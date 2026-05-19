---
name: security-investigate-issue
description: Triages an internally reported security concern for Open Collective codebases (engineering, ops, or security team) - validates reproducibility and impact, asserts the finding with a clear confidence level, and proposes a fix plan when applicable. Writes artifacts under `/workspace/priv/security-issues/<unique-folder>/` including `issue.md` (assertion and verdict), optional `plan.md` when there is a fix to plan, optional `impact.md` with production evaluation queries when forensic traces exist, plus a minimal runnable PoC for full confirmation. No external researcher reply or bounty policy. Use when the user describes an internal finding, asks to validate a suspected vulnerability from the team, or wants an engineering handoff without security@ or bounty workflow.
---

# Security issue investigation - internal (Open Collective)

Triages findings raised inside the org (engineering, ops, security). Scope is assertion, evidence, optional fix plan, and optional production-impact queries.

## Issue folder (required first step)

Create a **new unique directory** for this triage under the workspace:

`/workspace/priv/security-issues/<unique-folder>/`

Use a name that is unique and sortable, for example `YYYY-MM-DD-<kebab-case-short-slug>` (e.g. `2026-04-22-internal-expense-idor-preview`). If that path already exists, append a suffix (`-2`, `-3`, …) until unused. **All** skill outputs for this run (markdown files, PoC code, logs) go inside this folder only.

## Internal reference ID (optional)

If the user provides an **internal ticket ID** (Linear, Jira, GitHub security discussion, incident number, etc.), capture it at the start and repeat it in **`issue.md`** (e.g. a **Reference:** line near the top). Do not invent an ID.

## Workflow

**Prerequisite:** Create the issue directory under `/workspace/priv/security-issues/` per **Issue folder** before adding PoC code or markdown files.

1. **Parse the report** - Affected service (API, frontend, PDF, REST, images), endpoints or files, prerequisites (auth role, tenant), steps to reproduce, claimed impact, any PoC. **Note any internal reference ID** (see **Internal reference ID**).
2. **Reproduce or disprove** - Prefer local or staging. Trace code paths in the relevant repo; confirm or refute the claim with evidence (request/response, code citation, test). Treat production-only testing on `https://opencollective.com` as **evidence of behavior**, not as a substitute for a safe repro environment when building a PoC.
3. **Full confirmation requires a minimal PoC** - Do **not** treat an issue as **fully confirmed** until you **implement** a **minimal** proof-of-concept in the issue folder (e.g. `poc/` subdirectory, or `poc.ts` / `poc.js` / `poc.sh` as appropriate) and **run** it successfully against a permitted environment (local dev stack, test suite, or staging). The PoC must demonstrate the security-relevant behavior (not a full exploit chain unless necessary). Record how to run it in a short `README.md` inside the issue folder or at the top of the PoC file, and capture key command output (or test pass/fail) in **`issue.md`** as evidence. If a runnable PoC is **not** feasible (missing secrets, environment unavailable, or legal/safety constraints), state **not fully confirmed** or **provisional** with reasons; do **not** label the assertion **Confirmed** in that case.
4. **Classify** - Valid issue vs invalid vs intentional/won't fix vs duplicate. Note alignment with product/security expectations and `AGENTS.md` intentional postures (e.g. public GraphQL introspection, permissive API CORS are not defects). Reserve **fully confirmed** for cases that passed the PoC bar in step 3 (or document why confirmation is impossible).
5. **Severity** - Worst realistic exploitation; use CVSS3-style reasoning. Consider OC-specific sensitivities: auth, payment methods or connected accounts, ledger integrity/history, permission system.
6. **Fix plan** - Minimal, ordered steps: where to patch, tests to add, schema or migration impacts if any, rollout or backport notes. Match existing patterns in the touched repo. Capture the full plan in **`plan.md`** when applicable (see **Output files**).
7. **Optional production impact** - If durable traces exist (DB rows, auditable relationships, log fingerprints), write **`impact.md`** with read-only queries or log filters (see **`impact.md` (optional)** under **Output files**).

## Output files

Write **only** under the issue directory created in **Issue folder**:

