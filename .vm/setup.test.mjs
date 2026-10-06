// Exercise the host setup in a real terminal with a fake VM launcher.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { shellQuote } from "./process.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oc-setup-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".vm"));
  mkdirSync(join(root, "scripts"));
  const setup = join(root, ".vm/setup.sh");
  const trace = join(root, "trace");
  writeFileSync(
    setup,
    readFileSync(new URL("./setup.sh", import.meta.url), "utf8"),
  );
  writeFileSync(trace, "");
  writeFileSync(
    join(root, "scripts/vm.sh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TRACE, JSON.stringify(args) + '\\n');
if (args.at(-1) === process.env.FAIL_STAGE) process.exit(1);
`,
    { mode: 0o755 },
  );
  const env = { ...process.env, TRACE: trace, FAIL_STAGE: "" };
  return {
    root,
    setup,
    env,
    calls: () =>
      readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    run: (overrides = {}) =>
      spawnSync(
        "script",
        ["-q", "-e", "-c", `bash ${shellQuote(setup)}`, "/dev/null"],
        {
          env: { ...env, ...overrides },
          encoding: "utf8",
          input: "",
          timeout: 5000,
        },
      ),
  };
}

test("setup is repeatable and only provisions, configures identity, and prepares the stack", (t) => {
  const f = fixture(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Setup complete/);
  }
  const sequence = [
    ["up"],
    ["guest", "bash", "/workspace/.vm/git-identity.sh"],
    ["guest", "node", "/workspace/.vm/guest.mjs", "stack"],
    ["guest", "node", "/workspace/.vm/guest.mjs", "doctor"],
  ];
  assert.deepEqual(f.calls(), [...sequence, ...sequence]);
});

test("failed stack setup stops before reporting success and setup requires an interactive terminal", (t) => {
  const f = fixture(t);
  const failed = f.run({ FAIL_STAGE: "stack" });
  assert.notEqual(failed.status, 0);
  assert.equal(failed.stdout.includes("Setup complete"), false);
  assert.equal(
    f.calls().some((args) => args.at(-1) === "doctor"),
    false,
  );
  const count = f.calls().length;
  const noninteractive = spawnSync("bash", [f.setup], {
    env: f.env,
    encoding: "utf8",
    input: "",
    timeout: 5000,
  });
  assert.notEqual(noninteractive.status, 0);
  assert.match(noninteractive.stderr, /interactive host terminal/);
  assert.equal(f.calls().length, count);
});

test("Git identity uses the shared repository identity without prompting", (t) => {
  const f = fixture(t);
  const home = join(f.root, "guest-home");
  mkdirSync(home);
  const identity = join(f.root, ".vm/git-identity.sh");
  writeFileSync(
    identity,
    readFileSync(new URL("./git-identity.sh", import.meta.url), "utf8").replace(
      "cd /workspace",
      `cd ${shellQuote(f.root)}`,
    ),
  );
  spawnSync("git", ["init", "--quiet", f.root], { encoding: "utf8" });
  spawnSync("git", ["-C", f.root, "config", "--local", "user.name", "Fixture"]);
  spawnSync("git", [
    "-C",
    f.root,
    "config",
    "--local",
    "user.email",
    "fixture@example.com",
  ]);
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
  };
  const first = spawnSync("bash", [identity], {
    env,
    encoding: "utf8",
    input: "",
    timeout: 5000,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Using repository Git name: Fixture/);
  assert.match(
    first.stdout,
    /Using repository Git email: fixture@example\.com/,
  );
  const before = readFileSync(env.GIT_CONFIG_GLOBAL, "utf8");
  const second = spawnSync("bash", [identity], {
    env,
    encoding: "utf8",
    input: "",
    timeout: 5000,
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(env.GIT_CONFIG_GLOBAL, "utf8"), before);
  assert.match(second.stdout, /Using repository Git name: Fixture/);
  assert.match(
    second.stdout,
    /Using repository Git email: fixture@example\.com/,
  );
});

test("Git identity prompts when the shared repository has no identity", (t) => {
  const f = fixture(t);
  const home = join(f.root, "guest-home");
  mkdirSync(home);
  const identity = join(f.root, ".vm/git-identity.sh");
  writeFileSync(
    identity,
    readFileSync(new URL("./git-identity.sh", import.meta.url), "utf8").replace(
      "cd /workspace",
      `cd ${shellQuote(f.root)}`,
    ),
  );
  spawnSync("git", ["init", "--quiet", f.root], { encoding: "utf8" });
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
  };
  const result = spawnSync("bash", [identity], {
    env,
    encoding: "utf8",
    input: "Fallback Name\nfallback@example.com\n",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Git commit name \(shown on commits\):/);
  assert.match(result.stdout, /Git commit email \(shown on commits\):/);
  assert.equal(
    spawnSync("git", ["config", "--global", "--get", "user.name"], {
      env,
      encoding: "utf8",
    }).stdout.trim(),
    "Fallback Name",
  );
  assert.equal(
    spawnSync("git", ["config", "--global", "--get", "user.email"], {
      env,
      encoding: "utf8",
    }).stdout.trim(),
    "fallback@example.com",
  );
});
