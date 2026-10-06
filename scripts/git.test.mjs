import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { workspaceFixture } from "./git-fixtures.mjs";

function service(f, name = "opencollective-api") {
  const local = join(f.workspace, name);
  mkdirSync(local);
  f.git(local, "init", "--initial-branch=main");
  f.commit(local, "service initial");
  return local;
}

test("hide/restore preserves workspace Git state and leaves service Git and settings available", (t) => {
  const f = workspaceFixture(t);
  const local = service(f);
  f.git(f.workspace, "switch", "--create", "workspace-feature");
  writeFileSync(join(f.workspace, "version.txt"), "saved work");
  f.git(f.workspace, "stash", "push", "-m", "saved work");
  writeFileSync(join(f.workspace, "staged.txt"), "staged change");
  f.git(f.workspace, "add", "staged.txt");
  writeFileSync(join(f.workspace, "version.txt"), "unstaged change");
  const files = [
    ".git/HEAD",
    ".git/index",
    ".git/config",
    ".gitignore",
    ".gitattributes",
    ".github/config.yml",
  ];
  const before = files.map((path) => readFileSync(join(f.workspace, path)));
  const status = f.git(f.workspace, "status", "--porcelain");
  const stash = f.git(f.workspace, "rev-parse", "refs/stash");
  f.script("remove-git.sh");
  assert.equal(existsSync(join(f.workspace, ".git")), false);
  assert.equal(existsSync(join(f.workspace, ".git-backup/git/.git")), false);
  for (const path of files.slice(3))
    assert.equal(existsSync(join(f.workspace, path)), true);
  assert.equal(f.git(local, "branch", "--show-current"), "main");
  f.commit(local, "service commit while workspace Git is hidden");
  f.script("remove-git.sh");
  f.script("restore-git.sh");
  f.script("restore-git.sh");
  for (const [i, path] of files.entries())
    assert.deepEqual(readFileSync(join(f.workspace, path)), before[i]);
  assert.equal(f.git(f.workspace, "status", "--porcelain"), status);
  assert.equal(f.git(f.workspace, "rev-parse", "refs/stash"), stash);
  assert.equal(
    f.git(f.workspace, "branch", "--show-current"),
    "workspace-feature",
  );
  assert.equal(existsSync(join(f.workspace, ".git-backup")), false);
});

test("refuses backup and restore conflicts without overwriting metadata", (t) => {
  const f = workspaceFixture(t);
  const head = readFileSync(join(f.workspace, ".git/HEAD"));
  mkdirSync(join(f.workspace, ".git-backup"));
  writeFileSync(join(f.workspace, ".git-backup/keep"), "backup data");
  assert.match(f.script("remove-git.sh", [], 1), /already exists/);
  assert.match(
    f.script("restore-git.sh", [], 1),
    /Both .git and .git-backup exist/,
  );
  assert.deepEqual(readFileSync(join(f.workspace, ".git/HEAD")), head);
  assert.equal(
    readFileSync(join(f.workspace, ".git-backup/keep"), "utf8"),
    "backup data",
  );
});

test("preserves both repositories when restoring would overwrite a new .git", (t) => {
  const f = workspaceFixture(t);
  const head = f.git(f.workspace, "rev-parse", "HEAD");
  f.script("remove-git.sh");
  f.git(f.workspace, "init", "--initial-branch=replacement");
  assert.match(
    f.script("restore-git.sh", [], 1),
    /Both .git and .git-backup exist/,
  );
  assert.equal(f.git(f.workspace, "branch", "--show-current"), "replacement");
  assert.equal(
    f.git(f.workspace, "--git-dir=.git-backup/git", "rev-parse", "HEAD"),
    head,
  );
});

test("refuses missing or invalid backups and unexpected arguments", (t) => {
  const f = workspaceFixture(t);
  f.script("remove-git.sh", ["unexpected"], 1);
  f.script("restore-git.sh", ["unexpected"], 1);
  renameSync(join(f.workspace, ".git"), join(f.directory, "saved-git"));
  f.script("remove-git.sh", [], 1);
  f.script("restore-git.sh", [], 1);
  mkdirSync(join(f.workspace, ".git-backup/git"), { recursive: true });
  f.script("restore-git.sh", [], 1);
  assert.equal(existsSync(join(f.workspace, ".git")), false);
});

