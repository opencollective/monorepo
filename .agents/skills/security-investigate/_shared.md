# Shared security triage (Open Collective)

Used by `security-investigate-report` and `security-investigate-issue`. Read this file when either skill references it.

## Issue folder

Create a **new unique directory** under `opencollective-security/internal/<unique-folder>/` (security repo checkout: `opencollective-security/` or `/workspace/opencollective-security`).

- Name: `YYYY-MM-DD-<kebab-case-short-slug>` (e.g. `2026-04-20-expense-idor-preview`). If taken, append `-2`, `-3`, …
- **All** outputs for the run (markdown, PoC, logs) go in this folder only. Tree and file roles follow `opencollective-security/internal/README.md`.
- Create the folder **after** the **Known issue check** (full triage) or **when a known match is found** (minimal write-up only). No PoC or full triage artifacts until the check clears.
- If the security repo is not checked out, **stop** and ask the user to check it out. Do not write triage folders under monorepo `priv/` and do not commit triage artifacts into OSS product repos. Commit the folder in the security repo when appropriate.

## Known issue check (required before full triage)

**Before** the issue folder (except minimal artifacts on a match), PoC, or full code investigation, search **both** sources below. Read the GitHub MCP tool schemas before calling.

### 1. Security-repo triage archive (`internal/`, `reports/`, index)

Search the security repo checkout for prior runs of the **same finding** (not merely shared keywords).

**How to search:**

- Prefer `harness/index.json` by exact fingerprint, then GitHub issues (section 2 below), then grep `internal/**` and `reports/**` for fingerprints and distinctive terms in `issue.md` / `reply.md`.
- List `internal/` folder names; match distinctive slugs (mutation names, endpoints, vuln class).
- Read the top of promising `issue.md` / `reply.md` files (title, summary, verdict) before deciding.

**Match confidence:** Same code path or missing control as an existing folder — e.g. same mutation/resolver bypass, not two unrelated IDORs that share "GraphQL". A folder whose verdict is **Duplicate** still counts if it points at the canonical prior triage.

**Archive match →** Treat as duplicate. Cite the existing folder path (e.g. `opencollective-security/internal/2026-06-02-order-fromaccount-private-leak/`) and, when present in that folder's write-up, any linked `opencollective-security` issue. Skip full triage (see **Match found** below).

### 2. GitHub (`opencollective-security`)

Search [opencollective-security](https://github.com/opencollective/opencollective-security/issues) via **GitHub MCP**.

**If MCP unavailable:** Require enablement or explicit user confirmation that no matching issue exists. Do not skip to full triage without that.

**Search:** From the finding, extract terms (vuln class, service, endpoint/mutation, paths, distinctive phrases). Run **multiple** issue-search queries for `opencollective/opencollective-security`; include open **and** closed issues (fixed-but-documented still counts). Compare candidates with **high confidence** (same code path or missing control, not shared keywords). If a report or reference ID was supplied, search issue bodies for it too.

Also check whether a confident GitHub match already has a folder under `internal/` (cross-link in the duplicate write-up when both exist).

### Match found → stop full triage

- No repro deep-dive, PoC, fix plan, bounty work, or new tracking issue draft.
- Create issue folder; write **minimal artifacts only** (per invoking skill):
  - **Report skill:** `reply.md` only (Known issue / duplicate template).
  - **Internal skill:** `issue.md` only (verdict **Duplicate**, link to existing issue and/or prior `internal/` folder, search summary).
- In-chat: verdict **Duplicate / known issue**; existing GitHub issue URL/number and status when applicable; prior triage folder path when applicable; search summary; folder path and file written.
- Optionally offer to comment on the existing GitHub issue if the user wants.

### No match →

Brief search summary (security-repo archive and GitHub), then **Core triage workflow** below.

## Core triage workflow

1. **Parse** - Service (API, frontend, PDF, REST, images), endpoints/files, auth prerequisites, repro steps, claimed impact, any PoC. Use OWASP cheat sheets per **`AGENTS.md`** (Context7: `/owasp/cheatsheetseries` if available). Start with [Secure Code Review](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html) for framing.
2. **Reproduce or disprove** - Prefer local or staging. Trace code; confirm or refute with evidence (request/response, code citation, test). Production testing on `https://opencollective.com` is not a safe PoC environment (report triage: also out of scope for bounty acceptance per [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md)).
3. **Full confirmation requires a minimal PoC** - Do **not** label **fully confirmed** until you **implement** and **run** a minimal PoC in the issue folder (`poc/` or `poc.*`). Demonstrate security-relevant behavior only. Document how to run it (`README.md` or PoC header); capture command output in the primary write-up. If a PoC is infeasible (secrets, environment, safety, production-only repro), use **provisional** / **not fully confirmed** and explain why.
4. **Classify** - Valid / invalid / intentional-won't-fix / duplicate. Respect `AGENTS.md` intentional postures (public GraphQL introspection, permissive API CORS are not defects). Reserve **fully confirmed** for step 3 (or document why confirmation is impossible).
5. **Severity** - Worst realistic exploitation; CVSS3-style reasoning. OC amplifiers: auth, payment methods/connected accounts, ledger integrity/history, permission system. Map to bands: CVSS ≥9 → High, ≥8 → Medium, ≥7 → Low (full reasoning in write-ups).
6. **Fix plan** - Minimal ordered steps: patch location, tests, schema/migration impacts, rollout. Match repo patterns. Write **`plan.md`** when there is something to build (skip for clear invalid/duplicate/out-of-scope).

**Do not** run production impact analysis or write **`impact.md`** during core triage. That is an **end-of-triage offer** only (see invoking skill). In write-ups, describe claimed or theoretical impact in **`issue.md`** / **`reply.md`**; reserve **`impact.md`** for forensic production-evaluation queries after the user accepts.

## `impact.md` (on user acceptance only)

Write only when the user accepts the **production impact analysis** offer at the end of triage (do not create by default). Use when triage can name **specific, reproducible data patterns** indicating abuse. Tie queries to traced schema (Sequelize models, not migrations; see `opencollective-api/AGENTS.md`). Keep forensic focus; do not duplicate the main engineering narrative.

1. **Purpose** - What "exploited" means in observable terms.
2. **Assumptions** - Tables/entities, time window, detection limits.
3. **Queries** - Numbered read-only checks. Prefer PostgreSQL `SELECT`. For logs, name source and exact filters.
4. **How to interpret** - What supports vs undermines exploitation.
5. **Safety** - Read-only; internal ops policy; no production secrets in the folder.

Skip when there is nothing concrete to query (no durable audit trail, purely client-side, no DB/log signature).

## `plan.md`

When applicable: ordered fix plan (patch, tests, migrations/schema, rollout, owner notes).

## Index upsert (after full triage, not on duplicate)

Patch `opencollective-security/harness/index.json` with the monorepo `patch-index.cjs` (`--mode internal` for own investigations, `--mode bounty` for bounty-origin triage), linking the `internal/` folder via `--report` JSON `path` when applicable. Field ownership is in [OC-OVERLAY.md](../security-audit/OC-OVERLAY.md) — never rewrite the whole index.
