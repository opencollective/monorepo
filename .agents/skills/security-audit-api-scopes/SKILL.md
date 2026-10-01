---
name: security-audit-api-scopes
description: Checks OAuth scope coverage and correctness across GraphQL V2 fields. Use for scope audits or drift checks.
---

# API GraphQL V2 OAuth scope completeness hunter

Deterministic completeness check that **the correct OAuth scopes** are enforced on every GraphQL V2 surface in `opencollective-api`: mutations, top-level queries (including `query/collection/`), and nested object fields (`object/` plus `interface/` such as Account).

For engineers running on-demand checks. The enumerator records declared vs actual. **This hunter judges** missing / wrong / incomplete / description-drift.

## Enumerator

From the workspace root:

```bash
node .agents/skills/security-audit/scripts/enumerate-scope-coverage.cjs --root opencollective-api --out /tmp/opencode/v2-scopes.json
```

Gap summary (PII + declared drift):

```bash
node .agents/skills/security-audit/scripts/analyze-scope-gaps.cjs --in /tmp/opencode/v2-scopes.json
```

`--root` defaults to `OC_API_ROOT`, then `./opencollective-api`, then `/workspace/opencollective-api`.

Canonical scopes: `opencollective-api/server/constants/oauth-scopes.ts`.
Helpers: `opencollective-api/server/graphql/common/scope-check.ts`.

ESLint (`eslint-rules/graphql-mutation-scope-check.js`) only checks that **mutations** call **some** helper. This hunter must go beyond that: queries, nested fields, **which** helper, and whether it matches the resource.

Smoke test:

```bash
node --test .agents/skills/security-audit/scripts/enumerators.test.cjs
```

## Load known-safe patterns

Read `.agents/skills/review-feature-security/SKILL.md` when present. `AGENTS.md`: public GraphQL introspection and permissive API CORS are not defects.

OWASP framing: OAuth2 plus Access Control. Skill outputs win over the cheat sheet.

## Coverage unit

**Coverage unit = field x expected scope set.**

A field is not `covered` unless expected scopes and actual `enforcedScopes` match. Presence of any helper is not enough.

Per enumerator row:

- `kind`: `mutation` | `query` | `object_field`
- `parentType`: `Mutation`, `Query`, or object/interface name
- `declaredScope`: from description `Scope: "..."` (intent, not enforcement)
- `expectedScopes` / `missingExpectedScopes` / `sensitiveFlag`: PII heuristics (see below)
- `helpersCalled` / `enforcedScopes`: mapped from helpers (KYC->kyc, VirtualCards->virtualCards, Account->account, ExportRequests->exportRequests, Host->host, Transactions->transactions, Orders->orders, Applications->applications, Conversations->conversations, Expenses->expenses, Updates->updates, ConnectedAccounts->connectedAccounts, Webhooks->webhooks, Root->root, Comment->conversations|updates|expenses|account when the branch is detectable, `enforceScope`/`checkScope` literals, `rejectOAuthAndPersonalTokenAuth` -> `["session_only"]`)
- `eslintOptOut`: `require-scope-check` disable comment
- `delegatesTo`: `graphql/common` files when resolve is a thin wrapper

## Hunter workflow (do not skip)

1. **Regenerate** coverage JSON and run `analyze-scope-gaps.cjs`.
2. **Triage `sensitiveFlag` rows first** (`email`, `account`+`incognito` on private profile fields).
3. **Triage interface vs implementation splits** (Account is the main footgun; see below).
4. **Triage role/loader gates without OAuth scope** (`canSeePrivateProfileInfo`, `isAdminOfCollective`, context permissions) on token-backed fields.
5. **Triage collection delegates** (`Account.transactions` -> `TransactionsCollectionResolver`): compare nested field to top-level `Query.*` and read the shared resolver, not only the thin wrapper. The enumerator notes `delegates to … collection resolver` and does **not** auto-flag those rows; **direct loaders** (example: `Order.transactions` -> `Transaction.byOrderId`) are flagged.
6. **Triage read vs write asymmetry** (`Query.order` vs `OrderMutations`): top-level reads often use `assertOrderAccessibleForPrivateCollective` / host-admin role only; mutations call `checkRemoteUserCanUseOrders`. Zero-scope personal tokens are in scope for this hunter.
6b. **Triage Host-wide nested fields** (`hostApplications`, `hostApplicationRequests`, `host*Report`, `hostedVirtualCards`, …): expect **`host`** scope, not only `isAdmin(host)` / collective admin (enumerator flags via `inferResourceExpectedScopes`; `hostApplicationRequests` is on `AccountFields`, not `applications` scope).
7. **Run non-GraphQL static scan** (included in `analyze-scope-gaps.cjs`): async `TRANSACTIONS` export must **fail closed** on missing `incognito` (`checkScopeForExportRequest`); worker session JWT + `includeIncognitoTransactions=1` is only a gap if that check is missing. Also `checkRemoteUserCanUseComment` missing `OrderId`, REST `POST /services/transferwise/pay-batch` (personal tokens; not third-party OAuth Bearer).
8. **Manually verify** enumerator false positives (mutation args typed as `GraphQLEmailAddress`, emoji reactions, update mutations delegating to `graphql/common`).
9. **Dedup** harness index, GitHub security repo, and `reports/` / `internal/` folders before `confirmed`.

