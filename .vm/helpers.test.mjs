// Filesystem and command-boundary regressions for persistent VM setup. Real Git
// and OpenSSH parsing run against temporary fixtures; VM/agent actions are faked
// so tests never contact a provider or alter the developer's SSH configuration.
import assert from "node:assert/strict";
import {
  existsSync,
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
import { createHost as realCreateHost, renderSSH } from "./host.mjs";
import { createGuest, writeEnvDefaults } from "./guest.mjs";
import { command } from "./process.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "oc-helper-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "launcher");
  mkdirSync(root);
  return root;
}
const silent = () => {};
const rawSSH = { address: "192.168.121.3", identity: "/tmp/vm-key" };

// Host policy tests isolate the provider behind its public interface. Real SSH
// parsing and filesystem writes still run, with all state inside the fixture.
function createHost(options) {
  return realCreateHost({
    home: options.root,
    ...options,
    env: { XDG_STATE_HOME: join(options.root, "../state"), ...options.env },
    runtime: {
      connection: () => rawSSH,
      ...options.runtime,
    },
  });
}

test("OpenSSH uses the VM identity and persistent trust policy", (t) => {
  const root = fixture(t);
  const config = renderSSH(rawSSH, join(root, "known hosts"));
  const path = join(root, "config");
  writeFileSync(path, config);
  // Parse with OpenSSH itself: string assertions alone would miss invalid quoting
  // or the first-value-wins behavior of duplicate configuration directives.
  const resolved = command(["ssh", "-G", "-F", path, "oc-dev"], {
    quiet: true,
  }).stdout;
  for (const line of [
    "forwardagent no",
    "stricthostkeychecking accept-new",
    "identityfile /tmp/vm-key",
    "hostkeyalias oc-dev",
  ])
    assert.ok(resolved.includes(line));
  assert.equal(config.includes("/dev/null"), false);
  assert.throws(() => renderSSH(rawSSH, "/tmp/known\nHost *"), /line breaks/);
});

test("remote command quoting preserves argument boundaries and blocks shell expansion", async (t) => {
  const root = fixture(t);
  let invoked;
  const host = createHost({
    root,
    run: (args) => {
      invoked = args;
    },
    output: silent,
  });
  const literal = "space and $(secret) `command` 'quotes'";
  await host.ssh(["printf", "%s", literal], true);
  assert.deepEqual(invoked.slice(0, 4), [
    "ssh",
    "-F",
    join(host.stateDir, "ssh-config"),
    "-t",
  ]);
  assert.equal(
    command(["bash", "-c", invoked.at(-1)], { capture: true }).stdout,
    literal,
  );
});

test("environment defaults preserve exported user values and are idempotent", (t) => {
  const path = join(fixture(t), ".env");
  writeFileSync(path, "export API_URL=http://custom-api\n# User settings\n");
  const defaults = {
    API_URL: "http://localhost:3060",
    IMAGES_URL: "http://localhost:3001",
  };
  writeEnvDefaults(path, defaults);
  const content = readFileSync(path, "utf8");
  writeEnvDefaults(path, defaults);
  assert.equal(readFileSync(path, "utf8"), content);
  assert.ok(content.includes("export API_URL=http://custom-api"));
  assert.equal(content.match(/IMAGES_URL=/g).length, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("SSH installation retains user config, is idempotent and writes private files", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".ssh"));
  writeFileSync(
    join(root, ".ssh/config"),
    "Host personal\n  HostName example.com\n",
  );
  const host = createHost({
    root,
    home: root,
    env: {},
    output: silent,
    run: () => ({ status: 0, stdout: rawSSH }),
  });
  await host.refreshSSH({ install: true });
  const original = readFileSync(join(root, ".ssh/config"), "utf8");
  await host.refreshSSH({ install: true });
  assert.equal(readFileSync(join(root, ".ssh/config"), "utf8"), original);
  assert.equal(original.match(/Include/g).length, 1);
  assert.ok(original.includes("Host personal"));
  assert.equal(
    statSync(join(root, ".ssh/oc-development.conf")).mode & 0o777,
    0o600,
  );
});

