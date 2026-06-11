# Cycle report - reference queries

## Milestone discovery

Find project issues and infer the latest completed cycle:

```
search_issues: repo:opencollective/opencollective label:project
sort: updated, order: desc
```

Read `milestone.title`, `milestone.due_on`, and `milestone.created_at` from any hit.

## Issue queries

| Goal | Query |
| ---- | ----- |
| Project parents | `repo:opencollective/opencollective label:project milestone:Y26C2` |
| All closed work | `repo:opencollective/opencollective milestone:Y26C2 is:closed` |
| Bugs only | `repo:opencollective/opencollective milestone:Y26C2 is:closed type:Bug` |

Sub-issues: `issue_read` with `method: get_sub_issues` on each parent. Sub-issues expose `parent_issue_url` and often share a title prefix with the parent.

## Commit / PR queries

GitHub MCP `list_commits`:

| Repo | Parameters |
| ---- | ---------- |
| API | `owner: opencollective`, `repo: opencollective-api`, `since`, `until`, paginate `page` |
| Frontend | `owner: opencollective`, `repo: opencollective-frontend`, `since`, `until`, paginate `page` |

`search_pull_requests` (optional):

```
repo:opencollective/opencollective-api is:merged merged:2026-02-23..2026-04-10
repo:opencollective/opencollective-frontend is:merged merged:2026-02-23..2026-04-10
```

## Title translation hints

| Engineering signal | User-facing phrasing |
| ------------------ | -------------------- |
| `permalink`, `publicId`, `public id` | Readable, shareable links and IDs |
| `KYC`, `Persona` | Identity verification for payees |
| `Sidebar reorg`, `Incoming/Outgoing money` | Clearer navigation for money in and out |
| `Pay batch`, `Pipeline` | Paying multiple expenses at once |
| `New pricing`, `PlatformSubscription` | Updated platform pricing for hosts |
| `OAuth` (PayPal, Stripe, Wise) | Connecting payment accounts |
| `deps`, `chore`, `ci`, `test` | Usually omit unless user-visible |

## Cycle token format

`Y{YY}C{N}` - year and cycle number (e.g. `Y26C2` = 2026, cycle 2). Milestones live on `opencollective/opencollective`, not on API/frontend repos.