## Account interface vs `AccountFields` (why `Account.emails` was missed)

`GraphQLAccount` uses `fields: accountFieldsDefinition` (stub entries, often **no `resolve`**). Real resolvers live in `export const AccountFields = { ...accountFieldsDefinition(), emails: { resolve... } }` and are spread onto `Host`, `Individual`, `Organization`, etc.

The enumerator must:

- Merge **`export const *Fields`** maps and prefer configs **with a `resolve`** over interface stubs.
- Expand **`...accountFieldsDefinition()`** / **`...AccountFields`** spreads when parsing field maps.
- Attribute **`Account.emails`** at `Account.ts` ~1397 (`adminUserEmailsForCollective`), not the type-only stub at ~444.

**Fingerprint** for shared `AccountFields` email data: `oc:api:scope:graphql.v2.object_field.Account.emails` (do not file duplicate issues per implementor type).

## PII / sensitive field catalog (OAuth scope beyond `checkRemoteUserCanUse*`)

These often use **visibility loaders** or **admin role** only. That is **not** equivalent to OAuth scope for `userToken` / `personalToken`.

| Surface | Expected scope | Common wrong gate |
| --- | --- | --- |
| `Individual.email`, `Account.emails` | `email` | `canSeePrivateProfileInfo` only |
| `Account.legalName`, `mainProfile` | `account` (+ `incognito` when applicable) | loader / `getContextPermission` without `checkScope` |
| Host-wide reports / applications | `host` | `isAdmin(host)` only |
| `Account.hostApplicationRequests` | `host` | collective `isAdmin` only (same host-scope class as `Host.hostApplications`; not `applications`) |
| `Account.transactions` / `Query.transactions` | `transactions` | visibility only (see known issue) |
| `Account.orders` / `Query.orders` | `orders` | visibility only |
| `Query.order` / `Order.comments` / `Order.memo` | `orders` | host-admin / `canComment` only |
| `Order.transactions` | `transactions` | direct `Transaction.byOrderId` loader (no collection delegate) |
| `Tier.orders` | `orders` | direct `Order.findAndCountAll` (no `OrdersCollectionResolver`) |
| `PlatformBilling.expenses` | `expenses` | parent `platformBilling` checks `account` only |
| `PaymentIntent.transactions` / `TransactionGroup.transactions` | `transactions` | scope on `Query.paymentIntent` / `Query.transactionGroup` (nested field does not re-check) |
| `Mutation.createComment` on orders | `orders` | `checkRemoteUserCanUseComment` has no `OrderId` branch |
| `Account.expenses` / `Query.expenses` | `expenses` | visibility only |
| Export mutations / file download | `exportRequests` + type scopes | `account` only (known issue) |
| Async `TRANSACTIONS` export | `incognito` (required; export always includes incognito rows) | session JWT in `export-csv.ts` with no fail-closed check on create/file download |
| REST `POST /services/transferwise/pay-batch` | `expenses` (personal token) | `isAdmin(host)` only; OAuth apps do not use this route with `userToken` |

`Individual.email` documents `scope: "email"` but only calls `checkScope(req, 'email')` when the viewer **is** the account; host/collective admins read email via `canSeePrivateProfileInfo` **without** `email` scope -> **incomplete** branch coverage.

