// Model the Incus 6.23 command/API boundary without a daemon or KVM. These tests
// verify ordering and retries; live guest behavior is a separate host checklist.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DEFAULTS } from "./config.mjs";
import {
  bridgeAddress,
  cloudConfig,
  createIncus,
  selectImage,
  versionSupported,
  workspaceExecutionNeedsKernelRestart,
} from "./incus.mjs";
import { launcherIdentity, stateDirectory } from "./state.mjs";

const fingerprint = "a".repeat(64);
const image = {
  fingerprint,
  type: "virtual-machine",
  architecture: "x86_64",
  aliases: [{ name: "ubuntu/24.04/cloud" }],
  properties: { serial: "20261005_07:42" },
};
const ownerKey = "user.oc-vm.owner";
const readyKey = "user.oc-vm.provisioned";

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "oc-incus-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "launcher");
  const home = join(directory, "home");
  for (const subdir of [".vm", "scripts", ".devcontainer"])
    mkdirSync(join(root, subdir), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(root, ".vm/provision.sh"), "#!/bin/bash\n");
  writeFileSync(join(root, ".vm/configure-ssh.sh"), "# fixture\n");
  for (const script of [
    "install-dependencies.sh",
    "start-dependencies.sh",
    "run.sh",
    "test.sh",
  ])
    writeFileSync(join(root, "scripts", script), "fixture");
  writeFileSync(join(root, ".devcontainer/shell-aliases.sh"), "fixture");
  const settings = { ...DEFAULTS, ...overrides };
  const stateDir = stateDirectory({ root, home, env: {}, settings });
  const calls = [];
  const messages = [];
  const resources = new Map();
  const model = {
    client: "6.23",
    server: "6.23",
    driver: "lxc | qemu",
    routes: [],
    images: [image],
    agentReady: true,
    cloudInitStatus: 0,
    cloudInitError: null,
    diagnosticsFail: false,
    fail: null,
    offline: false,
    runningKernel: "6.17.0-1-generic",
    hweKernel: "6.17.0-1-generic",
  };
  let clock = 0;
  const result = (metadata) => ({
    status: 0,
    stdout: JSON.stringify({ type: "sync", metadata }),
  });
  function run(args, options = {}) {
    calls.push({ args, options });
    if (args[0] === "ssh-keygen" && args.includes("-f")) {
      const key = args[args.indexOf("-f") + 1];
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(key, "private fixture", { mode: 0o600 });
      writeFileSync(`${key}.pub`, "ssh-ed25519 AAAA fixture\n");
    }
    if (args[0] === "ip")
      return { status: 0, stdout: JSON.stringify(model.routes) };
    if (args[0] !== "incus") return { status: 0, stdout: "" };
    assert.equal(args[1], "--force-local");
    if (args.includes("version")) {
      assert.equal(args.at(-1), "local:");
      return {
        status: 0,
        stdout: `Client version: ${model.client}\nServer version: ${model.server}\n`,
      };
    }
    if (args.includes("query")) {
      assert.equal(
        args.includes("--project"),
        false,
        "6.23 query rejects --project",
      );
      const endpoint = args[args.indexOf("--raw") + 1];
      assert.ok(endpoint.startsWith("local:/1.0"));
      const url = new URL(endpoint.slice(6), "http://fixture");
      const path = url.pathname;
      const selectedProject = url.searchParams.get("project");
      assert.equal(
        selectedProject,
        path.includes("instances") ? settings.project : "default",
      );
      if (model.fail === "permission")
        return {
          status: 0,
          stdout: JSON.stringify({
            type: "error",
            error_code: 403,
            error: "Permission denied",
          }),
        };
      if (path === "/1.0")
        return result({
          environment: { server_version: model.server, driver: model.driver },
        });
      if (path === "/1.0/networks" && url.searchParams.has("recursion"))
        return result(
          [...resources.entries()]
            .filter(([key]) => key.startsWith("/1.0/networks/"))
            .map(([, value]) => value),
        );
      if (path.endsWith("/state"))
        return result({
          network: {
            enp5s0: {
              addresses: [
                { family: "inet", scope: "global", address: "192.168.121.10" },
              ],
            },
            docker0: {
              addresses: [
                { family: "inet", scope: "global", address: "172.17.0.1" },
              ],
            },
          },
        });
      if (args.includes("--request")) {
        assert.equal(args[args.indexOf("--request") + 1], "POST");
        assert.ok(args.includes("--wait"));
        const data = JSON.parse(args[args.indexOf("--data") + 1]);
        if (
          model.fail === "create" ||
          (model.fail === "project" && path === "/1.0/projects")
        )
          throw new Error("Interrupted creation");
        const value =
          path === "/1.0/instances"
            ? {
                ...data,
                status: "Stopped",
                persistentData: "database and tools",
              }
            : data;
        resources.set(`${path}/${data.name}`, value);
        return result({});
      }
      if (!resources.has(path))
        return {
          status: 0,
          stdout: JSON.stringify({
            type: "error",
            error_code: 404,
            error: "Not found",
          }),
        };
      return result(resources.get(path));
    }
    assert.equal(args[2], "--project");
    assert.equal(args[3], settings.project);
    const cli = args.slice(4);
    if (cli[0] === "image") {
      if (model.offline) throw new Error("Image server unavailable");
      if (cli[1] === "list")
        return { status: 0, stdout: JSON.stringify(model.images) };
      assert.deepEqual(cli, [
        "image",
        "copy",
        `images:${fingerprint}`,
        "local:",
        "--vm",
        "--target-project",
        settings.project,
      ]);
      return { status: 0 };
    }
    const vm = resources.get(`/1.0/instances/${settings.instance_name}`);
    const targetIndex =
      cli[0] === "config"
        ? cli[1] === "device"
          ? 3
          : 2
        : cli[0] === "file"
          ? 3
          : 1;
    assert.ok(cli[targetIndex].startsWith(`local:${settings.instance_name}`));
    if (cli[0] === "start") {
      if (model.fail === "start") throw new Error("Interrupted start");
      vm.status = "Running";
    }
    if (cli[0] === "stop") vm.status = "Stopped";
    if (cli[0] === "restart") {
      vm.status = "Running";
      model.runningKernel = model.hweKernel;
    }
    if (cli[0] === "config" && cli[1] === "set")
      for (const assignment of cli.slice(3)) {
        const at = assignment.indexOf("=");
        vm.config[assignment.slice(0, at)] = assignment.slice(at + 1);
      }
    if (cli[0] === "config" && cli[1] === "device") {
      if (cli[2] === "set")
        for (const assignment of cli.slice(5)) {
          const [key, value] = assignment.split("=");
          vm.devices[cli[4]][key] = value;
        }
    }
    if (cli[0] === "exec") {
      const guest = cli.slice(cli.indexOf("--") + 1);
      if (guest[0] === "uname" && guest[1] === "-r")
        return { status: 0, stdout: `${model.runningKernel}\n` };
      if (guest.includes("configure-git") && model.fail === "git-config")
        throw new Error("Guest Git configuration failed");
      if (guest[0] === "true" && !model.agentReady) return { status: 1 };
      if (guest[0] === "cloud-init" && model.fail === "cloud-init")
        throw new Error("Cloud-init failed");
      if (guest[0] === "cloud-init") {
        if (guest.includes("--wait") && model.cloudInitError)
          throw model.cloudInitError;
        if (!guest.includes("--wait") && model.diagnosticsFail)
          throw new Error("Guest diagnostics unavailable");
        return {
          status: model.cloudInitStatus,
          stdout: model.cloudInitStatus
            ? "status: error\nerrors: ['Failed package installation']\n"
            : "status: done\n",
        };
      }
      if (guest[0] === "test" && model.fail === "mount")
        throw new Error("Workspace mount unavailable");
      if (guest[0] === "tail") {
        if (model.diagnosticsFail)
          throw new Error("Guest diagnostics unavailable");
        return {
          status: 0,
          stdout: "Temporary failure resolving archive.ubuntu.com\n",
        };
      }
      if (
        guest[1] === "/workspace/.vm/provision.sh" &&
        model.fail === "provision"
      )
        throw new Error("Interrupted provision");
    }
    return { status: 0, stdout: "" };
  }
  const runtime = () =>
    createIncus({
      root,
      settings,
      stateDir,
      run,
      output: (value) => messages.push(value),
      uid: 1234,
      gid: 2345,
      hostPlatform: "linux",
      hostArch: "x64",
      hasKvm: true,
      now: () => clock,
      wait: async (milliseconds) => {
        clock += milliseconds;
      },
    });
  return {
    root,
    home,
    settings,
    stateDir,
    calls,
    resources,
    model,
    runtime,
    messages,
    vm: () => resources.get(`/1.0/instances/${settings.instance_name}`),
    writes: () =>
      calls.filter(
        ({ args }) =>
          args.includes("--request") ||
          args.includes("start") ||
          args.includes("set") ||
          args.includes("push"),
      ),
  };
}

