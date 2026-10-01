---
name: security-review-open-github-issues
description: Validates and triages open opencollective-security issues. Use for issue reviews or batch revalidation.
---

# Security review - open GitHub issues (opencollective-security)

Orchestrator skill. GitHub MCP is required. **Do not** open fix PRs or patch product repos.

## Prerequisites

1. Confirm the GitHub MCP server is enabled for this workspace. If no GitHub tools are available: **stop immediately** and tell the user GitHub MCP must be enabled. Do not use `gh` CLI, raw REST/GraphQL, or browser automation as substitutes.
2. Before any GitHub call, read the tool schema for that tool. Tool names differ by MCP implementation; map this workflow to the actual tools available (issue search/read/write, comments, labels, PR/code search).
3. Load [../review-feature-security/SKILL.md](../review-feature-security/SKILL.md) for known-safe product patterns - not as a reason to close issues in this repo (see **Repo scope vs bounty policy** below).
4. For code validation and PoCs, follow the investigation bar in [../security-investigate-issue/SKILL.md](../security-investigate-issue/SKILL.md) and [../security-investigate/_shared.md](../security-investigate/_shared.md) (parse → reproduce/disprove → minimal PoC when claiming **confirmed** still exists).

**Repo:** `owner` `opencollective`, `repo` `opencollective-security`.

## Repo scope vs bounty policy

`opencollective-security` is the team's **internal security and hardening backlog**, not only a mirror of [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md) bounty scope. It tracks DoS/DDoS, rate limits, CSP/header hardening, infra edge cases, staging/process debt, and similar items that are **non-qualifying for bounty** but still worth documenting and revisiting.

For this skill:

- **Do not close** an issue solely because the class is non-qualifying in SECURITY.md or called out in `review-feature-security` (e.g. "DoS is out of scope", "header-only hardening"). Note bounty non-eligibility in the triage comment when useful; **leave the issue open** if the underlying concern may still exist or is an accepted backlog item.
- **Do close** when code/process review shows the issue is **no longer valid**: fixed in product (link PR/commit), **duplicate** of a canonical issue, or **technically invalid** (wrong component, repro disproved, never existed). Use `completed` for fixes, `duplicate` with the canonical link, `not_planned` only when the report itself is wrong - not when policy excludes the class.
- **Still open** is normal for valid hardening, availability, and infra trackers even when severity is low or bounty would not pay. Triage must still state **technical validity** (confirmed / provisional / unclear / mitigated / fixed in prod but not tracked elsewhere) and suggested next steps.
- Labels like `wontfix` or `not security` describe posture; they do **not** by themselves mean "close on triage".

## Review stamp label (skip on later runs)

After a **completed** per-issue review, apply the repo label:

**`agent > security-review-open-github-issues`**

This marks the issue so batch runs do not pick it again. Check once at startup that the label exists; if it is missing, **stop** and ask a maintainer to create it on `opencollective-security`.

**Exclude stamped issues** when building the work list. Only include them when the operator explicitly asks (`force`, `re-review`, `ignore stamp`, `include reviewed`, or similar); then run the full sub-agent workflow again and **re-apply** the stamp on success.

Do **not** add the stamp when the sub-agent returns `blocked` (MCP, permissions, env) - leave the issue unstamped so a later run retries. When applying the stamp, preserve all existing labels.

## User scope

Parse optional filters from the user message:

| Filter                       | Behavior                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Issue numbers (`#123`, list) | Only those issues                                                                              |
| Labels                       | Pass to the issue-listing tool                                                                 |
| `state`                      | Default **OPEN** unless user asks for closed or all                                            |
| Search / keywords            | Search `repo:opencollective/opencollective-security` plus user terms                           |
| `limit` / `max`              | Cap how many issues get a sub-agent (default **10** if unstated; confirm before large batches) |
| **Force re-review**          | Include issues that already have the stamp (see above)                                         |

If the user gives no filter, list **open** issues **without** the review stamp (paginate until limit or exhaustion).

## Orchestrator workflow

