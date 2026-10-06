// Filesystem and command-boundary regressions for persistent VM setup. Real Git
// and OpenSSH parsing run against temporary fixtures; VM/agent actions are faked
// so tests never contact a provider or alter the developer's SSH configuration.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
// Representative permissive Incus defaults that the generated entry replaces.
const rawSSH =
  "Host default\n  HostName 192.168.121.3\n  User ubuntu\n  IdentityFile /tmp/vm-key\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  ForwardAgent no\n";

// Host policy tests isolate the provider behind its public interface. Real SSH
// parsing and filesystem writes still run, with all state inside the fixture.
function createHost(options) {
  return realCreateHost({
    home: options.root,
    ...options,
    env: { XDG_STATE_HOME: join(options.root, "../state"), ...options.env },
    runtime: {
      connection: () => rawSSH,
      fingerprint: () =>
        options.run?.([
          "incus",
          "exec",
          "local:oc-dev",
          "--",
          "ssh-keygen",
          "-lf",
          "/etc/ssh/ssh_host_ed25519_key.pub",
        ]),
      ...options.runtime,
    },
  });
}

test("OpenSSH resolves approved forwarding, Incus identity and persistent trust policy", (t) => {
  const root = fixture(t);
  const config = renderSSH(rawSSH, true, join(root, "known hosts"));
  const path = join(root, "config");
  writeFileSync(path, config);
  // Parse with OpenSSH itself: string assertions alone would miss invalid quoting
  // or the first-value-wins behavior of duplicate configuration directives.
  const resolved = command(["ssh", "-G", "-F", path, "oc-dev"], {
    quiet: true,
  }).stdout;
  for (const line of [
    "forwardagent yes",
    "stricthostkeychecking accept-new",
    "identityfile /tmp/vm-key",
    "hostkeyalias oc-dev",
  ])
    assert.ok(resolved.includes(line));
  assert.equal(config.includes("/dev/null"), false);
  assert.equal(config.includes("IdentityAgent"), false);
  assert.throws(
    () => renderSSH(rawSSH, false, "/tmp/known\nHost *"),
    /line breaks/,
  );
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

test("existing guest checkout is preserved without reading config or running Git", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".git"));
  createGuest({
    root,
    configPath: "/absent",
    run: () => assert.fail("No command should run"),
    output: silent,
  }).clone();
});

test("guest clone tracks a branch and a failed ref lookup leaves an empty destination", (t) => {
  const root = fixture(t);
  const origin = join(root, "origin");
  const checkout = join(root, "checkout");
  mkdirSync(origin);
  mkdirSync(checkout);
  const run = (args, options) =>
    command(args, {
      ...options,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_COUNT: "0",
      },
      quiet: true,
    });
  run(["git", "init", "-b", "main"], { cwd: origin });
  writeFileSync(join(origin, "README.md"), "fixture");
  run(["git", "add", "README.md"], { cwd: origin });
  run(
    [
      "git",
      "-c",
      "user.name=VM test",
      "-c",
      "user.email=vm@example.com",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: origin },
  );
  const configPath = join(root, "settings.json");
  writeFileSync(
    configPath,
    JSON.stringify({ repo_url: origin, repo_ref: "absent" }),
  );
  assert.throws(
    () =>
      createGuest({ root: checkout, configPath, run, output: silent }).clone(),
    /git failed/,
  );
  assert.deepEqual(readdirSync(checkout), []);
  writeFileSync(
    configPath,
    JSON.stringify({ repo_url: origin, repo_ref: "main" }),
  );
  createGuest({ root: checkout, configPath, run, output: silent }).clone();
  assert.equal(readFileSync(join(checkout, "README.md"), "utf8"), "fixture");
  assert.equal(
    run(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], {
      cwd: checkout,
    }).stdout.trim(),
    "origin/main",
  );
});

