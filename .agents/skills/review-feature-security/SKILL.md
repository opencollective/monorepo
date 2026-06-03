---
name: review-feature-security
disable-model-invocation: true
description: >
  Performs a structured security review of a specific feature, PR, or code change
  in the Open Collective codebase. Validates findings with a minimal runnable PoC
  when claiming full confirmation. Writes artifacts under
  `/workspace/priv/security-issues/<unique-folder>/` including `issue.md` per
  finding, optional `plan.md`, optional `impact.md`, plus PoC code. Use when
  asked to review the security of a new feature, a pull request, or a code change.
---

# Security review: feature (Open Collective)

Conduct a focused security review on a specific feature or code change. Scope is assertion, evidence, optional fix plan, and optional production-impact queries - aligned with the internal investigation skill (`security-investigate-issue`).

Detailed checks for each security category live in `references/checklist.md`.

## Review folder (required first step)

Create a **new unique directory** for this review under the workspace:

`/workspace/priv/security-issues/<unique-folder>/`

Use a name that is unique and sortable, for example `YYYY-MM-DD-review-<kebab-case-feature-or-pr>` (e.g. `2026-05-19-review-virtual-card-requests-collection`). If that path already exists, append a suffix (`-2`, `-3`, …) until unused. **All** skill outputs for this run (markdown files, PoC code, logs) go inside this folder only.

## Internal reference ID (optional)

If the user provides a **PR number, ticket ID, or branch name**, capture it at the start and repeat it in **`SUMMARY.md`** and in each finding's **`issue.md`** (e.g. a **Reference:** line near the top). Do not invent an ID.

## Workflow

**Prerequisite:** Create the review directory under `/workspace/priv/security-issues/` per **Review folder** before adding PoC code or markdown files.

1. **Define scope** - Ask for the feature, PR, or files if not already specified. List in-scope paths and layers touched: API mutations/queries, REST endpoints, frontend forms, cron jobs, webhooks, payment flows, file uploads.
2. **Gather context** - Read relevant files. What data is read or written? What roles/permissions are required? Payments, uploads, webhooks, OAuth, or external integrations?
3. **Apply the checklist** - Work through `references/checklist.md` for sections relevant to the feature. Prioritize critical checks (auth → authz → injection → payments). Use `rg` for dangerous patterns in in-scope files:

```bash
# Examples
rg "dangerouslySetInnerHTML" opencollective-frontend/
rg "eval\(" opencollective-api/server/
rg 'query\(.*\${' opencollective-api/server/
rg "Math\.random\(\)" opencollective-api/server/lib/
```

4. **Reproduce or disprove each candidate finding** - Prefer local or staging. Trace code paths; confirm or refute with evidence (request/response, code citation, test). Treat production-only behavior on `https://opencollective.com` as **evidence of behavior**, not as a substitute for a safe repro environment when building a PoC.
5. **Full confirmation requires a minimal PoC** - Do **not** treat a finding as **fully confirmed** until you **implement** a **minimal** proof-of-concept in that finding's directory (e.g. `poc/` subdirectory, or `poc.ts` / `poc.js` / `poc.sh`) and **run** it successfully against a permitted environment (local dev stack, test suite, or staging). The PoC must demonstrate the security-relevant behavior (not a full exploit chain unless necessary). Record how to run it in a short `README.md` in the finding folder or at the top of the PoC file, and capture key command output (or test pass/fail) in **`issue.md`** as evidence. If a runnable PoC is **not** feasible (missing secrets, environment unavailable, legal/safety constraints), state **not fully confirmed** or **provisional** with reasons; do **not** label the assertion **Confirmed** in that case.
6. **Classify each finding** - Valid issue vs invalid vs intentional/won't fix vs duplicate. Note alignment with product/security expectations and `AGENTS.md` intentional postures (e.g. public GraphQL introspection, permissive API CORS are not defects). Reserve **fully confirmed** for cases that passed the PoC bar in step 5 (or document why confirmation is impossible).
7. **Severity** - Worst realistic exploitation; use CVSS3-style reasoning. Consider OC-specific sensitivities: auth, payment methods or connected accounts, ledger integrity/history, permission system.
8. **Fix plan** - Minimal, ordered steps per finding that needs remediation. Match existing patterns in the touched repo. Capture in **`plan.md`** when applicable (see **Output files**).
9. **Optional production impact** - If durable traces exist for a finding, write **`impact.md`** in that finding's directory (see **`impact.md` (optional)** under **Output files**).
10. **Write review summary** - Create **`SUMMARY.md`** at the review folder root (scope, checklist areas covered, finding counts by verdict/severity, top recommendations). Do not duplicate full narratives from per-finding **`issue.md`** files.

## Output files

Write **only** under the review directory created in **Review folder**.

### Review root

| File         | When     | Contents                                                                                                                                                                      |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUMMARY.md` | **Always** | Scope (feature/PR/files), layers reviewed, checklist sections applied, table of findings (title, verdict, severity, path to `issue.md`), top recommendations, references. |

### Per finding

For each **candidate or confirmed** security issue worth documenting, create a **subdirectory** under the review folder:

`/workspace/priv/security-issues/<unique-folder>/<finding-slug>/`

Use a short kebab-case slug (e.g. `authz-missing-expense-preview`). **PoC code** for that finding lives in the same subdirectory (`poc/` or `poc.*` at its root). It is required for **full confirmation**, not optional when you claim confirmed.

| File        | When                                                                                                                                                             | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue.md`  | **Always** (one per finding subdirectory)                                                                                                                        | **Assertion document:** internal/PR reference (if any), title, summary of the claim, **verdict** (Confirmed / Provisional / Invalid / Duplicate / Intentional / Unclear) with reasoning, impact, affected components, code references, **pointer to PoC path and how it was run** (or why PoC was not run), suggested severity, and recommended next steps for engineering. |
| `plan.md`   | **When there is a fix to plan** (typically confirmed or high-confidence provisional; omit for clear invalid/duplicate/intentional with nothing to build)         | Ordered fix plan: where to patch, tests, migrations/schema, rollout, owner notes.                                                                                                                                                                                                                                                                                                                                                                    |
| `impact.md` | **When exploitation would leave queryable traces**                                                                                                               | **Production evaluation queries:** read-only checks an operator can run to assess **whether the issue was exploited in the wild**. Follow **`impact.md` (optional)** below. Omit when there is nothing concrete to query.                                                                                                                                                                                                                              |

