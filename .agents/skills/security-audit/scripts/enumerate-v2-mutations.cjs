#!/usr/bin/env node
'use strict';

/**
 * List every GraphQL V2 mutation from server/graphql/v2/mutation/.
 *
 * Combines mutation/index.js (spreads + explicit keys) with per-file exported
 * field maps. Heuristic parser: see lib-scan.cjs limitations.
 *
 * Usage:
 *   node enumerate-v2-mutations.cjs [--root <apiRoot>] [--out <file>]
 */

const path = require('path');
const lib = require('./lib-scan.cjs');

const USAGE = `enumerate-v2-mutations.cjs - list GraphQL V2 mutations from opencollective-api

Usage:
  node enumerate-v2-mutations.cjs [--root <apiRoot>] [--out <file>]

Options:
  --root   API repository root (default: OC_API_ROOT, ./opencollective-api, /workspace/opencollective-api)
  --out    Write JSON to this path instead of stdout
  --help   Show this help

Output JSON:
  { generatedAt, apiRoot, mutations: [{ name, file, line, description, hasEslintScopeDisable, resolveSnippet }] }
`;

function loadIndexBindings(indexSrc, indexPath) {
  const imports = lib.parseFileImportsToLocal(indexSrc, indexPath);
  const entries = lib.parseIndexEntries(indexSrc, 'mutation');
  const listed = [];
  for (const entry of entries) {
    if (entry.kind === 'spread') {
      const ident = entry.key.split(/[\s.(]/)[0];
      const imp = imports.get(ident);
      listed.push({ kind: 'spread', ident, import: imp, line: entry.line });
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

function collectMutationConfigs(options = {}) {
  const apiRoot = lib.resolveApiRoot(options);
  const mutationDir = path.join(apiRoot, 'server/graphql/v2/mutation');
  const indexPath = path.join(mutationDir, 'index.js');
  const indexSrc = lib.readSource(indexPath);
  const listed = loadIndexBindings(indexSrc, indexPath);
  const configs = [];
  const seen = new Set();

  const push = (cfg, nameOverride) => {
    const name = nameOverride || cfg.name;
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    configs.push({
      ...cfg,
      name,
      apiRoot,
      relFile: lib.relFromApi(apiRoot, cfg.file),
    });
  };

  const cache = new Map();
  function loadFile(filePath) {
    if (!cache.has(filePath)) {
      cache.set(filePath, fsExists(filePath) ? lib.readSource(filePath) : '');
    }
    return cache.get(filePath);
  }

  function fsExists(filePath) {
    try {
      return require('fs').existsSync(filePath);
    } catch {
      return false;
    }
  }

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
    const imp = item.import || (ident ? lib.parseFileImportsToLocal(indexSrc, indexPath).get(ident) : null);
    const filePath = imp && imp.resolved;
    if (!filePath || !fsExists(filePath)) {
      continue;
    }
    const src = loadFile(filePath);
    const exportName = item.kind === 'spread' ? (imp.imported === 'default' || imp.imported === '*' ? 'default' : imp.imported) : imp.imported === '*' ? ident : (imp.imported || 'default');
    let exported = configsFromExport(src, filePath, exportName);
    if (!exported.length && exportName !== 'default') {
      exported = configsFromExport(src, filePath, 'default');
    }
    if (!exported.length) {
      exported = configsFromExport(src, filePath, ident);
    }
    if (item.kind === 'alias' || item.kind === 'prop') {
      if (exported.length === 1 && !exported[0].name) {
        push({ ...exported[0], name: item.name }, item.name);
      } else {
        const match = exported.find((c) => c.name === item.name) || (exported.length === 1 ? exported[0] : null);
        if (match) {
          push({ ...match, name: item.name }, item.name);
        } else {
          for (const cfg of exported) {
            push(cfg);
          }
        }
      }
    } else {
      for (const cfg of exported) {
        push(cfg);
      }
    }
  }

  // Catch mutations defined in files but missed by index binding resolution.
  const files = lib.walkFiles(mutationDir);
  for (const filePath of files) {
    if (path.basename(filePath) === 'index.js' || path.basename(filePath) === 'index.ts') {
      continue;
    }
    const src = loadFile(filePath);
    const fromDefault = configsFromExport(src, filePath, 'default');
    for (const cfg of fromDefault) {
      if (cfg.name) {
        push(cfg);
      }
    }
    const named = [...src.matchAll(/export\s+const\s+(\w+)\s*=/g)].map((m) => m[1]);
    for (const n of named) {
      for (const cfg of configsFromExport(src, filePath, n)) {
        if (cfg.name) {
          push(cfg);
        }
      }
    }
  }

  configs.sort((a, b) => a.name.localeCompare(b.name) || a.relFile.localeCompare(b.relFile));
  return { apiRoot, configs };
}

function enumerateV2Mutations(options = {}) {
  const { apiRoot, configs } = collectMutationConfigs(options);
  return {
    generatedAt: lib.generatedAt(),
    apiRoot,
    mutations: configs.map((cfg) => ({
      name: cfg.name,
      file: cfg.relFile,
      line: cfg.line,
      description: cfg.description,
      hasEslintScopeDisable: Boolean(cfg.hasEslintScopeDisable),
      resolveSnippet: cfg.resolveSnippet,
    })),
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
  const result = enumerateV2Mutations(opts);
  lib.writeJson(result, opts.out);
}

if (require.main === module) {
  main();
}

module.exports = { enumerateV2Mutations, collectMutationConfigs, main, USAGE };