```
Progress:
- [ ] Verify GitHub MCP
- [ ] Build issue list (filters + pagination)
- [ ] For each issue: sub-agent review, then parent summary
- [ ] Roll-up for user (counts: closed, still open, needs human)
```

Process issues **one at a time** (sequential sub-agents). Skip stamped issues unless **force re-review** is requested.

### Parent roll-up

After all sub-agents finish, summarize in chat:

- Issues processed (numbers + links)
- Closed (with one-line reason each)
- Still open (with pointer to latest triage comment)
- MCP or permission failures
- Local folders under `opencollective-security/internal/` when a PoC was written (paths only)

## Per-issue sub-agent

Launch **one** sub-agent per issue (general agent, foreground, sequential).

The prompt must include:

- Issue number and URL
- Full issue title and body
- This skill path and the mandatory outcomes below
- Instruction to return a short structured result: `verdict`, `github_actions_taken`, `local_artifacts`, `blockers`

### Sub-agent mandatory outcomes

1. **Triage labels** - Compare body/title to [../security-audit/OC-OVERLAY.md](../security-audit/OC-OVERLAY.md). Add **only labels that already exist** on the repo. Typical gaps: `service > *`, `type > *`, `scope > *`, `severity > *`, `source > harness` for harness-origin. Fix a missing `<!-- oc-fingerprint: ... -->` in the issue body when absent and inferrable; do not invent fingerprints.
2. **Context** - Comment or body update with: related `opencollective-security` issues (search `oc-fingerprint` and keywords), fixing PRs/commits in product repos, and **missing repro fields** (auth role, mutation, affected account types) when the template is incomplete.
3. **Still valid?** - Read current code in `/workspace/<service>` (default API). Respect known-safe **product** patterns from `review-feature-security`. Separate **bounty/policy** (informational) from **technical validity**. Close only when: **fixed**, **duplicate**, or **technically invalid**. Do **not** close because SECURITY.md excludes the class; if the concern is fixed, close as **fixed**; if not fixed but policy-excluded, **keep open** and document status.
4. **Otherwise** - Add a single triage comment: current code assessment, **technical validity** (confirmed / provisional / unclear / mitigated), optional **bounty note** when non-qualifying, suggested next step, PoC summary if run. **Stop.** No fix PRs, no product-repo commits, no `plan.md` unless the user later asks.
5. **Review stamp** - On any successful outcome from steps 1-4 (including close), add the stamp label while preserving existing labels. Skip only on `blocked`.

### PoC (sub-agent)

When the issue claims an exploitable defect and local validation is feasible:

- Create `opencollective-security/internal/YYYY-MM-DD-<slug>/` with a minimal runnable PoC under `poc/`; run via `./scripts/test.sh` when applicable
- Reference path and outcome in the GitHub comment only - **never** commit PoC to OSS product repos

Optional: if `opencollective-security/harness/index.json` exists and the verdict changed, upsert with `node .agents/skills/security-audit/scripts/patch-index.cjs` (appropriate `--mode`; do not rewrite the whole index).

### GitHub write etiquette

- Sign automation comments with a short footer: `<!-- security-review-open-github-issues -->`
- Prefer comment tools for triage; use write/update tools for labels, body fingerprint, type, or close
- Do not assign milestones or users unless the user asked

## Sub-agent result template

The sub-agent returns:

```markdown
## Issue #N

- **verdict:** still_open | closed_fixed | closed_invalid | closed_duplicate | blocked
- **technical_validity:** confirmed | provisional | unclear | mitigated | no_longer_applies
- **bounty_policy:** qualifying | non_qualifying | n/a (optional; never use non_qualifying alone to justify close)
- **github_actions:** labels added; stamp applied; comment posted; closed (reason)
- **local_artifacts:** opencollective-security/internal/... or none
- **blockers:** MCP, permissions, env, or none
```

## What this skill does not do

- Send email or bounty `reply.md` workflow ([security-investigate-report](../security-investigate-report/SKILL.md))
- Run a full six-phase [security-audit](../security-audit/SKILL.md) hunt
- Implement or PR fixes on `opencollective-api`, frontend, or other product repos