test("6.23 baseline, subnet gateway and VM image selection", () => {
  for (const version of ["6.23", "6.23.0", "6.24", "7.0"])
    assert.equal(versionSupported(version), true);
  for (const version of ["6.22", "5.23", "unknown", undefined])
    assert.equal(versionSupported(version), false);
  assert.equal(bridgeAddress("192.168.121.99/24"), "192.168.121.1/24");
  assert.equal(bridgeAddress("10.17.99.20/16"), "10.17.0.1/16");
  assert.deepEqual(
    selectImage(
      [
        image,
        { ...image, type: "container" },
        { ...image, architecture: "aarch64" },
      ],
      "ubuntu/24.04/cloud",
    ),
    image,
  );
  assert.throws(
    () => selectImage([{ ...image, type: "container" }], "ubuntu/24.04/cloud"),
    /virtual-machine/,
  );
  const cloud = JSON.parse(
    cloudConfig("ssh-ed25519 AAAA fixture", 1234, 2345)
      .split("\n")
      .slice(1)
      .join("\n"),
  );
  assert.equal(cloud.users[0].name, "ubuntu");
  assert.equal(cloud.users[0].uid, 1234);
  assert.equal(cloud.users[0].primary_group, "oc-host");
  assert.ok(cloud.bootcmd[0].includes("2345"));
  assert.equal(cloud.ssh_pwauth, false);
  assert.equal(cloud.users[0].lock_passwd, true);
  assert.deepEqual(cloud.packages, ["openssh-server", "sudo"]);
  assert.throws(() => cloudConfig("ssh-ed25519 AAAA", 0, 1), /regular user/);
  assert.equal(workspaceExecutionNeedsKernelRestart("6.8.0-79-generic"), true);
  assert.equal(workspaceExecutionNeedsKernelRestart("6.10.0-1-generic"), true);
  assert.equal(workspaceExecutionNeedsKernelRestart("6.11.0-1-generic"), false);
  assert.equal(workspaceExecutionNeedsKernelRestart("7.0.0-1-generic"), false);
  assert.throws(() => workspaceExecutionNeedsKernelRestart("unknown"), /parse/);
});

