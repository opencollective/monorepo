# Shared security triage (Open Collective)

Used by `security-investigate-report` and `security-investigate-issue`. Read this file when either skill references it.

## Issue folder

Create a **new unique directory** under `/workspace/priv/security-issues/<unique-folder>/`.

- Name: `YYYY-MM-DD-<kebab-case-short-slug>` (e.g. `2026-04-20-expense-idor-preview`). If taken, append `-2`, `-3`, …
- **All** outputs for the run (markdown, PoC, logs) go in this folder only.
- Create the folder **after** the **Known issue check** (full triage) or **when a known match is found** (minimal write-up only). No PoC or full triage artifacts until the check clears.
- Do not commit unless the user explicitly wants them versioned. Do not commit `priv/security-audit/` either (see `AGENTS.md`).

## Known issue check (required before full triage)

**Before** the issue folder (except minimal artifacts on a match), PoC, or full code investigation, search **both** sources below. Read GitHub MCP tool schemas before calling (`search_issues`, `issue_read`).

### 1. Local triage archive (`priv/security-issues`)

Search `/workspace/priv/security-issues/` for prior runs of the **same finding** (not merely shared keywords).

**How to search:**

- List folder names; match distinctive slugs (mutation names, endpoints, vuln class).
- Grep `issue.md`, `reply.md`, and `SUMMARY.md` under that tree for distinctive terms, report/reference IDs, and code paths.
- Read the top of promising `issue.md` / `reply.md` files (title, summary, verdict) before deciding.

**Match confidence:** Same code path or missing control as an existing folder — e.g. same mutation/resolver bypass, not two unrelated IDORs that share "GraphQL". A folder whose verdict is **Duplicate** still counts if it points at the canonical prior triage.

**Local match →** Treat as duplicate. Cite the existing folder path (e.g. `priv/security-issues/2026-06-02-order-fromaccount-private-leak/`) and, when present in that folder's write-up, any linked `opencollective-security` issue. Skip full triage (see **Match found** below).

### 2. GitHub (`opencollective-security`)

