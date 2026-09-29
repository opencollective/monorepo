import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildContext, githubApi } from './docs-update-context.mjs';

const repository = 'opencollective/monorepo';
const base = `repos/${repository}`;
const run = (id, created_at, extra = {}) => ({
  id,
  created_at,
  workflow_id: 12,
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  html_url: `https://github.com/${repository}/actions/runs/${id}`,
  ...extra,
});
const current = run(100, '2026-09-27T08:00:00Z');
const commit = (sha, extra = {}) => ({
  sha,
  html_url: `https://github.com/opencollective/opencollective-frontend/commit/${sha}`,
  author: { login: 'contributor' },
  commit: {
    committer: { date: '2026-09-25T09:00:00Z' },
    author: { name: 'Contributor' },
    message: 'Feature\n\nDetails\nMore details',
  },
  ...extra,
});

function fixture({
  runs = [[]],
  jobs = {},
  frontend = [[]],
  apiCommits = [[]],
  prs = [[]],
  fail,
  currentRun = current,
} = {}) {
  const calls = [];
  const api = (endpoint, paginate = false) => {
    calls.push({ endpoint, paginate });
    if (fail?.(endpoint)) throw new Error('GitHub request failed');
    if (endpoint === `${base}/actions/runs/100`) return currentRun;
    if (endpoint === base) return { default_branch: 'main' };
    assert.equal(paginate, true, endpoint);
    const url = new URL(endpoint, 'https://api.github.com/');
    assert.equal(url.searchParams.get('per_page'), '100');
    if (url.pathname.endsWith('/workflows/12/runs')) {
      return runs.map((workflow_runs) => ({ workflow_runs }));
    }
    const jobRun = url.pathname.match(/\/runs\/(\d+)\/jobs$/)?.[1];
    if (jobRun) {
      assert.equal(url.searchParams.get('filter'), 'latest');
      return (jobs[jobRun] ?? [[{ name: 'agent', conclusion: 'success' }]]).map((jobs) => ({ jobs }));
    }
    if (url.pathname.endsWith('/commits')) {
      assert.equal(url.searchParams.get('sha'), 'main');
      assert.equal(url.searchParams.get('until'), currentRun.created_at);
      return url.pathname.includes('frontend') ? frontend : apiCommits;
    }
    if (url.pathname.endsWith('/documentation/pulls')) {
      assert.equal(url.searchParams.get('state'), 'open');
      return prs;
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };
  return { calls, context: () => buildContext({ repository, runId: '100', api }) };
}

test('first run emits an empty seven-day context without a checkpoint', () => {
  assert.deepEqual(fixture().context(), {
    since: '2026-09-20T08:00:00.000Z',
    until: current.created_at,
    previousSuccessfulRunUrl: null,
    frontendCommits: [],
    apiCommits: [],
    openDocsPrs: [],
  });
});

test('a recent success keeps a full week and uses creation time rather than rerun start time', () => {
  const previous = run(99, '2026-09-26T08:00:00Z', { run_started_at: '2026-09-27T07:00:00Z' });
  const context = fixture({ runs: [[previous]] }).context();
  assert.equal(context.since, '2026-09-20T08:00:00.000Z');
  assert.equal(context.previousSuccessfulRunUrl, previous.html_url);
});

test('catch-up crosses failed and skipped weeks, paginates jobs, and excludes current, future, and other-branch runs', () => {
  const previous = run(90, '2026-09-01T08:00:00Z');
  const { context, calls } = fixture({
    runs: [
      [
        current,
        run(101, '2026-09-28T08:00:00Z'),
        run(99, '2026-09-26T08:00:00Z', { head_branch: 'feature' }),
        run(98, '2026-09-25T08:00:00Z', { conclusion: 'failure' }),
        run(97, '2026-09-24T08:00:00Z'),
      ],
      [run(96, '2026-09-23T08:00:00Z', { conclusion: 'cancelled' }), previous, run(89, '2026-08-25T08:00:00Z')],
    ],
    jobs: {
      97: [
        [
          { name: 'activation', conclusion: 'success' },
          { name: 'agent', conclusion: 'skipped' },
        ],
      ],
      90: [[{ name: 'activation', conclusion: 'success' }], [{ name: 'agent', conclusion: 'success' }]],
    },
  });
  const result = context();
  assert.equal(result.since, '2026-09-01T08:00:00.000Z');
  assert.equal(result.previousSuccessfulRunUrl, previous.html_url);
  assert.deepEqual(
    calls.filter((c) => c.endpoint.includes('/jobs?')).map((c) => c.endpoint.match(/runs\/(\d+)/)[1]),
    ['97', '90'],
  );
  for (const { endpoint } of calls.filter((c) => c.endpoint.includes('/commits?'))) {
    assert.equal(new URL(endpoint, 'https://api.github.com/').searchParams.get('since'), result.since);
  }
});

test('a rerun never selects its own earlier successful attempt as a checkpoint', () => {
  const context = fixture({
    runs: [[{ ...current, run_attempt: 1 }]],
    currentRun: { ...current, run_attempt: 2, run_started_at: '2026-09-29T08:00:00Z' },
  }).context();
  assert.equal(context.until, current.created_at);
  assert.equal(context.previousSuccessfulRunUrl, null);
});

test('all commit and PR pages are retained with evidence fields and author fallbacks', () => {
  const pr = (number) => ({
    number,
    title: `Docs ${number}`,
    html_url: `https://github.com/opencollective/documentation/pull/${number}`,
    body: 'Workflow covered',
    updated_at: '2026-09-26T08:00:00Z',
  });
  const result = fixture({
    frontend: [[commit('a')], [commit('b', { author: null })]],
    apiCommits: [[commit('c')]],
    prs: [[pr(1)], [pr(2)]],
  }).context();
  assert.deepEqual(result.frontendCommits[0], {
    sha: 'a',
    url: commit('a').html_url,
    date: '2026-09-25T09:00:00Z',
    author: 'contributor',
    subject: 'Feature',
    body: 'Details\nMore details',
  });
  assert.equal(result.frontendCommits[1].author, 'Contributor');
  assert.equal(result.apiCommits[0].sha, 'c');
  assert.deepEqual(
    result.openDocsPrs.map((p) => p.number),
    [1, 2],
  );
  assert.equal(result.openDocsPrs[1].url, pr(2).html_url);
  assert.equal(result.openDocsPrs[1].updatedAt, pr(2).updated_at);
});

test('history, job, commit, and PR retrieval failures abort instead of falling back', () => {
  for (const match of [
    '/workflows/',
    '/jobs?',
    '/opencollective-frontend/commits',
    '/opencollective-api/commits',
    '/documentation/pulls',
  ]) {
    assert.throws(
      fixture({ runs: [[run(90, '2026-09-01T08:00:00Z')]], fail: (endpoint) => endpoint.includes(match) }).context,
      /GitHub request failed/,
    );
  }
});

test('missing runtime identifiers and malformed current-run metadata fail clearly', () => {
  assert.throws(() => buildContext({}), /required/);
  assert.throws(fixture({ currentRun: { ...current, created_at: 'invalid' } }).context, /timestamp/);
});

test('GitHub CLI adapter decodes paginated JSON and propagates command and JSON failures', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-context-test-'));
  const oldPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.PATH = `${dir}:${oldPath}`;
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[1] === 'failure') process.exit(1);
if (args[1] === 'invalid') { console.log('invalid JSON'); process.exit(0); }
if (args.includes('--paginate')) {
  if (args.slice(-2).join(' ') !== '--jq tojson') process.exit(2);
  console.log(JSON.stringify([{ body: 'first\\npage' }]));
  console.log(JSON.stringify([{ body: 'second page' }]));
} else console.log(JSON.stringify({ id: 1 }));
`,
    { mode: 0o755 },
  );
  assert.deepEqual(githubApi('single'), { id: 1 });
  assert.deepEqual(githubApi('pages', true), [[{ body: 'first\npage' }], [{ body: 'second page' }]]);
  assert.throws(() => githubApi('failure', true));
  assert.throws(() => githubApi('invalid', true), SyntaxError);
});
