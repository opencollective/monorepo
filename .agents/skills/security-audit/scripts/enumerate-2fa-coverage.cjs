#!/usr/bin/env node
'use strict';

/**
 * For each GraphQL V2 mutation, detect 2FA enforcement calls including 1-2 hops
 * into server/graphql/common/* (and same-file helpers).
 *
 * This script records presence. The hunter judges missing/wrong/intentional.
 *
 * Usage:
 *   node enumerate-2fa-coverage.cjs [--root <apiRoot>] [--out <file>]
 */

const lib = require('./lib-scan.cjs');
const { collectMutationConfigs } = require('./enumerate-v2-mutations.cjs');

const USAGE = `enumerate-2fa-coverage.cjs - GraphQL V2 mutation 2FA call coverage

Usage:
  node enumerate-2fa-coverage.cjs [--root <apiRoot>] [--out <file>]

Options:
  --root   API repository root (default: OC_API_ROOT, ./opencollective-api, /workspace/opencollective-api)
  --out    Write JSON to this path instead of stdout
  --help   Show this help

Output JSON:
  { generatedAt, apiRoot, mutations: [{ name, file, line, twoFactor: { enforceForAccount, enforceForAccountsUserIsAdminOf, validateRequest, onlyAskOnLogin, sessionParams, callees }, notes }] }
`;

function enumerate2faCoverage(options = {}) {
  const { apiRoot, configs } = collectMutationConfigs(options);
  const cache = new Map();
  const mutations = configs.map((cfg) => {
    const hops = lib.collectHopTexts({
      apiRoot,
      filePath: cfg.file,
      resolveText: cfg.resolveText || cfg.objectText || '',
      hops: 2,
      cache,
    });
    const flags = lib.detectTwoFactor(hops.texts);
    const notes = [];
    if (!cfg.resolveText) {
      notes.push('resolve body not extracted; scanned surrounding field config text');
    }
    if (flags.onlyAskOnLogin) {
      notes.push('onlyAskOnLogin option observed (login-time 2FA, not a fresh prompt)');
    }
    if (flags.sessionParams) {
      notes.push('TWO_FACTOR_SESSIONS_PARAMS and/or preAuthorize2FA observed');
    }
    return {
      name: cfg.name,
      file: cfg.relFile,
      line: cfg.line,
      twoFactor: {
        enforceForAccount: flags.enforceForAccount,
        enforceForAccountsUserIsAdminOf: flags.enforceForAccountsUserIsAdminOf,
        validateRequest: flags.validateRequest,
        onlyAskOnLogin: flags.onlyAskOnLogin,
        sessionParams: flags.sessionParams,
        callees: hops.callees,
      },
      notes,
    };
  });
  return {
    generatedAt: lib.generatedAt(),
    apiRoot,
    mutations,
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
  const result = enumerate2faCoverage(opts);
  lib.writeJson(result, opts.out);
}

if (require.main === module) {
  main();
}

module.exports = { enumerate2faCoverage, main, USAGE };
