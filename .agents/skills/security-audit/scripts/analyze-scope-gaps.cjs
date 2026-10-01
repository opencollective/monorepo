#!/usr/bin/env node
'use strict';

/**
 * Post-process enumerate-scope-coverage JSON for hunter review.
 * Usage: node analyze-scope-gaps.cjs [--in /tmp/opencode/v2-scopes.json] [--json]
 */

const fs = require('fs');
const path = require('path');
const { enumerateScopeCoverage } = require('./enumerate-scope-coverage.cjs');
const { scanNonGraphqlScopeGaps } = require('./scan-non-graphql-scope-gaps.cjs');
const { resolveApiRoot } = require('./lib-scan.cjs');

const USAGE = `analyze-scope-gaps.cjs - Summarize scope and PII gaps from coverage JSON

Usage:
  node analyze-scope-gaps.cjs [--root <apiRoot>] [--in <file>] [--json]

Options:
  --root   Regenerate coverage from API tree instead of --in
  --in     Read existing coverage JSON
  --json   Print machine-readable summary only
`;

function parseArgs(argv) {
  const opts = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--in') {
      opts.in = argv[++i];
    } else if (arg === '--root') {
      opts.root = argv[++i];
    } else if (arg === '--help') {
      opts.help = true;
    }
  }
  return opts;
}

function loadFields(opts) {
  if (opts.root) {
    return enumerateScopeCoverage({ root: opts.root }).fields;
  }
  if (opts.in) {
    return JSON.parse(fs.readFileSync(opts.in, 'utf8')).fields;
  }
  throw new Error('Provide --in <file> or --root <apiRoot>');
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  const fields = loadFields(opts);

  const sensitiveRaw = fields.filter(
    (f) =>
      f.sensitiveFlag &&
      (f.missingExpectedScopes?.length || f.sensitiveFlag === 'incomplete') &&
      (f.expectedScopes?.length || f.missingExpectedScopes?.length),
  );
  const seenSensitive = new Set();
  const sensitive = [];
  for (const f of sensitiveRaw) {
    const dedupeKey = `${f.file}:${f.line}:${f.name}:${(f.missingExpectedScopes || []).join(',')}`;
    if (seenSensitive.has(dedupeKey)) {
      continue;
    }
    seenSensitive.add(dedupeKey);
    if (f.name === 'emails' && f.parentType !== 'Account') {
      continue;
    }
    sensitive.push(f);
  }
  const declaredGap = fields.filter((f) => {
    const decl = f.declaredScope || [];
    if (!decl.length) {
      return false;
    }
    const enf = new Set(f.enforcedScopes || []);
    return decl.some((s) => !enf.has(s));
  });

  const apiRoot = opts.root ? resolveApiRoot({ root: opts.root }) : resolveApiRoot({});
  const nonGraphqlGaps = scanNonGraphqlScopeGaps(apiRoot);

  const summary = {
    totalFields: fields.length,
    nonGraphqlGaps,
    sensitiveGaps: sensitive.map((f) => ({
      fingerprint: `oc:api:scope:graphql.v2.${f.kind}.${f.parentType}.${f.name}`,
      flag: f.sensitiveFlag,
      parentType: f.parentType,
      name: f.name,
      file: f.file,
      line: f.line,
      expectedScopes: f.expectedScopes,
      missingExpectedScopes: f.missingExpectedScopes,
      enforcedScopes: f.enforcedScopes,
      notes: f.notes,
    })),
    declaredScopeGaps: declaredGap.map((f) => ({
      fingerprint: `oc:api:scope:graphql.v2.${f.kind}.${f.parentType}.${f.name}`,
      parentType: f.parentType,
      name: f.name,
      declaredScope: f.declaredScope,
      enforcedScopes: f.enforcedScopes,
      file: f.file,
      line: f.line,
    })),
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Total fields: ${summary.totalFields}\n`);
  process.stdout.write(`Non-GraphQL static gaps: ${summary.nonGraphqlGaps.length}\n`);
  for (const row of summary.nonGraphqlGaps) {
    process.stdout.write(`  [${row.flag}] ${row.fingerprint} @ ${row.file}:${row.line || '?'}\n`);
  }
  process.stdout.write(`Sensitive / PII / resource scope gaps: ${summary.sensitiveGaps.length}\n`);
  for (const row of summary.sensitiveGaps) {
    process.stdout.write(
      `  [${row.flag}] ${row.parentType}.${row.name} missing=${JSON.stringify(row.missingExpectedScopes)} @ ${row.file}:${row.line}\n`,
    );
  }
  process.stdout.write(`\nDeclared vs enforced gaps: ${summary.declaredScopeGaps.length}\n`);
  for (const row of summary.declaredScopeGaps.slice(0, 25)) {
    process.stdout.write(
      `  ${row.parentType}.${row.name} declared=${JSON.stringify(row.declaredScope)} enforced=${JSON.stringify(row.enforcedScopes)}\n`,
    );
  }
  if (summary.declaredScopeGaps.length > 25) {
    process.stdout.write(`  ... and ${summary.declaredScopeGaps.length - 25} more\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