test("doctor inspects prerequisites without creating resources or keys", (t) => {
  const f = fixture(t);
  f.runtime().doctor();
  assert.equal(f.writes().length, 0);
  assert.equal(existsSync(f.stateDir), false);
  f.model.client = "6.22";
  assert.throws(() => f.runtime().doctor(), /6.23/);
  f.model.client = "6.24";
  f.model.server = "6.25";
  f.runtime().doctor();
  f.model.driver = "lxc";
  assert.throws(() => f.runtime().doctor(), /QEMU/);
});

test("status reports an absent VM without creating resources", (t) => {
  const f = fixture(t);
  f.runtime().status();
  assert.equal(JSON.parse(f.messages.at(-1)).status, "Not created");
  assert.equal(f.writes().length, 0);
  assert.equal(existsSync(f.stateDir), false);
});

test("fresh VM mounts the writable workspace before provisioning and keeps its login key on host", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  const vm = f.vm();
  assert.equal(vm.type, "virtual-machine");
  assert.deepEqual(vm.profiles, []);
  assert.equal(vm.config[ownerKey], launcherIdentity(f.root));
  assert.equal(vm.config[readyKey], "true");
  assert.equal(vm.config["limits.memory"], "43008MiB");
  assert.equal(vm.devices.root.size, "100GiB");
  assert.equal(vm.devices.workspace.path, "/workspace");
  assert.ok(vm.config["cloud-init.user-data"].startsWith("#cloud-config"));
  assert.equal(
    f.resources.get("/1.0/storage-pools/oc-development").driver,
    "dir",
  );
  assert.equal(
    f.resources.get("/1.0/networks/oc-development").config["ipv4.address"],
    "192.168.121.1/24",
  );
  assert.equal(
    f.resources.get("/1.0/projects/oc-development").config["features.networks"],
    "false",
  );
  const creation = f.calls.findIndex(
    ({ args }) =>
      args.includes("--data") &&
      JSON.parse(args.at(-1)).type === "virtual-machine",
  );
  assert.ok(creation < f.calls.findIndex(({ args }) => args.includes("start")));
  const cloud = f.calls.findIndex(({ args }) => args.includes("cloud-init"));
  const mount = f.calls.findIndex(
    ({ args }) =>
      args.includes("test") && args.includes("/workspace/.vm/provision.sh"),
  );
  const provision = f.calls.findIndex(
    ({ args }) =>
      args.includes("bash") &&
      args.includes("/workspace/.vm/provision.sh") &&
      args.at(-1) === "https",
  );
  assert.ok(cloud >= 0 && cloud < mount && mount < provision);
  assert.equal(vm.devices.workspace.source, f.root);
  assert.equal(vm.devices.workspace.readonly, undefined);
  assert.equal(
    f.calls.some(({ args }) => args.includes("push")),
    false,
  );
  assert.equal(statSync(join(f.stateDir, "identity")).mode & 0o777, 0o600);
  assert.equal(statSync(f.stateDir).mode & 0o777, 0o700);
  assert.equal(vm.config["user.oc-vm.image.fingerprint"], fingerprint);
  assert.deepEqual(f.runtime().connection(), {
    address: "192.168.121.10",
    identity: join(f.stateDir, "identity"),
  });
});

