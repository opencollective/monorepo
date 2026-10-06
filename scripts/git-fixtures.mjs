import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function workspaceFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "oc workspace-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = join(directory, "workspace");
  mkdirSync(join(workspace, "scripts"), { recursive: true });
  for (const name of [
    "init.sh",
    "projects.sh",
    "remove-git.sh",
    "restore-git.sh",
  ])
    copyFileSync(
      new URL(`./${name}`, import.meta.url),
      join(workspace, "scripts", name),
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_TERMINAL_PROMPT: "0",
  });
  delete env.OC_MONOREPO_ROOT;
  const execute = (cwd, command, args, overrides = {}) =>
    spawnSync(command, args, {
      cwd,
      env: { ...env, ...overrides },
      encoding: "utf8",
    });
  function git(cwd, ...args) {
    const result = execute(cwd, "git", args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  }
  function commit(cwd, content) {
    writeFileSync(join(cwd, "version.txt"), content);
    git(cwd, "add", "version.txt");
    git(cwd, "commit", "-m", content);
    return git(cwd, "rev-parse", "HEAD");
  }
  function script(name, args = [], status = 0, overrides = {}) {
    // Invoke outside the workspace to exercise script-relative root discovery.
    const result = execute(
      directory,
      "bash",
      [join(workspace, "scripts", name), ...args],
      overrides,
    );
    assert.equal(result.status, status, result.stdout + result.stderr);
    return result.stdout + result.stderr;
  }
  git(workspace, "init", "--initial-branch=main");
  writeFileSync(
    join(workspace, ".gitignore"),
    "/opencollective*/\n/.git-backup/\n/.worktrees/\n",
  );
  writeFileSync(join(workspace, ".gitattributes"), "*.txt text\n");
  mkdirSync(join(workspace, ".github"));
  writeFileSync(join(workspace, ".github/config.yml"), "test: true\n");
  commit(workspace, "workspace initial");
  git(workspace, "add", ".");
  git(workspace, "commit", "-m", "Workspace scripts");
  return { directory, workspace, env, execute, git, commit, script };
}
