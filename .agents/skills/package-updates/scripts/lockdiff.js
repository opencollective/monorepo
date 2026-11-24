#!/usr/bin/env node
// Purpose: list the packages that moved between two package-lock.json files (base vs PR head).
// Usage:   node lockdiff.js <base-package-lock.json> <head-package-lock.json>
// Output:  one line per moved package: `D|T name: old -> new [MAJOR]` (D = direct dependency of the
//          root package.json, T = transitive). Several installed versions are comma-joined. A MAJOR flag
//          can be a nested-path dedupe reshuffle rather than a new version: check before reporting it.
//          Fetch the lockfiles with `git show <sha>:package-lock.json` (or `gh api .../contents`).
const fs = require('fs');
const [, , a, b] = process.argv;
if (!a || !b) {
  console.error('usage: lockdiff.js <base-package-lock.json> <head-package-lock.json>');
  process.exit(2);
}
const A = JSON.parse(fs.readFileSync(a, 'utf8')).packages;
const headLock = JSON.parse(fs.readFileSync(b, 'utf8'));
const B = headLock.packages;
const versions = P => {
  const out = {};
  for (const [k, v] of Object.entries(P)) {
    if (!k) continue;
    const name = k.replace(/^.*node_modules\//, '');
    (out[name] ??= new Set()).add(v.version);
  }
  return out;
};
const x = versions(A);
const y = versions(B);
const root = B[''] || {};
const direct = new Set([...Object.keys(root.dependencies || {}), ...Object.keys(root.devDependencies || {})]);
for (const name of new Set([...Object.keys(x), ...Object.keys(y)])) {
  const p = [...(x[name] || [])].sort().join(',');
  const q = [...(y[name] || [])].sort().join(',');
  if (p === q) continue;
  const major = p.split(',')[0].split('.')[0] !== q.split(',')[0].split('.')[0] ? ' MAJOR' : '';
  console.log(`${direct.has(name) ? 'D' : 'T'} ${name}: ${p || '-'} -> ${q || '-'}${major}`);
}