test("provisioning activates the HWE kernel before marking the VM ready", async (t) => {
  const f = fixture(t);
  f.model.runningKernel = "6.8.0-79-generic";
  f.model.hweKernel = "6.17.0-1-generic";
  await f.runtime().up();
  const provision = f.calls.findIndex(
    ({ args }) =>
      args.includes("bash") && args.includes("/workspace/.vm/provision.sh"),
  );
  const restart = f.calls.findIndex(
    ({ args }) => args.includes("restart") && args.includes("local:oc-dev"),
  );
  const ready = f.calls.findIndex(
    ({ args }) =>
      args.includes("config") && args.includes("user.oc-vm.provisioned=true"),
  );
  assert.ok(provision >= 0 && provision < restart && restart < ready);
  assert.equal(f.model.runningKernel, "6.17.0-1-generic");
  assert.equal(f.vm().config[readyKey], "true");
});

test("existing disks survive offline stop/start, restart and reprovision", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  const original = f.vm();
  f.model.offline = true;
  f.calls.length = 0;
  f.runtime().stop();
  await f.runtime().up();
  await f.runtime().restart();
  await f.runtime().up({ forceProvision: true });
  assert.equal(f.vm(), original);
  assert.equal(original.persistentData, "database and tools");
  assert.equal(
    f.calls.some(({ args }) => args.includes("image")),
    false,
  );
  assert.equal(
    f.calls.filter(
      ({ args }) =>
        args.includes("bash") && args.includes("/workspace/.vm/provision.sh"),
    ).length,
    1,
  );
  f.runtime().status();
  assert.ok(f.messages.at(-1).includes(fingerprint));
});

for (const [failure, stage] of [
  ["start", "VM start"],
  ["cloud-init", "cloud-init"],
  ["mount", "workspace mount"],
  ["provision", "system provisioning"],
]) {
  test(`interrupted ${failure} retains VM and resumes provisioning on retry`, async (t) => {
    const f = fixture(t);
    f.model.fail = failure;
    await assert.rejects(f.runtime().up(), new RegExp(`${stage} failed`));
    const vm = f.vm();
    assert.ok(vm);
    assert.equal(vm.config[readyKey], "false");
    f.model.fail = null;
    await f.runtime().up();
    assert.equal(f.vm(), vm);
    assert.equal(vm.config[readyKey], "true");
    assert.equal(
      f.calls.filter(
        ({ args }) => args.includes("image") && args.includes("list"),
      ).length,
      1,
    );
  });
}

test("failed reprovision remains pending for ordinary up", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  f.model.fail = "provision";
  await assert.rejects(
    f.runtime().up({ forceProvision: true }),
    /system provisioning/,
  );
  assert.equal(f.vm().config[readyKey], "false");
  f.model.fail = null;
  await f.runtime().up();
  assert.equal(f.vm().config[readyKey], "true");
});

