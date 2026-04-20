---
name: security-investigate-report
description: Triages an incoming security report for Open Collective codebases - validates reproducibility and impact, maps to official bounty policy, proposes fixes, and drafts contributor replies. Writes artifacts under `/workspace/priv/security-issues/<unique-folder>/` including up to three core markdown files (`reply.md`, optional `issue.md` when fully confirmed, optional `plan.md` when there is a fix to plan), optional `impact.md` with production evaluation queries when forensic traces exist, plus a minimal runnable PoC for full confirmation. Use when the user pastes or describes a security report, asks to investigate a vulnerability, assess bounty eligibility, or draft a response to security@opencollective.com reporters.
---

# Security report investigation (Open Collective)

Canonical policy: [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md). Use it for eligibility, scope, qualifying vs non-qualifying issues, rewards table, and contact rules. This skill does not replace human sign-off on bounties or payouts.

## Issue folder (required first step)

Create a **new unique directory** for this triage under the workspace:

`/workspace/priv/security-issues/<unique-folder>/`

Use a name that is unique and sortable, for example `YYYY-MM-DD-<kebab-case-short-slug>` (e.g. `2026-04-20-expense-idor-preview`). If that path already exists, append a suffix (`-2`, `-3`, …) until unused. **All** skill outputs for this run (markdown files, PoC code, logs) go inside this folder only.

## Report ID (when provided)

Sometimes the user or the original thread already includes a **security report ID** (ticket reference, email subject id, internal code, etc.). **Capture it at the start** of triage and reuse it consistently:

- **`reply.md`:** If the finding is **eligible for a bounty** (or you discuss payment / expense submission), **include the actual report ID** in the email body (e.g. next to expense instructions). If no ID was ever provided, use the placeholder **`__SECURITY_REPORT_ID__`** and note that the reporter must replace it per team process.
- **`issue.md`:** When you write an internal GitHub issue for a **fully confirmed** finding, **include the same report ID** in the body (e.g. a **Report ID:** line near the top) so internal tracking links to the original report. If no ID exists, write that none was supplied or use `__SECURITY_REPORT_ID__` if the team will assign one later. The issue title should not be the PR/commit title, but a concise description of the finding.

Do not invent an ID; only use what was given or the agreed placeholder.

## Workflow

**Prerequisite:** Create the issue directory under `/workspace/priv/security-issues/` per **Issue folder** before adding PoC code or markdown files.

1. **Parse the report** - Affected service (API, frontend, PDF, REST, images), endpoints or files, prerequisites (auth role, tenant), steps to reproduce, claimed impact, any PoC. **Note any report ID** already provided (see **Report ID**).
2. **Reproduce or disprove** - Prefer local or staging per policy (production testing on `https://opencollective.com` is out of scope for acceptance). Trace code paths in the relevant repo; confirm or refute the claim with evidence (request/response, code citation, test).
3. **Full confirmation requires a minimal PoC** - Do **not** treat an issue as **fully confirmed** until you **implement** a **minimal** proof-of-concept in the issue folder (e.g. `poc/` subdirectory, or `poc.ts` / `poc.js` / `poc.sh` as appropriate) and **run** it successfully against a permitted environment (local dev stack, test suite, or staging per SECURITY.md). The PoC must demonstrate the security-relevant behavior (not a full exploit chain unless necessary). Record how to run it in a short `README.md` inside the issue folder or at the top of the PoC file, and capture key command output (or test pass/fail) in `issue.md` and/or `reply.md` as evidence. If a runnable PoC is **not** feasible (missing secrets, environment unavailable, legal/safety constraints, or only reproducible on production), state **not fully confirmed** or **provisional** with reasons; do **not** use **Confirmed** / write `issue.md` as a confirmed finding in that case.
4. **Classify** - Valid issue vs invalid vs intentional/won't fix vs duplicate. Note alignment with **Qualifying** and **Non-qualifying** lists in SECURITY.md. Reserve **fully confirmed** for cases that passed the PoC bar in step 3 (or document why confirmation is impossible).
5. **Severity** - Worst realistic exploitation; use CVSS3-style reasoning. SECURITY.md lists OC-specific amplifiers: auth, payment methods or connected accounts, ledger integrity/history, permission system.
6. **Fix plan** - Minimal, ordered steps: where to patch, tests to add, schema or migration impacts if any, rollout or backport notes. Match existing patterns in the touched repo. Capture the full plan in `plan.md` when applicable (see **Output files**).
7. **Contributor reply** - Tone professional, thanks the reporter, states outcome clearly. See templates below. Capture the full paste-ready text in `reply.md`. If bounty or expense is discussed, apply **Report ID** (real ID or placeholder).
8. **Policy compliance** (only if issue is **fully confirmed** and bounty may apply) - Walk through **Eligibility and Responsible Disclosure** and **Scope** in SECURITY.md. Flag gaps (e.g. missing required sentence in original email, production-only testing, unvalidated scanner output, hypothetical without PoC). State whether bounty is **recommended**, **not eligible**, or **needs more info**; do not promise payment.
9. **Bounty recommendation** - If eligible, map to **Rewards** table by project type and suggest Low / Medium / High / Critical with dollar range from policy. Mention sanctions / payment-processor limitations from SECURITY.md if relevant. For payment instructions, tell the reporter to submit an expense at `https://opencollective.com/ofitech/expenses/new` and include the **report ID** in the expense description: use the **actual ID** if one was provided at the start; otherwise **`__SECURITY_REPORT_ID__`** (reporter or team replaces placeholder). See **Report ID**.
10. **Internal issue draft** - If the finding is **fully confirmed** (step 3), write `issue.md` with GitHub issue body content for internal tracking (see **Output files** and **Report ID**).
11. **Production impact evaluation (optional)** - If durable traces exist (DB rows, auditable relationships, log fingerprints), write `impact.md` with **specific read-only queries or log filters** operators can use in production to assess in-the-wild exploitation (see **`impact.md` (optional)** under **Output files**). Skip when there is nothing actionable to query.