`/workspace/priv/security-issues/<unique-folder>/`

Use the exact markdown basenames below. **PoC code** lives in the same directory, typically under `poc/` or as `poc.*` at the root of that folder; it is required for **full confirmation** (see workflow step 3), not optional when you claim confirmed.

| File        | When                                                                                                                                                             | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue.md`  | **Always**                                                                                                                                                       | **Assertion document:** internal reference ID (if any), title suggestion, summary of the claim, **verdict** (Confirmed / Provisional / Invalid / Duplicate / Intentional / Unclear) with reasoning, impact, affected components, code references, **pointer to PoC path and how it was run** (or why PoC was not run), suggested severity, and recommended next steps for engineering. One canonical internal write-up (no separate external reply). |
| `plan.md`   | **When there is a fix to plan** (typically confirmed or high-confidence provisional issues; omit for clear invalid/duplicate/out-of-scope with nothing to build) | Ordered fix plan: where to patch, tests, migrations/schema, rollout, owner notes.                                                                                                                                                                                                                                                                                                                                                                    |
| `impact.md` | **When exploitation would leave queryable traces**                                                                                                               | **Production evaluation queries:** read-only checks an operator can run to assess **whether the issue was exploited in the wild**. Follow the **`impact.md` (optional)** subsection below (purpose, assumptions, queries, interpretation, safety). Omit when there is nothing concrete to query.                                                                                                                                                     |

### `impact.md` (optional)

Create **`impact.md`** when triage can name **specific, reproducible data patterns** that would indicate abuse (table/column changes, suspicious rows, correlation across tenants, request logs with fingerprints, etc.). Tie queries to the **actual code path and schema** you traced (Sequelize models, not migrations; see `AGENTS.md`).

**Include in `impact.md`:**

1. **Purpose** - What "exploited" means in observable terms for this finding (one short paragraph).
2. **Assumptions** - Which tables/entities, time window, and limits of detection (false positives, missed edge cases).
3. **Queries** - Numbered list of **specific** queries. Prefer PostgreSQL `SELECT` (and safe read-only aggregations). If a check needs application or log search instead of SQL, say the source and give **exact** filter strings or fields where possible.
4. **How to interpret** - What rows or counts would support vs undermine an exploitation hypothesis.
5. **Safety and policy** - Production access follows internal ops policy; queries should be **read-only**; recommend review with someone who can run production DB or log queries; never paste real production secrets or credentials into the issue folder.

Do **not** duplicate the full engineering narrative from `issue.md`; keep `impact.md` narrowly focused on **post-triage forensic evaluation**.

## Severity classification (quick reference)

- CVSS3 score >= 9: severity high
- CVSS3 score >= 8: severity medium
- CVSS3 score >= 7: severity low

(Use full CVSS reasoning in **`issue.md`**; these bands are a shorthand only.)

## Internal workspace context

`AGENTS.md` documents intentional security postures. Do not treat those as vulnerabilities when triaging.

Triage outputs under `/workspace/priv/security-issues/` are sensitive; do not commit unless the user explicitly wants them versioned.

## Output structure for the user

**Issue directory:** Full path to `/workspace/priv/security-issues/<unique-folder>/`.

**Files:** Always **`issue.md`**; when applicable **`plan.md`** and **`impact.md`**; plus PoC artifacts in that same directory when confirming.

**In-chat summary** (brief; full detail lives in the markdown files):

1. **Verdict** - Confirmed / Provisional / Invalid / Duplicate / Intentional / Unclear (with reason).
2. **Evidence** - What was checked (code, local/staging repro). If confirmed: PoC path, command run, and outcome.
3. **Impact** - Who is affected, confidentiality / integrity / availability, payment/ledger/permission sensitivities if relevant.
4. **Suggested severity** - Low / Medium / High / Critical with short justification.
5. **Fix plan** - Pointer or bullets; full steps in **`plan.md`** when created.
6. **Paths** - Full path to the issue folder; which of **`issue.md`** / **`plan.md`** / **`impact.md`** were written; where PoC lives (if any).
