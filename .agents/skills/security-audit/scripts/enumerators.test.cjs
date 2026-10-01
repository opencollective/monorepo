'use strict';

/**
 * Smoke assertions for GraphQL V2 enumerators against the real API tree.
 * Run: node --test .agents/skills/security-audit/scripts/enumerators.test.cjs
 */

const path = require('path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveApiRoot } = require('./lib-scan.cjs');
const { enumerateV2Mutations } = require('./enumerate-v2-mutations.cjs');
const { enumerate2faCoverage } = require('./enumerate-2fa-coverage.cjs');
const { enumerateScopeCoverage } = require('./enumerate-scope-coverage.cjs');

const scriptsDir = __dirname;
const apiRoot = resolveApiRoot({ root: process.env.OC_API_ROOT || '/workspace/opencollective-api' });

test('enumerate-v2-mutations lists editTier and editVendor', () => {
  const result = enumerateV2Mutations({ root: apiRoot });
  assert.ok(result.mutations.length > 0, 'expected a non-empty mutation list');
  const names = new Set(result.mutations.map((m) => m.name));
  assert.ok(names.has('editTier'), 'editTier must exist');
  assert.ok(names.has('editVendor'), 'editVendor must be listed');
  const editTier = result.mutations.find((m) => m.name === 'editTier');
  assert.match(editTier.file, /TierMutations/);
  assert.equal(typeof editTier.line, 'number');
});

test('enumerate-2fa-coverage covers those mutations', () => {
  const result = enumerate2faCoverage({ root: apiRoot });
  assert.ok(result.mutations.length > 0, 'expected non-empty 2FA coverage JSON');
  const names = new Set(result.mutations.map((m) => m.name));
  assert.ok(names.has('editTier'));
  assert.ok(names.has('editVendor'));
  const editTier = result.mutations.find((m) => m.name === 'editTier');
  assert.equal(typeof editTier.twoFactor.enforceForAccount, 'boolean');
  assert.ok(editTier.twoFactor.enforceForAccount, 'editTier calls enforceForAccount');
});

test('enumerate-scope-coverage finds Host object_field with checkRemoteUserCanUseHost', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  assert.ok(result.fields.length > 0, 'expected non-empty scope coverage JSON');
  const hostHelper = result.fields.find(
    (f) =>
      f.kind === 'object_field' &&
      (f.helpersCalled || []).includes('checkRemoteUserCanUseHost') &&
      /Host\.ts$/.test(f.file),
  );
  assert.ok(hostHelper, 'Host.ts must yield an object_field that calls checkRemoteUserCanUseHost');
  assert.ok((hostHelper.enforcedScopes || []).includes('host'));
});

test('enumerate-scope-coverage merges AccountFields.emails resolve (not interface stub)', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  const emails = result.fields.find((f) => f.parentType === 'Account' && f.name === 'emails');
  assert.ok(emails, 'Account.emails must be enumerated');
  assert.ok(emails.line >= 1390, `expected AccountFields override line, got ${emails.line}`);
  assert.ok(
    (emails.notes || []).some((n) => /canSeePrivateProfileInfo/.test(n)) ||
      /adminUserEmailsForCollective/.test((emails.notes || []).join('')),
    'emails resolve should reference private profile or admin email loader',
  );
  assert.ok((emails.expectedScopes || []).includes('email'), 'emails should expect OAuth email scope');
  assert.ok((emails.missingExpectedScopes || []).includes('email'));
  assert.equal(emails.sensitiveFlag, 'wrong');
});

test('enumerate-scope-coverage flags Order.transactions missing transactions scope', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  const orderTx = result.fields.find((f) => f.parentType === 'Order' && f.name === 'transactions');
  assert.ok(orderTx, 'Order.transactions must be enumerated');
  assert.ok((orderTx.expectedScopes || []).includes('transactions'));
  assert.ok((orderTx.missingExpectedScopes || []).includes('transactions'));
  assert.ok(orderTx.sensitiveFlag);
});

test('enumerate-scope-coverage flags Query.order missing orders scope', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  const orderQuery = result.fields.find((f) => f.kind === 'query' && f.name === 'order');
  assert.ok(orderQuery, 'Query.order must be enumerated');
  assert.ok((orderQuery.expectedScopes || []).includes('orders'));
  assert.ok((orderQuery.missingExpectedScopes || []).includes('orders'));
});

test('enumerate-scope-coverage flags Account.hostApplicationRequests missing host scope', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  const requests = result.fields.find((f) => f.parentType === 'Account' && f.name === 'hostApplicationRequests');
  assert.ok(requests, 'Account.hostApplicationRequests must be enumerated');
  assert.ok((requests.expectedScopes || []).includes('host'));
  assert.ok((requests.missingExpectedScopes || []).includes('host'));
});

test('enumerate-scope-coverage flags Host.hostApplications missing host scope', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  const hostApps = result.fields.find((f) => f.parentType === 'Host' && f.name === 'hostApplications');
  assert.ok(hostApps, 'Host.hostApplications must be enumerated');
  assert.ok((hostApps.expectedScopes || []).includes('host'));
  assert.ok((hostApps.missingExpectedScopes || []).includes('host'));
});

test('enumerate-scope-coverage does not flag PaymentIntent.transactions when parent query enforces scope', () => {
  const result = enumerateScopeCoverage({ root: apiRoot });
  const piTx = result.fields.find((f) => f.parentType === 'PaymentIntent' && f.name === 'transactions');
  assert.ok(piTx, 'PaymentIntent.transactions must be enumerated');
  assert.equal(piTx.missingExpectedScopes?.length || 0, 0, 'nested field should defer to Query.paymentIntent scope');
  assert.ok((piTx.notes || []).some((n) => /PaymentIntentCollectionResolver/.test(n)));
});

test('CLI --help exits 0', () => {
  for (const script of [
    'lib-scan.cjs',
    'enumerate-v2-mutations.cjs',
    'enumerate-2fa-coverage.cjs',
    'enumerate-scope-coverage.cjs',
  ]) {
    const proc = spawnSync(process.execPath, [path.join(scriptsDir, script), '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(proc.status, 0, `${script} --help should exit 0`);
    assert.match(proc.stdout, /Usage:/);
  }
});