Do not create empty placeholder files. Findings that are **Invalid**, **Duplicate**, or **Intentional** after code review only (no PoC needed) may be listed in **`SUMMARY.md`** without a subdirectory unless the user or team wants a paper trail - then still write **`issue.md`** with the appropriate verdict.

### `impact.md` (optional)

Create **`impact.md`** when review can name **specific, reproducible data patterns** that would indicate abuse (table/column changes, suspicious rows, correlation across tenants, request logs with fingerprints, etc.). Tie queries to the **actual code path and schema** you traced (Sequelize models, not migrations; see `AGENTS.md`).

**Include in `impact.md`:**

1. **Purpose** - What "exploited" means in observable terms for this finding (one short paragraph).
2. **Assumptions** - Which tables/entities, time window, and limits of detection (false positives, missed edge cases).
3. **Queries** - Numbered list of **specific** queries. Prefer PostgreSQL `SELECT` (and safe read-only aggregations). If a check needs application or log search instead of SQL, say the source and give **exact** filter strings or fields where possible.
4. **How to interpret** - What rows or counts would support vs undermine an exploitation hypothesis.
5. **Safety and policy** - Production access follows internal ops policy; queries should be **read-only**; recommend review with someone who can run production DB or log queries; never paste real production secrets or credentials into the issue folder.

Do **not** duplicate the full engineering narrative from `issue.md`; keep `impact.md` narrowly focused on **post-review forensic evaluation**.

## Severity classification (quick reference)

- CVSS3 score >= 9: severity high
- CVSS3 score >= 8: severity medium
- CVSS3 score >= 7: severity low

(Use full CVSS reasoning in each finding's **`issue.md`**; these bands are a shorthand only.)

### CVSS severity table (for scoring)

| Severity | Range    | Typical findings                                             |
| -------- | -------- | ------------------------------------------------------------ |
| Critical | 9.0–10.0 | Auth bypass, RCE, SQLi, payment fraud, credential theft      |
| High     | 7.0–8.9  | IDOR, webhook forgery, privilege escalation, mass assignment |
| Medium   | 4.0–6.9  | Info disclosure, weak rate limits, missing input validation  |
| Low      | 0.1–3.9  | Hardening opportunities, minor config issues                 |

When uncertain, use midpoint: Critical → 9.5, High → 7.5, Medium → 5.5, Low → 2.0.

## Known safe patterns (do not flag)

Based on prior audits of the Open Collective codebase, the following are **intentional**:

- **GraphQL introspection enabled** - API is public; introspection is on purpose.
- **Permissive CORS** - API is public; CORS is intentionally permissive.
- **Webhook signature verification** - Stripe, PayPal, and Transferwise already verify signatures; `rawBody` is set for `/webhooks` routes in `express.ts`. Idempotency handled via existing transaction lookups.
- **SQL parameterization** - `queries.js`, `sql-search.ts`, and Kysely collection queries already use parameterized queries.
- **Authorization hooks** - `ExpenseMutations`, `OrderMutations`, `PayoutMethodMutations` already perform permission checks; `security/expense.ts` and `security/order.ts` implement fraud checks.
- **GraphQL Armor** - Apollo Armor enforces depth, cost, token, and alias limits globally; rate limiting applies to all GraphQL endpoints.

`AGENTS.md` documents additional intentional security postures. Do not treat those as vulnerabilities when reviewing.

## Internal workspace context

Review outputs under `/workspace/priv/security-issues/` are sensitive; do not commit unless the user explicitly wants them versioned.

## Output structure for the user

**Review directory:** Full path to `/workspace/priv/security-issues/<unique-folder>/`.

**Files:** Always **`SUMMARY.md`**; per finding (when documented) **`issue.md`**, and when applicable **`plan.md`** and **`impact.md`**, plus PoC artifacts in that finding's subdirectory when confirming.

**In-chat summary** (brief; full detail lives in the markdown files):

1. **Scope** - What was reviewed (feature/PR/files).
2. **Findings** - Count by verdict (Confirmed / Provisional / Invalid / etc.); list finding slugs.
3. **Evidence** - What was checked (code, local/staging repro). For each **Confirmed** finding: PoC path, command run, and outcome.
4. **Impact** - Who is affected for the highest-severity confirmed or provisional items; payment/ledger/permission sensitivities if relevant.
5. **Suggested severity** - Per confirmed/provisional finding; call out the worst.
6. **Fix plan** - Pointer or bullets; full steps in each finding's **`plan.md`** when created.
7. **Paths** - Full path to the review folder; which finding subdirectories exist; which of **`issue.md`** / **`plan.md`** / **`impact.md`** were written; where PoC artifacts live.

## Checklist reference

See `references/checklist.md` for detailed, actionable checks organized by category:
authentication, authorization, GraphQL, SQL/DB, input validation, file uploads,
webhooks, payments, frontend, cryptography, rate limiting, logging, and business logic.
