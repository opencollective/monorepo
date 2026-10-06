import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { workspaceFixture } from "./git-fixtures.mjs";

function fixture(t) {
  const f = workspaceFixture(t);
  const projects = {};
  let manifest = "PROJECT_REPOSITORIES=(\n";
  for (const name of ["api", "frontend", "documentation"]) {
    const remote = join(f.directory, `${name}-remote`);
    const path = `opencollective-${name}`;
    const local = join(f.workspace, path);
    mkdirSync(remote);
    f.git(remote, "init", "--initial-branch=main");
    const initial = f.commit(remote, "initial");
    const url = pathToFileURL(remote).href;
    manifest += `  "${path}" "${url}"\n`;
    projects[name] = { remote, local, path, url, initial };
  }
  writeFileSync(join(f.workspace, "scripts/projects.sh"), manifest + ")\n");
  f.git(f.workspace, "add", "scripts/projects.sh");
  f.git(f.workspace, "commit", "-m", "Fixture manifest");
  const init = (args = [], status = 0, overrides = {}) =>
    f.script("init.sh", args, status, overrides);
  return { ...f, projects, init };
}

test("clones all projects as independent repositories on main even when remote HEAD differs", (t) => {
  const { workspace, projects, git, commit, init } = fixture(t);
  for (const project of Object.values(projects)) {
    project.latest = commit(project.remote, "latest main");
    git(project.remote, "switch", "--create", "legacy");
    commit(project.remote, "legacy");
  }
  init();
  for (const project of Object.values(projects)) {
    assert.equal(statSync(join(project.local, ".git")).isDirectory(), true);
    assert.equal(git(project.local, "branch", "--show-current"), "main");
    assert.equal(git(project.local, "rev-parse", "HEAD"), project.latest);
    assert.equal(
      git(project.local, "rev-parse", "--abbrev-ref", "@{upstream}"),
      "origin/main",
    );
  }
  assert.equal(git(workspace, "status", "--porcelain"), "");
  assert.equal(existsSync(join(workspace, ".git")), true);
  assert.equal(existsSync(join(workspace, ".gitmodules")), false);
});

test("keeps aliases, case normalization, filtering, deduplication and shallow cloning", (t) => {
  const { projects, git, commit, init } = fixture(t);
  const latest = commit(projects.api.remote, "new main");
  git(projects.api.remote, "switch", "--create", "legacy");
  commit(projects.api.remote, "legacy");
  const output = init([
    "--projects",
    " API,opencollective-api,api ",
    "--shallow",
  ]);
  assert.equal(
    (output.match(/Cloning opencollective-api on main/g) || []).length,
    1,
  );
  assert.equal(git(projects.api.local, "rev-parse", "HEAD"), latest);
  assert.equal(
    git(projects.api.local, "rev-parse", "--is-shallow-repository"),
    "true",
  );
  assert.equal(existsSync(projects.frontend.local), false);
  assert.equal(existsSync(projects.documentation.local), false);
  const next = commit(projects.api.remote, "next main");
  init(["--projects", "api", "--shallow"]);
  assert.notEqual(next, latest);
  assert.equal(git(projects.api.local, "rev-parse", "HEAD"), latest);
  assert.equal(git(projects.api.local, "rev-parse", "origin/main"), latest);
});

test("leaves existing branches, local commits, stashes, dirty files and remotes untouched", (t) => {
  const { projects, git, commit, init } = fixture(t);
  init();
  const { local, remote, initial } = projects.api;
  git(local, "switch", "--create", "feature");
  const feature = commit(local, "local feature");
  writeFileSync(join(local, "version.txt"), "stash work");
  git(local, "stash", "push", "-m", "saved work");
  const stash = git(local, "rev-parse", "refs/stash");
  writeFileSync(join(local, "version.txt"), "uncommitted work");
  writeFileSync(join(local, "untracked.txt"), "untracked work");
  commit(remote, "upstream update");
  // A failed fetch would be visible if setup attempted one.
  git(local, "remote", "set-url", "origin", "/nonexistent/oc-init-remote");
  const before = git(local, "status", "--porcelain");
  init();
  assert.equal(git(local, "branch", "--show-current"), "feature");
  assert.equal(git(local, "rev-parse", "HEAD"), feature);
  assert.equal(git(local, "rev-parse", "origin/main"), initial);
  assert.equal(git(local, "rev-parse", "refs/stash"), stash);
  assert.equal(git(local, "status", "--porcelain"), before);
  assert.equal(
    readFileSync(join(local, "version.txt"), "utf8"),
    "uncommitted work",
  );
  assert.equal(
    git(local, "remote", "get-url", "origin"),
    "/nonexistent/oc-init-remote",
  );
});

