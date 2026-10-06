// Incus 6 adapter. Local operations explicitly select the local: remote;
// query uses URL project parameters because 6 rejects its --project flag.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { arch, platform } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULTS } from "./config.mjs";
import { atomicWrite, launcherIdentity } from "./state.mjs";

const OWNER = "user.oc-vm.owner";
const READY = "user.oc-vm.provisioned";
const IMAGE = "user.oc-vm.image.fingerprint";
const SERIAL = "user.oc-vm.image.serial";
const CLOUD_RETRY = "user.oc-vm.cloud-init.retry-pending";

export function versionSupported(version) {
  const match = /^(\d+)\.(\d+)(?:\.|$|[-+])/.exec(version ?? "");
  return Boolean(
    match && (+match[1] > 6 || (+match[1] === 6 && +match[2] >= 23)),
  );
}

export function ipv4Range(cidr) {
  const [address, rawPrefix = "32"] = cidr.split("/");
  const octets = address.split(".").map(Number);
  const prefix = Number(rawPrefix);
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  )
    throw new Error(`Invalid IPv4 CIDR: ${cidr}`);
  const number = octets.reduce((total, n) => total * 256 + n, 0);
  const size = 2 ** (32 - prefix);
  const start = Math.floor(number / size) * size;
  return { start, end: start + size - 1, prefix };
}

export function bridgeAddress(cidr) {
  const { start, prefix } = ipv4Range(cidr);
  const address = [24, 16, 8, 0]
    .map((shift) => Math.floor((start + 1) / 2 ** shift) % 256)
    .join(".");
  return `${address}/${prefix}`;
}

export function selectImage(images, selector) {
  const matches = images.filter(
    (image) =>
      image.type === "virtual-machine" &&
      ["x86_64", "amd64"].includes(image.architecture) &&
      (image.aliases?.some((alias) => alias.name === selector) ||
        image.fingerprint === selector),
  );
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0].fingerprint))
    throw new Error(`Expected one amd64 virtual-machine image for ${selector}`);
  return matches[0];
}

// JSON is a YAML subset accepted by cloud-init; it preserves public keys and
// argument arrays without interpolating values into shell fragments.
export function cloudConfig(
  publicKey,
  uid,
  gid,
  { preserveHostKeys = false } = {},
) {
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !Number.isSafeInteger(gid) ||
    gid <= 0
  )
    throw new Error(
      "Run the launcher as a regular user with a non-root primary group",
    );
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(publicKey.trim()))
    throw new Error("Invalid VM public key");
  return `#cloud-config\n${JSON.stringify(
    {
      bootcmd: [
        [
          "cloud-init-per",
          "instance",
          "oc-host-group",
          "bash",
          "-c",
          'if getent group oc-host >/dev/null; then [ "$(getent group oc-host | cut -d: -f3)" = "$1" ]; else groupadd --non-unique --gid "$1" oc-host; fi',
          "oc-vm",
          String(gid),
        ],
        [
          "cloud-init-per",
          "instance",
          "oc-host-user",
          "bash",
          "-c",
          'if id ubuntu >/dev/null 2>&1; then usermod -u "$1" -g oc-host ubuntu; fi',
          "oc-vm",
          String(uid),
        ],
      ],
      users: [
        {
          name: "ubuntu",
          uid,
          primary_group: "oc-host",
          groups: ["sudo"],
          shell: "/bin/bash",
          lock_passwd: true,
          sudo: ["ALL=(ALL) NOPASSWD:ALL"],
          ssh_authorized_keys: [publicKey.trim()],
        },
      ],
      ssh_pwauth: false,
      disable_root: true,
      ...(preserveHostKeys ? { ssh_deletekeys: false } : {}),
      packages: ["openssh-server", "sudo"],
    },
    null,
    2,
  )}\n`;
}

