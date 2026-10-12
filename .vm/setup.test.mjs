// Real Git and OpenSSH fixtures; the msb boundary never boots a VM in CI.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createArguments,
  createHost,
  discoverWorkspace,
  installSSH,
  PORTS,
  renderSSH,
  validateSandbox,
  versionSupported,
} from "./host.mjs";
import { DEFAULTS } from "./config.mjs";
import { command } from "./process.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "oc-msb-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "project with spaces");
  const home = join(directory, "home");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".vm"));
  mkdirSync(join(home, ".ssh"), { recursive: true });
  writeFileSync(join(root, ".gitmodules"), "");
  writeFileSync(join(root, "scripts/run.sh"), "#!/bin/sh\n");
  command(["git", "init", "-q", root]);
  command(["git", "-C", root, "add", "."]);
  command([
    "git",
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "fixture",
  ]);
  writeFileSync(join(home, ".ssh/oc-dev_ed25519"), "fixture private key");
  writeFileSync(join(home, ".ssh/oc-dev_ed25519.pub"), "ssh-ed25519 fixture");
  return { root, home, directory };
}

// This is v0.7.8 inspect's flattened configuration, not a private launcher file.
function record(settings, mounts) {
  return {
    status: "Running",
    pending_changes: [],
    config: {
      security_profile: "default",
      labels: {
        "opencollective.workspace": mounts[0].host,
        "opencollective.setup": "microsandbox-v1",
      },
      image: { Oci: { reference: settings.image } },
      resources: { cpus: settings.cpus, memory_mib: settings.memory_mb },
      init: { cmd: "/lib/systemd/systemd" },
      runtime: { user: "ubuntu", workdir: "/workspace" },
      mounts: [
        ...mounts.map(({ host, guest }) => ({
          type: "Bind",
          host,
          guest,
          quota_mib: settings.disk_gb * 1024,
          options: { readonly: false, override_uid: 1000, override_gid: 1000 },
        })),
        {
          type: "Owned",
          guest: "/var/lib/docker",
          storage: { kind: "disk", capacity_mib: settings.disk_gb * 1024 },
        },
      ],
      network: {
        ports: PORTS.map((port) => ({
          host_port: port,
          guest_port: port,
          host_bind: "127.0.0.1",
          protocol: "tcp",
        })),
      },
    },
  };
}

function hostFixture(t, { existing = false, fail, change, env = {} } = {}) {
  const f = fixture(t);
  const { mounts } = discoverWorkspace(f.root);
  let current = existing ? record(DEFAULTS, mounts) : undefined;
  if (current && change) change(current);
  const calls = [];
  const messages = [];
  const run = (args, options) => {
    if (args[0] === "git") return command(args, options);
    calls.push({ args, options });
    if (args[0] === "bash") return { status: 0, stdout: "/tmp/msb\n" };
    if (args[1] === fail || args.at(-1) === fail)
      throw new Error("fixture stage failed");
    let value;
    switch (args[1]) {
      case "--version":
        return { status: 0, stdout: "msb 0.7.8\n" };
      case "context":
        value = { kind: "local" };
        break;
      case "ls":
        value = current ? [{ name: "oc-dev" }] : [];
        break;
      case "create":
        current = record(DEFAULTS, mounts);
        break;
      case "inspect":
        value = current;
        break;
    }
    return { status: 0, stdout: value ? JSON.stringify(value) : "" };
  };
  const host = createHost({
    ...f,
    run,
    output: (message) => messages.push(message),
    env,
  });
  return { ...f, calls, messages, host };
}

test("version gate accepts current CLI and rejects outdated or unparseable versions", () => {
  for (const version of ["msb 0.7.8", "0.8.0", "1.0.0"])
    assert.ok(versionSupported(version));
  for (const version of ["msb 0.7.7", "0.6.99", "unknown"])
    assert.equal(versionSupported(version), false);
});

