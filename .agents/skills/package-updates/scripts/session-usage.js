#!/usr/bin/env node
// Token usage and a price estimate for one maintenance session, sub-agents and local Codex reviews included.
//
//   node session-usage.js --since <ISO start> [--claude <session-id|transcript.jsonl>] [--codex]
//
// --since     the session start written in the session file; only later entries count.
// --claude    Claude Code transcript (main + <session>/subagents/*.jsonl). Default: the most recently
//             written transcript under ~/.claude/projects, which is the running session.
// --codex     also sum Codex rollouts (~/.codex/sessions) started after --since: Codex as orchestrator,
//             and the local `codex review` runs of ai-review.sh.
// --json      machine-readable output.
// Prices come from prices.json next to this script; models missing there are listed as unpriced.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const since = opt('--since') ? Date.parse(opt('--since')) : 0;
if (opt('--since') && Number.isNaN(since)) {
  console.error(`invalid --since: ${opt('--since')}`);
  process.exit(2);
}
const prices = JSON.parse(fs.readFileSync(path.join(__dirname, 'prices.json'), 'utf8'));

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
};
const lines = file =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const totals = {}; // model -> counters
const add = (model, source, u) => {
  const t = (totals[model] ||= { requests: 0, sources: new Set(), input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0 });
  t.requests += u.requests ?? 1;
  t.sources.add(source);
  for (const k of ['input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output']) t[k] += u[k] || 0;
};

// Claude Code: one usage per API request, repeated on every content block of the reply: dedupe by message id.
function claude() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  let main = opt('--claude');
  if (main && !main.endsWith('.jsonl')) main = walk(root).find(f => path.basename(f) === `${main}.jsonl`);
  if (!main) {
    main = walk(root)
      .filter(f => !f.includes(`${path.sep}subagents${path.sep}`))
      .map(f => [f, fs.statSync(f).mtimeMs])
      .sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  if (!main || !fs.existsSync(main)) throw new Error('Claude transcript not found');
  const files = [main, ...walk(path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents'))];
  const seen = new Set();
  for (const file of files) {
    const source = file === main ? 'claude main' : 'claude sub-agent';
    for (const e of lines(file)) {
      const m = e.message;
      if (e.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') continue;
      if (since && Date.parse(e.timestamp) < since) continue;
      const id = m.id || e.requestId;
      if (seen.has(id)) continue;
      seen.add(id);
      const u = m.usage;
      const cc = u.cache_creation || {};
      const w1h = cc.ephemeral_1h_input_tokens || 0;
      const w5m = cc.ephemeral_5m_input_tokens ?? Math.max((u.cache_creation_input_tokens || 0) - w1h, 0);
      add(m.model, source, { input: u.input_tokens, cache_write_5m: w5m, cache_write_1h: w1h, cache_read: u.cache_read_input_tokens, output: u.output_tokens });
    }
  }
  return main;
}

// Codex: each rollout carries a running total; its last token_count event is the rollout's usage.
// input_tokens includes the cached part.
function codex() {
  let n = 0;
  for (const file of walk(path.join(os.homedir(), '.codex', 'sessions'))) {
    if (since && fs.statSync(file).mtimeMs < since) continue;
    let model = 'codex (unknown model)';
    let last = null;
    let start = null;
    for (const e of lines(file)) {
      start ??= Date.parse(e.timestamp);
      if (e.type === 'turn_context' && e.payload?.model) model = e.payload.model;
      if (e.payload?.type === 'token_count' && e.payload.info?.total_token_usage) last = e.payload.info.total_token_usage;
    }
    if (!last || (since && start < since)) continue;
    n++;
    add(model, 'codex', {
      input: last.input_tokens - (last.cached_input_tokens || 0),
      cache_write_5m: last.cache_write_input_tokens || 0,
      cache_read: last.cached_input_tokens || 0,
      output: last.output_tokens,
    });
  }
  return n;
}

const transcript = claude();
const codexRuns = args.includes('--codex') ? codex() : 0;

const rows = Object.entries(totals).map(([model, t]) => {
  const p = prices[model];
  const cost = p ? ['input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output'].reduce((s, k) => s + (t[k] * (p[k] ?? 0)) / 1e6, 0) : null;
  return { model, ...t, sources: [...t.sources].join(', '), cost };
});
rows.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));
const total = rows.reduce((s, r) => s + (r.cost || 0), 0);
const unpriced = rows.filter(r => r.cost === null).map(r => r.model);

if (args.includes('--json')) {
  console.log(JSON.stringify({ transcript, codexRuns, rows, total, unpriced }, null, 2));
  process.exit(0);
}
const k = n => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
console.log(`transcript: ${transcript}${codexRuns ? `; codex rollouts: ${codexRuns}` : ''}`);
console.log('| Model | Used by | Requests | Input | Cache write | Cache read | Output | Est. cost |');
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of rows) {
  console.log(
    `| ${r.model} | ${r.sources} | ${r.requests} | ${k(r.input)} | ${k(r.cache_write_5m + r.cache_write_1h)} | ${k(r.cache_read)} | ${k(r.output)} | ${r.cost === null ? 'unpriced' : `$${r.cost.toFixed(2)}`} |`,
  );
}
console.log(`| **Total** | | | | | | | **$${total.toFixed(2)}**${unpriced.length ? ' + unpriced' : ''} |`);
console.log('Estimate at API list prices (scripts/prices.json); a subscription plan bills differently.');
if (unpriced.length) console.log(`Unpriced: ${unpriced.join(', ')} (add them to prices.json)`);
