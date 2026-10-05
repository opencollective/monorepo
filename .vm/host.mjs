#!/usr/bin/env node
// Host-side Vagrant and SSH configuration. Agent identities are never managed.
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform, arch } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { command, isMain, main, shellQuote } from "./process.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS = "oc-dev";

// Keep generated SSH files private and replace them in one rename so an editor
// or SSH client never observes a half-written configuration.
export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.oc-vm-${randomUUID()}`);
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// OpenSSH config quoting differs from shell quoting; these values never go
// through a shell. Reject newlines that could introduce another Host block.
export function sshQuote(value) {
  if (/[\n\r\x00]/.test(value))
    throw new Error("SSH configuration values cannot contain line breaks");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderSSH(raw, forwardAgent, knownHosts) {
  // Keep Vagrant's discovered address, user and identity, but replace its trust
  // and forwarding defaults. OpenSSH takes the first value for most options.
  const dropped = new Set([
    "host",
    "forwardagent",
    "identityagent",
    "stricthostkeychecking",
    "userknownhostsfile",
    "hostkeyalias",
    "identitiesonly",
    "forwardx11",
    "serveraliveinterval",
    "serveralivecountmax",
  ]);
  const lines = [
    `Host ${ALIAS}`,
    ...raw
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim() &&
          !dropped.has(line.trim().split(/\s+/)[0].toLowerCase()),
      ),
  ];
  // Vagrant’s IdentityFile authenticates to the VM. Approved forwarding uses
  // the developer’s existing agent; trust persists across changing guest IPs.
  lines.push(
    `  ForwardAgent ${forwardAgent ? "yes" : "no"}`,
    "  IdentitiesOnly yes",
    "  ForwardX11 no",
    "  StrictHostKeyChecking accept-new",
    `  HostKeyAlias ${ALIAS}`,
    `  UserKnownHostsFile ${sshQuote(knownHosts)}`,
    "  ServerAliveInterval 30",
    "  ServerAliveCountMax 3",
  );
  return `${lines.join("\n")}\n`;
}

async function confirmPrompt(question) {
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await input.question(`${question} [y/N] `)).toLowerCase() === "y";
  } finally {
    input.close();
  }
}

// Parameters let regression tests exercise filesystem behavior without touching a real agent or VM.
export function createHost({
  root = ROOT,
  home = homedir(),
  env = process.env,
  run = command,
  output = console.log,
  confirm = confirmPrompt,
} = {}) {
  const execute = (args, options = {}) =>
    run(args, { cwd: root, env, ...options });
  const sshSettingsPath = join(root, ".vagrant/oc-ssh-settings.json");

  function forwardingApproved() {
    if (!existsSync(sshSettingsPath)) return false;
    const settings = JSON.parse(readFileSync(sshSettingsPath, "utf8"));
    if (
      !settings ||
      Array.isArray(settings) ||
      typeof settings.forward_agent !== "boolean" ||
      Object.keys(settings).some((key) => key !== "forward_agent")
    )
      throw new Error(
        "Invalid .vagrant/oc-ssh-settings.json; expected a forward_agent boolean",
      );
    return settings.forward_agent;
  }

  async function configureForwarding() {
    // Begin disabled so a failed check or interrupted prompt cannot retain a
    // previous approval. This never starts an agent or changes its identities.
    const save = (enabled) =>
      atomicWrite(
        sshSettingsPath,
        JSON.stringify({ forward_agent: enabled }, null, 2) + "\n",
      );
    save(false);
    let loaded = false;
    if (env.SSH_AUTH_SOCK) {
      try {
        loaded =
          execute(["ssh-add", "-l"], { quiet: true, check: false }).status ===
          0;
      } catch {
        // An absent inspection tool or inaccessible agent means HTTPS fallback.
      }
    }
    if (!loaded) {
      output(
        "No loaded host SSH agent is available. Public repositories use HTTPS; Git pushes need separate authentication.",
      );
      return false;
    }
    output(
      "Guest processes can authenticate using identities available through your existing host SSH agent.",
    );
    const approved = await confirm(
      "Forward this host SSH agent to the development VM?",
    );
    save(approved);
    output(
      approved
        ? "Host agent forwarding approved."
        : "Forwarding disabled. Public repositories use HTTPS; Git pushes need separate authentication.",
    );
    return approved;
  }

  async function refreshSSH({ install = false, reset = false } = {}) {
    // Discover current connection details instead of persisting a libvirt IP or
    // guessing the location of Vagrant's generated private key.
    const raw = execute(["vagrant", "ssh-config", "--host", ALIAS], {
      capture: true,
    }).stdout;
    const sshDir = join(home, ".ssh");
    const knownHosts = join(sshDir, "oc-development-known_hosts");
    const config = renderSSH(raw, forwardingApproved(), knownHosts);
    const local = join(root, ".vagrant/oc-ssh-config");
    atomicWrite(local, config);
    // Recreation changes host keys. Show the fingerprint through Vagrant's
    // managed connection before explicitly clearing this VM's trust record.
    if (reset) {
      execute([
        "vagrant",
        "ssh",
        "-c",
        "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub",
      ]);
      output(
        "Verify this VM fingerprint before clearing the old oc-dev trust record.",
      );
      if (
        !(await confirm(
          "Remove only oc-dev from its dedicated known_hosts file?",
        ))
      )
        throw new Error("Host-key reset cancelled");
      if (existsSync(knownHosts))
        execute(["ssh-keygen", "-R", ALIAS, "-f", knownHosts]);
    }
    if (install) {
      const fragment = join(sshDir, "oc-development.conf");
      const mainConfig = join(sshDir, "config");
      const existing = existsSync(mainConfig)
        ? readFileSync(mainConfig, "utf8")
        : "";
      const include = `Include ${sshQuote(fragment)}`;
      // Include must precede Host blocks; otherwise it can inherit their scope.
      // Update only our fragment on subsequent refreshes, preserving user entries.
      if (!existing.split(/\r?\n/).includes(include))
        atomicWrite(mainConfig, `${include}\n\n${existing}`);
      atomicWrite(fragment, config);
      output(
        `Installed SSH alias ${ALIAS}; refresh after a VM IP/identity change.`,
      );
    } else {
      output(config.trimEnd());
    }
    return local;
  }

  async function ssh(args, tty = false) {
    const local = join(root, ".vagrant/oc-ssh-config");
    if (!existsSync(local)) await refreshSSH();
    const sshArgs = ["ssh", "-F", local];
    // Guest onboarding needs a terminal for login prompts; ordinary remote
    // commands can run without one. Both use the same generated SSH policy.
    if (tty || !args.length) sshArgs.push("-t");
    sshArgs.push(ALIAS);
    if (args.length) sshArgs.push(args.map(shellQuote).join(" "));
    execute(sshArgs);
  }

  function doctor() {
    // Read-only prerequisite checks: no VM creation, key generation, or login.
    // Check both /dev/kvm access and the system libvirt connection used by Vagrant.
    const failures = [];
    output(`Host: ${platform()} ${arch()}`);
    for (const tool of ["vagrant", "virsh", "ssh", "node"]) {
      const found = (env.PATH ?? "")
        .split(":")
        .map((path) => join(path, tool))
        .find((path) => {
          try {
            accessSync(path, constants.X_OK);
            return true;
          } catch {
            return false;
          }
        });
      output(`${tool}: ${found ?? "missing"}`);
      if (!found) failures.push(tool);
    }
    if (platform() !== "linux" || arch() !== "x64")
      failures.push("Linux x86_64 host");
    if (Number(process.versions.node.split(".")[0]) < 20)
      failures.push("Node.js 20 or newer");
    try {
      accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
    } catch {
      failures.push("read/write access to /dev/kvm");
    }
    if (!failures.length) {
      execute(["vagrant", "validate"]);
      if (
        !execute(["vagrant", "plugin", "list"], {
          capture: true,
        }).stdout.includes("vagrant-libvirt ")
      )
        failures.push("vagrant-libvirt plugin");
      execute(["virsh", "-c", "qemu:///system", "list", "--all"]);
    }
    if (failures.length)
      throw new Error(
        `Missing prerequisites: ${failures.join(", ")}. See .vm/README.md.`,
      );
    output("Host prerequisites ready; boot and guest checks are separate.");
  }

  async function cli([action, ...args]) {
    switch (action) {
      case "doctor":
        return doctor();
      case "up":
        execute(["vagrant", "up", "--provider=libvirt"]);
        return refreshSSH({ install: true });
      case "ssh-forwarding":
        if (args.length) throw new Error("ssh-forwarding takes no arguments");
        return configureForwarding();
      case "ssh-config": {
        if (
          args.some((arg) => !["--install", "--reset-host-key"].includes(arg))
        )
          throw new Error("Unknown ssh-config option");
        return refreshSSH({
          install: args.includes("--install"),
          reset: args.includes("--reset-host-key"),
        });
      }
      case "ssh":
        return ssh(args);
      case "guest":
        return ssh(args, true);
      default:
        throw new Error(
          "Usage: scripts/vm.sh setup|doctor|up|ssh-forwarding|ssh-config|ssh|guest",
        );
    }
  }
  return {
    cli,
    ssh,
    refreshSSH,
    configureForwarding,
    forwardingApproved,
    doctor,
  };
}

if (isMain(import.meta.url))
  await main(() => createHost().cli(process.argv.slice(2)));
