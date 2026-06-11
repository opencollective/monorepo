---
name: generate-cycle-report
description: Generates a concise, end-user-oriented markdown report of Open Collective achievements for a completed engineering cycle. Pulls planned work from org project 5 and opencollective/opencollective milestone issues, then supplements with API and frontend commit history for work not tracked on the board. Use when the user invokes /generate-cycle-report, asks for a cycle recap, achievements report, or what shipped in the past cycle.
---

# Generate cycle report

Produce a short, readable markdown recap of what the team shipped in a completed cycle. Read this skill fully before drafting.

## Hard prerequisite

1. Confirm the **GitHub MCP server** is enabled.
2. If **no GitHub MCP**: stop and tell the user to enable it. Prefer GitHub MCP for issues and remote commits. **Fallback only:** local git in `/workspace/opencollective-api` and `/workspace/opencollective-frontend` when MCP cannot reach those repos.

Before any GitHub MCP call, **read the tool schema** for that tool.

## Cycle identification

Cycles are tracked on [Cycle Planning & Weekly Board](https://github.com/orgs/opencollective/projects/5) and as **milestones** on `opencollective/opencollective` (tokens like `Y26C2`, `Y26C3`).

| Item | Value |
| ---- | ----- |
| Org project | `https://github.com/orgs/opencollective/projects/5` |
| Planning repo | `opencollective/opencollective` |
| Code repos | `opencollective/opencollective-api`, `opencollective/opencollective-frontend` |

**Resolve the target cycle:**

1. If the user names a milestone (e.g. `Y26C3`), use it.
2. If they say "past cycle" / "last cycle" with no name, pick the **most recently completed** milestone: search `repo:opencollective/opencollective label:project`, sort by milestone `due_on`, and choose the latest milestone whose `due_on` is before today (or the one the user confirms).
3. If unclear, ask **once** which milestone to report on.

**Date range:** From any issue in that milestone, read `milestone.created_at` (start) and `milestone.due_on` (end). Use ISO dates for commit queries.

## Data collection

Run these steps in parallel where possible.

### 1. Project issues and sub-issues

```
search_issues: repo:opencollective/opencollective label:project milestone:<CYCLE>
```

For each `[Project]` parent issue:

- `issue_read` method `get` - overview and desired outcomes
- `issue_read` method `get_sub_issues` - paginate until exhausted

Also fetch **all closed issues** in the milestone (not only `project` label):

```
search_issues: repo:opencollective/opencollective milestone:<CYCLE> is:closed
```

Paginate (`page` 2, 3, ...) while `incomplete_results` or a full page is returned.

### 2. Commit and PR history (gap fill)

Collect merged work in the code repos during the cycle date range. Prefer GitHub MCP:

```
list_commits: owner=opencollective, repo=opencollective-api, since=<start>, until=<end>
list_commits: owner=opencollective, repo=opencollective-frontend, since=<start>, until=<end>
```

Paginate both. Optionally cross-check with:

```
search_pull_requests: repo:opencollective/opencollective-api is:merged merged:<start>..<end>
search_pull_requests: repo:opencollective/opencollective-frontend is:merged merged:<start>..<end>
```

**Local fallback** (same date range):

```bash
git -C /workspace/opencollective-api log --since="<start>" --until="<end>" --oneline
git -C /workspace/opencollective-frontend log --since="<start>" --until="<end>" --oneline
```

### 3. Reconcile issues vs commits

- Map sub-issues and PR titles to parent projects when `parent_issue_url` or title prefix matches.
- Flag commits/PRs with **no matching cycle issue** (no `Fixes #`, no sub-issue title match, not covered by a project outcome). These feed the **Also shipped** section.
- **Exclude** from the report unless clearly user-facing: `chore`, `ci`, `test`, `deps`/`fix(deps)`, lockfile-only, devcontainer, eslint, sentry-only noise, internal refactors with no product effect.

## Synthesis rules

**Audience:** fiscal host admins, collective admins, contributors, and OC staff - not engineers.

**Tone:**

- Plain language, complete sentences in bullets.
- Describe **what people can do now** or **what got better**, not implementation.
- No em dashes (use hyphens).
- OC vocabulary from `AGENTS.md`: Account/Collective, Orders/Contributions, fiscal host, payment request.

**Per project issue:**

- Strip `[Project]` from the title.
- 2-4 bullets max, drawn from **closed sub-issues** and desired outcomes - not open or deferred work.
- Translate engineering titles into user benefits (e.g. "Add public id search fields" -> "Search expenses and contributions by their new readable IDs").
- Omit sub-issue lists, assignees, PR numbers, and file paths.

**Miscellaneous / small fixes:**

- Roll up closed non-project issues and small sub-issues into one short section (3-6 bullets), grouped by theme (bugs fixed, UX polish, email copy, etc.).

**Also shipped (from commits):**

- Only items **not** already covered above.
- Group into 2-5 theme bullets; keep the whole section to 5 bullets max unless the user asks for detail.

**Do not include:** velocity stats, contributor counts, lines changed, open carryover (unless user asks), or a raw commit log.

## Output template

Return **only** the filled report as markdown:

```markdown
# Open Collective - <CYCLE> achievements

<Cycle start> - <Cycle end>

One sentence on the cycle's main themes for readers skimming.

## <Project title 1>

- User-facing outcome
- User-facing outcome

## <Project title 2>

- User-facing outcome

## Improvements and fixes

- Grouped user-visible fix or polish
- ...

## Also shipped

- Work merged in API/frontend that was not tracked on the cycle board
- ...
```

Omit empty sections. If every commit mapped to an issue, drop **Also shipped**.

## Review checklist

Before returning the report:

- [ ] Milestone and date range are correct
- [ ] Every `[Project]` issue for the cycle appears as a section (or is explicitly merged into another with a note)
- [ ] Bullets are end-user oriented, not technical
- [ ] No duplicate bullets across sections
- [ ] Report fits on roughly one screen (aim for &lt; 60 lines)
- [ ] Open / incomplete work is not listed as an achievement

## Examples

**Input:** `/generate-cycle-report Y26C2`

**Output shape (illustrative, abbreviated):**

```markdown
# Open Collective - Y26C2 achievements

Feb 23 - Apr 10, 2026

This cycle focused on clearer money navigation, trustworthy payouts, and shareable links across the platform.

## KYC meets Expenses & Payment Methods

- Fiscal hosts can spot expenses tied to payees still in KYC review before paying out.
- Hosts get alerts when a payout method changes after verification and can review what changed.

## Permalinks & unified IDs

- Expenses, contributions, and transactions have readable IDs (e.g. `ex-...`) you can search and share.
- Old links keep working; new permalinks work across the dashboard and exports.

## Improvements and fixes

- PayPal OAuth connection errors are easier to understand when setup fails.
- Expense holds release correctly when a payment completes.

## Also shipped

- PayPal account connection flow for recurring contributions.
```

For more query examples, see [reference.md](reference.md).
