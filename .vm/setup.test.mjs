// Run the real setup entry point against a fake msb; never boot or provision a VM.
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../", import.meta.url));
const fakeMsb = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
if (tool === 'id') { console.log(process.env.FAKE_UID || '1000'); process.exit(0); }
if (tool === 'uname') { console.log(process.env.FAKE_OS || 'Linux'); process.exit(0); }
fs.appendFileSync(process.env.TRACE, JSON.stringify({
  args, backend: process.env.MSB_BACKEND, workspace: process.env.OC_VM_WORKSPACE,
  disk: process.env.OC_VM_DISK_GB, home: process.env.MSB_HOME,
  config: process.env.MSB_CONFIG_PATH
}) + '\\n');
const stage = args[0] === 'exec' ? args.at(-1) : args[0];
if (stage === process.env.FAIL_STAGE) process.exit(27);
const recordFile = process.env.RECORD;
if (args[0] === '--version') console.log(process.env.FAKE_VERSION || 'msb 0.7.8');
else if (args[0] === 'context') console.log(JSON.stringify({kind: process.env.BACKEND || 'local'}));
else if (args[0] === 'ls') {
  console.log(process.env.LIST_OUTPUT || JSON.stringify(fs.existsSync(recordFile) ? [{name: process.env.INSTANCE}] : []));
} else if (args[0] === 'inspect') process.stdout.write(fs.readFileSync(recordFile, 'utf8'));
else if (args[0] === 'create') fs.copyFileSync(process.env.INITIAL_RECORD, recordFile);
else if (args[0] === 'start') {
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  record.status = 'Running';
  fs.writeFileSync(recordFile, JSON.stringify(record));
}
`;

function fixture(t, { existing = false, change, env = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "oc-msb-setup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "workspace with spaces and ' $literal");
  const bin = join(directory, "bin");
  const home = join(directory, "home");
  for (const path of [".git", ".vm", "scripts"])
    mkdirSync(join(root, path), { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  for (const file of ["setup.sh", "opencollective-msb.yaml"])
    copyFileSync(join(source, ".vm", file), join(root, ".vm", file));
  copyFileSync(join(source, "scripts/vm.sh"), join(root, "scripts/vm.sh"));
  writeFileSync(join(root, ".gitmodules"), "");
  writeFileSync(join(root, "scripts/run.sh"), "");
  for (const service of ["api", "frontend", "rest", "pdf", "images", "taxes"]) {
    mkdirSync(join(root, `opencollective-${service}`));
    writeFileSync(join(root, `opencollective-${service}/package.json`), "{}");
  }
  writeFileSync(join(bin, "fake-msb.cjs"), fakeMsb, { mode: 0o755 });
  for (const tool of ["msb", "id", "uname"])
    symlinkSync("fake-msb.cjs", join(bin, tool));
  const initial = {
    status: "Running",
    config: {
      labels: {
        "opencollective.workspace": root,
        "opencollective.setup": "microsandbox-v1",
      },
      resources: { cpus: 8, memory_mib: 32768 },
      init: { cmd: "/lib/systemd/systemd" },
      runtime: { user: "ubuntu", workdir: "/workspace", shell: "/bin/bash" },
      security_profile: "default",
      mounts: [
        ...["/workspace", root].map((guest) => ({
          type: "Bind",
          host: root,
          guest,
          options: { override_uid: 1000, override_gid: 1000, readonly: false },
        })),
        {
          type: "Owned",
          guest: "/var/lib/docker",
          storage: { kind: "disk", capacity_mib: 102400 },
        },
      ],
    },
  };
  change?.(initial);
  const record = join(directory, "record.json");
  const initialRecord = join(directory, "initial-record.json");
  const trace = join(directory, "trace.jsonl");
  writeFileSync(initialRecord, JSON.stringify(initial));
  if (existing) copyFileSync(initialRecord, record);
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.startsWith("OC_VM_") || key.startsWith("MSB_"))
      delete environment[key];
  const run = (args = [], entry = ".vm/setup.sh") =>
    spawnSync("bash", [join(root, entry), ...args], {
      cwd: tmpdir(),
      env: {
        ...environment,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        TRACE: trace,
        RECORD: record,
        INITIAL_RECORD: initialRecord,
        INSTANCE: env.OC_VM_INSTANCE_NAME || "oc-dev",
        ...env,
      },
      encoding: "utf8",
    });
  const calls = () =>
    existsSync(trace)
      ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse)
      : [];
  return { root, home, record, run, calls };
}

test("setup loads the 32 GiB YAML, preserves literal paths, and provisions in order", (t) => {
  const f = fixture(t, {
    env: {
      MSB_BACKEND: "cloud",
      MSB_HOME: "/custom msb",
      MSB_CONFIG_PATH: "/custom config.json",
    },
  });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = f.calls();
  const creation = calls.find(({ args }) => args[0] === "create");
  assert.deepEqual(creation.args, [
    "create",
    "--conf",
    join(f.root, ".vm/opencollective-msb.yaml"),
    "--name",
    "oc-dev",
    "--mount-owned",
    "/var/lib/docker:kind=disk,size=100G",
    "--mount-dir",
    `${f.root}:${f.root}:uid=1000,gid=1000,quota=100G`,
  ]);
  assert.match(readFileSync(creation.args[2], "utf8"), /^memory: "32768M"$/m);
  assert.ok(calls.every((call) => call.backend === "local"));
  assert.ok(
    calls.every((call) => call.workspace === f.root && call.disk === "100"),
  );
  assert.ok(
    calls.every(
      (call) =>
        call.home === "/custom msb" && call.config === "/custom config.json",
    ),
  );
  assert.deepEqual(
    calls
      .filter(({ args }) => args[0] === "exec")
      .map(({ args }) => args.slice(1)),
    [
      [
        "--user",
        "root",
        "--no-stdin",
        "--stream",
        "oc-dev",
        "--",
        "bash",
        "/workspace/.vm/provision.sh",
      ],
      [
        "--user",
        "ubuntu",
        "--no-stdin",
        "--stream",
        "oc-dev",
        "--",
        "node",
        "/workspace/.vm/guest.mjs",
        "stack",
      ],
      [
        "--user",
        "ubuntu",
        "--no-stdin",
        "--stream",
        "oc-dev",
        "--",
        "node",
        "/workspace/.vm/guest.mjs",
        "doctor",
      ],
    ],
  );
  assert.equal(existsSync(join(f.home, ".ssh")), false);
});

test("environment resource and image overrides use native flags", (t) => {
  const f = fixture(t, {
    env: {
      OC_VM_CPUS: "04",
      OC_VM_MEMORY_MB: "16384",
      OC_VM_DISK_GB: "50",
      OC_VM_INSTANCE_NAME: "custom-dev",
      OC_VM_IMAGE: "ubuntu:24.04",
    },
  });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const { args, disk } = f.calls().find(({ args }) => args[0] === "create");
  assert.equal(args[args.indexOf("--name") + 1], "custom-dev");
  assert.equal(
    args[args.indexOf("--mount-owned") + 1],
    "/var/lib/docker:kind=disk,size=50G",
  );
  assert.equal(disk, "50");
  assert.deepEqual(args.slice(-5), [
    "--cpus",
    "4",
    "--memory",
    "16384M",
    "ubuntu:24.04",
  ]);
});

test("reruns preserve saved resources and external mounts, including legacy 42 GiB VMs", (t) => {
  const f = fixture(t, {
    existing: true,
    env: { OC_VM_CPUS: "4", OC_VM_MEMORY_MB: "16384", OC_VM_DISK_GB: "50" },
    change: (r) => {
      r.config.resources.memory_mib = 43008;
      r.config.mounts.push({
        type: "Bind",
        host: "/external",
        guest: "/external",
      });
    },
  });
  const before = readFileSync(f.record, "utf8");
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.run(["setup"], "scripts/vm.sh");
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /creation settings do not update existing sandboxes/,
    );
  }
  assert.equal(readFileSync(f.record, "utf8"), before);
  assert.equal(f.calls().filter(({ args }) => args[0] === "create").length, 0);
  assert.equal(f.calls().filter(({ args }) => args[0] === "exec").length, 6);
});

test("setup starts stopped instances and rejects paused or transitional states", (t) => {
  for (const status of [
    "Stopped",
    "Crashed",
    "Created",
    "Paused",
    "Starting",
    "Draining",
  ]) {
    const f = fixture(t, {
      existing: true,
      change: (r) => {
        r.status = status;
      },
    });
    const result = f.run();
    const runnable = ["Stopped", "Crashed", "Created"].includes(status);
    assert.equal(result.status, runnable ? 0 : 1, result.stderr);
    assert.equal(
      f.calls().some(({ args }) => args[0] === "start"),
      runnable,
    );
    assert.equal(
      f.calls().some(({ args }) => args[0] === "exec"),
      runnable,
    );
    if (!runnable)
      assert.match(result.stderr, new RegExp(`Sandbox is ${status}`));
  }
});

test("workspace, mounts, runtime, and pending changes are checked before guest execution", (t) => {
  for (const change of [
    (r) => {
      r.config.labels["opencollective.workspace"] = "/other";
    },
    (r) => {
      r.config.mounts[0].options.readonly = true;
    },
    (r) => {
      r.config.mounts[0].options.override_uid = 0;
    },
    (r) => {
      r.config.mounts.splice(1, 1);
    },
    (r) => {
      r.config.mounts[2].storage.kind = "dir";
    },
    (r) => {
      r.config.runtime.user = "root";
    },
    (r) => {
      r.config.init.cmd = "auto";
    },
    (r) => {
      r.pending_changes = ["mounts"];
    },
  ]) {
    const f = fixture(t, { existing: true, change });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match/);
    assert.equal(
      f
        .calls()
        .some(({ args }) => ["create", "exec", "start"].includes(args[0])),
      false,
    );
  }
});

test("managed policy mismatches after creation stop before provisioning and retain the VM", (t) => {
  const f = fixture(t, {
    change: (r) => {
      r.config.runtime.user = "root";
    },
  });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match/);
  assert.equal(existsSync(f.record), true);
  assert.equal(
    f.calls().some(({ args }) => args[0] === "exec"),
    false,
  );
});

test("invalid settings, missing services, and worktree entry points fail before msb", (t) => {
  for (const env of [
    { OC_VM_CPUS: "0" },
    { OC_VM_CPUS: "256" },
    { OC_VM_CPUS: "1; touch /tmp/no" },
    { OC_VM_MEMORY_MB: "-1" },
    { OC_VM_MEMORY_MB: "" },
    { OC_VM_DISK_GB: "NaN" },
    { OC_VM_DISK_GB: "999999999999999999999" },
    { OC_VM_INSTANCE_NAME: "../other" },
    { OC_VM_IMAGE: "--option" },
    { OC_VM_IMAGE: "ubuntu extra" },
    { FAKE_UID: "0" },
    { FAKE_OS: "Darwin" },
  ]) {
    const f = fixture(t, { env });
    assert.equal(f.run().status, 1);
    assert.deepEqual(f.calls(), []);
  }
  const missing = fixture(t);
  rmSync(join(missing.root, "opencollective-api"), { recursive: true });
  assert.match(missing.run().stderr, /prepare this service on the host/);
  assert.deepEqual(missing.calls(), []);
  const worktree = fixture(t);
  rmSync(join(worktree.root, ".git"), { recursive: true });
  writeFileSync(join(worktree.root, ".git"), "gitdir: /external/git");
  assert.match(worktree.run().stderr, /primary monorepo checkout/);
  assert.deepEqual(worktree.calls(), []);
});

test("old versions, non-local backends, and invalid lists cannot create a sandbox", (t) => {
  for (const env of [
    { FAKE_VERSION: "msb 0.7.7" },
    { FAKE_VERSION: "unknown" },
    { BACKEND: "cloud" },
    { LIST_OUTPUT: "not JSON" },
    { LIST_OUTPUT: "{}" },
  ]) {
    const f = fixture(t, { env });
    assert.equal(f.run().status, 1);
    assert.equal(
      f.calls().some(({ args }) => ["create", "exec"].includes(args[0])),
      false,
    );
  }
});

test("failures propagate, stop later stages, and never remove or replace a sandbox", (t) => {
  for (const stage of [
    "doctor",
    "ls",
    "create",
    "/workspace/.vm/provision.sh",
    "stack",
  ]) {
    const f = fixture(t, { env: { FAIL_STAGE: stage } });
    const result = f.run();
    assert.equal(result.status, 27, result.stderr);
    assert.match(result.stderr, /sandbox is retained/);
    assert.doesNotMatch(result.stdout, /Setup complete/);
    const calls = f.calls();
    assert.equal(
      calls.some(
        ({ args }) =>
          args.includes("--replace") || ["rm", "remove"].includes(args[0]),
      ),
      false,
    );
    const failed = calls.at(-1).args;
    assert.equal(failed[0] === "exec" ? failed.at(-1) : failed[0], stage);
    if (["stack", "/workspace/.vm/provision.sh"].includes(stage))
      assert.equal(existsSync(f.record), true);
  }
});

test("entry points reject extra arguments and offer help without msb", (t) => {
  const f = fixture(t);
  for (const [args, entry, status] of [
    [["--help"], ".vm/setup.sh", 0],
    [["setup"], ".vm/setup.sh", 1],
    [["--help"], "scripts/vm.sh", 0],
    [["stop"], "scripts/vm.sh", 1],
    [["setup", "extra"], "scripts/vm.sh", 1],
  ])
    assert.equal(f.run(args, entry).status, status);
  assert.deepEqual(f.calls(), []);
});