## Output files (three core markdown files, optional `impact.md`, plus PoC artifacts)

Write **only** under the issue directory created in **Issue folder**:

`/workspace/priv/security-issues/<unique-folder>/`

Use the exact markdown basenames below. **PoC code** (scripts, small test file, `curl` recipe, etc.) lives in the same directory, typically under `poc/` or as `poc.*` at the root of that folder; it is required for **full confirmation** (see workflow step 3), not optional when you claim confirmed.

| File        | When                                                                                                                                                              | Contents                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reply.md`  | **Always**                                                                                                                                                        | Full text of the reply for the researcher (same substance as the former "Draft email" section: professional tone, verdict, thanks, bounty/expense wording when applicable). Paste-ready. If not fully confirmed, say so clearly (e.g. provisional, could not run PoC). **If bounty-related:** include the **report ID** when one was provided (see **Report ID**). |
| `issue.md`  | **If the issue is fully confirmed** (minimal PoC implemented and run successfully in step 3)                                                                      | Body text for a GitHub issue on your internal repo: **report ID** (if any), title suggestion, summary, impact, affected components, references to code, **pointer to PoC path and how it was run**, severity, labels/hints if useful. No duplicate of the full email; focus on documentation and engineering handoff.                                              |
| `plan.md`   | **When there is a fix to plan** (typically fully confirmed issues; omit for clear invalid/duplicate/out-of-scope with nothing to build)                           | Ordered fix plan: where to patch, tests, migrations/schema, rollout, owner notes. Match the **Fix plan** workflow step.                                                                                                                                                                                                                                            |
| `impact.md` | **When exploitation would leave queryable traces** (often when `issue.md` exists, but also for high-confidence provisional findings if operators need indicators) | **Production evaluation queries:** read-only checks an operator can run against production data (or production-equivalent read replicas) to assess **whether the issue was exploited in the wild**. Omit when there is nothing concrete to query (e.g. no durable audit trail, purely client-side issue, or only hypothetical abuse with no DB or log signature).  |

If a markdown file does not apply, skip it. Do not create empty placeholder files.

### `impact.md` (optional)

Create **`impact.md`** when triage can name **specific, reproducible data patterns** that would indicate abuse (table/column changes, suspicious rows, correlation across tenants, request logs with fingerprints, etc.). Tie queries to the **actual code path and schema** you traced (Sequelize models, not migrations; see `AGENTS.md`).

**Include in `impact.md`:**

1. **Purpose** - What "exploited" means in observable terms for this finding (one short paragraph).
2. **Assumptions** - Which tables/entities, time window (e.g. since first vulnerable deploy if known), and limits of detection (false positives, missed edge cases).
3. **Queries** - Numbered list of **specific** queries. Prefer PostgreSQL `SELECT` (and safe read-only aggregations). One query per step or question; include identifiers/joins the operator needs (e.g. `CollectiveId`, `UserId`, expense/vendor/payout IDs as applicable). If a check needs application or log search instead of SQL, say the source (e.g. CloudWatch, Sentry, webhook logs) and give **exact** filter strings or fields where possible.
4. **How to interpret** - What rows or counts would support vs undermine an exploitation hypothesis.
5. **Safety and policy** - Note that production access follows internal ops policy; queries should be **read-only**; recommend review with someone who can run production DB or log queries; never paste real production secrets or credentials into the issue folder.

Do **not** put `impact.md` content that belongs in `issue.md` (product/engineering summary); keep `impact.md` narrowly focused on **post-triage forensic evaluation**.

## Contributor reply templates

Adapt wording; keep accurate and kind.

**Invalid / non-issue / duplicate**

- Thank them; briefly state conclusion (cannot reproduce, not a security defect, duplicate of internal tracking, out of scope per SECURITY.md, or matches a **Non-qualifying** category with short rationale).
- If helpful, point to docs or safe alternatives (e.g. use staging URLs from SECURITY.md for future tests).
- No bounty language unless you are also acknowledging a separate valid finding.

**Fully confirmed issue** (only after minimal PoC implemented and run per workflow step 3)

- Thank them; confirm validation with a minimal PoC you ran in a permitted environment (avoid exploit details in email if still undisclosed).
- Summarize next steps (fix in progress, timeline if known, invitation to verify after patch).
- **Policy check** - If all eligibility rules appear met, state that the report is eligible for consideration under the bounty program per SECURITY.md and give the **suggested severity tier and reward band** from the table. If something is uncertain (first reporter, 72-hour rule, AI-generated report review), say what you still need verified.
- **Expense** - Include: submit expense at `https://opencollective.com/ofitech/expenses/new` with the **report ID** in the expense description (use the **real ID** if the triage started with one; otherwise **`__SECURITY_REPORT_ID__`**) or as instructed by the team.

