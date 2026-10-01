#!/usr/bin/env node
'use strict';

/**
 * Static checks outside GraphQL field enumeration (workers, REST controllers, shared helpers).
 */

const fs = require('fs');
const path = require('path');

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * @param {string} apiRoot
 * @returns {Array<{ fingerprint: string, title: string, flag: string, file: string, line?: number, detail: string }>}
 */
function scanNonGraphqlScopeGaps(apiRoot) {
  const gaps = [];

  const exportCsv = readIfExists(path.join(apiRoot, 'server/lib/export-requests/export-csv.ts'));
  const scopeCheck = readIfExists(path.join(apiRoot, 'server/graphql/common/scope-check.ts'));
  const transactionExportRequiresIncognito =
    Boolean(scopeCheck) &&
    /checkScopeForExportRequest[\s\S]*ExportRequestTypes\.TRANSACTIONS[\s\S]*checkRemoteUserCanUseIncognito/.test(
      scopeCheck,
    );
  if (
    exportCsv &&
    exportCsv.includes("includeIncognitoTransactions', '1'") &&
    exportCsv.includes('generateSessionToken') &&
    !transactionExportRequiresIncognito
  ) {
    gaps.push({
      fingerprint: 'oc:api:scope:async.export.transactions.incognito',
      title: 'Async transaction export includes incognito rows via session JWT',
      flag: 'wrong',
      file: 'server/lib/export-requests/export-csv.ts',
      line: 54,
      detail:
        'Worker always sets includeIncognitoTransactions=1 and authenticates with generateSessionToken(); createExportRequest / ExportRequest.file must require incognito for TRANSACTIONS exports (fail closed).',
    });
  }
  if (scopeCheck) {
    const fn = scopeCheck.match(/export const checkRemoteUserCanUseComment[\s\S]*?^};/m);
    if (fn && !fn[0].includes('OrderId')) {
      gaps.push({
        fingerprint: 'oc:api:scope:graphql.v2.mutation.Mutation.createComment',
        title: 'Order private notes skip orders OAuth scope in createComment',
        flag: 'missing',
        file: 'server/graphql/common/scope-check.ts',
        line: 120,
        detail:
          'checkRemoteUserCanUseComment handles Conversation/Update/Expense/HostApplication only; OrderId comments rely on host-admin role without enforceScope(orders).',
      });
    }
  }

  const payBatch = readIfExists(path.join(apiRoot, 'server/controllers/transferwise.ts'));
  if (payBatch && payBatch.includes('export async function payBatch') && !/enforceScope|checkScope|checkRemoteUserCanUseExpenses/.test(payBatch)) {
    gaps.push({
      fingerprint: 'oc:api:scope:rest.POST.services.transferwise.pay-batch',
      title: 'Wise pay-batch REST route has no OAuth/personal-token scope check',
      flag: 'missing',
      file: 'server/controllers/transferwise.ts',
      line: 37,
      detail:
        'Route checks remoteUser.isAdmin(host) only. Personal-Token auth is supported globally on API routes; OAuth user tokens are not used as raw Bearer on this REST path (session JWT from the web UI).',
    });
  }

  return gaps;
}

module.exports = { scanNonGraphqlScopeGaps };
