import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'oc-init-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  mkdirSync(join(workspace, 'scripts'), { recursive: true });
  copyFileSync(new URL('./init.sh', import.meta.url), join(workspace, 'scripts/init.sh'));

  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'protocol.file.allow',
    GIT_CONFIG_VALUE_0: 'always',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_TERMINAL_PROMPT: '0',
  };
  const execute = (cwd, command, args) => spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  function git(cwd, ...args) {
    const result = execute(cwd, 'git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function commit(cwd, content) {
    writeFileSync(join(cwd, 'version.txt'), content);
    git(cwd, 'add', 'version.txt');
    git(cwd, 'commit', '-m', content);
    return git(cwd, 'rev-parse', 'HEAD');
  }

  git(workspace, 'init', '--initial-branch=main');
  const projects = {};
  let manifest = '';
  for (const project of ['api', 'frontend']) {
    const remote = join(directory, `${project}-remote`);
    const path = `opencollective-${project}`;
    const local = join(workspace, path);
    mkdirSync(remote);
    git(remote, 'init', '--initial-branch=main');
    const initial = commit(remote, 'initial');
    const url = pathToFileURL(remote).href;
    // Names intentionally differ from paths to exercise manifest parsing.
    manifest += `[submodule "${project}"]\n\tpath = ${path}\n\turl = ${url}\n\tbranch = main\n\tignore = all\n`;
    git(workspace, 'update-index', '--add', '--cacheinfo', '160000', initial, path);
    projects[project] = { remote, local, path, url, initial };
  }
  writeFileSync(join(workspace, '.gitmodules'), manifest);
  git(workspace, 'add', '.gitmodules', 'scripts');
  git(workspace, 'commit', '-m', 'Workspace');

  function init(args = [], status = 0) {
    // Invoke from outside the workspace to verify root resolution.
    const result = execute(directory, 'bash', [join(workspace, 'scripts/init.sh'), ...args]);
    assert.equal(result.status, status, result.stdout + result.stderr);
    return result.stdout + result.stderr;
  }
  return { workspace, projects, git, commit, init };
}

test('initializes every submodule on the latest main, even when upstream HEAD points elsewhere', (t) => {
  const { workspace, projects, git, commit, init } = fixture(t);
  for (const project of Object.values(projects)) {
    project.latest = commit(project.remote, 'latest main');
    git(project.remote, 'switch', '--create', 'legacy');
    commit(project.remote, 'legacy');
  }
  init();
  for (const project of Object.values(projects)) {
    assert.equal(git(project.local, 'branch', '--show-current'), 'main');
    assert.equal(git(project.local, 'rev-parse', 'HEAD'), project.latest);
    assert.equal(git(project.local, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
    assert.equal(readFileSync(join(project.local, '.git'), 'utf8').startsWith('gitdir:'), true);
    assert.equal(git(workspace, 'rev-parse', `HEAD:${project.path}`), project.initial);
  }
  assert.equal(git(workspace, 'status', '--porcelain'), '');
});

test('shallow initialization follows main when upstream HEAD points elsewhere', (t) => {
  const { projects, git, commit, init } = fixture(t);
  const latest = commit(projects.api.remote, 'latest main');
  git(projects.api.remote, 'switch', '--create', 'legacy');
  commit(projects.api.remote, 'legacy');
  init(['--projects', 'api', '--shallow']);
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), latest);
  assert.equal(git(projects.api.local, 'rev-parse', '--is-shallow-repository'), 'true');
});

test('keeps project filtering, aliases, deduplication, and shallow clones', (t) => {
  const { workspace, projects, git, commit, init } = fixture(t);
  const latest = commit(projects.api.remote, 'new main');
  init(['--projects', ' API,opencollective-api,api ', '--shallow']);
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), latest);
  assert.equal(git(projects.api.local, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(existsSync(join(projects.frontend.local, '.git')), false);
  assert.equal(git(workspace, 'status', '--porcelain'), '');
  const next = commit(projects.api.remote, 'next main');
  init(['--projects', 'api', '--shallow']);
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), next);
});

test('reruns fetch new commits and return clean feature branches to main', (t) => {
  const { workspace, projects, git, commit, init } = fixture(t);
  init();
  git(projects.api.local, 'switch', '--create', 'feature');
  const feature = commit(projects.api.local, 'local feature');
  const latest = commit(projects.api.remote, 'second upstream commit');
  init(['--projects', 'api']);
  assert.equal(git(projects.api.local, 'branch', '--show-current'), 'main');
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), latest);
  assert.equal(git(projects.api.local, 'rev-parse', 'feature'), feature);
  assert.equal(git(projects.frontend.local, 'rev-parse', 'HEAD'), projects.frontend.initial);
  assert.equal(git(workspace, 'status', '--porcelain'), '');
  init(['--projects', 'api']);
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), latest);
});

