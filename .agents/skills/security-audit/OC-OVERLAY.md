# Open Collective overlay

Companion to [SKILL.md](SKILL.md). Cloudflare phases, schemas, and validators stay as vendored. This file is the OC-specific filing, dedup, and ledger contract.

Bounty and qualifying-class policy: [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md). Hunts are not bounty submissions, but do not file Bug issues for classes that policy lists as non-qualifying.

Known-safe patterns (not defects) live in [`../review-feature-security/SKILL.md`](../review-feature-security/SKILL.md). Load that skill before filing.

## Paths

| Role | Path |
| --- | --- |
| Default target | `/workspace/opencollective-api` or `./opencollective-api` |
| Local run (gitignored) | `priv/security-audit/<YYYY-MM-DD>-<n>/` |
| Security repo | `opencollective-security/` or `/workspace/opencollective-security` |
| Run copy on security repo | `opencollective-security/harness/<token>/runs/<YYYY-MM-DD>-<n>/` |
| Cumulative ledger | `opencollective-security/harness/api/coverage-ledger.json` (`harness/<token>/` for other targets) |
| Findings index | `opencollective-security/harness/index.json` |
| Internal / ad-hoc triage | `opencollective-security/internal/<YYYY-MM-DD>-<slug>/` |

`<token>` is `api` (default), `frontend`, `rest`, `pdf`, or `images`. If the security repo is not checked out, write only the local `priv/` run. Do not invent a security-repo write.

Never commit findings, PoCs, or harness artifacts into OSS product repos.

## Fingerprints

Format: `oc:<repo>:<class>:<canonical-ref>`

- `<repo>`: `api`, `frontend`, `rest`, `pdf`, `images`
- `<class>`: lowercase token such as `2fa`, `scopes`, `idor`, `ssrf`, `authz`, `ledger`, `webhook`
- `<canonical-ref>`: stable GraphQL field, file plus export, or route. Example: `oc:api:2fa:graphql.v2.mutation.editVendor.payoutMethod`

Must also satisfy the findings schema: `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$`.

Embed in every GitHub issue body (and local `issue.md`) as a hidden HTML comment, on its own line near the top:

```html
<!-- oc-fingerprint: oc:api:2fa:graphql.v2.mutation.editVendor.payoutMethod -->
```

## Dedup

Code first, LLM last. Search in this order:

1. `harness/index.json` by exact `fingerprint`, title, paths, and report metadata.
2. GitHub issues on `opencollective/opencollective-security` (open and closed) for the HTML comment above, then title and body terms.
3. Triage folders: grep `opencollective-security/reports/**` and `opencollective-security/internal/**` for fingerprints and distinctive terms in `issue.md` / `reply.md`.
4. Optional: prior hunt outputs under `harness/**/runs/**/findings.json`.

Exact fingerprint hit: add a comment on the existing issue (and a hunt-mode index upsert for `lastSeen` / `commitSha`). Do not file a new Bug.

If the index `commitSha` (or the SHA cited on the issue) differs from the current target ref, do not silence the finding. Mark coverage `prior_confirmed_changed_source` and re-validate. It stays confirmed only if current independent validation still holds.

Closed or fixed issues still count as known. File a new Bug only for a verified regression after the control disappeared.

## When to file a Bug

| Verdict | GitHub Bug on `opencollective-security` |
| --- | --- |
| `confirmed` after independent verification, with sandbox or unambiguous source-plus-threat-model from a specialized hunter | Yes |
| Generic hunt without a local sandbox | No. Keep `needs_validation` only |
| `needs_validation`, `rejected`, duplicate, intentional, non-qualifying | No |

Issue type: **Bug**. Required label: `source > harness`. Also apply existing labels that match:

- `service > api` / `service > frontend` / `service > rest` / `service > pdf` (create `service > images` only if the repo already has it)
- `type > *` and `scope > *` already on the repo (for example `type > permissions`, `scope > payment methods`, `scope > oauth`)
- `severity > critical`, `severity > high`, `severity > medium` when overall severity maps. There is no `severity > low` label; omit severity for low or informational.

Do not invent labels. Product code stays read-only. Do not open auto-fix PRs on `opencollective-api` or other OSS checkouts.

## Issue body template

