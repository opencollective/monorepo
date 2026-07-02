---
name: security-investigate-report
description: Triages an incoming security report for Open Collective codebases - searches `priv/security-issues` and opencollective/opencollective-security first for existing documentation, validates reproducibility and impact when new, maps to official bounty policy, proposes fixes, and drafts contributor replies. Writes artifacts under `/workspace/priv/security-issues/<unique-folder>/` including up to three core markdown files (`reply.md`, optional `issue.md` when fully confirmed, optional `plan.md` when there is a fix to plan), plus a minimal runnable PoC for full confirmation. Updates `security/memory.md` after full triage. After triage, offers optional production impact analysis (`impact.md`) and filing on opencollective/opencollective-security. Use when the user pastes or describes a security report, asks to investigate a vulnerability, assess bounty eligibility, or draft a response to security@opencollective.com reporters.
---

# Security report investigation (Open Collective)

Canonical policy: [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md) (eligibility, scope, qualifying/non-qualifying, rewards, contact). This skill does not replace human sign-off on bounties or payouts.

**Shared triage steps:** Read [../security-investigate/_shared.md](../security-investigate/_shared.md) for issue folder rules, **known issue check** (local `priv/security-issues` archive + GitHub MCP search of opencollective-security), core workflow (parse → PoC → classify → severity → fix), **`security/memory.md` update**, and `plan.md` / `impact.md` structure.

## Report ID (when provided)

Capture any **security report ID** (ticket, email subject id, internal code) at the start. Do not invent one.

- **`reply.md` / expense instructions:** Use the real ID when bounty or payment is discussed; otherwise **`__SECURITY_REPORT_ID__`** (reporter replaces per team process).
- **`issue.md`:** **Report ID:** line near the top when fully confirmed. Title = concise finding description, not a PR/commit title.

## Known issue match (report-specific)

When **_shared.md** finds a match (in `priv/security-issues`, on GitHub, or both): **`reply.md` only**. Cite prior triage folder path and/or existing GitHub issue URL/number and status. Note duplicates are generally not eligible for a separate bounty per SECURITY.md; **do not promise payment**. Do **not** offer to file a new opencollective-security issue. Do **not** update `security/memory.md` (canonical entry should already exist).

## Full triage workflow

**Prerequisite:** Known issue check passed (local + GitHub). Create issue folder, then:

1. **Steps 1–6** from **_shared.md** (parse through fix plan). For classify (step 4), also check SECURITY.md Qualifying / Non-qualifying lists.
2. **Contributor reply** - Professional, paste-ready **`reply.md`** (templates below). Apply **Report ID** when bounty/expense applies.
3. **Policy compliance** (fully confirmed + possible bounty) - Walk SECURITY.md Eligibility, Responsible Disclosure, and Scope. Flag gaps (missing policy sentence, production-only testing, scanner-only, hypothetical without PoC). Verdict: **recommended** / **not eligible** / **needs more info**. **Do not promise payment.**
4. **Bounty recommendation** - If eligible, map to Rewards table (project type, Low/Medium/High/Critical band). Note sanctions/payment-processor limits if relevant. Expense: `https://opencollective.com/ofitech/expenses/new` with report ID (see **Report ID**).
5. **`issue.md`** - Only when **fully confirmed** (PoC run). GitHub body for opencollective-security: report ID, title suggestion, summary, impact, components, code refs, PoC path/run instructions, severity, label hints. Engineering handoff, not a copy of the email.
6. **`security/memory.md`** - Per **_shared.md** (reporter section, title, date, bounty or —).
7. **End-of-triage offers** - After in-chat summary, offer production impact analysis and GitHub issue filing (see below). Do not run either by default.

## Output files

All under `/workspace/priv/security-issues/<unique-folder>/`. PoC in `poc/` or `poc.*`; required for **fully confirmed**. Skip files that do not apply.

| File        | When                                                                                    | Contents                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reply.md`  | **Always**                                                                              | Paste-ready researcher reply: verdict, thanks, bounty/expense when applicable (see **Report ID**). State provisional clearly if PoC not run.                                  |
| `issue.md`  | **Fully confirmed only**                                                                | opencollective-security issue body (see workflow step 5).                                                                                                                     |
| `plan.md`   | **Fix to plan**                                                                         | Per **_shared.md**.                                                                                                                                                           |
| `impact.md` | **User accepts impact offer**                                                           | Per **_shared.md**. Do not create during default triage.                                                                                                                      |

## Reply templates (adapt; keep accurate and kind)

**Known issue / duplicate** - Thanks; prior triage (`priv/security-issues/…`) and/or known GitHub issue + link/number/status; duplicates generally not eligible for separate bounty; invite follow-up if they believe it is a distinct flaw; optional report ID for correlation.

**Invalid / non-issue** - Thanks; conclusion (cannot reproduce, not a defect, out of scope, Non-qualifying with brief rationale); point to staging/docs if helpful; no bounty unless a separate valid finding.

**Fully confirmed** - Thanks; validated via minimal PoC in permitted environment (minimal exploit detail if undisclosed); next steps; if eligibility appears met, bounty tier/band per SECURITY.md and note any uncertainty (first reporter, 72h rule, etc.); expense URL + **Report ID**.

## End-of-triage offers (optional)

After the in-chat summary, **offer** both follow-ups below. Do not run either during default triage; wait for user acceptance.

### Production impact analysis

When abuse may leave **queryable traces** (DB rows, audit logs, etc.).

- **Offer when:** Fully or provisionally confirmed findings where forensic checks could clarify whether exploitation occurred in production.
- **On accept:** Write **`impact.md`** per **_shared.md** and note the new file in chat.

### GitHub issue

**Offer** to create on **`opencollective/opencollective-security`**. Do not create without user acceptance. Do not use browser automation.

- **Offer when:** Fully confirmed + `issue.md` (primary); provisional/invalid only if user may want a record.
- **On accept:** GitHub MCP available; read schema (`issue_write` create, etc.). Title/body from `issue.md` when present; no secrets or raw exploit steps if undisclosed. Use existing labels only. Return issue URL or leave `issue.md` for manual paste at [New issue](https://github.com/opencollective/opencollective-security/issues/new).

## In-chat summary

**Duplicate path:** (1) Verdict + prior triage folder and/or existing GitHub issue link (2) Search queries and why same finding (local + GitHub) (3) Folder path + `reply.md`.

**Full triage path:** (1) Duplicate check note (local + GitHub) (2) Verdict + reason (3) Evidence + PoC if confirmed (4) Impact (theoretical; in `reply.md` / `issue.md` — not production forensic queries) (5) Severity (6) Fix plan pointer (7) Bounty eligibility/band/compliance + report ID (8) `security/memory.md` updated (9) Folder path + files written + PoC path (10) **Offer** production impact analysis (`impact.md`) when queryable traces may exist (11) **Offer** opencollective-security issue when applicable — only run either after user accepts