test('updates older standalone clones, including clones that only fetched a feature branch', (t) => {
  const { workspace, projects, git, commit, init } = fixture(t);
  const { remote, local, url } = projects.api;
  git(remote, 'switch', '--create', 'feature');
  const feature = commit(remote, 'remote feature');
  git(workspace, 'clone', '--single-branch', '--branch', 'feature', url, local);
  git(remote, 'switch', 'main');
  const latest = commit(remote, 'latest main');
  init(['--projects', 'api']);
  assert.equal(git(local, 'branch', '--show-current'), 'main');
  assert.equal(git(local, 'rev-parse', 'HEAD'), latest);
  assert.equal(git(local, 'rev-parse', 'feature'), feature);
  assert.equal(git(workspace, 'config', '--get', 'submodule.api.ignore'), 'all');
  assert.equal(git(workspace, 'status', '--porcelain'), '');
});

test('fetches but preserves uncommitted work, reports failure, and updates other projects', (t) => {
  const { workspace, projects, git, commit, init } = fixture(t);
  init();
  const { local, initial, remote } = projects.api;
  git(local, 'switch', '--create', 'feature');
  writeFileSync(join(local, 'version.txt'), 'uncommitted work');
  writeFileSync(join(local, 'untracked.txt'), 'untracked work');
  const latest = commit(remote, 'upstream update');
  const frontendLatest = commit(projects.frontend.remote, 'frontend update');
  const output = init([], 1);
  assert.match(output, /has uncommitted changes/);
  assert.equal(git(local, 'branch', '--show-current'), 'feature');
  assert.equal(git(local, 'rev-parse', 'HEAD'), initial);
  assert.equal(git(local, 'rev-parse', 'origin/main'), latest);
  assert.equal(readFileSync(join(local, 'version.txt'), 'utf8'), 'uncommitted work');
  assert.equal(readFileSync(join(local, 'untracked.txt'), 'utf8'), 'untracked work');
  assert.equal(git(projects.frontend.local, 'rev-parse', 'HEAD'), frontendLatest);
  assert.equal(git(workspace, 'status', '--porcelain'), '');
});

for (const divergent of [false, true]) {
  test(`preserves ${divergent ? 'divergent' : 'ahead'} local main commits`, (t) => {
    const { projects, git, commit, init } = fixture(t);
    init(['--projects', 'api']);
    const local = commit(projects.api.local, 'unpublished commit');
    if (divergent) commit(projects.api.remote, 'divergent upstream');
    const output = init(['--projects', 'api'], 1);
    assert.match(output, /local commits on main/);
    assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), local);
    assert.equal(readFileSync(join(projects.api.local, 'version.txt'), 'utf8'), 'unpublished commit');
  });
}

test('reattaches detached checkouts to main', (t) => {
  const { projects, git, commit, init } = fixture(t);
  init(['--projects', 'api']);
  git(projects.api.local, 'switch', '--detach');
  const latest = commit(projects.api.remote, 'latest main');
  init(['--projects', 'api']);
  assert.equal(git(projects.api.local, 'branch', '--show-current'), 'main');
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), latest);
});

test('initializes empty placeholder directories but preserves non-repository contents', (t) => {
  const { projects, git, init } = fixture(t);
  mkdirSync(projects.api.local);
  mkdirSync(projects.frontend.local);
  writeFileSync(join(projects.frontend.local, 'keep.txt'), 'local data');
  init([], 1);
  assert.equal(git(projects.api.local, 'branch', '--show-current'), 'main');
  assert.equal(readFileSync(join(projects.frontend.local, 'keep.txt'), 'utf8'), 'local data');
  assert.equal(existsSync(join(projects.frontend.local, '.git')), false);
});

test('rejects invalid selections before cloning', (t) => {
  const { projects, init } = fixture(t);
  assert.match(init(['--projects', 'api,unknown'], 1), /Unknown project/);
  assert.match(init(['--projects', ' , '], 1), /No projects selected/);
  assert.match(init(['--projects'], 1), /requires a comma-separated list/);
  assert.equal(existsSync(join(projects.api.local, '.git')), false);
});

test('reports fetch failures and continues with other repositories', (t) => {
  const { projects, git, commit, init } = fixture(t);
  init();
  const latest = commit(projects.frontend.remote, 'new frontend');
  git(projects.api.local, 'remote', 'set-url', 'origin', '/nonexistent/oc-init-remote');
  assert.match(init([], 1), /Failed to initialize\/update opencollective-api/);
  assert.equal(git(projects.frontend.local, 'rev-parse', 'HEAD'), latest);
});

test('reports a missing upstream main instead of following another branch', (t) => {
  const { projects, git, commit, init } = fixture(t);
  init();
  git(projects.api.remote, 'branch', '--move', 'main', 'legacy');
  const latest = commit(projects.frontend.remote, 'new frontend');
  init([], 1);
  assert.equal(git(projects.api.local, 'rev-parse', 'HEAD'), projects.api.initial);
  assert.equal(git(projects.frontend.local, 'rev-parse', 'HEAD'), latest);
});
