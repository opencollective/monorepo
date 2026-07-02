---
name: security-investigate-issue
description: Triages an internally reported security concern for Open Collective codebases (engineering, ops, or security team) - validates reproducibility and impact, asserts the finding with a clear confidence level, and proposes a fix plan when applicable. Writes artifacts under `/workspace/priv/security-issues/<unique-folder>/` including `issue.md` (assertion and verdict), optional `plan.md` when there is a fix to plan, plus a minimal runnable PoC for full confirmation. Offers optional production impact analysis (`impact.md`) at the end when queryable traces may exist. Updates `security/memory.md` after full triage. No external researcher reply or bounty policy. Use when the user describes an internal finding, asks to validate a suspected vulnerability from the team, or wants an engineering handoff without security@ or bounty workflow.
---

# Security issue investigation - internal (Open Collective)

Triages findings raised inside the org (engineering, ops, security): assertion, evidence, optional fix plan. No external reply or bounty workflow.

**Shared triage steps:** Read [../security-investigate/_shared.md](../security-investigate/_shared.md) for issue folder rules, **known issue check** (local `priv/security-issues` archive + GitHub MCP search of opencollective-security), core workflow (parse → PoC → classify → severity → fix), **`security/memory.md` update**, and `plan.md` / `impact.md` structure.

## Workflow

**Prerequisite:** Run **_shared.md** **Known issue check** first (local archive, then GitHub). On match: **`issue.md` only** (verdict **Duplicate**, link to prior triage folder and/or existing GitHub issue). On no match: create issue folder, then **_shared.md** steps 1–6, then update **`security/memory.md`** per **_shared.md** (skip on duplicate).

## Internal reference ID (optional)

If the user provides an internal ticket ID (Linear, Jira, incident number, etc.), capture at start and repeat in **`issue.md`** (**Reference:** line). Do not invent an ID.

## Output files

All under `/workspace/priv/security-issues/<unique-folder>/`. PoC in `poc/` or `poc.*`; required for **fully confirmed**.

| File        | When           | Contents                                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue.md`  | **Always**     | Assertion: reference ID (if any), title suggestion, claim summary, **verdict** (Confirmed / Provisional / Invalid / Duplicate / Intentional / Unclear) with reasoning, impact, components, code refs, PoC path/run (or why not), severity, next steps. One canonical internal write-up. |
| `plan.md`   | **Fix to plan** | Per **_shared.md**.                                                                                                                                                                                                                                                                                                                      |
| `impact.md` | **User accepts impact offer** | Per **_shared.md**. Do not create during default triage.                                                                                                                                                                                                                                                                                 |

## Production impact analysis (optional)

After the in-chat summary, **offer** production impact analysis when abuse may leave **queryable traces** (DB rows, audit logs, etc.). Do not write **`impact.md`** unless the user accepts.

- **Offer when:** Fully or provisionally confirmed findings where forensic checks could clarify whether exploitation occurred in production.
- **On accept:** Write **`impact.md`** per **_shared.md** and note the new file in chat.

## In-chat summary

**Duplicate path:** (1) Verdict Duplicate + prior triage folder and/or existing GitHub issue link (2) Search summary (local + GitHub) (3) Folder path + `issue.md`.

**Full triage path:**

1. **Known issue check** - Searched `priv/security-issues` and GitHub; no confident match (or weak hits ruled out)
2. **Verdict** + reason
3. **Evidence** (+ PoC path/outcome if confirmed)
4. **Impact** (theoretical; in `issue.md` — not production forensic queries)
5. **Suggested severity**
6. **Fix plan** pointer (`plan.md` when created)
7. **Memory** - `security/memory.md` row added or bounty updated (Internal section unless named contact supplied)
8. **Paths** - folder; which of `issue.md` / `plan.md`; PoC location
9. **Offer** production impact analysis (`impact.md`) when queryable traces may exist — only write after user accepts