test("bootstrap accepts developer configuration and restores only an absent test database", async (t) => {
  for (const existing of [true, false]) {
    let databaseExists = existing;
    const root = fixture(t);
    for (const service of [
      "api",
      "frontend",
      "rest",
      "pdf",
      "images",
      "taxes",
    ]) {
      mkdirSync(join(root, `opencollective-${service}`));
      writeFileSync(join(root, `opencollective-${service}/package.json`), "{}");
    }
    const config = join(root, "opencollective-api/.env");
    const overrides =
      "PG_URL=postgres://developer@custom.example/dev\nAWS_S3_ENDPOINT=https://custom-storage.example\nOC_ENV=custom\n";
    writeFileSync(config, overrides);
    const calls = [];
    const guest = createGuest({
      root,
      env: { OC_ENV: "custom" },
      output: silent,
      wait: () => assert.fail("Ready dependencies should not wait"),
      // Database and storage operations are mocked; these tests never contact
      // the custom endpoints and exercise both persistent-database branches.
      run: (args, options) => {
        calls.push({ args, options });
        if (args.includes("db:restore:test")) databaseExists = true;
        return {
          status: 0,
          stdout: args[0] === "psql" && databaseExists ? "1\n" : "",
        };
      },
    });
    await guest.stack();
    const content = readFileSync(config, "utf8");
    assert.ok(content.startsWith(overrides));
    await guest.stack();
    assert.equal(readFileSync(config, "utf8"), content);
    const startup = calls[0];
    assert.deepEqual(startup.args.slice(2), [
      "--engine",
      "docker",
      "--detach",
      "db",
      "mail",
      "uploads",
    ]);
    assert.equal(startup.options.env.COMPOSE_PROJECT_NAME, "oc-development");
    assert.equal(
      calls.filter(({ args }) => args.includes("db:restore:test")).length,
      existing ? 0 : 1,
    );
  }
});

test("guest commands refresh addresses without polluting their stdout", async (t) => {
  const calls = [];
  const host = createHost({
    root: fixture(t),
    output: () =>
      assert.fail("SSH administration output must not mix with guest output"),
    run: (args) => calls.push(args),
  });
  await host.cli(["ssh", "node", "/workspace/.vm/guest.mjs", "doctor"]);
  assert.equal(calls.at(-1).at(-1), "node /workspace/.vm/guest.mjs doctor");
});

test("lifecycle commands dispatch to Incus and reject unexpected arguments", async (t) => {
  const calls = [];
  const runtime = Object.fromEntries(
    ["doctor", "up", "stop", "restart", "status"].map((action) => [
      action,
      (options) => calls.push({ action, options }),
    ]),
  );
  const host = createHost({ root: fixture(t), runtime, output: silent });
  for (const action of [
    "doctor",
    "up",
    "stop",
    "restart",
    "status",
    "provision",
  ]) {
    await host.cli([action]);
    await assert.rejects(
      host.cli([action, "unexpected"]),
      /takes no arguments/,
    );
  }
  assert.deepEqual(
    calls.map(({ action }) => action),
    ["doctor", "up", "stop", "restart", "status", "up"],
  );
  assert.deepEqual(calls.at(-1).options, { forceProvision: true });
});

test("SSH alias does not inherit host wildcard agent forwarding", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".ssh"));
  writeFileSync(join(root, ".ssh/config"), "Host *\n  ForwardAgent yes\n");
  const host = createHost({ root, output: silent });
  await host.refreshSSH({ install: true });
  const settings = command(
    ["ssh", "-G", "-F", join(root, ".ssh/config"), "oc-dev"],
    { quiet: true },
  ).stdout;
  assert.match(settings, /^forwardagent no$/m);
});

test("destroy removes only VM host integration and retains shared source files", async (t) => {
  const root = fixture(t);
  const source = join(root, "source.txt");
  writeFileSync(source, "shared work");
  mkdirSync(join(root, ".ssh"));
  writeFileSync(
    join(root, ".ssh/config"),
    "Host personal\n  HostName example.com\n",
  );
  let destroyed = false;
  const host = createHost({
    root,
    output: silent,
    runtime: {
      destroy: () => {
        destroyed = true;
      },
    },
  });
  await host.refreshSSH({ install: true });
  await host.cli(["destroy"]);
  assert.equal(destroyed, true);
  assert.equal(readFileSync(source, "utf8"), "shared work");
  assert.equal(
    readFileSync(join(root, ".ssh/config"), "utf8").includes("Host personal"),
    true,
  );
  assert.equal(existsSync(join(root, ".ssh/oc-development.conf")), false);
  assert.equal(existsSync(host.stateDir), false);
});

test("missing service stops stack setup before commands or workspace writes", async (t) => {
  const root = fixture(t);
  await assert.rejects(
    createGuest({
      root,
      run: () => assert.fail("No commands should run"),
    }).stack(),
    /prepare this service in the host checkout/,
  );
  assert.equal(existsSync(join(root, "opencollective-api")), false);
});
