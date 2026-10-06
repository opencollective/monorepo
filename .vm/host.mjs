#!/usr/bin/env node
// Host-side Incus and SSH configuration.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { loadSettings } from "./config.mjs";
import { createIncus } from "./incus.mjs";
import { atomicWrite, stateDirectory } from "./state.mjs";
import { fileURLToPath } from "node:url";
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

export function renderSSH({ address, identity }, knownHosts) {
  return [
    `Host ${ALIAS}`,
    `  HostName ${address}`,
    "  User ubuntu",
    `  IdentityFile ${sshQuote(identity)}`,
    "  ForwardAgent no",
    "  IdentitiesOnly yes",
    "  ForwardX11 no",
    "  StrictHostKeyChecking accept-new",
    `  HostKeyAlias ${ALIAS}`,
    `  UserKnownHostsFile ${sshQuote(knownHosts)}`,
    "  ServerAliveInterval 30",
    "  ServerAliveCountMax 3",
    "",
  ].join("\n");
}

// Parameters let regression tests exercise filesystem behavior without touching a real VM.
export function createHost({
  root = ROOT,
  home = homedir(),
  env = process.env,
  run = command,
  output = console.log,
  runtime,
} = {}) {
  const execute = (args, options = {}) =>
    run(args, { cwd: root, env, ...options });
  const settings = loadSettings(root, env);
  const stateDir = stateDirectory({ root, home, env, settings });
  const incus =
    runtime ?? createIncus({ root, settings, stateDir, run: execute, output });
  async function refreshSSH({ install = false, announce = true } = {}) {
    const raw = incus.connection();
    const sshDir = join(home, ".ssh");
    const knownHosts = join(sshDir, "oc-development-known_hosts");
    const config = renderSSH(raw, knownHosts);
    const local = join(stateDir, "ssh-config");
    atomicWrite(local, config);
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
      case "restart":
        if (args.length) throw new Error("restart takes no arguments");
        await incus.restart();
        return refreshSSH({ install: true });
      case "ssh-config": {
        if (args.some((arg) => arg !== "--install"))
          throw new Error("Unknown ssh-config option");
        return refreshSSH({
          install: args.includes("--install"),
        });
      }
      case "ssh":
        return ssh(args);
      case "guest":
        return ssh(args, true);
      default:
        throw new Error(
          "Usage: scripts/vm.sh setup|doctor|up|stop|restart|status|destroy|provision|ssh-config|ssh|guest",
        );
    }
  }
  return {
    stateDir,
    cli,
    ssh,
    refreshSSH,
    doctor,
  };
}

if (isMain(import.meta.url))
  await main(() => createHost().cli(process.argv.slice(2)));
