// Git access decisions use faked probes; the HTTPS clone test runs real Git
// against local repositories through a fixture-only URL rewrite. No network,
// host agent, private repository, or personal Git configuration is accessed.
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createGuest } from "./guest.mjs";
import { command } from "./process.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oc-git-access-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const silent = () => {};
const gitEnv = {
  ...process.env,
  SSH_AUTH_SOCK: "",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_COUNT: "0",
};

for (const [
  name,
  socket,
  agentStatus,
  publicAccess,
  privateAccess,
  expected,
] of [
  ["absent agent", false, 0, true, true, "https-public"],
  ["empty agent", true, 1, true, true, "https-public"],
  ["unreachable agent", true, 2, true, true, "https-public"],
  ["unregistered identity", true, 0, false, false, "https-public"],
  ["public SSH access", true, 0, true, false, "ssh-public"],
  ["private SSH access", true, 0, true, true, "ssh-private"],
]) {
  test(`${name} selects the available repositories and transport`, (t) => {
    const root = fixture(t);
    command(["git", "init", "-q", root], { env: gitEnv, quiet: true });
    const modules = ["api", "frontend", "security"]
      .map(
        (service) =>
          `[submodule "opencollective-${service}"]\npath = opencollective-${service}\nurl = git@github.com:opencollective/opencollective-${service}.git\n`,
      )
      .join("");
    writeFileSync(join(root, ".gitmodules"), modules);
    const calls = [];
    const guest = createGuest({
      root,
      output: silent,
      env: { ...gitEnv, SSH_AUTH_SOCK: socket ? "/tmp/forwarded" : "" },
      run: (args, options) => {
        calls.push(args);
        if (args[0] === "ssh-add") {
          assert.deepEqual(args, ["ssh-add", "-l"]);
          return { status: agentStatus };
        }
        if (args[0] === "git" && args[1] === "ls-remote") {
          assert.match(options.env.GIT_SSH_COMMAND, /BatchMode=yes/);
          return {
            status: args[2].includes("security")
              ? privateAccess
                ? 0
                : 1
              : publicAccess
                ? 0
                : 1,
          };
        }
        if (args[0] === "bash") return { status: 0 };
        assert.equal(args[0], "git");
        return command(args, { ...options, quiet: true });
      },
    });
    guest.initialize();
    assert.equal(guest.gitStatus(), expected);
    const selected = calls
      .find((args) => args[0] === "bash")
      .at(-1)
      .split(",");
    assert.deepEqual(
      selected,
      expected === "ssh-private"
        ? [
            "opencollective-api",
            "opencollective-frontend",
            "opencollective-security",
          ]
        : ["opencollective-api", "opencollective-frontend"],
    );
    const overrides = calls.filter(
      (args) => args[0] === "git" && args[2] === "--local",
    );
    assert.equal(overrides.length, expected === "ssh-private" ? 3 : 2);
    for (const args of overrides)
      assert.match(
        args.at(-1),
        expected === "https-public"
          ? /^https:\/\/github\.com\//
          : /^git@github\.com:/,
      );
    assert.equal(readFileSync(join(root, ".gitmodules"), "utf8"), modules);
    if (!socket || agentStatus !== 0)
      assert.equal(
        calls.some((args) => args[1] === "ls-remote"),
        false,
      );
  });
}

test("HTTPS fallback clones public modules and preserves existing remotes, branches and work", (t) => {
  const root = fixture(t);
  const origins = join(root, "origins");
  const workspace = join(root, "workspace");
  const assets = join(root, "assets");
  mkdirSync(origins);
  mkdirSync(workspace);
  mkdirSync(join(assets, "shared"), { recursive: true });
  copyFileSync(
    fileURLToPath(new URL("../scripts/init.sh", import.meta.url)),
    join(assets, "shared/init.sh"),
  );
  // Git still records HTTPS origin URLs; this per-process test rewrite changes
  // only their transport to local file repositories and permits that protocol.
  const env = {
    ...gitEnv,
    GIT_ALLOW_PROTOCOL: "file",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file://${origins}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/fixture/",
  };
  const run = (args, options = {}) =>
    command(args, { ...options, env: { ...env, ...options.env }, quiet: true });
  const git = (cwd, ...args) => run(["git", ...args], { cwd });
  const commit = (cwd) =>
    git(
      cwd,
      "-c",
      "user.name=VM fixture",
      "-c",
      "user.email=vm@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "fixture",
    );
  git(workspace, "init", "-qb", "main");
  let modules = "";
  for (const service of ["api", "frontend", "security"]) {
    const origin = join(origins, `${service}.git`);
    mkdirSync(origin);
    git(origin, "init", "-qb", "main");
    writeFileSync(join(origin, "README.md"), service);
    git(origin, "add", "README.md");
    commit(origin);
    const oid = git(origin, "rev-parse", "HEAD").stdout.trim();
    const path = `opencollective-${service}`;
    git(
      workspace,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${oid},${path}`,
    );
    modules += `[submodule "${path}"]\npath = ${path}\nurl = git@github.com:fixture/${service}.git\n`;
  }
  writeFileSync(join(workspace, ".gitmodules"), modules);
  git(workspace, "add", ".gitmodules");
  commit(workspace);
  const guest = createGuest({
    root: workspace,
    assets,
    env,
    run,
    output: silent,
  });
  guest.initialize();
  for (const service of ["api", "frontend"]) {
    const path = join(workspace, `opencollective-${service}`);
    assert.equal(readFileSync(join(path, "README.md"), "utf8"), service);
    assert.equal(
      git(path, "remote", "get-url", "--push", "origin").stdout.trim(),
      `file://${origins}/${service}.git`,
    );
    // Inspect stored configuration separately from Git's URL rewrite expansion.
    assert.equal(
      git(path, "config", "--get", "remote.origin.url").stdout.trim(),
      `https://github.com/fixture/${service}.git`,
    );
  }
  assert.equal(
    existsSync(join(workspace, "opencollective-security/.git")),
    false,
  );
  assert.equal(guest.gitStatus(), "https-public");
  const api = join(workspace, "opencollective-api");
  git(api, "switch", "-qc", "feature");
  git(
    api,
    "remote",
    "set-url",
    "origin",
    "https://example.invalid/developer/api.git",
  );
  writeFileSync(join(api, "uncommitted.txt"), "keep my work");
  guest.initialize();
  assert.equal(git(api, "branch", "--show-current").stdout.trim(), "feature");
  assert.equal(
    git(api, "config", "--get", "remote.origin.url").stdout.trim(),
    "https://example.invalid/developer/api.git",
  );
  assert.equal(
    readFileSync(join(api, "uncommitted.txt"), "utf8"),
    "keep my work",
  );
  assert.equal(readFileSync(join(workspace, ".gitmodules"), "utf8"), modules);
});