Match [opencollective-security#200](https://github.com/opencollective/opencollective-security/issues/200). Put the fingerprint comment first. For harness hunts, Report ID is `harness` and Reporter is `security-audit harness`. For bounty-origin rows, use the real report ID and reporter (Gmail-ingested mail: full folder id `gm_<gmailId>`, not the bare Gmail id).

```markdown
<!-- oc-fingerprint: oc:api:2fa:graphql.v2.mutation.editVendor.payoutMethod -->

**Report ID:** `harness`

**Reporter:** security-audit harness

**Affected service:** `opencollective-api`

**Status:** Confirmed (local PoC, YYYY-MM-DD)

**Working severity:** Low

**Related:** #N (optional; distinct prior issue, not a duplicate)

## Summary

One short paragraph: intended control, missing check, and reachable result.

## Impact

- **Affected:** who or which hosts, collectives, or tenants.
- **Integrity / confidentiality / availability:** concrete result.
- **Prerequisites:** principal and policy (for example host admin, `REQUIRE_2FA_FOR_ADMINS`).
- **Limits:** what this does not grant.

## Affected components

- `server/graphql/v2/mutation/VendorMutations.ts` - `editVendor` payout-method branch
- reference control on the intended path (file plus function)

## Reproduction

Sandboxed local steps or Mocha PoC path under `opencollective-security/internal/.../poc/` or `harness/<token>/runs/<date>-<n>/`. No live or production probes. State the observed result.

## Suggested fix

Narrowest source change at the last trusted decision point, plus a regression test. Name the account the control must run against (for vendor payouts, the **host**, not the vendor).

## Labels / hints

Area: api, 2fa, vendors, payout-method, permissions
Priority: low
```

## Upsert `harness/index.json`

Never have the model rewrite the whole file. Use `scripts/patch-index.cjs` (creates `{ "version": 1, "findings": [] }` if missing, then validates).

Hunt mode (manual runs and this skill):

```bash
node .agents/skills/security-audit/scripts/patch-index.cjs \
  --mode hunt \
  --index opencollective-security/harness/index.json \
  --fingerprint oc:api:2fa:graphql.v2.mutation.editVendor.payoutMethod \
  --title "editVendor bypasses REQUIRE_2FA_FOR_ADMINS on vendor payout-method changes" \
  --verdict confirmed \
  --repo opencollective-api \
  --path server/graphql/v2/mutation/VendorMutations.ts \
  --sha <reviewed-commit> \
  --issue 200
```

Bounty or internal triage (investigate skills), add `--mode bounty` or `--mode internal` and `--report` JSON. Do not run those modes from a hunt.

### Field ownership

One record per fingerprint. No run deletes a row. Closed or fixed stays known.

| Writer | May change | Must not |
| --- | --- | --- |
| `--mode hunt` | Upsert hunt fields: `title` if missing, `verdict` if provided, union `paths`, `commitSha`, `lastSeen`, `issue` if provided, add `harness` to `sources` | Clear or rewrite `reports[]`; delete rows |
| `--mode bounty` / `--mode internal` | Append or update `reports[]` (match `messageId` or `gmailId`, else date plus title), add `bounty` or `internal` to `sources` | Clear hunt fields (`paths`, `commitSha`) |

Invalid or not-a-vuln bounty mail still gets a row so the next researcher matches.

## Coverage ledger notes

Validators stay next to `SKILL.md`. After every parent ledger or findings write:

```bash
node .agents/skills/security-audit/validate-findings.cjs <output-dir>/findings.json
node .agents/skills/security-audit/validate-coverage-ledger.cjs <output-dir>/coverage-ledger.json
```

Ledger shape and state table are defined in [RECONNAISSANCE.md](RECONNAISSANCE.md). Do not weaken them.

OC unit practice:

- Default API surfaces: GraphQL V2 mutations, queries, and nested fields; webhooks (incoming and outgoing); ledger and money-state paths; private organizations; OAuth and personal tokens; expenses; orders.
- Scoped generic hunt: one slice per run. Seed in-scope units for that slice. Mark other slices `out_of_scope`, never `covered`. Read the latest `harness/api/coverage-ledger.json` as prior-run input.
- Specialized 2FA hunter: one unit per mutation (or payout-adjacent branch) versus host `REQUIRE_2FA_FOR_ADMINS` / `twoFactorAuthLib`.
- Specialized scopes hunter: one unit per GraphQL field versus the expected OAuth scope set. Status is not `covered` unless expected and actual sets match. ESLint seeing some helper is not coverage.
- `result_fingerprints` use the `oc:` format above.
- Record skipped companions in `excluded_blocks` with reason `OC overlay: companion skipped unless requested`.
- After a successful run, copy the validated run ledger to `harness/<token>/coverage-ledger.json`. That file is the next prior-run input. Keep the per-run copy under `runs/<YYYY-MM-DD>-<n>/`. If no prior ledger exists, say so; the first hunt creates it.

## Confirmation bar

- Specialized 2FA or scope miss with an unambiguous missing (or wrong) call and a real admin-write or token-client threat model may be `confirmed` from source plus that model. Mocha PoC when cheap.
- Generic hunt without a local sandbox stays `needs_validation`. Never a Bug issue.
- Bounty mail still requires a PoC for fully confirmed (investigate-report skill).
