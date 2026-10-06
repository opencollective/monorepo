// Exercise guest Git configuration using real Git and a fake session-provided gh.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createGuest } from "./guest.mjs";
import { command } from "./process.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "oc-git-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "workspace");
  const home = join(directory, "guest-home");
  const bin = join(directory, "bin");
  for (const path of [root, home, bin]) mkdirSync(path);
  const calls = [];
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_COUNT: "0",
    GIT_TERMINAL_PROMPT: "0",
    PATH: `${bin}:${process.env.PATH}`,
    GH_TRACE: join(directory, "gh-trace"),
  };
  const run = (args, options = {}) => {
    calls.push(args);
    return command(args, {
      cwd: root,
      env,
      quiet: true,
      timeout: 5000,
      ...(options.input === undefined
        ? {}
        : { stdio: ["pipe", "pipe", "pipe"] }),
      ...options,
    });
  };
  run(["git", "init", "-q", "-b", "main"]);
  run(["git", "config", "--local", "user.name", "Fixture"]);
  run(["git", "config", "--local", "user.email", "fixture@example.com"]);
  run([
    "git",
    "remote",
    "add",
    "origin",
    "git@github.com:opencollective/monorepo.git",
  ]);
  writeFileSync(join(root, "source.txt"), "shared source");
  run(["git", "add", "source.txt"]);
  run(["git", "commit", "-qm", "fixture"]);
  writeFileSync(join(root, "source.txt"), "uncommitted shared work");
  const worktree = join(root, ".worktrees", "feature", "repository");
  run(["git", "worktree", "add", "-b", "feature", worktree]);
  const guest = createGuest({ root, env, run, output: () => {} });
  return { root, home, bin, calls, run, guest, env, worktree };
}

test("HTTPS rewriting applies to fetch, push and worktrees without changing shared remotes or work", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, ".git/config"), "utf8");
  f.calls.length = 0;
  f.guest.configureGit("https");
  f.guest.configureGit("https");
  for (const cwd of [f.root, f.worktree]) {
    for (const args of [
      ["remote", "get-url", "origin"],
      ["remote", "get-url", "--push", "origin"],
    ])
      assert.equal(
        f.run(["git", ...args], { cwd }).stdout.trim(),
        "https://github.com/opencollective/monorepo.git",
      );
    assert.equal(
      f
        .run(["git", "config", "--local", "remote.origin.url"], { cwd })
        .stdout.trim(),
      "git@github.com:opencollective/monorepo.git",
    );
  }
  assert.equal(readFileSync(join(f.root, ".git/config"), "utf8"), before);
  assert.equal(
    readFileSync(join(f.root, "source.txt"), "utf8"),
    "uncommitted shared work",
  );
  assert.equal(
    f
      .run(["git", "branch", "--show-current"], { cwd: f.worktree })
      .stdout.trim(),
    "feature",
  );
  for (const [url, expected] of [
    ["ssh://git@github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["https://github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["git@gitlab.com:org/repo.git", "git@gitlab.com:org/repo.git"],
  ])
    assert.equal(
      f.run(["git", "ls-remote", "--get-url", url]).stdout.trim(),
      expected,
    );
  assert.equal(
    f.calls.some((args) =>
      ["clone", "fetch", "checkout", "submodule"].includes(args[1]),
    ),
    false,
  );
});

test("switching between protocols replaces guest URL rules without changing stored remotes", (t) => {
  const f = fixture(t);
  for (const protocol of ["https", "ssh", "ssh", "https"]) {
    f.guest.configureGit(protocol);
    const expected =
      protocol === "ssh"
        ? "git@github.com:org/repo.git"
        : "https://github.com/org/repo.git";
    assert.equal(
      f
        .run([
          "git",
          "ls-remote",
          "--get-url",
          "https://github.com/org/repo.git",
        ])
        .stdout.trim(),
      expected,
    );
    assert.equal(
      f
        .run(["git", "ls-remote", "--get-url", "git@github.com:org/repo.git"])
        .stdout.trim(),
      expected,
    );
  }
});

test("GitHub credentials resolve gh from the session PATH and never use a credential store", (t) => {
  const f = fixture(t);
  const store = join(f.home, "credentials");
  f.run([
    "git",
    "config",
    "--global",
    "credential.helper",
    `store --file=${store}`,
  ]);
  f.guest.configureGit("https");
  f.guest.configureGit("https");
  // gh can appear after provisioning, when an Orca session supplies it.
  writeFileSync(
    join(f.bin, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.GH_TRACE, JSON.stringify(args) + '\\n');
if (args.join(' ') === 'auth git-credential get')
  process.stdout.write('username=fixture\\npassword=fixture-password\\n');
else if (args.join(' ') !== 'auth git-credential store') process.exit(1);
`,
    { mode: 0o755 },
  );
  const input = "protocol=https\nhost=github.com\n\n";
  const credentials = f.run(["git", "credential", "fill"], { input }).stdout;
  assert.match(credentials, /username=fixture/);
  assert.match(credentials, /password=fixture-password/);
  f.run(["git", "credential", "approve"], { input: credentials });
  assert.deepEqual(
    readFileSync(f.env.GH_TRACE, "utf8").trim().split("\n").map(JSON.parse),
    [
      ["auth", "git-credential", "get"],
      ["auth", "git-credential", "store"],
    ],
  );
  assert.deepEqual(
    f
      .run([
        "git",
        "config",
        "--global",
        "--get-all",
        "credential.https://github.com.helper",
      ])
      .stdout.split("\n"),
    ["", "!gh auth git-credential", ""],
  );
  for (const path of [
    store,
    join(f.home, ".git-credentials"),
    join(f.home, ".config/gh"),
    join(f.home, ".ssh"),
  ])
    assert.equal(existsSync(path), false);
});

test("invalid protocols and Git configuration errors fail before continuing", (t) => {
  const f = fixture(t);
  f.calls.length = 0;
  assert.throws(() => f.guest.configureGit("http"), /ssh or https/);
  assert.deepEqual(f.calls, []);
  assert.throws(
    () =>
      createGuest({ root: f.root, run: () => ({ status: 1 }) }).configureGit(
        "https",
      ),
    /Could not update guest Git/,
  );
});
