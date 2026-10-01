#!/usr/bin/env node
'use strict';

/**
 * Enumerate OAuth scope helpers on every GraphQL V2 surface: mutations, top-level
 * queries (including collection/), and nested object/interface fields.
 *
 * Records declared Scope: "..." vs helpers actually called. The hunter judges
 * missing / wrong / incomplete / description-drift. ESLint only checks that
 * mutations call SOME helper; this enumerator goes beyond that (queries + nested
 * fields, which helper, which scope literals).
 *
 * Usage:
 *   node enumerate-scope-coverage.cjs [--root <apiRoot>] [--out <file>]
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib-scan.cjs');
const { collectMutationConfigs } = require('./enumerate-v2-mutations.cjs');

const USAGE = `enumerate-scope-coverage.cjs - GraphQL V2 OAuth scope coverage (mutations, queries, object fields)

Usage:
  node enumerate-scope-coverage.cjs [--root <apiRoot>] [--out <file>]

Options:
  --root   API repository root (default: OC_API_ROOT, ./opencollective-api, /workspace/opencollective-api)
  --out    Write JSON to this path instead of stdout
  --help   Show this help

Output JSON:
  { generatedAt, apiRoot, fields: [{ kind, parentType, name, file, line, description, declaredScope, helpersCalled, enforcedScopes, eslintOptOut, delegatesTo }] }
`;

function loadIndexBindings(indexSrc, indexPath, varName) {
  const imports = lib.parseFileImportsToLocal(indexSrc, indexPath);
  const entries = lib.parseIndexEntries(indexSrc, varName);
  const listed = [];
  for (const entry of entries) {
    if (entry.kind === 'spread') {
      const ident = entry.key.split(/[\s.(]/)[0];
      listed.push({ kind: 'spread', ident, import: imports.get(ident), line: entry.line });
    } else if (entry.kind === 'prop') {
      listed.push({
        kind: entry.valueKind === 'object' ? 'inline' : 'alias',
        name: entry.key,
        ident: entry.valueKind === 'shorthand' ? entry.key : entry.valueText.replace(/\s+/g, '').replace(/;$/, ''),
        entry,
        import: imports.get(entry.valueText.trim().replace(/\(.*$/, '').split('.')[0]),
        line: entry.line,
      });
    }
  }
  return listed;
}

function configsFromExport(src, file, exportName) {
  return lib.configsFromExport(src, file, exportName);
}

function collectQueryConfigs(apiRoot) {
  const queryDir = path.join(apiRoot, 'server/graphql/v2/query');
  const indexPath = ['index.ts', 'index.js'].map((n) => path.join(queryDir, n)).find((p) => fs.existsSync(p));
  const configs = [];
  const seen = new Set();
  const cache = new Map();

  const push = (cfg, nameOverride) => {
    const name = nameOverride || cfg.name;
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    configs.push({
      ...cfg,
      name,
      kind: 'query',
      parentType: 'Query',
      relFile: lib.relFromApi(apiRoot, cfg.file),
    });
  };

  function loadFile(filePath) {
    if (!cache.has(filePath)) {
      cache.set(filePath, fs.existsSync(filePath) ? lib.readSource(filePath) : '');
    }
    return cache.get(filePath);
  }

  if (indexPath) {
    const indexSrc = lib.readSource(indexPath);
    const listed = loadIndexBindings(indexSrc, indexPath, 'query');
    for (const item of listed) {
      if (item.kind === 'inline') {
        const cfg = lib.fieldConfigFromObjectText(indexSrc, item.entry.valueStart, indexPath, item.name, {
          line: item.line,
        });
        if (cfg) {
          push(cfg, item.name);
        }
        continue;
      }
      const ident = (item.ident || '').replace(/\(.*$/, '').trim();
      const imp = item.import || lib.parseFileImportsToLocal(indexSrc, indexPath).get(ident);
      const filePath = imp && imp.resolved;
      if (!filePath || !fs.existsSync(filePath)) {
        continue;
      }
      const src = loadFile(filePath);
      const exportName =
        item.kind === 'spread'
          ? imp.imported === 'default' || imp.imported === '*'
            ? 'default'
            : imp.imported
          : imp.imported === '*'
            ? ident
            : imp.imported || 'default';
      let exported = configsFromExport(src, filePath, exportName);
      if (!exported.length && exportName !== 'default') {
        exported = configsFromExport(src, filePath, 'default');
      }
      if (!exported.length) {
        exported = configsFromExport(src, filePath, ident);
      }
      if (exported.length === 1 && (!exported[0].name || item.name)) {
        push({ ...exported[0], name: item.name }, item.name);
      } else {
        const match = exported.find((c) => c.name === item.name);
        if (match) {
          push({ ...match, name: item.name }, item.name);
        } else if (item.name) {
          // Factory / default export is the query field itself
          if (exported.length === 1) {
            push({ ...exported[0], name: item.name }, item.name);
          } else {
            for (const cfg of exported) {
              push(cfg);
            }
          }
        } else {
          for (const cfg of exported) {
            push(cfg);
          }
        }
      }
    }
  }

  const files = lib.walkFiles(queryDir);
  for (const filePath of files) {
    if (/\/index\.(js|ts)$/.test(filePath)) {
      continue;
    }
    const src = loadFile(filePath);
    for (const cfg of configsFromExport(src, filePath, 'default')) {
      if (cfg.name) {
        push({ ...cfg, kind: 'query', parentType: 'Query' });
      }
    }
  }

  configs.sort((a, b) => a.name.localeCompare(b.name));
  return configs;
}

function collectObjectFieldConfigs(apiRoot) {
  const dirs = [
    path.join(apiRoot, 'server/graphql/v2/object'),
    path.join(apiRoot, 'server/graphql/v2/interface'),
  ];
  const fieldMap = new Map();
  const addField = (cfg) => {
    const key = `${cfg.parentType}.${cfg.name}`;
    const existing = fieldMap.get(key);
    if (lib.preferScopeFieldConfig(cfg, existing)) {
      fieldMap.set(key, cfg);
    }
  };
  for (const dir of dirs) {
    for (const filePath of lib.walkFiles(dir)) {
      const src = lib.readSource(filePath);
      const types = lib.findGraphQLTypeConfigs(src, filePath);
      for (const type of types) {
        const extracted = lib.resolveFieldsObject(src, type.fieldsProp, filePath);
        const parentType = type.typeName || path.basename(filePath).replace(/\.(js|ts)$/, '');
        for (const cfg of extracted) {
          addField({
            ...cfg,
            kind: 'object_field',
            parentType,
            relFile: lib.relFromApi(apiRoot, cfg.file || filePath),
          });
        }
      }
      for (const map of lib.extractExportedFieldMaps(src, filePath)) {
        for (const cfg of map.fields) {
          addField({
            ...cfg,
            kind: 'object_field',
            parentType: map.parentType,
            relFile: lib.relFromApi(apiRoot, cfg.file || filePath),
          });
        }
      }
    }
  }
  const fields = [...fieldMap.values()];
  fields.sort((a, b) => a.parentType.localeCompare(b.parentType) || a.name.localeCompare(b.name));
  return fields;
}

function toScopeRecord(apiRoot, cfg, cache) {
  const hops = lib.collectHopTexts({
    apiRoot,
    filePath: cfg.file,
    resolveText: cfg.resolveText || cfg.objectText || '',
    hops: 2,
    cache,
  });
  const detected = lib.detectScopeHelpers(hops.texts);
  const joinedResolve = hops.texts.map((t) => t.text).join('\n');
  const sensitive = lib.inferSensitiveExpectedScopes(cfg, detected, joinedResolve);
  const enforcedSet = new Set(detected.enforcedScopes || []);
  const missingExpectedScopes = (sensitive.expectedScopes || []).filter((s) => !enforcedSet.has(s));
  const sensitiveFlag = missingExpectedScopes.length ? sensitive.sensitiveFlag : null;
  const delegatesTo = hops.callees.filter((rel) => /graphql\/common\//.test(rel));
  const declaredScope = Array.isArray(cfg.declaredScope)
    ? cfg.declaredScope
    : lib.extractDeclaredScope(cfg.description);
  const notes = [...(detected.notes || []), ...(sensitive.sensitiveNotes || [])];
  return {
    kind: cfg.kind,
    parentType: cfg.parentType,
    name: cfg.name,
    file: cfg.relFile || lib.relFromApi(apiRoot, cfg.file),
    line: cfg.line,
    description: cfg.description,
    declaredScope,
    expectedScopes: sensitive.expectedScopes,
    missingExpectedScopes,
    sensitiveFlag,
    helpersCalled: detected.helpersCalled,
    enforcedScopes: detected.enforcedScopes,
    eslintOptOut: Boolean(cfg.hasEslintScopeDisable),
    delegatesTo,
    notes,
  };
}

function enumerateScopeCoverage(options = {}) {
  const { apiRoot, configs: mutationConfigs } = collectMutationConfigs(options);
  const cache = new Map();
  const fields = [];

  for (const cfg of mutationConfigs) {
    fields.push(
      toScopeRecord(apiRoot, { ...cfg, kind: 'mutation', parentType: 'Mutation' }, cache),
    );
  }
  for (const cfg of collectQueryConfigs(apiRoot)) {
    fields.push(toScopeRecord(apiRoot, cfg, cache));
  }
  for (const cfg of collectObjectFieldConfigs(apiRoot)) {
    fields.push(toScopeRecord(apiRoot, cfg, cache));
  }

  return {
    generatedAt: lib.generatedAt(),
    apiRoot,
    fields,
  };
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = lib.parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    lib.printHelp(USAGE);
    return;
  }
  const result = enumerateScopeCoverage(opts);
  lib.writeJson(result, opts.out);
}

if (require.main === module) {
  main();
}

module.exports = { enumerateScopeCoverage, collectQueryConfigs, collectObjectFieldConfigs, main, USAGE };