test("create uses owned Docker storage, writable binds and loopback ports without root-disk", () => {
  const args = createArguments(DEFAULTS, [
    { host: "/host/project", guest: "/workspace" },
  ]);
  assert.ok(args.includes("/var/lib/docker:kind=disk,size=100G"));
  assert.ok(
    args.includes("/host/project:/workspace:uid=1000,gid=1000,quota=100G"),
  );
  assert.equal(args.includes("--root-disk"), false);
  assert.equal(args.includes("--replace"), false);
  assert.deepEqual(
    args.filter((_, index) => args[index - 1] === "--port"),
    PORTS.map((port) => `127.0.0.1:${port}:${port}`),
  );
});

test("discovery mounts the primary checkout and external service Git worktrees without Git writes", (t) => {
  const f = fixture(t);
  const worktree = join(f.root, ".worktrees/feature/workspace");
  command(["git", "-C", f.root, "worktree", "add", "-qb", "feature", worktree]);
  const service = join(f.root, "opencollective-api");
  command(["git", "clone", "-q", f.root, service]);
  const external = join(f.directory, "external-service");
  command([
    "git",
    "-C",
    service,
    "worktree",
    "add",
    "-qb",
    "service-feature",
    external,
  ]);
  const before = readFileSync(join(f.root, ".git/config"), "utf8");
  const found = discoverWorkspace(worktree);
  assert.equal(found.workspace, f.root);
  assert.deepEqual(found.mounts[0], { host: f.root, guest: "/workspace" });
  assert.deepEqual(
    found.mounts.slice(1).sort((a, b) => a.host.localeCompare(b.host)),
    [
      { host: f.root, guest: f.root },
      { host: external, guest: external },
    ].sort((a, b) => a.host.localeCompare(b.host)),
  );
  assert.equal(
    found.guestDirectory,
    "/workspace/.worktrees/feature/workspace/.vm",
  );
  assert.equal(readFileSync(join(f.root, ".git/config"), "utf8"), before);
  assert.equal(
    command(["git", "-C", worktree, "branch", "--show-current"], {
      capture: true,
    }).stdout.trim(),
    "feature",
  );
});

test("existing sandbox validation rejects mismatched resources, identity, mounts and ports", () => {
  const mounts = [{ host: "/project", guest: "/workspace" }];
  validateSandbox(record(DEFAULTS, mounts), DEFAULTS, mounts);
  for (const change of [
    (r) => (r.config.labels = {}),
    (r) => r.config.resources.cpus++,
    (r) => (r.config.image.Oci.reference = "other"),
    (r) => (r.config.init.cmd = "auto"),
    (r) => (r.config.mounts[0].options.readonly = true),
    (r) => r.config.mounts[1].storage.capacity_mib++,
    (r) => (r.config.network.ports[0].host_bind = "0.0.0.0"),
    (r) => (r.pending_changes = ["cpus"]),
  ]) {
    const existing = record(DEFAULTS, mounts);
    change(existing);
    assert.throws(
      () => validateSandbox(existing, DEFAULTS, mounts),
      /does not match/,
    );
  }
});

test("SSH alias parses with OpenSSH, retains other hosts and keeps private files private", (t) => {
  const f = fixture(t);
  const input = {
    name: "oc-dev",
    msb: "/path with spaces/msb",
    identity: join(f.home, ".ssh/oc-dev_ed25519"),
    msbHome: "/state with spaces",
    configPath: "/config/msb.json",
  };
  writeFileSync(
    join(f.home, ".ssh/config"),
    "Host *\n  ForwardAgent yes\nHost personal\n  HostName example.com\n",
  );
  installSSH(f.home, input);
  const before = readFileSync(join(f.home, ".ssh/config"), "utf8");
  installSSH(f.home, input);
  assert.equal(readFileSync(join(f.home, ".ssh/config"), "utf8"), before);
  const resolved = command(
    ["ssh", "-G", "-F", join(f.home, ".ssh/config"), "oc-dev"],
    { quiet: true },
  ).stdout;
  assert.match(resolved, /^user ubuntu$/m);
  assert.match(resolved, /^forwardagent no$/m);
  assert.match(
    resolved,
    /proxycommand env MSB_BACKEND=local 'MSB_HOME=\/state with spaces'/,
  );
  assert.match(resolved, /--stdio --no-inactivity-timeout/);
  assert.ok(before.includes("Host personal"));
  assert.equal(
    statSync(join(f.home, ".ssh/oc-development.conf")).mode & 0o777,
    0o600,
  );
  assert.throws(
    () => renderSSH({ ...input, knownHosts: "bad\nHost *" }),
    /line breaks/,
  );
});