Search [opencollective-security](https://github.com/opencollective/opencollective-security/issues) via **GitHub MCP** (`user-github`).

**If MCP unavailable:** Require enablement or explicit user confirmation that no matching issue exists. Do not skip to full triage without that.

**Search:** From the finding, extract terms (vuln class, service, endpoint/mutation, paths, distinctive phrases). Run **multiple** `search_issues` queries (`owner`: `opencollective`, `repo`: `opencollective-security`); include open **and** closed issues (fixed-but-documented still counts). Compare candidates with **high confidence** (same code path or missing control, not shared keywords). If a report or reference ID was supplied, search issue bodies for it too.

Also check whether a confident GitHub match already has a folder under `priv/security-issues` (cross-link in the duplicate write-up when both exist).

### Match found → stop full triage

- No repro deep-dive, PoC, fix plan, bounty work, or new tracking issue draft.
- Create issue folder; write **minimal artifacts only** (per invoking skill):
  - **Report skill:** `reply.md` only (Known issue / duplicate template).
  - **Internal skill:** `issue.md` only (verdict **Duplicate**, link to existing issue and/or prior `priv/security-issues` folder, search summary).
- In-chat: verdict **Duplicate / known issue**; existing GitHub issue URL/number and status when applicable; prior triage folder path when applicable; search summary; folder path and file written.
- Optionally offer `add_issue_comment` on the existing GitHub issue if the user wants.
- **Do not** add a row to [`security/memory.md`](../../../security/memory.md) on the duplicate path (the canonical entry should already be there).

### No match →

Brief search summary (both local archive and GitHub), then **Core triage workflow** below.

## Core triage workflow

1. **Parse** - Service (API, frontend, PDF, REST, images), endpoints/files, auth prerequisites, repro steps, claimed impact, any PoC. Use OWASP cheat sheets per **`AGENTS.md`** (Context7: `/owasp/cheatsheetseries` if available). Start with [Secure Code Review](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html) for framing.
2. **Reproduce or disprove** - Prefer local or staging. Trace code; confirm or refute with evidence (request/response, code citation, test). Production testing on `https://opencollective.com` is not a safe PoC environment (report triage: also out of scope for bounty acceptance per [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md)).
3. **Full confirmation requires a minimal PoC** - Do **not** label **fully confirmed** until you **implement** and **run** a minimal PoC in the issue folder (`poc/` or `poc.*`). Demonstrate security-relevant behavior only. Document how to run it (`README.md` or PoC header); capture command output in the primary write-up. If a PoC is infeasible (secrets, environment, safety, production-only repro), use **provisional** / **not fully confirmed** and explain why.
4. **Classify** - Valid / invalid / intentional-won't-fix / duplicate. Respect `AGENTS.md` intentional postures (public GraphQL introspection, permissive API CORS are not defects). Reserve **fully confirmed** for step 3 (or document why confirmation is impossible).
5. **Severity** - Worst realistic exploitation; CVSS3-style reasoning. OC amplifiers: auth, payment methods/connected accounts, ledger integrity/history, permission system. Map to bands: CVSS ≥9 → High, ≥8 → Medium, ≥7 → Low (full reasoning in write-ups).
6. **Fix plan** - Minimal ordered steps: patch location, tests, schema/migration impacts, rollout. Match repo patterns. Write **`plan.md`** when there is something to build (skip for clear invalid/duplicate/out-of-scope).

**Do not** run production impact analysis or write **`impact.md`** during core triage. That is an **end-of-triage offer** only (see invoking skill). In write-ups, describe claimed or theoretical impact in **`issue.md`** / **`reply.md`**; reserve **`impact.md`** for forensic production-evaluation queries after the user accepts.

## `impact.md` (on user acceptance only)

Write only when the user accepts the **production impact analysis** offer at the end of triage (do not create by default). Use when triage can name **specific, reproducible data patterns** indicating abuse. Tie queries to traced schema (Sequelize models, not migrations; see `AGENTS.md`). Keep forensic focus; do not duplicate the main engineering narrative.

1. **Purpose** - What "exploited" means in observable terms.
2. **Assumptions** - Tables/entities, time window, detection limits.
3. **Queries** - Numbered read-only checks. Prefer PostgreSQL `SELECT`. For logs, name source and exact filters.
4. **How to interpret** - What supports vs undermines exploitation.
5. **Safety** - Read-only; internal ops policy; no production secrets in the folder.

Skip when there is nothing concrete to query (no durable audit trail, purely client-side, no DB/log signature).

## `plan.md`

When applicable: ordered fix plan (patch, tests, migrations/schema, rollout, owner notes).

## Security memory (`security/memory.md`)

After **full triage** (not on the duplicate / known-issue short path), update [`/workspace/security/memory.md`](../../../security/memory.md) so the long-term index stays current.

**Skip when:** Verdict is **Duplicate** (local or GitHub) — the canonical row should already exist.

**Add or update one table row per distinct finding** (not per artifact file):

| Column   | Source |
| -------- | ------ |
| **Date** | Folder date prefix (`YYYY-MM-DD-…`) or triage date |
| **Title** | `issue.md` H1, or concise title from `reply.md` / triage summary |
| **Bounty** | Amount paid (e.g. `$120`), recommended band when pending (e.g. `$300` with note in triage only), or **—** when none |

**Reporter grouping:**

- **Report triage:** Section `## <Name> (<email>)` from the report; create the section if missing. Use the reporter's preferred name when known.
- **Internal triage:** Section `## Internal` unless the user supplied a named contact; optional `(<email>)` on the heading.

**Ordering:** Keep sections alphabetically by reporter name (`Internal` sorts with other headings). Within each table, append new rows in chronological order.

**Idempotency:** If the same finding (same title and date) is already listed, update the **Bounty** cell when new payment info is known; do not duplicate the row.

Record the memory update in the in-chat summary (reporter section and title added or bounty updated).