for (const status of [1, 2]) {
  test(`cloud-init exit ${status} reports guest errors and stops before provisioning`, async (t) => {
    const f = fixture(t);
    f.model.cloudInitStatus = status;
    await assert.rejects(
      f.runtime().up(),
      new RegExp(`cloud-init failed: cloud-init status exited with ${status}`),
    );
    assert.ok(
      f.messages.some((message) =>
        message.includes("Failed package installation"),
      ),
    );
    assert.ok(
      f.messages.some((message) =>
        message.includes("Temporary failure resolving"),
      ),
    );
    assert.equal(
      f.calls.some(({ args }) => args.includes("push")),
      false,
    );
    const vm = f.vm();
    assert.equal(vm.config[readyKey], "false");
    f.model.cloudInitStatus = 0;
    await f.runtime().up();
    assert.equal(f.vm(), vm);
    assert.equal(vm.config[readyKey], "true");
  });
}

test("cloud-init timeout retains the original failure when diagnostics also fail", async (t) => {
  const f = fixture(t);
  f.model.cloudInitError = Object.assign(
    new Error("cloud-init wait timed out"),
    {
      code: "ETIMEDOUT",
    },
  );
  f.model.diagnosticsFail = true;
  await assert.rejects(
    f.runtime().up(),
    /cloud-init failed: cloud-init wait timed out/,
  );
  assert.ok(
    f.messages.some((message) =>
      message.includes("Guest diagnostics unavailable"),
    ),
  );
  assert.equal(f.vm().config[readyKey], "false");
  assert.equal(
    f.calls.some(({ args }) => args.includes("push")),
    false,
  );
});

test("guest-agent readiness has a finite deadline and retains the VM", async (t) => {
  const f = fixture(t);
  f.model.agentReady = false;
  await assert.rejects(f.runtime().up(), /guest-agent readiness failed/);
  assert.ok(f.vm());
  f.model.agentReady = true;
  await f.runtime().up();
});

for (const kind of ["projects", "storage-pools", "networks"]) {
  test(`unowned ${kind} collision stops before resource mutation`, async (t) => {
    const f = fixture(t);
    f.resources.set(`/1.0/${kind}/oc-development`, { config: {} });
    await assert.rejects(f.runtime().up(), /not owned/);
    assert.equal(f.writes().length, 0);
  });
}

test("unowned instance, including a container, is never started or reprovisioned", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  f.vm().type = "container";
  f.calls.length = 0;
  await assert.rejects(f.runtime().up(), /not this launcher's virtual machine/);
  assert.equal(f.writes().length, 0);
});

test("route and managed-network subnet overlap are rejected before writes", async (t) => {
  for (const conflict of ["route", "network"]) {
    const f = fixture(t);
    if (conflict === "route")
      f.model.routes = [{ dst: "192.168.0.0/16", dev: "vpn0" }];
    else
      f.resources.set("/1.0/networks/other", {
        name: "other",
        config: { "ipv4.address": "192.168.121.1/24" },
      });
    await assert.rejects(f.runtime().up(), /overlaps/);
    assert.equal(f.writes().length, 0);
  }
});

test("an existing custom pool is used without modifying its configuration", async (t) => {
  const f = fixture(t, { storage_pool: "existing" });
  const pool = { driver: "zfs", config: { source: "existing-data" } };
  f.resources.set("/1.0/storage-pools/existing", pool);
  await f.runtime().up();
  assert.equal(f.vm().devices.root.pool, "existing");
  assert.deepEqual(pool, {
    driver: "zfs",
    config: { source: "existing-data" },
  });
  const missing = fixture(t, { storage_pool: "absent" });
  await assert.rejects(missing.runtime().up(), /does not exist/);
  assert.equal(missing.writes().length, 0);
});

