import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import net from "node:net";
import { createRequire } from "node:module";

const scripts = dirname(fileURLToPath(import.meta.url));
function fixture(t, settings = "") {
  const dir = mkdtempSync(join(tmpdir(), "workspace-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(scripts, join(dir, "scripts"), { recursive: true });
  cpSync(join(scripts, "test/fake.sh"), join(dir, "scripts/backends/fake.sh"));
  mkdirSync(join(dir, "fake"));
  mkdirSync(join(dir, "bin"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(WORKSPACE_|INCUS_|ORCA_)/.test(key),
    ),
  );
  Object.assign(env, {
    HOME: dir,
    FAKE_DIR: join(dir, "fake"),
    PATH: `${dir}/bin:${env.PATH}`,
  });
  writeFileSync(
    join(dir, "bin/ssh"),
    '#!/bin/bash\nif [[ "$1" == -G ]]; then printf "forwardagent no\\nstricthostkeychecking true\\nidentityagent none\\nhostname 10.231.0.2\\nidentitiesonly yes\\nhostkeyalias %s\\nuserknownhostsfile %s\\n" "$2" "$WORKSPACE_STATE_DIR/instances/${2#oc-}/known_hosts"; fi\n',
    { mode: 0o755 },
  );
  const key = spawnSync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    join(dir, "fake/host"),
  ]);
  assert.equal(key.status, 0, key.stderr.toString());
  const config = join(dir, "config.env");
  writeFileSync(
    config,
    `WORKSPACE_BACKEND=fake\nWORKSPACE_STATE_DIR=${dir}/state\nWORKSPACE_INSTALL_DIR=${dir}/installed\n${settings}`,
  );
  const run = (action, { input, extra = {}, args = [] } = {}) =>
    spawnSync(
      "bash",
      [join(dir, "scripts/workspace.sh"), "--config", config, action, ...args],
      { env: { ...env, ...extra }, input, encoding: "utf8" },
    );
  const create = (extra = {}) =>
    run("create", {
      extra: {
        ORCA_VM_INSTANCE_ID: "orca-test-one",
        ORCA_REPO_URL: "https://github.com/opencollective/opencollective-api",
        ORCA_REPO_BRANCH: "test-branch",
        ORCA_REPO_REF: "refs/heads/main",
        ORCA_REPO_REF_HEAD: "a".repeat(40),
        ...extra,
      },
    });
  const events = () => readFileSync(join(dir, "fake/events"), "utf8");
  const payload = (mode, result) =>
    JSON.stringify({
      schemaVersion: 1,
      mode,
      instanceId: "orca-test-one",
      recipeResult: result,
    });
  return { dir, env, config, run, create, events, payload };
}
function passed(result) {
  assert.equal(result.status, 0, result.stderr);
}