test("leaves empty folders, non-repository contents and linked metadata untouched", (t) => {
  const { projects, init } = fixture(t);
  for (const project of Object.values(projects)) mkdirSync(project.local);
  writeFileSync(join(projects.frontend.local, "keep.txt"), "local data");
  const pointer = "gitdir: ../.git/modules/old-submodule\n";
  writeFileSync(join(projects.documentation.local, ".git"), pointer);
  init();
  assert.equal(existsSync(join(projects.api.local, ".git")), false);
  assert.equal(
    readFileSync(join(projects.frontend.local, "keep.txt"), "utf8"),
    "local data",
  );
  assert.equal(
    readFileSync(join(projects.documentation.local, ".git"), "utf8"),
    pointer,
  );
});

test("rejects invalid selections and arguments before cloning", (t) => {
  const { projects, init } = fixture(t);
  assert.match(init(["--projects", "api,unknown"], 1), /Unknown project/);
  assert.match(init(["--projects", " , "], 1), /No projects selected/);
  assert.match(init(["--projects"], 1), /requires a comma-separated list/);
  assert.match(init(["--unknown"], 1), /Unknown option/);
  assert.match(init(["--help"]), /Existing directories are left untouched/);
  for (const project of Object.values(projects))
    assert.equal(existsSync(project.local), false);
});

test("reports clone failures and continues with other projects", (t) => {
  const { workspace, projects, init } = fixture(t);
  const manifest = readFileSync(join(workspace, "scripts/projects.sh"), "utf8");
  writeFileSync(
    join(workspace, "scripts/projects.sh"),
    manifest.replace(projects.api.url, "file:///nonexistent/oc-init-remote"),
  );
  assert.match(init([], 1), /Failed to clone: opencollective-api/);
  assert.equal(existsSync(join(projects.api.local, ".git")), false);
  assert.equal(
    statSync(join(projects.frontend.local, ".git")).isDirectory(),
    true,
  );
});

test("reports a missing main rather than cloning another branch", (t) => {
  const { projects, git, init } = fixture(t);
  git(projects.api.remote, "branch", "--move", "main", "legacy");
  init([], 1);
  assert.equal(existsSync(join(projects.api.local, ".git")), false);
  assert.equal(existsSync(join(projects.frontend.local, ".git")), true);
});

test("preserves file conflicts and still clones other projects", (t) => {
  const { projects, init } = fixture(t);
  writeFileSync(projects.api.local, "local file");
  init([], 1);
  assert.equal(readFileSync(projects.api.local, "utf8"), "local file");
  assert.equal(existsSync(join(projects.frontend.local, ".git")), true);
});

test("clones projects while workspace Git is hidden and leaves it hidden", (t) => {
  const { workspace, projects, script, init, git } = fixture(t);
  script("remove-git.sh");
  init(["--projects", "api"]);
  assert.equal(existsSync(join(workspace, ".git")), false);
  assert.equal(existsSync(join(workspace, ".git-backup/git")), true);
  assert.equal(git(projects.api.local, "branch", "--show-current"), "main");
  script("restore-git.sh");
  assert.equal(git(workspace, "status", "--porcelain"), "");
});

test("honors an explicit root without requiring workspace Git", (t) => {
  const { directory, projects, init, git } = fixture(t);
  const target = join(directory, "another workspace");
  mkdirSync(target);
  init(["--projects", "api"], 0, { OC_MONOREPO_ROOT: target });
  assert.equal(existsSync(projects.api.local), false);
  assert.equal(
    git(join(target, projects.api.path), "branch", "--show-current"),
    "main",
  );
});
