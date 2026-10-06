#!/usr/bin/env node
// Host-side Incus and SSH configuration. Host agent identities are never managed.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { loadSettings } from "./config.mjs";
import { createIncus } from "./incus.mjs";
import { atomicWrite, stateDirectory } from "./state.mjs";
export { atomicWrite } from "./state.mjs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { command, isMain, main, shellQuote } from "./process.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS = "oc-dev";

// OpenSSH config quoting differs from shell quoting; these values never go
// through a shell. Reject newlines that could introduce another Host block.
export function sshQuote(value) {
  if (/[\n\r\x00]/.test(value))
    throw new Error("SSH configuration values cannot contain line breaks");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderSSH(raw, forwardAgent, knownHosts) {
  // Keep Incus's discovered address, user and dedicated identity, but replace its trust
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
  // The dedicated IdentityFile authenticates to the VM. Approved forwarding uses
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
  runtime,
} = {}) {
  const execute = (args, options = {}) =>
    run(args, { cwd: root, env, ...options });
  const settings = loadSettings(root, env);
  const stateDir = stateDirectory({ root, home, env, settings });
  const incus =
    runtime ?? createIncus({ root, settings, stateDir, run: execute, output });
  const sshSettingsPath = join(stateDir, "ssh-settings.json");

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
        "Invalid host ssh-settings.json; expected a forward_agent boolean",
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

  async function refreshSSH({
    install = false,
    reset = false,
    announce = true,
  } = {}) {
    const raw = incus.connection();
    const sshDir = join(home, ".ssh");
    const knownHosts = join(sshDir, "oc-development-known_hosts");
    const config = renderSSH(raw, forwardingApproved(), knownHosts);
    const local = join(stateDir, "ssh-config");
    atomicWrite(local, config);
    // Read fingerprints through the local daemon before resetting SSH trust.
    if (reset) {
      incus.fingerprint();
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
      if (announce)
        output(
          `Installed SSH alias ${ALIAS}; refresh after a VM IP/identity change.`,
        );
    } else if (announce) {
      output(config.trimEnd());
    }
    return local;
  }

  function removeHostIntegration() {
    const sshDir = join(home, ".ssh");
    const fragment = join(sshDir, "oc-development.conf");
    const knownHosts = join(sshDir, "oc-development-known_hosts");
    const mainConfig = join(sshDir, "config");
    if (existsSync(mainConfig)) {
      const include = `Include ${sshQuote(fragment)}`;
      const lines = readFileSync(mainConfig, "utf8").split(/\r?\n/);
      const retained = lines.filter((line) => line.trim() !== include);
      if (retained.length !== lines.length)
        atomicWrite(mainConfig, retained.join("\n"));
    }
    rmSync(fragment, { force: true });
    rmSync(knownHosts, { force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }

  async function ssh(args, tty = false) {
    const local = join(stateDir, "ssh-config");
    await refreshSSH({ install: true, announce: false });
    const sshArgs = ["ssh", "-F", local];
    // Guest onboarding needs a terminal for login prompts; ordinary remote
    // commands can run without one. Both use the same generated SSH policy.
    if (tty || !args.length) sshArgs.push("-t");
    sshArgs.push(ALIAS);
    if (args.length) sshArgs.push(args.map(shellQuote).join(" "));
    execute(sshArgs);
  }

  const doctor = () => incus.doctor();

  async function cli([action, ...args]) {
    switch (action) {
      case "doctor":
      case "status":
      case "stop":
        if (args.length) throw new Error(`${action} takes no arguments`);
        return incus[action]();
      case "destroy":
        if (args.length) throw new Error("destroy takes no arguments");
        incus.destroy();
        removeHostIntegration();
        output(
          "Removed launcher VM resources, SSH configuration, and private host state.",
        );
        return;
      case "up":
      case "provision":
        if (args.length) throw new Error(`${action} takes no arguments`);
        await incus.up({ forceProvision: action === "provision" });
        return refreshSSH({ install: true });
      case "retry-cloud-init":
        if (args.length) throw new Error("retry-cloud-init takes no arguments");
        await incus.up({ retryCloudInit: true });
        return refreshSSH({ install: true });
      case "restart":
        if (args.length) throw new Error("restart takes no arguments");
        await incus.restart();
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
          "Usage: scripts/vm.sh setup|doctor|up|stop|restart|status|destroy|provision|retry-cloud-init|ssh-forwarding|ssh-config|ssh|guest",
        );
    }
  }
  return {
    stateDir,
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