test("CPU, memory and disk growth apply only after stop; disk shrink fails", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  const vm = f.vm();
  Object.assign(f.settings, {
    cpus: 4,
    memory_mb: 16384,
    disk_gb: 250,
  });
  await assert.rejects(f.runtime().up(), /Stop the VM/);
  f.runtime().stop();
  await f.runtime().up();
  assert.equal(vm.config["limits.cpu"], "4");
  assert.equal(vm.config["limits.memory"], "16384MiB");
  assert.equal(vm.devices.workspace.path, "/workspace");
  assert.equal(vm.devices.root.size, "250GiB");
  assert.equal(vm.config[readyKey], "true");
  assert.equal(vm.persistentData, "database and tools");
  f.settings.disk_gb = 200;
  await assert.rejects(f.runtime().up(), /cannot be shrunk/);
});

test("permission failures are not treated as absent resources", async (t) => {
  const f = fixture(t);
  f.model.fail = "permission";
  await assert.rejects(f.runtime().up(), /Permission denied/);
  assert.equal(f.writes().length, 0);
});

test("private state cannot reside in the launcher, including through symlinks", (t) => {
  const f = fixture(t);
  symlinkSync(f.root, join(f.home, "linked-launcher"));
  for (const path of [f.root, join(f.home, "linked-launcher")])
    assert.throws(
      () =>
        stateDirectory({
          root: f.root,
          home: f.home,
          env: { XDG_STATE_HOME: path },
          settings: f.settings,
        }),
      /outside/,
    );
  assert.throws(
    () =>
      stateDirectory({
        root: f.root,
        home: f.home,
        env: { XDG_STATE_HOME: "relative" },
        settings: f.settings,
      }),
    /absolute/,
  );
});

test("partially created infrastructure is reused after an interrupted project creation", async (t) => {
  const f = fixture(t);
  f.model.fail = "project";
  await assert.rejects(f.runtime().up(), /resource creation failed/);
  const pool = f.resources.get("/1.0/storage-pools/oc-development");
  const network = f.resources.get("/1.0/networks/oc-development");
  assert.ok(pool && network);
  assert.equal(f.vm(), undefined);
  f.model.fail = null;
  await f.runtime().up();
  assert.equal(f.resources.get("/1.0/storage-pools/oc-development"), pool);
  assert.equal(f.resources.get("/1.0/networks/oc-development"), network);
});

test("an imported local VM image needs no remote image copy", async (t) => {
  const f = fixture(t, { image: "local:ubuntu/24.04/cloud" });
  await f.runtime().up();
  assert.equal(
    f.calls.some(({ args }) => args.includes("image") && args.includes("copy")),
    false,
  );
  assert.equal(f.vm().config["user.oc-vm.image.fingerprint"], fingerprint);
});

test("missing key on an existing VM stops before writes and never generates a replacement", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  rmSync(join(f.stateDir, "identity"));
  f.calls.length = 0;
  await assert.rejects(f.runtime().up(), /VM login key is missing/);
  assert.equal(f.writes().length, 0);
  assert.equal(
    f.calls.some(({ args }) => args.includes("-t") && args.includes("ed25519")),
    false,
  );
});

test("incompatible owned network and project configuration fail without mutation", async (t) => {
  for (const kind of ["network", "project"]) {
    const f = fixture(t);
    await f.runtime().up();
    if (kind === "network")
      f.resources.get("/1.0/networks/oc-development").config["ipv4.nat"] =
        "false";
    else
      f.resources.get("/1.0/projects/oc-development").config[
        "features.images"
      ] = "false";
    f.calls.length = 0;
    await assert.rejects(
      f.runtime().up(),
      kind === "network" ? /network differs/ : /incompatible feature/,
    );
    assert.equal(f.writes().length, 0);
  }
});

test("up applies Git protocol changes to an initialized VM without reinstalling tools", async (t) => {
  const f = fixture(t);
  await f.runtime().up();
  f.settings.git_protocol = "ssh";
  f.calls.length = 0;
  await f.runtime().up();
  const configuration = f.calls.find(({ args }) =>
    args.includes("configure-git"),
  );
  assert.deepEqual(
    configuration.args.slice(configuration.args.indexOf("--") + 1),
    [
      "sudo",
      "-iu",
      "ubuntu",
      "node",
      "/workspace/.vm/guest.mjs",
      "configure-git",
      "ssh",
    ],
  );
  assert.equal(
    f.calls.some(({ args }) => args.includes("/workspace/.vm/provision.sh")),
    false,
  );
  f.model.fail = "git-config";
  await assert.rejects(f.runtime().up(), /Git configuration failed/);
  assert.equal(f.vm().config[readyKey], "true");
});
