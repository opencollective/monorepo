---
name: security-audit-api-2fa
description: Checks 2FA enforcement across GraphQL V2 mutations. Use for coverage gaps or on-demand checks.
---

# API GraphQL V2 2FA completeness hunter

Deterministic completeness check of **two-factor enforcement** on every GraphQL V2 mutation in `opencollective-api`. For engineers running on-demand checks.

This hunter **records and classifies**. The enumerator does not decide Bug vs hardening.

## Enumerator

From the workspace root:

```bash
node .agents/skills/security-audit/scripts/enumerate-2fa-coverage.cjs --root opencollective-api --out /tmp/opencode/v2-2fa.json
```

`--root` defaults to `OC_API_ROOT`, then `./opencollective-api`, then `/workspace/opencollective-api`. Also run `enumerate-v2-mutations.cjs` when you need the raw mutation list.

Smoke test (no extra deps):

```bash
node --test .agents/skills/security-audit/scripts/enumerators.test.cjs
```

## Load known-safe patterns

Read `.agents/skills/review-feature-security/SKILL.md` when that skill is present. Otherwise use `AGENTS.md` Security: public GraphQL introspection and permissive API CORS are not defects.

OWASP framing: Multifactor Authentication. This skill's outputs (classification, optional findings.json, Bug) are the source of truth, not the cheat sheet.

## Classify every mutation

For each row in the enumerator JSON, trace `file` + `line` + `twoFactor.callees` (1-2 hops into `server/graphql/common/*`). Assign **one** class:

| Class | When | Verdict |
| --- | --- | --- |
| **public/guest N/A** | Unauthenticated or guest-only (example: `confirmGuestAccount`) | Not a 2FA finding |
| **read-only N/A** | No durable write, payout, token, or admin policy change | Not a 2FA finding |
| **admin write / REQUIRE_2FA_FOR_ADMINS** | Admin (or host-admin) mutation that changes money, payout methods, vendors, legal docs, hosting, or equivalent. Must follow host policy `REQUIRE_2FA_FOR_ADMINS` via `twoFactorAuthLib.enforceForAccount` or `enforceForAccountsUserIsAdminOf` (which call `validateRequest` when the policy or user 2FA is on) | Missing call with a real threat model is **confirmed** |
| **user-has-2FA-enabled** | Path that should prompt when the acting user already has 2FA enrolled (`validateRequest` / `enforceForAccount` without waiting only for host policy) | Missing call is confirmed only with a real threat model |
| **intentional onlyAskOnLogin / preAuthorize2FA** | `onlyAskOnLogin: true` or `TWO_FACTOR_SESSIONS_PARAMS` / `preAuthorize2FA` is an explicit product choice (login-time or pre-authorized token) | Hardening at most, not a Bug, unless the option skips a required payout/admin gate |

`twoFactor.sessionParams` means the script saw `TWO_FACTOR_SESSIONS_PARAMS` and/or `preAuthorize2FA`. `onlyAskOnLogin` is login-time 2FA, not a fresh prompt for the mutation.

## What is confirmed

**Confirmed** = missing 2FA call on an admin-write mutation with a **real threat model**, in the class of `editVendor` payout 2FA bypass ([opencollective-security #200](https://github.com/opencollective/opencollective-security/issues/200)).

Unambiguous missing call: confirm from **source trace + threat model**. Mocha PoC when cheap (phase 2). Do not file from enumerator flags alone.

**Not a Bug:** defense-in-depth extra prompts after login (for example `onlyAskOnLogin` on tier edits). That is hardening.

## Fingerprint

`oc:api:2fa:graphql.v2.mutation.<name>[.<subpath>]`

Examples: `oc:api:2fa:graphql.v2.mutation.editVendor`, `oc:api:2fa:graphql.v2.mutation.editVendor.payoutMethod`.

Stable across runs. No line numbers, waves, or severity in the fingerprint.

## Dedup and filing

1. Search `opencollective-security/harness/index.json` (when present).
2. Search GitHub `opencollective/opencollective-security` issues (open and closed).
3. Grep `reports/` and `internal/` in the security repo checkout for the same fingerprint.
4. Upsert hunt fields (must not rewrite `reports[]`):

```bash
node .agents/skills/security-audit/scripts/patch-index.cjs --mode hunt \
  --index opencollective-security/harness/index.json \
  --fingerprint 'oc:api:2fa:graphql.v2.mutation.editVendor' \
  --verdict confirmed --repo opencollective-api \
  --path server/graphql/v2/mutation/VendorMutations.ts --issue 200
```
5. File a Bug **only if confirmed and not a duplicate**. Label `source > harness`.

## Artifacts

Write under `opencollective-security/harness/api/runs/<YYYY-MM-DD>-<n>/` (and local gitignored `priv/security-audit/` when the security repo is not checked out). Do not patch product code from this hunter.

If you produce `findings.json`, validate it:

```bash
node .agents/skills/security-audit/validate-findings.cjs path/to/findings.json
```

## Enumerator limitations

Heuristic/regex parser (`lib-scan.cjs`): not TypeScript. Spread fields are not expanded. Runtime field factories are not executed. 2FA hops follow same-file helpers and `server/graphql/common/*` only (not `server/lib/*` except through those hops). If a mutation is missing from JSON, say so; do not invent GraphQL fields.

## Sub-agents

Run via sub-agent `security/2fa` (this skill) plus `security/verifier` on every candidate. Hunters must not edit product source.
