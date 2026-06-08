# Shared security triage (Open Collective)

Used by `security-investigate-report` and `security-investigate-issue`. Read this file when either skill references it.

## Issue folder

Create a **new unique directory** under `/workspace/priv/security-issues/<unique-folder>/`.

- Name: `YYYY-MM-DD-<kebab-case-short-slug>` (e.g. `2026-04-20-expense-idor-preview`). If taken, append `-2`, `-3`, …
- **All** outputs for the run (markdown, PoC, logs) go in this folder only.
- Create the folder **after** the **Known issue check** (full triage) or **when a known match is found** (minimal write-up only). No PoC or full triage artifacts until the check clears.
- Do not commit unless the user explicitly wants them versioned. Do not commit `priv/security-audit/` either (see `AGENTS.md`).

## Known issue check (required before full triage)

**Before** the issue folder (except minimal artifacts on a match), PoC, or full code investigation, search [opencollective-security](https://github.com/opencollective/opencollective-security/issues) via **GitHub MCP** (`user-github`). Read tool schemas before calling (`search_issues`, `issue_read`).

**If MCP unavailable:** Require enablement or explicit user confirmation that no matching issue exists. Do not skip to full triage without that.

**Search:** From the finding, extract terms (vuln class, service, endpoint/mutation, paths, distinctive phrases). Run **multiple** `search_issues` queries (`owner`: `opencollective`, `repo`: `opencollective-security`); include open **and** closed issues (fixed-but-documented still counts). Compare candidates with **high confidence** (same code path or missing control, not shared keywords). If a report or reference ID was supplied, search issue bodies for it too.

**Match found → stop full triage**

- No repro deep-dive, PoC, fix plan, bounty work, or new tracking issue draft.
- Create issue folder; write **minimal artifacts only** (per invoking skill):
  - **Report skill:** `reply.md` only (Known issue / duplicate template).
  - **Internal skill:** `issue.md` only (verdict **Duplicate**, link to existing issue, search summary).
- In-chat: verdict **Duplicate / known issue**; existing issue URL/number and status; search summary; folder path and file written.
- Optionally offer `add_issue_comment` on the existing issue if the user wants.

**No match →** Brief search summary, then **Core triage workflow** below.

## Core triage workflow

1. **Parse** - Service (API, frontend, PDF, REST, images), endpoints/files, auth prerequisites, repro steps, claimed impact, any PoC. Use OWASP cheat sheets per **`AGENTS.md`** (Context7: `/owasp/cheatsheetseries` if available). Start with [Secure Code Review](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html) for framing.
2. **Reproduce or disprove** - Prefer local or staging. Trace code; confirm or refute with evidence (request/response, code citation, test). Production testing on `https://opencollective.com` is not a safe PoC environment (report triage: also out of scope for bounty acceptance per [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md)).
3. **Full confirmation requires a minimal PoC** - Do **not** label **fully confirmed** until you **implement** and **run** a minimal PoC in the issue folder (`poc/` or `poc.*`). Demonstrate security-relevant behavior only. Document how to run it (`README.md` or PoC header); capture command output in the primary write-up. If a PoC is infeasible (secrets, environment, safety, production-only repro), use **provisional** / **not fully confirmed** and explain why.
4. **Classify** - Valid / invalid / intentional-won't-fix / duplicate. Respect `AGENTS.md` intentional postures (public GraphQL introspection, permissive API CORS are not defects). Reserve **fully confirmed** for step 3 (or document why confirmation is impossible).
5. **Severity** - Worst realistic exploitation; CVSS3-style reasoning. OC amplifiers: auth, payment methods/connected accounts, ledger integrity/history, permission system. Map to bands: CVSS ≥9 → High, ≥8 → Medium, ≥7 → Low (full reasoning in write-ups).
6. **Fix plan** - Minimal ordered steps: patch location, tests, schema/migration impacts, rollout. Match repo patterns. Write **`plan.md`** when there is something to build (skip for clear invalid/duplicate/out-of-scope).
7. **Production impact (optional)** - If abuse leaves queryable traces, write **`impact.md`** per section below.

## `impact.md` (optional)

When triage can name **specific, reproducible data patterns** indicating abuse. Tie queries to traced schema (Sequelize models, not migrations; see `AGENTS.md`). Keep forensic focus; do not duplicate the main engineering narrative.

1. **Purpose** - What "exploited" means in observable terms.
2. **Assumptions** - Tables/entities, time window, detection limits.
3. **Queries** - Numbered read-only checks. Prefer PostgreSQL `SELECT`. For logs, name source and exact filters.
4. **How to interpret** - What supports vs undermines exploitation.
5. **Safety** - Read-only; internal ops policy; no production secrets in the folder.

Skip when there is nothing concrete to query (no durable audit trail, purely client-side, no DB/log signature).

## `plan.md`

When applicable: ordered fix plan (patch, tests, migrations/schema, rollout, owner notes).