`Account.emails` returns admin emails when `canSeePrivateProfileInfo` is true and never calls `checkScope(req, 'email')` -> **`account`-only OAuth can read emails** (reported bypass).

## Flags (findings when confirmed)

| Flag | Meaning |
| --- | --- |
| **missing** | Authz-sensitive field with no scope helper on the resolve path (including callees) |
| **wrong** | Weaker or unrelated scope (example: `account` on expense, host, or export; host-wide data behind `account` only; email PII behind `canSeePrivateProfileInfo` only) |
| **incomplete** | One of several required scopes or branches (example: `checkScope(email)` on self only; host report export checks `transactions` but not `host`) |
| **description drift** | Description says `Scope: "expenses"` but the resolver enforces `account` (or the reverse) |
| **opt-out without coverage** | ESLint disable whose callee does not enforce on **all** branches |
| **sensitiveFlag** (enumerator) | Heuristic PII gap; hunter must confirm before `confirmed` |

## Not findings

- Session JWT without `userToken` / `personalToken` bypassing scopes (`checkScope` returns true when there is no token). That is the current session model, not a scope Bug.
- GraphQL V1 token scopes.
- Public/guest mutations with documented ESLint opt-out and explained public surface (`confirmGuestAccount`, guest flows).
- GraphQL fields that only take `GraphQLEmailAddress` as **input args** (not returned).

## Fingerprint

`oc:api:scope:graphql.v2.<kind>.<parent>.<name>`

Examples: `oc:api:scope:graphql.v2.mutation.Mutation.editExpense`, `oc:api:scope:graphql.v2.object_field.Host.hostedLegalDocuments`, `oc:api:scope:graphql.v2.object_field.Account.emails`, `oc:api:scope:graphql.v2.query.Query.exportRequests`.

## Dedup and filing

1. Search `opencollective-security/harness/index.json` (when present).
2. Search GitHub `opencollective/opencollective-security` (open and closed). Known related: OAuth `account` on host-wide tax ID export; `updateAccountPlatformSubscription` missing `account` (#11720); OAuth `email` on transactions/receipts (fingerprint `oc:api:scope:graphql.v2.object_field.Account.emails` and related); export scope escalation (`oc:api:scope:graphql.v2.mutation.Mutation.exportTransactions` / exportRequests class); incognito-in-export is a **distinct** facet from transactions-scope escalation (require `incognito` on TRANSACTIONS exports rather than a stored include flag).
3. Upsert hunt fields (must not rewrite `reports[]`):

```bash
node .agents/skills/security-audit/scripts/patch-index.cjs --mode hunt \
  --index opencollective-security/harness/index.json \
  --fingerprint 'oc:api:scope:graphql.v2.object_field.Account.emails' \
  --title 'Account.emails bypasses OAuth email scope' \
  --verdict confirmed --repo opencollective-api \
  --path server/graphql/v2/interface/Account.ts \
  --sha <api-commit>
```
4. File a Bug **only if confirmed and not a duplicate**. Label `source > harness`.

Confirmed = source trace of the field, the expected scope set, the actual helper/literal, and a real OAuth/personal-token threat model. Mocha PoC when cheap (phase 2).

## Artifacts

Write under `opencollective-security/harness/api/runs/<YYYY-MM-DD>-<n>/` (and local gitignored `priv/security-audit/` when the security repo is not checked out). Do not patch product code from this hunter.

If you produce `findings.json`, validate:

```bash
node .agents/skills/security-audit/validate-findings.cjs path/to/findings.json
```

## Enumerator limitations

Heuristic parser (`lib-scan.cjs`): not TypeScript. Spread fields (`...AccountFields`) on implementors still duplicate rows in raw JSON; use `analyze-scope-gaps.cjs` dedupe for `Account.emails`. `inferResourceExpectedScopes` flags direct nested resource loaders (`Order.transactions`) and `Query.order`; collection delegates are noted, not auto-flagged. `scan-non-graphql-scope-gaps.cjs` covers workers/REST/helpers. Runtime `fields()` factories are not executed. Nested types in `collection/` are not scanned (only `object/` and `interface/`). Comment and export-request scope branches are best-effort. Callee tracing depth is limited (Stripe connect, emoji reactions may need manual read). If parsing misses files, say so; do not invent GraphQL fields.

## Sub-agents

Run via sub-agent `security/scopes` (this skill) plus `security/verifier` on every candidate. Hunters must not edit product source.