test("config is literal data and environment overrides file settings", (t) => {
  const f = fixture(
    t,
    "WORKSPACE_REPO_URL=https://example.test/$(touch${IFS}/tmp/workspace-config-executed)\nWORKSPACE_CPUS=2\n",
  );
  const r = spawnSync(
    "bash",
    [
      "-c",
      'source "$1/config.sh"; workspace_load_config "$2"; printf "%s\\n%s" "$WORKSPACE_REPO_URL" "$WORKSPACE_CPUS"',
      "bash",
      `${f.dir}/scripts`,
      f.config,
    ],
    { env: { ...f.env, WORKSPACE_CPUS: "6" }, encoding: "utf8" },
  );
  passed(r);
  assert.match(r.stdout, /\$\(touch/);
  assert.match(r.stdout, /\n6$/);
  assert.equal(existsSync("/tmp/workspace-config-executed"), false);
});
test("rejects unknown config, insecure paths, unsupported backend and bad selections", (t) => {
  for (const setting of [
    "UNKNOWN=yes",
    "WORKSPACE_INSTALL_DIR=/tmp/$(id)",
    "WORKSPACE_BACKEND=virtualbox",
    "WORKSPACE_PROJECTS=security",
    "WORKSPACE_STATE_DISK_GIB=16",
    "WORKSPACE_PROJECTS=frontend",
  ]) {
    const f = fixture(t, `${setting}\n`);
    assert.notEqual(f.run("help").status, 0, setting);
  }
});
test("create emits schema v2 once, retry reuses identity and resume preserves checkout", (t) => {
  const f = fixture(t);
  const first = f.create();
  passed(first);
  const result = JSON.parse(first.stdout);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.checkoutMode, "provisioned-root");
  assert.equal(result.connection.projectRoot, "/workspace/opencollective-api");
  assert.equal(result.connection.target.identityAgent, "none");
  assert.equal(result.connection.target.identitiesOnly, true);
  const key = readFileSync(result.connection.target.identityFile, "utf8");
  passed(f.create());
  assert.equal(f.events().match(/^create /gm).length, 1);
  passed(f.run("suspend", { input: f.payload("suspend", result) }));
  const resumed = f.run("resume", { input: f.payload("resume", result) });
  passed(resumed);
  assert.deepEqual(JSON.parse(resumed.stdout), result);
  assert.equal(
    readFileSync(result.connection.target.identityFile, "utf8"),
    key,
  );
  assert.equal(f.events().match(/guest.sh prepare/g).length, 1);
  const config = readFileSync(
    join(f.dir, "state/ssh/hosts/orca-test-one"),
    "utf8",
  );
  assert.match(config, /ForwardAgent no/);
  assert.match(config, /StrictHostKeyChecking yes/);
  passed(f.run("destroy", { input: f.payload("destroy", result) }));
  passed(f.run("destroy", { input: f.payload("destroy", result) }));
  assert.equal(existsSync(result.connection.target.identityFile), false);
});
test("creation failures clean allocation and private SSH files", (t) => {
  for (const failure of ["create", "start", "prepare"]) {
    const f = fixture(t);
    assert.notEqual(f.create({ FAKE_FAIL: failure }).status, 0);
    assert.equal(
      existsSync(join(f.dir, "state/instances/orca-test-one")),
      false,
    );
    assert.equal(existsSync(join(f.dir, "fake/orca-test-one")), false);
    passed(f.create());
  }
});
test("failed cleanup retains recoverable ownership record", (t) => {
  const f = fixture(t);
  passed(f.create());
  assert.notEqual(
    f.run("destroy", {
      args: ["orca-test-one"],
      extra: { FAKE_FAIL: "destroy" },
    }).status,
    0,
  );
  assert.equal(
    existsSync(join(f.dir, "state/instances/orca-test-one/record.json")),
    true,
  );
  passed(f.run("destroy", { args: ["orca-test-one"] }));
});
test("ownership checks prevent deletion and invalid lifecycle payloads", (t) => {
  const f = fixture(t);
  const created = f.create();
  passed(created);
  const result = JSON.parse(created.stdout);
  const original = f.events();
  assert.notEqual(
    f.run("destroy", {
      input: f.payload("destroy", {
        ...result,
        userData: { ...result.userData, owner: "foreign" },
      }),
    }).status,
    0,
  );
  assert.equal(f.events(), original);
  const file = join(f.dir, "fake/orca-test-one");
  writeFileSync(file, JSON.stringify({ owner: "foreign" }));
  assert.notEqual(f.run("destroy", { args: ["orca-test-one"] }).status, 0);
  assert.equal(existsSync(file), true);
  assert.equal(
    existsSync(join(f.dir, "state/instances/orca-test-one/record.json")),
    true,
  );
});
test("only selected private credentials enter workspaces, never image guest config", (t) => {
  const f = fixture(t);
  const credential = join(f.dir, "selected.json");
  writeFileSync(credential, "development-secret", { mode: 0o600 });
  const extra = {
    WORKSPACE_CREDENTIAL_FILES: JSON.stringify({
      [credential]: ".codex/auth.json",
    }),
  };
  passed(f.create(extra));
  assert.equal(
    readFileSync(join(f.dir, "fake/credential"), "utf8"),
    "development-secret",
  );
  const config = readFileSync(join(f.dir, "fake/guest-config.json"), "utf8");
  assert.equal(config.includes(credential), false);
  assert.equal(config.includes("CREDENTIAL"), false);
  assert.equal(config.includes("INCUS_"), false);
  passed(f.run("destroy", { args: ["orca-test-one"] }));
  chmodSync(credential, 0o644);
  assert.notEqual(f.create(extra).status, 0);
  assert.equal(existsSync(join(f.dir, "fake/orca-test-one")), false);
});
test("failed candidate smoke preserves active image and deletes candidate/builder", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "fake/active"), "original");
  assert.notEqual(
    f.run("build-image", { extra: { FAKE_FAIL: "image-check" } }).status,
    0,
  );
  assert.equal(readFileSync(join(f.dir, "fake/active"), "utf8"), "original");
  assert.match(f.events(), /discard /);
  assert.doesNotMatch(f.events(), /promote /);
  assert.equal(existsSync(join(f.dir, "fake/candidate")), false);
  passed(f.run("build-image", { args: ["--rebuild"] }));
  assert.match(f.events(), /builder --rebuild/);
  assert.notEqual(readFileSync(join(f.dir, "fake/active"), "utf8"), "original");
});
test("dependency fingerprints invalidate on lock, manifest, npm settings and runtime versions", (t) => {
  const f = fixture(t);
  const repo = join(f.dir, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "package.json"), '{"name":"test"}');
  const fingerprint = (node = "v24.1.0", npm = "11.0.0") => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        'source "$1/guest-lib.sh"; dependency_fingerprint "$2" "$3" "$4"',
        "bash",
        `${f.dir}/scripts`,
        repo,
        node,
        npm,
      ],
      { encoding: "utf8" },
    );
    passed(r);
    return r.stdout;
  };
  let previous = fingerprint();
  assert.equal(previous, fingerprint());
  for (const file of [
    "package-lock.json",
    ".npmrc",
    ".nvmrc",
    "package.json",
  ]) {
    writeFileSync(join(repo, file), "changed");
    const next = fingerprint();
    assert.notEqual(next, previous, file);
    previous = next;
  }
  assert.notEqual(fingerprint("v24.2.0"), previous);
  assert.notEqual(fingerprint("v24.1.0", "11.1.0"), previous);
});
test("managed Node services bind wildcard and default listeners to loopback", async () => {
  createRequire(import.meta.url)("./loopback.cjs");
  for (const args of [[0], [0, "0.0.0.0"], [{ port: 0, host: "::" }]]) {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(...args, resolve));
    assert.equal(server.address().address, "127.0.0.1");
    await new Promise((resolve) => server.close(resolve));
  }
});