test("setup creates once, reruns start the same sandbox and never transports Git configuration", async (t) => {
  const f = hostFixture(t);
  await f.host.cli(["setup"]);
  await f.host.cli(["setup"]);
  assert.equal(f.calls.filter(({ args }) => args[1] === "create").length, 1);
  assert.equal(f.calls.filter(({ args }) => args[1] === "start").length, 0);
  assert.equal(
    f.calls.filter(({ args }) => args[1] === "ssh" && args[2] === "authorize")
      .length,
    2,
  );
  assert.ok(
    f.calls.every(
      ({ options, args }) =>
        args[0] === "bash" || options.env.MSB_BACKEND === "local",
    ),
  );
  assert.ok(
    f.calls.every(
      ({ args }) =>
        !args.includes("--root-disk") &&
        !args.includes("configure-git") &&
        !args.some((arg) => arg.includes("git-identity")),
    ),
  );
  assert.equal(
    f.messages.filter((message) => message.includes("Setup complete")).length,
    2,
  );
});

test("failures retain the sandbox and never report completion; mismatches stop before guest execution", async (t) => {
  for (const options of [
    { fail: "stack" },
    { fail: "inspect" },
    { existing: true, change: (r) => (r.config.labels = {}) },
  ]) {
    const f = hostFixture(t, options);
    await assert.rejects(f.host.cli(["setup"]), /retained/);
    assert.ok(
      f.messages.every((message) => !message.includes("Setup complete")),
    );
    assert.ok(
      f.calls.every(
        ({ args }) => !args.includes("rm") && !args.includes("--replace"),
      ),
    );
    if (options.change)
      assert.ok(f.calls.every(({ args }) => args[1] !== "exec"));
  }
});

test("invalid command or settings fail before invoking msb", async (t) => {
  const f = hostFixture(t, { env: { OC_VM_CPUS: "0" } });
  await assert.rejects(f.host.cli(["setup"]), /positive integer/);
  await assert.rejects(f.host.cli(["stop"]), /use msb directly/);
  await assert.rejects(f.host.cli(["setup", "extra"]), /Usage/);
  assert.deepEqual(f.calls, []);
});

test("setup starts a stopped sandbox and rejects paused state before provisioning", async (t) => {
  const stopped = hostFixture(t, {
    existing: true,
    change: (r) => {
      r.status = "Stopped";
    },
  });
  await stopped.host.cli(["setup"]);
  assert.equal(
    stopped.calls.filter(({ args }) => args[1] === "start").length,
    1,
  );
  const paused = hostFixture(t, {
    existing: true,
    change: (r) => {
      r.status = "Paused";
    },
  });
  await assert.rejects(paused.host.cli(["setup"]), /Paused/);
  assert.ok(paused.calls.every(({ args }) => args[1] !== "exec"));
});

test("setup invoked from an external monorepo worktree still selects the primary checkout", (t) => {
  const f = fixture(t);
  const external = join(f.directory, "external-monorepo");
  command([
    "git",
    "-C",
    f.root,
    "worktree",
    "add",
    "-qb",
    "external",
    external,
  ]);
  const found = discoverWorkspace(external);
  assert.deepEqual(found.mounts[0], { host: f.root, guest: "/workspace" });
  assert.ok(
    found.mounts.some(
      ({ host, guest }) => host === external && guest === external,
    ),
  );
  assert.equal(found.guestDirectory, join(external, ".vm"));
});