## Quick reference from SECURITY.md

- **Required for reports** - Clear description, repro steps, PoC when needed; message must include: `I have read and accepted the Security Policy of Open Collective.` Non-compliant reports may be ignored.
- **Scope** - No bounty acceptance for testing done on production `https://opencollective.com`; prefer local repos; staging hosts listed in SECURITY.md.
- **Qualifying** - Includes RCE, LFI/RFI/XXE/SSRF/XSPA, injections, XSS, CSRF with real impact, open redirect, auth/session flaws, IDOR, impactful CORS, privilege escalation, SQLi (see full list in SECURITY.md).
- **Non-qualifying** - Includes many scanner-only findings, pure information disclosure, missing headers without direct vuln, hypothetical without PoC, rate limits, DoS, etc. (see full list in SECURITY.md).

## Severity classification

- CVSS3 score >= 9: severity high
- CVSS3 score >= 8: severity medium
- CVSS3 score >= 7: severity low

## Internal workspace context

`AGENTS.md` documents intentional security postures (e.g. public GraphQL introspection, permissive API CORS). Do not treat those as vulnerabilities when triaging.

Security audit findings under `priv/security-audit/` must **not** be committed (per `AGENTS.md`). Triage outputs under `/workspace/priv/security-issues/` (issue folders, PoC code, replies) are similarly sensitive; do not commit unless the user explicitly wants them versioned. This skill is for **incoming contributor reports**, not for publishing audit files.

## Output structure for the user

**Issue directory:** Full path to `/workspace/priv/security-issues/<unique-folder>/` (the folder created for this run).

**Files:** Produce `reply.md`, and when applicable `issue.md`, `plan.md`, and `impact.md`, per **Output files** above; plus PoC artifacts in that same directory when confirming.

**In-chat summary** (brief; full detail lives in the markdown files where relevant):

1. **Verdict** - Valid / Invalid / Unclear / Duplicate / Provisional (not fully confirmed) (with reason).
2. **Evidence** - What was checked (code, local/staging repro, logs). If fully confirmed: PoC path, command run, and outcome.
3. **Impact** - Who is affected, confidentiality / integrity / availability, OC-specific sensitivities (payments, ledger, permissions).
4. **Suggested severity** - Low / Medium / High / Critical with short justification.
5. **Fix plan** - Pointer or bullets; full steps go in `plan.md` when that file is created.
6. **Bounty** - Eligible or not; if eligible, project row and amount band; compliance notes; expense URL; **report ID** used or note that none was provided.
7. **Paths** - Full path to the issue folder; which of `reply.md` / `issue.md` / `plan.md` / `impact.md` were written; where PoC lives (if any).