test("initialization selects only missing repositories and preserves existing branches", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, ".gitmodules"),
    '[submodule "opencollective-api"]\npath = opencollective-api\nurl = git@github.com:opencollective/opencollective-api.git\n[submodule "opencollective-frontend"]\npath = opencollective-frontend\nurl = git@github.com:opencollective/opencollective-frontend.git\n',
  );
  mkdirSync(join(root, "opencollective-api"));
  writeFileSync(join(root, "opencollective-api/.git"), "");
  command(["git", "init", "-q", root], { quiet: true });
  const calls = [];
  const guest = createGuest({
    root,
    env: {},
    output: silent,
    run: (args, options) => {
      if (args[0] === "git") return command(args, { ...options, quiet: true });
      calls.push(args);
      return { status: 0 };
    },
  });
  guest.initialize();
  assert.deepEqual(calls[0].slice(-2), [
    "--projects",
    "opencollective-frontend",
  ]);
  mkdirSync(join(root, "opencollective-frontend"));
  writeFileSync(join(root, "opencollective-frontend/.git"), "");
  calls.length = 0;
  guest.initialize();
  assert.deepEqual(calls, []);
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

test("host-key reset requires confirmation and does not erase trust when declined", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".ssh"));
  writeFileSync(join(root, ".ssh/oc-development-known_hosts"), "trusted-key");
  const calls = [];
  const host = createHost({
    root,
    home: root,
    env: {},
    output: silent,
    confirm: async () => false,
    run: (args) => {
      calls.push(args);
      return { status: 0, stdout: rawSSH };
    },
  });
  await assert.rejects(host.refreshSSH({ reset: true }), /cancelled/);
  assert.equal(
    calls.some((args) => args.includes("-R")),
    false,
  );
  assert.equal(
    readFileSync(join(root, ".ssh/oc-development-known_hosts"), "utf8"),
    "trusted-key",
  );
  assert.ok(existsSync(join(host.stateDir, "ssh-config")));
});

test("forwarding is disabled by default and never inherits Incus's agent override", async (t) => {
  const root = fixture(t);
  const host = createHost({
    root,
    home: root,
    env: {},
    output: silent,
    runtime: {
      connection: () =>
        rawSSH + "  IdentityAgent /tmp/other-agent\n  ForwardAgent yes\n",
    },
  });
  assert.equal(host.forwardingApproved(), false);
  const path = await host.refreshSSH();
  const config = readFileSync(path, "utf8");
  assert.ok(config.includes("ForwardAgent no"));
  assert.equal(config.includes("IdentityAgent"), false);
});

for (const [name, agentStatus, approval, expected, socket] of [
  ["approval", 0, true, true, "/tmp/host-agent"],
  ["refusal", 0, false, false, "/tmp/host-agent"],
  ["empty agent", 1, true, false, "/tmp/host-agent"],
  ["unreachable agent", 2, true, false, "/tmp/host-agent"],
  ["absent agent", 0, true, false, undefined],
]) {
  test(
    "forwarding " +
      name +
      " is persisted and SSH refreshes preserve the choice",
    async (t) => {
      const root = fixture(t);
      const calls = [];
      let prompts = 0;
      const host = createHost({
        root,
        home: root,
        env: socket ? { SSH_AUTH_SOCK: socket } : {},
        output: silent,
        confirm: async (question) => {
          prompts++;
          assert.match(question, /Forward this host SSH agent/);
          return approval;
        },
        run: (args, options) => {
          calls.push(args);
          if (args[0] === "ssh-add") {
            assert.deepEqual(args, ["ssh-add", "-l"]);
            assert.equal(options.env.SSH_AUTH_SOCK, socket);
            // Multiple identities are allowed; no selected-key restriction exists.
            return {
              status: agentStatus,
              stdout: "256 first identity\n2048 second identity\n",
            };
          }
          assert.fail("Unexpected host command");
          return { status: 0, stdout: rawSSH };
        },
      });
      mkdirSync(host.stateDir, { recursive: true });
      writeFileSync(
        join(host.stateDir, "ssh-settings.json"),
        '{"forward_agent":true}',
      );
      assert.equal(await host.configureForwarding(), expected);
      assert.equal(prompts, socket && agentStatus === 0 ? 1 : 0);
      assert.deepEqual(
        JSON.parse(
          readFileSync(join(host.stateDir, "ssh-settings.json"), "utf8"),
        ),
        { forward_agent: expected },
      );
      assert.equal(
        statSync(join(host.stateDir, "ssh-settings.json")).mode & 0o777,
        0o600,
      );
      await host.refreshSSH({ install: true });
      await host.refreshSSH({ install: true });
      assert.ok(
        readFileSync(join(root, ".ssh/oc-development.conf"), "utf8").includes(
          "ForwardAgent " + (expected ? "yes" : "no"),
        ),
      );
      assert.equal(host.forwardingApproved(), expected);
      assert.equal(
        calls.filter((args) => args[0] === "ssh-add").length,
        socket ? 1 : 0,
      );
    },
  );
}

