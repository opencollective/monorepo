#!/usr/bin/env node
// Project onboarding only. Microsandbox owns lifecycle, storage and SSH serving.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { loadSettings } from "./config.mjs";
import { atomicWrite } from "./state.mjs";
import { command, isMain, main, shellQuote } from "./process.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PORTS = [3000, 3001, 3002, 3003, 3060, 1080, 9000, 9001, 5432];
const OWNER = "opencollective.workspace";
const IMPLEMENTATION = "opencollective.setup";
const VERSION = "microsandbox-v1";

export function versionSupported(version) {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 0 || minor > 7 || (minor === 7 && patch >= 8);
}

function within(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
}

// Worktree records use NUL delimiters so spaces in host paths survive discovery.
function worktrees(repo, run) {
  return run(["git", "-C", repo, "worktree", "list", "--porcelain", "-z"], {
    capture: true,
  })
    .stdout.split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice(9));
}

export function discoverWorkspace(root, run = command) {
  const primary = worktrees(root, run)[0];
  if (
    !primary ||
    !existsSync(join(primary, ".gitmodules")) ||
    !existsSync(join(primary, "scripts/run.sh"))
  )
    throw new Error(
      "The primary monorepo checkout must exist and contain .gitmodules and scripts/run.sh",
    );
  const workspace = realpathSync(primary);
  const invoking = realpathSync(root);

  const sources = new Set([workspace]);
  const repositories = [
    workspace,
    ...readdirSync(workspace, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          existsSync(join(workspace, entry.name, ".git")),
      )
      .map((entry) => join(workspace, entry.name)),
  ];
  for (const repo of repositories) {
    const common = run(
      [
        "git",
        "-C",
        repo,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
      { capture: true },
    ).stdout.trim();
    for (const path of [common, ...worktrees(repo, run)]) {
      // Ignore stale/prunable worktrees. Never rewrite host Git metadata.
      if (existsSync(path)) sources.add(realpathSync(path));
    }
  }
  // /workspace is the project-facing mount; original absolute paths allow Git's
  // worktree backlinks to keep working. Share only repository-related paths.
  const mounts = [{ host: workspace, guest: "/workspace" }];
  const canonical = [...sources].sort((a, b) => a.length - b.length);
  const covered = [];
  for (const host of canonical) {
    if (covered.some((parent) => within(parent, host))) continue;
    covered.push(host);
    if (host !== "/workspace") mounts.push({ host, guest: host });
  }
  for (const { host, guest } of mounts) {
    if (/[\r\n\x00:]/.test(host) || /[\r\n\x00:]/.test(guest))
      throw new Error("Shared paths cannot contain line breaks, NUL or ':'");
    if (
      guest !== "/workspace" &&
      within("/workspace", guest) &&
      existsSync(join(workspace, relative("/workspace", guest)))
    )
      throw new Error(
        `Git path mount ${guest} would hide files in /workspace; move the primary checkout to a non-conflicting path`,
      );
  }
  return {
    workspace,
    mounts,
    guestDirectory: within(workspace, invoking)
      ? join("/workspace", relative(workspace, invoking), ".vm")
      : join(invoking, ".vm"),
  };
}

export function sshQuote(value) {
  if (/[\n\r\x00]/.test(value))
    throw new Error("SSH configuration values cannot contain line breaks");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderSSH({
  name,
  msb,
  identity,
  knownHosts,
  msbHome,
  configPath,
}) {
  // OpenSSH expands % tokens before executing ProxyCommand, even inside quotes.
  const proxy = [
    "env",
    "MSB_BACKEND=local",
    ...(msbHome ? [`MSB_HOME=${msbHome}`] : []),
    ...(configPath ? [`MSB_CONFIG_PATH=${configPath}`] : []),
    msb,
    "ssh",
    "serve",
    name,
    "--stdio",
    "--no-inactivity-timeout",
  ]
    .map((arg) => shellQuote(arg).replaceAll("%", "%%"))
    .join(" ");
  return [
    `Host ${name}`,
    "  HostName microsandbox",
    "  User ubuntu",
    `  IdentityFile ${sshQuote(identity.replaceAll("%", "%%"))}`,
    "  IdentitiesOnly yes",
    "  ForwardAgent no",
    "  ForwardX11 no",
    "  StrictHostKeyChecking accept-new",
    `  HostKeyAlias ${name}-microsandbox`,
    `  UserKnownHostsFile ${sshQuote(knownHosts.replaceAll("%", "%%"))}`,
    `  ProxyCommand ${proxy}`,
    "  ServerAliveInterval 30",
    "  ServerAliveCountMax 3",
    "",
  ].join("\n");
}

export function installSSH(home, settings) {
  const sshDir = join(home, ".ssh");
  const fragment = join(sshDir, "oc-development.conf");
  const mainConfig = join(sshDir, "config");
  const existing = existsSync(mainConfig)
    ? readFileSync(mainConfig, "utf8")
    : "";
  const include = `Include ${sshQuote(fragment)}`;
  if (!existing.split(/\r?\n/).includes(include))
    atomicWrite(mainConfig, `${include}\n\n${existing}`);
  atomicWrite(
    fragment,
    renderSSH({
      ...settings,
      knownHosts: join(sshDir, "oc-microsandbox-known_hosts"),
    }),
  );
}

export function createArguments(settings, mounts) {
  return [
    "create",
    settings.image,
    "--name",
    settings.instance_name,
    "--cpus",
    String(settings.cpus),
    "--memory",
    `${settings.memory_mb}M`,
    "--init",
    "/lib/systemd/systemd",
    "--user",
    "ubuntu",
    "--workdir",
    "/workspace",
    "--shell",
    "/bin/bash",
    "--security",
    "default",
    "--net",
    "public",
    "--label",
    `${OWNER}=${mounts[0].host}`,
    "--label",
    `${IMPLEMENTATION}=${VERSION}`,
    "--mount-owned",
    `/var/lib/docker:kind=disk,size=${settings.disk_gb}G`,
    ...mounts.flatMap(({ host, guest }) => [
      "--mount-dir",
      `${host}:${guest}:uid=1000,gid=1000,quota=${settings.disk_gb}G`,
    ]),
    ...PORTS.flatMap((port) => ["--port", `127.0.0.1:${port}:${port}`]),
  ];
}

export function validateSandbox(record, settings, mounts) {
  const config = record.config;
  const mismatch = (detail) => {
    throw new Error(
      `Existing sandbox ${settings.instance_name} does not match ${detail}. Inspect it with msb inspect; use matching OC_VM_* values or a different OC_VM_INSTANCE_NAME. Setup never replaces a sandbox.`,
    );
  };
  if (
    config?.labels?.[OWNER] !== mounts[0].host ||
    config?.labels?.[IMPLEMENTATION] !== VERSION
  )
    mismatch("this workspace/setup");
  if (record.pending_changes?.length)
    mismatch("the active configuration (pending changes)");
  if (config.image?.Oci?.reference !== settings.image) mismatch("OC_VM_IMAGE");
  if (
    config.resources?.cpus !== settings.cpus ||
    config.resources?.memory_mib !== settings.memory_mb
  )
    mismatch("CPU/memory settings");
  if (
    config.init?.cmd !== "/lib/systemd/systemd" ||
    config.runtime?.user !== "ubuntu" ||
    config.runtime?.workdir !== "/workspace" ||
    config.security_profile !== "default"
  )
    mismatch("guest runtime settings");
  const disk = config.mounts?.find(
    (mount) => mount.type === "Owned" && mount.guest === "/var/lib/docker",
  );
  if (
    disk?.storage?.kind !== "disk" ||
    disk.storage.capacity_mib !== settings.disk_gb * 1024
  )
    mismatch("Docker disk settings");
  const binds = config.mounts.filter((mount) => mount.type === "Bind");
  if (
    binds.length !== mounts.length ||
    mounts.some(
      ({ host, guest }) =>
        !binds.some(
          (mount) =>
            mount.host === host &&
            mount.guest === guest &&
            !mount.options?.readonly &&
            mount.options?.override_uid === 1000 &&
            mount.options?.override_gid === 1000 &&
            mount.quota_mib === settings.disk_gb * 1024,
        ),
    )
  )
    mismatch("shared mounts");
  const ports = config.network?.ports ?? [];
  if (
    ports.length !== PORTS.length ||
    PORTS.some(
      (port) =>
        !ports.some(
          (mapping) =>
            mapping.host_port === port &&
            mapping.guest_port === port &&
            mapping.host_bind === "127.0.0.1" &&
            mapping.protocol === "tcp",
        ),
    )
  )
    mismatch("published localhost ports");
}

export function createHost({
  root = ROOT,
  home = homedir(),
  env = process.env,
  run = command,
  output = console.log,
} = {}) {
  const execute = (args, options = {}) =>
    run(args, { cwd: root, env, ...options });
  const msbEnv = { ...env, MSB_BACKEND: "local" };
  for (const key of ["MSB_HOME", "MSB_CONFIG_PATH"])
    if (msbEnv[key]) msbEnv[key] = resolve(root, msbEnv[key]);
  let msb;
  const sandbox = (args, options = {}) =>
    execute([msb, ...args], { env: msbEnv, ...options });

  async function setup() {
    const settings = loadSettings(env);
    if (platform() !== "linux")
      throw new Error("Project setup currently supports Linux KVM hosts");
    if (typeof process.getuid === "function" && process.getuid() === 0)
      throw new Error("Run setup as your regular host user, without sudo");
    msb = execute(["bash", "-c", "command -v msb"], {
      capture: true,
      check: false,
    }).stdout.trim();
    if (!isAbsolute(msb))
      throw new Error("Install the microsandbox CLI and put msb on PATH");
    if (!versionSupported(sandbox(["--version"], { capture: true }).stdout))
      throw new Error("microsandbox v0.7.8 or newer is required");
    const context = JSON.parse(
      sandbox(["context", "--format", "json"], { capture: true }).stdout,
    );
    if (context.kind !== "local")
      throw new Error(
        "A managed microsandbox profile selected a non-local backend; use a local profile",
      );
    sandbox(["doctor"]);
    const { workspace, mounts, guestDirectory } = discoverWorkspace(
      root,
      execute,
    );
    output(`Sharing primary checkout ${workspace} at /workspace.`);
    const names = JSON.parse(
      sandbox(["ls", "--format", "json"], { capture: true }).stdout,
    );
    if (names.some(({ name }) => name === settings.instance_name)) {
      const record = JSON.parse(
        sandbox(["inspect", settings.instance_name, "--format", "json"], {
          capture: true,
        }).stdout,
      );
      validateSandbox(record, settings, mounts);
      if (["Stopped", "Crashed", "Created"].includes(record.status))
        sandbox(["start", settings.instance_name]);
      else if (record.status !== "Running")
        throw new Error(
          `Sandbox is ${record.status}; resolve its state with msb before setup`,
        );
    } else {
      sandbox(createArguments(settings, mounts));
      // Inspect effective settings: managed policies can override creation flags.
      validateSandbox(
        JSON.parse(
          sandbox(["inspect", settings.instance_name, "--format", "json"], {
            capture: true,
          }).stdout,
        ),
        settings,
        mounts,
      );
    }
    sandbox([
      "exec",
      "--user",
      "root",
      "--no-stdin",
      "--stream",
      settings.instance_name,
      "--",
      "bash",
      join(guestDirectory, "provision.sh"),
    ]);

    const publicKey = env.OC_VM_SSH_KEY
      ? resolve(env.OC_VM_SSH_KEY)
      : join(home, ".ssh/oc-dev_ed25519.pub");
    if (!publicKey.endsWith(".pub"))
      throw new Error("OC_VM_SSH_KEY must be a public key path ending in .pub");
    const identity = publicKey.slice(0, -4);
    if (!env.OC_VM_SSH_KEY && !existsSync(identity) && !existsSync(publicKey)) {
      mkdirSync(dirname(identity), { recursive: true, mode: 0o700 });
      execute([
        "ssh-keygen",
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        identity,
        "-C",
        "oc-microsandbox",
      ]);
    }
    if (!existsSync(publicKey) || !existsSync(identity))
      throw new Error(`Supply an SSH key pair at ${identity} and ${publicKey}`);
    sandbox(["ssh", "authorize", "--file", publicKey]);
    installSSH(home, {
      name: settings.instance_name,
      msb,
      identity,
      msbHome: msbEnv.MSB_HOME,
      configPath: msbEnv.MSB_CONFIG_PATH,
    });
    sandbox([
      "exec",
      "--user",
      "ubuntu",
      "--no-stdin",
      "--stream",
      settings.instance_name,
      "--",
      "node",
      join(guestDirectory, "guest.mjs"),
      "stack",
    ]);
    sandbox([
      "exec",
      "--user",
      "ubuntu",
      "--no-stdin",
      "--stream",
      settings.instance_name,
      "--",
      "node",
      join(guestDirectory, "guest.mjs"),
      "doctor",
    ]);
    output(
      `Setup complete. Connect with ssh ${settings.instance_name}, then run: run frontend api`,
    );
  }

  async function cli(args) {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
      output(
        "Usage: scripts/vm.sh setup\nUse msb start|stop|restart|ps|inspect|exec|rm for sandbox administration.\nSee .vm/README.md for OC_VM_* overrides.",
      );
      return;
    }
    if (args.length !== 1 || args[0] !== "setup")
      throw new Error(
        "Usage: scripts/vm.sh setup; use msb directly for sandbox administration",
      );
    try {
      await setup();
    } catch (error) {
      throw new Error(
        `${error.message}\nFix the failed stage and rerun scripts/vm.sh setup; any created sandbox is retained.`,
      );
    }
  }
  return { cli };
}

if (isMain(import.meta.url))
  await main(() => createHost().cli(process.argv.slice(2)));
