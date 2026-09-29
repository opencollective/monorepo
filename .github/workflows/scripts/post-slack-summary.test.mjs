import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const shared = readFileSync(new URL('../shared/post-slack-summary.md', import.meta.url), 'utf8');
// Execute the imported job's actual shell code; keep tests independent of a YAML package.
const script = shared
  .split('          run: |\n')[1]
  .split('\n---')[0]
  .split('\n')
  .map((line) => line.replace(/^ {12}/, ''))
  .join('\n');
const message = (text) => ({ type: 'post_slack_summary', message: text });

function deliver(t, files, { webhook = 'https://slack.invalid/test', curlExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'slack-summary-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const capture = join(dir, 'curl-args.json');
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.SLACK_CAPTURE, JSON.stringify(process.argv.slice(2)));
process.exit(${curlExit});
`,
    { mode: 0o755 },
  );
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, 'gh-aw/safe-jobs', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      SLACK_WEBHOOK_URL: webhook,
      SLACK_CAPTURE: capture,
    },
  });
  assert.ifError(result.error);
  const args = existsSync(capture) ? JSON.parse(readFileSync(capture, 'utf8')) : null;
  return { ...result, args, payload: args ? JSON.parse(args[args.indexOf('--data') + 1]) : null };
}

test('shared job re-downloads the fallback artifact before posting', () => {
  assert.match(
    shared,
    /name: Download agent output fallback[\s\S]*name: agent-output-fallback[\s\S]*name: Post to Slack/,
  );
  assert.match(shared, /continue-on-error: true/);
});

test('JSON agent output sends the last summary with quotes and newlines safely encoded', (t) => {
  const text = 'Updated "Contributions"\nPR: https://github.com/opencollective/documentation/pull/1';
  const result = deliver(t, {
    'agent_output.json': JSON.stringify({ items: [message('old'), { type: 'noop' }, message(text)] }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.payload, { text });
  assert.equal(result.args.at(-1), 'https://slack.invalid/test');
});

test('nested safeoutputs JSONL takes precedence over agent output and tolerates malformed lines', (t) => {
  const result = deliver(t, {
    'nested/safeoutputs.jsonl': [
      JSON.stringify(message('first')),
      'bad JSON',
      '',
      JSON.stringify(message('last')),
    ].join('\n'),
    'agent_output.json': JSON.stringify({ items: [message('fallback')] }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.payload, { text: 'last' });
});

test('JSONL agent_output fallback still works when the file is not a JSON envelope', (t) => {
  const result = deliver(t, {
    'agent_output.json': [JSON.stringify({ type: 'noop' }), JSON.stringify(message('No gaps'))].join('\n'),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.payload, { text: 'No gaps' });
});

test('empty or malformed safeoutputs falls back to the JSON envelope', (t) => {
  const result = deliver(t, {
    'safeoutputs.jsonl': 'bad JSON\n',
    'agent_output.json': JSON.stringify({ items: [message('Recovered')] }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.payload, { text: 'Recovered' });
});

test('missing webhook skips delivery even with a valid summary', (t) => {
  const result = deliver(t, { 'agent_output.json': JSON.stringify({ items: [message('Ready')] }) }, { webhook: '' });
  assert.equal(result.status, 0);
  assert.equal(result.args, null);
  assert.match(result.stdout, /SLACK_WEBHOOK_URL is not set/);
});

test('missing files or missing summary skip delivery', (t) => {
  for (const files of [
    {},
    { 'agent_output.json': 'not JSON' },
    { 'agent_output.json': JSON.stringify({ items: [{ type: 'noop' }] }) },
  ]) {
    const result = deliver(t, files);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.args, null);
    assert.match(result.stdout, /No Slack message/);
  }
});

test('webhook HTTP failure remains a job failure', (t) => {
  const result = deliver(t, { 'agent_output.json': JSON.stringify({ items: [message('Ready')] }) }, { curlExit: 22 });
  assert.equal(result.status, 22);
});
