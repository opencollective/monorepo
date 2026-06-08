---
name: security-investigate-issue
description: Triages an internally reported security concern for Open Collective codebases (engineering, ops, or security team) - validates reproducibility and impact, asserts the finding with a clear confidence level, and proposes a fix plan when applicable. Writes artifacts under `/workspace/priv/security-issues/<unique-folder>/` including `issue.md` (assertion and verdict), optional `plan.md` when there is a fix to plan, optional `impact.md` with production evaluation queries when forensic traces exist, plus a minimal runnable PoC for full confirmation. No external researcher reply or bounty policy. Use when the user describes an internal finding, asks to validate a suspected vulnerability from the team, or wants an engineering handoff without security@ or bounty workflow.
---

# Security issue investigation - internal (Open Collective)

Triages findings raised inside the org (engineering, ops, security): assertion, evidence, optional fix plan, optional production-impact queries. No external reply or bounty workflow.

**Shared triage steps:** Read [../security-investigate/_shared.md](../security-investigate/_shared.md) for issue folder rules, **known issue check** (GitHub MCP search of opencollective-security), core workflow (parse → PoC → classify → severity → fix → impact), and `impact.md` / `plan.md` structure.

## Workflow

**Prerequisite:** Run **_shared.md** **Known issue check** first. On match: **`issue.md` only** (verdict **Duplicate**, link to existing issue). On no match: create issue folder, then **_shared.md** steps 1–7.

## Internal reference ID (optional)

If the user provides an internal ticket ID (Linear, Jira, incident number, etc.), capture at start and repeat in **`issue.md`** (**Reference:** line). Do not invent an ID.

## Output files

All under `/workspace/priv/security-issues/<unique-folder>/`. PoC in `poc/` or `poc.*`; required for **fully confirmed**.

| File        | When           | Contents                                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue.md`  | **Always**     | Assertion: reference ID (if any), title suggestion, claim summary, **verdict** (Confirmed / Provisional / Invalid / Duplicate / Intentional / Unclear) with reasoning, impact, components, code refs, PoC path/run (or why not), severity, next steps. One canonical internal write-up. |
| `plan.md`   | **Fix to plan** | Per **_shared.md**.                                                                                                                                                                                                                                                                                                                      |
| `impact.md` | **Queryable traces** | Per **_shared.md**.                                                                                                                                                                                                                                                                                                                      |

## In-chat summary

**Duplicate path:** (1) Verdict Duplicate + existing issue link (2) Search summary (3) Folder path + `issue.md`.

**Full triage path:**

1. **Known issue check** - Searched; no confident match (or weak hits ruled out)
2. **Verdict** + reason
3. **Evidence** (+ PoC path/outcome if confirmed)
4. **Impact**
5. **Suggested severity**
6. **Fix plan** pointer (`plan.md` when created)
7. **Paths** - folder; which of `issue.md` / `plan.md` / `impact.md`; PoC location