test("refuses services using root submodule metadata before moving anything", (t) => {
  const f = workspaceFixture(t);
  const remote = join(f.directory, "remote");
  mkdirSync(remote);
  f.git(remote, "init", "--initial-branch=main");
  const head = f.commit(remote, "service initial");
  f.git(
    f.workspace,
    "submodule",
    "add",
    "--force",
    pathToFileURL(remote).href,
    "opencollective-api",
  );
  const pointer = readFileSync(join(f.workspace, "opencollective-api/.git"));
  assert.match(
    f.script("remove-git.sh", [], 1),
    /depends on workspace Git metadata/,
  );
  assert.equal(existsSync(join(f.workspace, ".git-backup")), false);
  assert.deepEqual(
    readFileSync(join(f.workspace, "opencollective-api/.git")),
    pointer,
  );
  assert.equal(
    f.git(join(f.workspace, "opencollective-api"), "rev-parse", "HEAD"),
    head,
  );
});

test("refuses active workspace worktrees and root .git files", (t) => {
  const f = workspaceFixture(t);
  const linked = join(f.directory, "workspace worktree");
  f.git(f.workspace, "worktree", "add", "-b", "linked", linked);
  assert.match(
    f.script("remove-git.sh", [], 1),
    /Workspace worktree .* depends on root Git/,
  );
  assert.equal(existsSync(join(f.workspace, ".git-backup")), false);
  for (const script of ["remove-git.sh", "restore-git.sh"])
    assert.match(
      f.script(script, [], 1, { OC_MONOREPO_ROOT: linked }),
      /Only ordinary workspace clones/,
    );
  assert.equal(f.git(linked, "branch", "--show-current"), "linked");
});

test("independent service worktrees remain usable while workspace Git is hidden", (t) => {
  const f = workspaceFixture(t);
  const local = service(f);
  const linked = join(f.workspace, ".worktrees/feature/opencollective-api");
  f.git(local, "worktree", "add", "-b", "feature", linked);
  f.script("remove-git.sh");
  assert.equal(f.git(linked, "branch", "--show-current"), "feature");
  f.commit(linked, "worktree commit");
  f.script("restore-git.sh");
  assert.equal(
    f.git(local, "rev-parse", "feature"),
    f.git(linked, "rev-parse", "HEAD"),
  );
});

test("refuses symlink root metadata without moving it", (t) => {
  const f = workspaceFixture(t);
  const saved = join(f.directory, "saved-git");
  renameSync(join(f.workspace, ".git"), saved);
  symlinkSync(saved, join(f.workspace, ".git"));
  f.script("remove-git.sh", [], 1);
  f.script("restore-git.sh", [], 1);
  assert.equal(existsSync(join(saved, "HEAD")), true);
});

test("refuses a linked service with unresolvable metadata", (t) => {
  const f = workspaceFixture(t);
  mkdirSync(join(f.workspace, "opencollective-api"));
  writeFileSync(
    join(f.workspace, "opencollective-api/.git"),
    "gitdir: ../.git/modules/missing\n",
  );
  f.script("remove-git.sh", [], 1);
  assert.equal(existsSync(join(f.workspace, ".git")), true);
  assert.equal(existsSync(join(f.workspace, ".git-backup")), false);
});

test("refuses a symlinked service Git directory that depends on root metadata", (t) => {
  const f = workspaceFixture(t);
  const local = service(f);
  const linkedMetadata = join(f.workspace, ".git/modules/service");
  mkdirSync(join(f.workspace, ".git/modules"));
  renameSync(join(local, ".git"), linkedMetadata);
  symlinkSync(linkedMetadata, join(local, ".git"));
  const head = f.git(local, "rev-parse", "HEAD");
  assert.match(
    f.script("remove-git.sh", [], 1),
    /depends on workspace Git metadata/,
  );
  assert.equal(f.git(local, "rev-parse", "HEAD"), head);
  assert.equal(existsSync(join(f.workspace, ".git-backup")), false);
});

test("refuses symlink backup destinations without modifying their contents", (t) => {
  const f = workspaceFixture(t);
  const destination = join(f.directory, "backup");
  mkdirSync(destination);
  writeFileSync(join(destination, "keep"), "external data");
  symlinkSync(destination, join(f.workspace, ".git-backup"));
  f.script("remove-git.sh", [], 1);
  f.script("restore-git.sh", [], 1);
  assert.equal(
    readFileSync(join(destination, "keep"), "utf8"),
    "external data",
  );
  assert.equal(existsSync(join(f.workspace, ".git")), true);
});

test("refuses workspace worktrees with line breaks in their paths", (t) => {
  const f = workspaceFixture(t);
  const linked = join(f.directory, "workspace\nworktree");
  f.git(f.workspace, "worktree", "add", "-b", "linked", linked);
  assert.match(f.script("remove-git.sh", [], 1), /depends on root Git/);
  assert.equal(existsSync(join(f.workspace, ".git-backup")), false);
});
