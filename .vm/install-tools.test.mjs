// Exercise the real Bash installer with a local nvm archive and fake network, nvm, and npm commands.
// Each fixture has its own HOME; no test downloads tools or changes the host nvm.
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
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("./install-tools.sh", import.meta.url));
const declared = JSON.parse(
  readFileSync(new URL("./versions.json", import.meta.url), "utf8"),
);

function fixture(t, versions = declared) {
  const root = mkdtempSync(join(tmpdir(), "oc-tools-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const home = join(root, "home");
  const trace = join(root, "trace");
  const tools = join(bin, "fake-tool.cjs");
  const config = join(root, "versions.json");
  mkdirSync(bin);
  mkdirSync(home);
  const source = join(root, "nvm-source");
  const archive = join(root, "nvm.tar.gz");
  mkdirSync(source);
  writeFileSync(
    join(source, "nvm.sh"),
    'nvm() { node "$TOOL_FAKE" nvm "$@"; }\n',
  );
  const packed = spawnSync("tar", ["-czf", archive, "-C", root, "nvm-source"], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  writeFileSync(trace, "");
  writeFileSync(config, JSON.stringify(versions));
  const fake = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { basename } = require('node:path');
const args = process.argv.slice(2);
const tool = basename(process.argv[1]) === 'fake-tool.cjs' ? args.shift() : basename(process.argv[1]);
appendFileSync(process.env.TRACE, JSON.stringify({ tool, args }) + '\\n');
if (tool === 'curl') {
  if (args.at(-1).endsWith('/releases/latest')) {
    if (process.env.LOOKUP_FAIL) process.exit(22);
    console.log(process.env.RELEASE_JSON);
  } else {
    if (process.env.ARCHIVE_FAIL) process.exit(22);
    process.stdout.write(readFileSync(process.env.ARCHIVE));
  }
} else if (tool === 'npm' && args[0] === '--version') {
  console.log('11.0.0');
}
`;
  for (const name of ["git", "curl", "npm", "fake-tool.cjs"])
    writeFileSync(join(bin, name), fake, { mode: 0o755 });
  return {
    home,
    calls: () =>
      readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    run: (env = {}) =>
      spawnSync("bash", [installer, config], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:${process.env.PATH}`,
          TRACE: trace,
          ARCHIVE: archive,
          ARCHIVE_FAIL: "",
          TOOL_FAKE: tools,
          RELEASE_JSON: JSON.stringify({ tag_name: "v0.99.0" }),
          LOOKUP_FAIL: "",
          ...env,
        },
        encoding: "utf8",
      }),
  };
}

test("latest resolves a stable nvm release and installs npm tools on pinned Node", (t) => {
  const tools = fixture(t);
  const result = tools.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = tools.calls();
  assert.deepEqual(calls.find(({ tool }) => tool === "curl").args, [
    "-fsSL",
    "https://api.github.com/repos/nvm-sh/nvm/releases/latest",
  ]);
  assert.deepEqual(calls.filter(({ tool }) => tool === "curl")[1].args, [
    "-fsSL",
    "https://github.com/nvm-sh/nvm/archive/refs/tags/v0.99.0.tar.gz",
  ]);
  assert.equal(
    calls.some(({ tool }) => tool === "git"),
    false,
  );
  assert.deepEqual(
    calls.filter(({ tool }) => tool === "nvm").map(({ args }) => args),
    [
      ["install", "24.21.0"],
      ["alias", "default", "24.21.0"],
      ["use", "24.21.0"],
    ],
  );
  assert.deepEqual(calls.find(({ tool }) => tool === "npm").args, [
    "install",
    "-g",
    "@openai/codex@latest",
    "opencode-ai@latest",
    "eslint@latest",
    "prettier@latest",
    "typescript@latest",
    "pm2@latest",
  ]);
});

test("reprovision refreshes nvm while preserving installed files", (t) => {
  const tools = fixture(t);
  assert.equal(tools.run().status, 0);
  const marker = join(tools.home, ".nvm", "preserved");
  writeFileSync(marker, "keep");
  const result = tools.run({
    RELEASE_JSON: JSON.stringify({ tag_name: "v0.99.1" }),
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = tools.calls();
  assert.equal(calls.filter(({ tool }) => tool === "curl").length, 4);
  assert.equal(
    calls.some(({ tool }) => tool === "git"),
    false,
  );
  assert.equal(
    calls
      .filter(({ tool }) => tool === "curl")
      .at(-1)
      .args.at(-1),
    "https://github.com/nvm-sh/nvm/archive/refs/tags/v0.99.1.tar.gz",
  );
  assert.equal(readFileSync(marker, "utf8"), "keep");
  assert.equal(
    calls.filter(({ tool, args }) => tool === "npm" && args[0] === "install")
      .length,
    2,
  );
});

test("explicit nvm and npm versions bypass release lookup", (t) => {
  const tools = fixture(t, {
    ...declared,
    nvm: "v0.40.8",
    npm_packages: { "@openai/codex": "1.2.3" },
  });
  const result = tools.run({ LOOKUP_FAIL: "1" });
  assert.equal(result.status, 0, result.stderr);
  const downloads = tools.calls().filter(({ tool }) => tool === "curl");
  assert.equal(downloads.length, 1);
  assert.equal(
    downloads[0].args.at(-1),
    "https://github.com/nvm-sh/nvm/archive/refs/tags/v0.40.8.tar.gz",
  );
  assert.deepEqual(tools.calls().find(({ tool }) => tool === "npm").args, [
    "install",
    "-g",
    "@openai/codex@1.2.3",
  ]);
});

for (const [name, env, message] of [
  ["failed lookup", { LOOKUP_FAIL: "1" }, /Could not look up/],
  ["malformed response", { RELEASE_JSON: "not JSON" }, /no valid tag_name/],
  ["missing tag", { RELEASE_JSON: "{}" }, /no valid tag_name/],
  [
    "invalid tag",
    { RELEASE_JSON: '{"tag_name":"main"}' },
    /Invalid nvm release tag/,
  ],
]) {
  test(`${name} stops before installing any tools`, (t) => {
    const tools = fixture(t);
    const result = tools.run(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(
      tools.calls().some(({ tool }) => ["git", "npm", "nvm"].includes(tool)),
      false,
    );
  });
}

test("a failed archive download stops before executing nvm or npm", (t) => {
  const tools = fixture(t);
  const result = tools.run({ ARCHIVE_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(
    tools.calls().some(({ tool }) => ["git", "npm", "nvm"].includes(tool)),
    false,
  );
});