test("forwarding fails closed when agent inspection is unavailable", async (t) => {
  const root = fixture(t);
  const host = createHost({
    root,
    env: { SSH_AUTH_SOCK: "/tmp/agent" },
    output: silent,
    confirm: async () =>
      assert.fail("No usable agent means no approval prompt"),
    run: (args) => {
      assert.deepEqual(args, ["ssh-add", "-l"]);
      throw new Error("command unavailable");
    },
  });
  assert.equal(await host.configureForwarding(), false);
  assert.equal(host.forwardingApproved(), false);
});

test("malformed forwarding preferences are rejected", (t) => {
  const root = fixture(t);
  const host = createHost({ root, env: {}, output: silent });
  mkdirSync(host.stateDir, { recursive: true });
  for (const value of [
    null,
    [],
    {},
    { forward_agent: "false" },
    { forward_agent: 1 },
    { forward_agent: true, extra: true },
  ]) {
    writeFileSync(
      join(host.stateDir, "ssh-settings.json"),
      JSON.stringify(value),
    );
    assert.throws(() => host.forwardingApproved(), /Invalid/);
  }
  writeFileSync(join(host.stateDir, "ssh-settings.json"), "not JSON");
  assert.throws(() => host.forwardingApproved());
});

test("guest commands refresh addresses without polluting their stdout", async (t) => {
  const calls = [];
  const host = createHost({
    root: fixture(t),
    output: () =>
      assert.fail("SSH administration output must not mix with guest output"),
    run: (args) => calls.push(args),
  });
  await host.cli(["ssh", "node", "/opt/oc-vm/guest.mjs", "git-status"]);
  assert.equal(calls.at(-1).at(-1), "node /opt/oc-vm/guest.mjs git-status");
});

test("lifecycle commands dispatch to Incus and reject unexpected arguments", async (t) => {
  const calls = [];
  const runtime = Object.fromEntries(
    ["doctor", "up", "stop", "restart", "status", "repairSSH"].map((action) => [
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
  await host.cli(["retry-cloud-init"]);
  assert.deepEqual(calls.at(-1), {
    action: "up",
    options: { retryCloudInit: true },
  });
  await assert.rejects(
    host.cli(["retry-cloud-init", "unexpected"]),
    /takes no arguments/,
  );
  await host.cli(["repair-ssh"]);
  assert.equal(calls.at(-1).action, "repairSSH");
  await assert.rejects(
    host.cli(["repair-ssh", "unexpected"]),
    /takes no arguments/,
  );
});

test("approved host-key reset reads Incus fingerprint before clearing only dedicated trust", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".ssh"));
  writeFileSync(join(root, ".ssh/oc-development-known_hosts"), "old trust");
  const calls = [];
  const host = createHost({
    root,
    home: root,
    output: silent,
    confirm: async () => true,
    run: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  await host.refreshSSH({ reset: true });
  assert.equal(calls[0][0], "incus");
  assert.deepEqual(calls[1], [
    "ssh-keygen",
    "-R",
    "oc-dev",
    "-f",
    join(root, ".ssh/oc-development-known_hosts"),
  ]);
});