export function createIncus({
  root,
  settings,
  stateDir,
  run,
  output = console.log,
  wait = sleep,
  now = Date.now,
  uid = process.getuid(),
  gid = process.getgid(),
  hostPlatform = platform(),
  hostArch = arch(),
  hasKvm = existsSync("/dev/kvm"),
}) {
  const owner = launcherIdentity(root);
  const name = settings.instance_name;
  const target = `local:${name}`;
  const project = settings.project;
  const identity = join(stateDir, "identity");
  let stage = "prerequisites";
  const local = (args, options = {}, selectedProject = project) =>
    run(
      ["incus", "--force-local", "--project", selectedProject, ...args],
      options,
    );

  function query(
    path,
    {
      project: selectedProject = "default",
      optional = false,
      method = "GET",
      data,
    } = {},
  ) {
    const endpoint = `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(selectedProject)}`;
    const args = [
      "incus",
      "--force-local",
      "query",
      "--raw",
      `local:${endpoint}`,
    ];
    if (method !== "GET")
      args.push("--request", method, "--wait", "--data", JSON.stringify(data));
    const result = run(args, { capture: true, quiet: true, check: false });
    if (result.status !== 0)
      throw new Error(
        result.stderr?.trim() || "Cannot contact the local Incus daemon",
      );
    const response = JSON.parse(result.stdout);
    if (response.type === "error" || response.error_code) {
      if (optional && response.error_code === 404) return null;
      throw new Error(
        response.error || `Incus API error ${response.error_code}`,
      );
    }
    if (response.metadata?.err) throw new Error(response.metadata.err);
    return response.metadata;
  }

  const instance = (optional = false) =>
    query(`/1.0/instances/${name}`, { project, optional });
  function ownedInstance(optional = false) {
    const value = instance(optional);
    if (
      value &&
      (value.type !== "virtual-machine" || value.config?.[OWNER] !== owner)
    )
      throw new Error(
        `Instance ${project}/${name} is not this launcher's virtual machine`,
      );
    return value;
  }
  const exec = (args, options = {}) =>
    local(["exec", target, "--force-noninteractive", "--", ...args], options);
  const setConfig = (values) =>
    local([
      "config",
      "set",
      target,
      ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    ]);

  function doctor() {
    if (hostPlatform !== "linux" || hostArch !== "x64")
      throw new Error("A local Linux x86_64 host is required");
    if (Number(process.versions.node.split(".")[0]) < 20)
      throw new Error("Node.js 20 or newer is required");
    if (uid <= 0 || gid <= 0)
      throw new Error(
        "Run the launcher as a regular user with a non-root primary group",
      );
    if (!hasKvm)
      throw new Error(
        "/dev/kvm is missing; run this launcher on your KVM host",
      );
    const version = run(["incus", "--force-local", "version", "local:"], {
      capture: true,
    }).stdout;
    const client = /Client version:\s*(\S+)/i.exec(version)?.[1];
    const server = query("/1.0");
    if (
      !versionSupported(client) ||
      !versionSupported(server.environment?.server_version)
    )
      throw new Error("Incus client and server 6.23 or newer are required");
    if (server.environment?.server_clustered)
      throw new Error(
        "Use a local standalone Incus daemon; clustered placement is not supported",
      );
    if (!/\bqemu\b/.test(server.environment?.driver ?? ""))
      throw new Error("The Incus daemon has no QEMU virtual-machine support");
    for (const args of [
      ["ssh", "-V"],
      ["ssh-keygen", "-?"],
      ["ip", "-j", "-4", "route", "show", "table", "all"],
    ])
      run(args, { quiet: true, check: args[0] !== "ssh-keygen" });
    output(
      `Incus client ${client}, server ${server.environment.server_version}; KVM host ready.`,
    );
  }

  function assertOwned(value, kind) {
    if (value && value.config?.[OWNER] !== owner)
      throw new Error(
        `${kind} already exists and is not owned by this launcher`,
      );
  }

  function ensureResources() {
    stage = "resource checks";
    const existingProject = query(`/1.0/projects/${project}`, {
      optional: true,
    });
    const pool = query(`/1.0/storage-pools/${settings.storage_pool}`, {
      optional: true,
    });
    const network = query(`/1.0/networks/${settings.network_name}`, {
      optional: true,
    });
    assertOwned(existingProject, `Project ${project}`);
    if (pool && settings.storage_pool === DEFAULTS.storage_pool)
      assertOwned(pool, `Pool ${settings.storage_pool}`);
    if (pool && !["dir", "btrfs", "zfs", "lvm", "ceph"].includes(pool.driver))
      throw new Error("Storage pool does not support VM block volumes");
    assertOwned(network, `Network ${settings.network_name}`);
    const address = bridgeAddress(settings.network_address);
    if (
      network &&
      (network.type !== "bridge" ||
        network.config["ipv4.address"] !== address ||
        network.config["ipv4.nat"] !== "true" ||
        network.config["ipv4.dhcp"] !== "true" ||
        network.config["ipv6.address"] !== "none")
    )
      throw new Error(
        "Existing launcher network differs from settings; choose another network_name or restore its settings",
      );
    if (
      existingProject &&
      (existingProject.config["features.images"] !== "true" ||
        existingProject.config["features.profiles"] !== "true" ||
        existingProject.config["features.storage.volumes"] !== "true" ||
        existingProject.config["features.networks"] !== "false")
    )
      throw new Error(
        "Existing launcher project has incompatible feature settings",
      );
    const desired = ipv4Range(address);
    const networks = query("/1.0/networks?recursion=1");
    for (const other of networks) {
      if (other.name === settings.network_name) continue;
      const cidr = other.config?.["ipv4.address"];
      if (!cidr || cidr === "none" || cidr === "auto") continue;
      const range = ipv4Range(cidr);
      if (desired.start <= range.end && range.start <= desired.end)
        throw new Error(
          `network_address overlaps Incus network ${other.name}; choose another private subnet`,
        );
    }
    const routes = JSON.parse(
      run(["ip", "-j", "-4", "route", "show", "table", "all"], {
        capture: true,
      }).stdout,
    );
    for (const route of routes) {
      if (
        !route.dst ||
        route.dst === "default" ||
        (network && route.dev === settings.network_name)
      )
        continue;
      const range = ipv4Range(route.dst);
      if (desired.start <= range.end && range.start <= desired.end)
        throw new Error(
          `network_address overlaps host route ${route.dst} (${route.dev}); choose another private subnet`,
        );
    }
    // Complete collision checks before creating anything. Shared daemon defaults
    // and unrelated pools, profiles, networks, and projects are never rewritten.
    stage = "resource creation";
    if (!pool) {
      if (settings.storage_pool !== DEFAULTS.storage_pool)
        throw new Error(
          "Configured storage_pool does not exist; create it in Incus first",
        );
      query("/1.0/storage-pools", {
        method: "POST",
        data: {
          name: settings.storage_pool,
          driver: "dir",
          config: { [OWNER]: owner },
        },
      });
    }
    if (!network)
      query("/1.0/networks", {
        method: "POST",
        data: {
          name: settings.network_name,
          type: "bridge",
          config: {
            [OWNER]: owner,
            "ipv4.address": address,
            "ipv4.nat": "true",
            "ipv4.dhcp": "true",
            "ipv6.address": "none",
          },
        },
      });
    if (!existingProject)
      query("/1.0/projects", {
        method: "POST",
        data: {
          name: project,
          config: {
            [OWNER]: owner,
            "features.images": "true",
            "features.profiles": "true",
            "features.storage.volumes": "true",
            "features.networks": "false",
          },
        },
      });
  }

  function ensureIdentity() {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    chmodSync(stateDir, 0o700);
    if (!existsSync(identity))
      run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", identity]);
    chmodSync(identity, 0o600);
    if (!existsSync(`${identity}.pub`))
      atomicWrite(
        `${identity}.pub`,
        run(["ssh-keygen", "-y", "-f", identity], { capture: true }).stdout,
      );
    return readFileSync(`${identity}.pub`, "utf8").trim();
  }

  function createInstance() {
    stage = "image resolution";
    const separator = settings.image.indexOf(":");
    const remote = settings.image.slice(0, separator);
    const selector = settings.image.slice(separator + 1);
    const images = JSON.parse(
      local(["image", "list", `${remote}:`, selector, "--format=json"], {
        capture: true,
      }).stdout,
    );
    const image = selectImage(images, selector);
    const userData = cloudConfig(ensureIdentity(), uid, gid);
    if (remote !== "local")
      local([
        "image",
        "copy",
        `${remote}:${image.fingerprint}`,
        "local:",
        "--vm",
        "--target-project",
        project,
      ]);
    stage = "VM creation";
    const devices = {
      root: {
        type: "disk",
        path: "/",
        pool: settings.storage_pool,
        size: `${settings.disk_gb}GiB`,
      },
      eth0: { type: "nic", name: "eth0", network: settings.network_name },
    };
    if (settings.share_host_folder)
      devices.launcher = {
        type: "disk",
        source: realpathSync(root),
        path: "/host-workspace",
      };
    query("/1.0/instances", {
      project,
      method: "POST",
      data: {
        name,
        type: "virtual-machine",
        architecture: "x86_64",
        profiles: [],
        devices,
        config: {
          [OWNER]: owner,
          [READY]: "false",
          [IMAGE]: image.fingerprint,
          [SERIAL]: image.properties?.serial ?? "unknown",
          "limits.cpu": String(settings.cpus),
          "limits.memory": `${settings.memory_mb}MiB`,
          "cloud-init.user-data": userData,
        },
        source: { type: "image", fingerprint: image.fingerprint },
      },
    });
    atomicWrite(
      join(stateDir, "image.json"),
      JSON.stringify(
        {
          source: settings.image,
          fingerprint: image.fingerprint,
          serial: image.properties?.serial ?? null,
        },
        null,
        2,
      ) + "\n",
    );
    output(
      `Created ${project}/${name} from ${image.fingerprint} (${image.properties?.serial ?? "unknown serial"}).`,
    );
  }

  function reconcile(value) {
    const devices = value.devices;
    if (
      devices.root?.pool !== settings.storage_pool ||
      devices.eth0?.network !== settings.network_name
    )
      throw new Error(
        "Existing VM disk/pool/network differs from settings; restore settings or create a separate VM",
      );
    const oldSize = /^(\d+)GiB$/.exec(devices.root.size);
    if (!oldSize || settings.disk_gb < Number(oldSize[1]))
      throw new Error(
        "VM disks cannot be shrunk; restore disk_gb or create a separate VM",
      );
    const diskChanged = settings.disk_gb > Number(oldSize[1]);
    const launcher = devices.launcher;
    if (
      launcher &&
      (launcher.source !== realpathSync(root) ||
        launcher.path !== "/host-workspace" ||
        launcher.type !== "disk")
    )
      throw new Error("Existing launcher share differs from this checkout");
    const resourcesChanged =
      value.config["limits.cpu"] !== String(settings.cpus) ||
      value.config["limits.memory"] !== `${settings.memory_mb}MiB`;
    const sharingChanged = Boolean(launcher) !== settings.share_host_folder;
    if (
      (resourcesChanged || sharingChanged || diskChanged) &&
      value.status !== "Stopped"
    )
      throw new Error(
        "Stop the VM with scripts/vm.sh stop before changing CPU, memory, disk, or sharing",
      );
    if (diskChanged) {
      setConfig({ [READY]: "false" });
      value.config[READY] = "false";
      local([
        "config",
        "device",
        "set",
        target,
        "root",
        `size=${settings.disk_gb}GiB`,
      ]);
    }
    if (resourcesChanged)
      setConfig({
        "limits.cpu": String(settings.cpus),
        "limits.memory": `${settings.memory_mb}MiB`,
      });
    if (sharingChanged) {
      if (settings.share_host_folder)
        local([
          "config",
          "device",
          "add",
          target,
          "launcher",
          "disk",
          `source=${realpathSync(root)}`,
          "path=/host-workspace",
        ]);
      else local(["config", "device", "remove", target, "launcher"]);
    }
  }

  async function waitForAgent() {
    stage = "guest-agent readiness";
    const deadline = now() + 180000;
    while (now() < deadline) {
      try {
        const result = exec(["true"], {
          quiet: true,
          check: false,
          timeout: 5000,
        });
        if (result.status === 0) return;
      } catch (error) {
        if (error.code !== "ETIMEDOUT") throw error;
      }
      await wait(1000);
    }
    throw new Error(
      `Guest agent did not become ready within 180 seconds; inspect incus --force-local --project ${project} console local:${name}`,
    );
  }

  function waitForCloudInit() {
    let failure;
    try {
      const result = exec(["cloud-init", "status", "--wait", "--long"], {
        check: false,
        timeout: 600000,
      });
      if (result.status === 0) return;
      failure = new Error(
        `cloud-init status exited with ${result.status ?? result.signal}`,
      );
    } catch (error) {
      failure = error;
    }
    // The agent is already available, so collect guest diagnostics without SSH.
    // A failed diagnostic must not replace the original error or stall retries.
    for (const args of [
      ["cloud-init", "status", "--long"],
      ["tail", "-n", "80", "/var/log/cloud-init-output.log"],
      ["tail", "-n", "60", "/var/log/cloud-init.log"],
      ["ip", "-br", "address"],
      ["ip", "-4", "route"],
      ["resolvectl", "status"],
      ["cat", "/etc/resolv.conf"],
      ["timeout", "5", "getent", "ahostsv4", "archive.ubuntu.com"],
    ]) {
      output(`Cloud-init diagnostics: ${args.join(" ")}`);
      try {
        const result = exec(args, {
          capture: true,
          quiet: true,
          check: false,
          timeout: 10000,
        });
        if (result.stdout?.trim()) output(result.stdout.trim());
        if (result.stderr?.trim()) output(result.stderr.trim());
        if (result.status !== 0)
          output(`Diagnostic exited with ${result.status ?? result.signal}`);
      } catch (error) {
        output(`Could not collect diagnostic: ${error.message}`);
      }
    }
    throw failure;
  }

  function provision() {
    stage = "cloud-init";
    waitForCloudInit();
    exec([
      "bash",
      "-c",
      '[ "$(id -u ubuntu)" = "$1" ] && [ "$(id -g ubuntu)" = "$2" ] || { echo "Guest UID/GID differs from host; inspect cloud-init before provisioning" >&2; exit 1; }',
      "oc-vm",
      String(uid),
      String(gid),
    ]);
    setConfig({ [READY]: "false" });
    stage = "provisioning uploads";
    exec(["install", "-d", "-m", "700", "/tmp/oc-vm", "/tmp/oc-vm/shared"]);
    const uploads = readdirSync(join(root, ".vm"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => [
        join(root, ".vm", entry.name),
        `/tmp/oc-vm/${entry.name}`,
      ]);
    for (const script of [
      "init.sh",
      "install-dependencies.sh",
      "start-dependencies.sh",
      "run.sh",
      "test.sh",
    ])
      uploads.push([
        join(root, "scripts", script),
        `/tmp/oc-vm/shared/${script}`,
      ]);
    uploads.push([
      join(root, ".devcontainer/shell-aliases.sh"),
      "/tmp/oc-vm/shared/shell-aliases.sh",
    ]);
    for (const [source, destination] of uploads)
      local(["file", "push", source, `${target}${destination}`]);
    stage = "system provisioning";
    exec(["bash", "/tmp/oc-vm/provision.sh", JSON.stringify(settings)]);
    setConfig({ [READY]: "true" });
  }

  async function retryInitialCloudInit(value) {
    stage = "cloud-init recovery";
    if (value.config[READY] === "true")
      throw new Error(
        "Cloud-init recovery is limited to failed initial setup; use provision for an initialized VM",
      );
    const result = exec(["cloud-init", "status", "--format=json"], {
      capture: true,
      quiet: true,
      check: false,
      timeout: 10000,
    });
    const report = JSON.parse(result.stdout);
    if (result.status === 0 && report.status === "done") {
      setConfig({ [CLOUD_RETRY]: "false" });
      return;
    }
    const pending = value.config[CLOUD_RETRY] === "true";
    const packageFailure =
      report.stage === null &&
      report.status === "error" &&
      report.errors?.length > 0 &&
      report.errors.every(
        (error) =>
          typeof error === "string" &&
          error.startsWith("('package_update_upgrade_install',"),
      ) &&
      ["init-local", "init", "modules-config"].every(
        (stage) =>
          report[stage]?.finished != null &&
          !report[stage].errors?.length &&
          !Object.keys(report[stage].recoverable_errors ?? {}).length,
      ) &&
      report["modules-final"]?.finished != null;
    if (!packageFailure && !(pending && report.status === "not started"))
      throw new Error(
        "Cloud-init recovery requires a completed first boot with only package installation errors",
      );
    // A full cloud-init retry is limited to bootstrap, before our provisioner has
    // installed services or credentials. Retain logs, machine ID, disks and keys.
    const untouched = exec(["test", "!", "-e", "/opt/oc-vm/provision.sh"], {
      quiet: true,
      check: false,
      timeout: 10000,
    });
    if (untouched.status !== 0)
      throw new Error(
        "System provisioning has already started; repair cloud-init without resetting it",
      );
    for (const hostname of ["archive.ubuntu.com", "security.ubuntu.com"])
      exec(["timeout", "10", "getent", "ahostsv4", hostname], {
        timeout: 15000,
      });
    const userData = cloudConfig(ensureIdentity(), uid, gid, {
      preserveHostKeys: true,
    });
    // NoCloud seed templates are normally applied on creation, so changing the
    // Incus config alone does not replace the existing guest's seed file.
    exec([
      "python3",
      "-c",
      'from pathlib import Path; import sys; p = Path("/var/lib/cloud/seed/nocloud-net/user-data"); original = p.read_bytes(); backup = p.with_name("user-data.oc-vm-before-retry"); backup.exists() or backup.write_bytes(original); backup.chmod(0o600); p.write_text(sys.argv[1]); p.chmod(0o600)',
      userData,
    ]);
    setConfig({ "cloud-init.user-data": userData, [CLOUD_RETRY]: "true" });
    output(
      "Retrying initial cloud-init on the existing VM; preserving SSH host keys and boot logs.",
    );
    exec(["cloud-init", "clean"], { timeout: 30000 });
    local(["restart", target], { timeout: 120000 });
    await waitForAgent();
    stage = "cloud-init recovery";
    waitForCloudInit();
    setConfig({ [CLOUD_RETRY]: "false" });
  }

  async function up({ forceProvision = false, retryCloudInit = false } = {}) {
    try {
      stage = "prerequisites";
      doctor();
      stage = "instance checks";
      let value = ownedInstance(true);
      if (retryCloudInit && !value)
        throw new Error(
          "Cloud-init recovery requires an existing VM; run up to create one",
        );
      if (retryCloudInit && value.config[READY] === "true")
        throw new Error(
          "Cloud-init recovery is limited to failed initial setup; use provision for an initialized VM",
        );
      if (value && !existsSync(identity))
        throw new Error(
          `VM login key is missing from ${stateDir}; restore host state before connecting`,
        );
      ensureResources();
      if (!value) {
        createInstance();
        value = ownedInstance();
      }
      stage = "instance configuration";
      reconcile(value);
      if (forceProvision) {
        stage = "provisioning request";
        setConfig({ [READY]: "false" });
        value.config[READY] = "false";
      }
      stage = "VM start";
      if (value.status === "Stopped") local(["start", target]);
      else if (value.status !== "Running")
        throw new Error(
          `VM is ${value.status}; resolve its state in Incus before retrying`,
        );
      await waitForAgent();
      if (retryCloudInit || value.config[CLOUD_RETRY] === "true")
        await retryInitialCloudInit(value);
      if (forceProvision || value.config[READY] !== "true") provision();
      output(`VM ready: ${project}/${name}`);
    } catch (error) {
      throw new Error(
        `${stage} failed: ${error.message}. Created resources are retained; fix the cause and rerun scripts/vm.sh up.`,
      );
    }
  }

  function connection() {
    ownedInstance();
    if (!existsSync(identity))
      throw new Error(`Missing VM login key: ${identity}`);
    const state = query(`/1.0/instances/${name}/state`, { project });
    // VM interfaces use predictable guest names (for example enp5s0), which
    // need not match the name of the Incus NIC device.
    const addresses = Object.values(state.network ?? {}).flatMap(
      (nic) => nic.addresses ?? [],
    );
    const subnet = ipv4Range(settings.network_address);
    const matches = [
      ...new Set(
        addresses
          .filter((value) => {
            if (value.family !== "inet" || value.scope !== "global")
              return false;
            const range = ipv4Range(value.address);
            return range.start > subnet.start && range.start < subnet.end;
          })
          .map((value) => value.address),
      ),
    ];
    if (matches.length !== 1)
      throw new Error(
        "VM must have one management IPv4 address; run scripts/vm.sh up first",
      );
    const address = matches[0];
    return `Host oc-dev\n  HostName ${address}\n  User ubuntu\n  IdentityFile "${identity.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"\n`;
  }

  async function restart() {
    ownedInstance();
    local(["restart", target]);
    await waitForAgent();
  }
  function stop() {
    const value = ownedInstance();
    if (value.status !== "Stopped") local(["stop", target]);
  }
  function status() {
    const value = ownedInstance(true);
    output(
      JSON.stringify(
        {
          project,
          instance: name,
          status: value?.status ?? "Not created",
          provisioned: value?.config[READY] === "true",
          fingerprint: value?.config[IMAGE],
          serial: value?.config[SERIAL],
        },
        null,
        2,
      ),
    );
  }
  function destroy() {
    // Preflight every named object before deleting anything. Resource names can
    // collide with unrelated daemon resources, so only remove objects carrying
    // this checkout's ownership marker. A user-selected storage pool is shared.
    const instance = ownedInstance(true);
    const existingProject = query(`/1.0/projects/${project}`, {
      optional: true,
      project: "default",
    });
    const network = query(`/1.0/networks/${settings.network_name}`, {
      optional: true,
      project: "default",
    });
    const pool = query(`/1.0/storage-pools/${settings.storage_pool}`, {
      optional: true,
      project: "default",
    });
    assertOwned(existingProject, `Project ${project}`);
    assertOwned(network, `Network ${settings.network_name}`);
    if (settings.storage_pool === DEFAULTS.storage_pool)
      assertOwned(pool, `Pool ${settings.storage_pool}`);

    if (instance) {
      output(`Deleting VM ${project}/${name} and its disks and snapshots.`);
      local(["delete", target, "--force"]);
    }
    if (existingProject) {
      output(`Deleting Incus project ${project} and its remaining contents.`);
      // Incus projects can retain project-local images (including the copied
      // cloud image) after the VM is deleted. 6.23 requires --force to remove
      // those remaining project resources along with the project.
      local(["project", "delete", project, "--force"], {}, "default");
    }
    if (network) {
      output(`Deleting Incus network ${settings.network_name}.`);
      local(["network", "delete", settings.network_name], {}, "default");
    }
    if (pool && settings.storage_pool === DEFAULTS.storage_pool) {
      output(`Deleting dedicated Incus storage pool ${settings.storage_pool}.`);
      local(["storage", "delete", settings.storage_pool], {}, "default");
    }
  }
  return {
    doctor,
    up,
    connection,
    stop,
    restart,
    status,
    destroy,
    fingerprint: () => {
      ownedInstance();
      exec(["ssh-keygen", "-lf", "/etc/ssh/ssh_host_ed25519_key.pub"]);
    },
  };
}
