---
name: package-updates
description: Review and maintain dependency-update PRs (Renovate, Dependabot, and lockfile maintenance) in Open Collective api, frontend, rest, images, pdf, and contributors-svg. Use for inventory, CI triage, retries, rebases, compatibility fixes, and authorized merges. Status and review requests remain read-only.
---

# Package updates

Maintain dependency PRs through investigation, verification, and the actions the user authorized.
Scope is api, frontend, rest, images, pdf and contributors-svg unless the user names a repo or PR.
A status or review-only request produces findings: no retries, PR edits, pushes or merges. Reviewing
this skill's own files does not start maintenance on live PRs. Other repositories follow the same
rules, but the scripts only know these six: do their steps by hand (`gh pr review --approve`, then
`gh pr merge --squash --match-head-commit <sha>` on the checked head).

| Read                                                | When                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [repo-facts.md](references/repo-facts.md)           | once per maintenance session, with `bash "$SK/scripts/repo-facts.sh" <repo...>`         |
| [failures.md](references/failures.md)               | any red check, before a retry, a STUCK check or a timeout                               |
| [fixing.md](references/fixing.md)                   | before changing service code (with the repo's AGENTS.md); to brief a fixer              |
| [reviews.md](references/reviews.md)                 | before any review (own or AI); to brief a reviewer; "check feedback" / "the usual"      |
| [renovate.md](references/renovate.md)               | local rebases, foreign commits, pushes to bot branches, closed updates, workflow merges |
| [security-alerts.md](references/security-alerts.md) | `[security]` PRs, Dependabot security PRs, open Dependabot alerts                       |
| [hosts.md](references/hosts.md)                     | session start in Codex or zsh, long waits, installs in a scratch worktree               |
| [history.md](references/history.md)                 | when a rule looks arbitrary: the incident behind it                                     |

## Setup

- `SK` is this file's directory; run scripts as `bash "$SK/scripts/<name>.sh"` (needs `gh`, `jq`;
  fixes need the repo's Node/npm, see `use_repo_node` in `_lib.sh`).
- `S="${SCRATCH:-${TMPDIR:-/tmp}}/package-updates"; mkdir -p "$S"` holds worktrees, inventory,
  claims, reviews and the session file, outside the user's checkouts. Existing worktrees (other
  sessions' too: `git worktree list`) are inspected or resumed, never redone or overwritten.
- Re-read live PR state right before asking or acting: the user often approves, merges or comments
  from GitHub meanwhile. A batch item already done there is reported, never re-run.
- Cache the inventory per repo; query again only for omitted PRs, pagination, missing evidence or
  changed state. Never print a PR body whole: `gh pr view N --json body -q .body | sed -n
  '/Release Notes/,/Configuration/p' | head -60`. Bound read-only output with `head`/`tail`; never
  truncate a mutating script's output. Keep progress updates concise.
- Tools you write (probe, parser, differential run) are Node.js files under `$SK/scripts/` with a
  purpose/usage header, never one-off code in `/tmp` or inline, never deleted; extend existing ones.

## Session

1. **Open.** Run the inventory, choose the PRs, write `$S/session-<YYYYMMDD-HHMM>.md`: start time
   (ISO, UTC), then one line per PR (repo, number, head SHA, triage class). That list is the scope;
   only the user widens it. A PR opened later goes under "Next session", untouched. Session notes
   (retries spent, claims, sub-agents and results) go in the same file.
2. **Work** through triage, cycles, fixes and reviews, in parallel wherever possible (Delegation).
3. **Stop working** when no sub-agent is running and none is left to start. Running CI (a background
   `cycle.sh`, a rebase Renovate has not done, a rerun) is reported as pending, not waited for.
4. **Closing batch:** one batch for everything prepared, asked once; execute the answer.
5. **Usage:** `node "$SK/scripts/session-usage.js" --since <start> --codex` table in the report
   (`--codex` counts every Codex rollout on the machine: say so if the user ran Codex meanwhile;
   unpriced models are reported as such, never priced from memory).
6. **Retrospective:** time and tokens per PR and role, fruitless retries, wrong classes, redone
   sub-agent reports, manual steps a script could do, tools added or changed. Propose improvements
   as `R1…` with evidence in a final question; write only approved ones (Maintaining).
7. **Close:** mark the session file closed with its outcome, clean up worktrees, report.

## Delegation

You are the orchestrator: CI cycles run as a background script, fixes go to a fixer sub-agent,
reviews to a reviewer sub-agent, so your context keeps decisions, not logs. Without sub-agents, do
the roles yourself and say so once in the report. **You keep** triage, the retry budget, which PRs
get a rerun, rebase or fix, which findings a fix addresses, accepting or dismissing findings, the
batch, and every authorized action. Sub-agents never push, approve, merge, close, comment, label or
resolve threads.

**CI cycles:** `cycle.sh` is the only interface for reruns, rebases and waits.

```sh
bash "$SK/scripts/cycle.sh" api rerun 12198@3b18107 12199@910e98c > "$S/cycle-api.log" 2>&1; echo "exit $?"   # background
bash "$SK/scripts/cycle.sh" api rerun-full 12198@3b18107   # whole workflow, not --failed (failures.md, Retries)
bash "$SK/scripts/cycle.sh" frontend rebase 12431@a2f8337   # Renovate checkbox or Dependabot update-branch
TIMEOUT_MIN=90 bash "$SK/scripts/cycle.sh" api wait 12197   # wait and summarize only (default 60 min)
```

One per repo, in the background; pin each PR to the head you triaged (a moved head is skipped). It
claims its PRs, waits for restarted workflows or new heads, then checks, and prints one line per PR
plus failing jobs and flake signatures for red ones (full output in `$S/cycle/`). Exit 0 green, 1 red
or skipped, 3 timeout (pending), 2 usage. It never retries twice: you classify and decide next.

**One owner per PR.** Before starting a fixer: `echo "fixer <agent id>" > "$S/claims/<repo>-<pr>"`,
removed when its report is in. `cycle.sh` skips claimed PRs and releases its own on exit; a claim
whose `cycle.sh` pid is gone (`kill -0`) is stale: remove it.

**Agent kinds.** Each role names a kind of agent, then the model that fits it on each host:

| Kind                                      | Claude Code        | OpenAI (Codex / ChatGPT)                                                              |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| **Deep coder** (writes and reasons hard)  | `opus`             | `gpt-6.1-sol` at high reasoning effort (fallback `gpt-6-sol`)                         |
| **Careful reader** (reviews, call sites)  | `sonnet`           | the configured model (`gpt-6.1-sol`, fallback `gpt-6-sol`) at its configured effort   |
| **Quick scanner** (summaries, listings)   | `haiku`            | the configured model at `low` reasoning effort (per-run override, never edit config)  |

OpenAI notes: use the model the user's config already names; if it is refused, use `gpt-6-sol` and
say so; never switch to another model (`gpt-6-astra` is too expensive) without asking. There is no
cheaper OpenAI model to name for the quick scanner, so lower the reasoning effort instead.

**Fixer** (deep coder): one per PR needing a code change, a conflict-resolving `local-rebase.sh`, or
accepted findings. Brief: [fixing.md](references/fixing.md#fixer-brief). Read its diff before the push
batch; the fix then goes to a reviewer, never back to the fixer that wrote it.

**Reviewer**: one per batch candidate, or per package bumped across repos, started at triage and
resumed on each new head. A quick scanner for patch/minor bumps of dev-only tooling with a
`package.json` + lockfile diff and no bot finding, and for a lockfile maintenance PR whose
`lockdiff.js` output shows no runtime-path major (it checks the minors and patches in the runtime
path and says so); a careful reader for the rest. Brief: [reviews.md](references/reviews.md#reviewer-sub-agent).

**Quick-scanner helpers**, read-only, started by you in parallel with the reviewers; their output is
a file the reviewer or you then check, never a verdict:

- **Release-notes digest:** for a package range not yet cached, read the notes of every release in
  the range and write `$S/reviews/<package>@<from>-<to>.md` (breaking changes with source links,
  security fixes, deprecations). The careful-reader reviewer does the call-site check against it.
- **Failure second look:** given a failing job's log and `failures.sh` output, say whether the full
  failing block matches a known flake signature or looks like a real failure, quoting the lines.
  You decide the class and the retry.
- **Changelog of a bump's transitive moves:** run `lockdiff.js` on base and head and group the output
  (direct, runtime-path, dev-only, majors that are dedupe reshuffles). The reviewer judges the runtime ones.

Never a quick scanner: fixes, security-relevant bumps, majors, probes, and anything on payment, auth,
persistence or framework call sites.

## Authorization

For a maintenance request, these are routine: inventory, log reading, one justified retry per
distinct failure, rebases of untouched bot branches, local fix preparation, `blocked`/`major` labels
and the blocked comments (Triage), and ticking Renovate "recreate" boxes once the user asked to
revisit closed updates. For a status or review-only request, everything stays read-only.

| Action                                                   | Authorization                            |
| -------------------------------------------------------- | ---------------------------------------- |
| Push a fix or locally rebased branch; open a fix/prep PR | User approval, unless already authorized |
| Record a GitHub approving review; merge; close           | User approval, unless already authorized |
| Modify another human's PR or discard their commits       | Explicit authorization for that PR       |
| Comments (except blocked marking), branch deletion       | Explicit authorization for that action   |

- **Merging is two steps.** The user's yes on a batch merge item is their review, recorded as an
  approval from their account; `merge.sh --approve` then merges once green. This covers only PRs
  already green when reviewed. A PR that receives a fix (pushed commit, rebase with code changes)
  needs a new batch for its new head once CI is green; approve and merge only after that yes. A yes
  to "push fix" authorizes the push, never approval or merge.
- The user's own PRs cannot be self-approved: use an existing qualifying review or report the
  missing reviewer. Never `gh pr merge --admin`; administrative bypass is not a remedy.
- "Check feedback" on a PR ("the usual") authorizes push and thread resolution on that PR, not
  approval or merge. Resolve a thread only within existing authorization, once its fix is pushed and
  verified; a local commit does not resolve it.
- Ask only after preparing the concrete batch, with a question tool only if it supports approvals in
  the current mode (otherwise in the final message). Elapsed time is not consent. Authorization
  given earlier in the session persists: do not re-ask.
- **PRs this skill opens** (fix, prep, supersede, lockfile or config PRs) get the label
  `package-updates` (create with color `0e8a16` if missing) when opened. They are inventoried in
  later sessions and followed up like the user's own PRs: CI state, review feedback (reviews.md),
  rebase only when needed, an "awaiting another reviewer" line while green, merge after the usual
  batch. A PR still open when its work is merged elsewhere is reported for closing, never closed.
- Dismissing a Dependabot or CodeQL alert, like closing a PR, is the user's call.

## Triage

```sh
bash "$SK/scripts/status.sh"                                          # fast status: all repos
bash "$SK/scripts/list-prs.sh" api --json > "$S/inventory-api.json"   # full inventory; jq this file afterwards
bash "$SK/scripts/failures.sh" api 12194                              # failing jobs and flake signatures
```

A plain "status" ask gets `status.sh` only: green, red job names, conflicts, foreign commits,
blocked labels and next steps, then stop (no logs, release notes, rebases or reviews unless the user
points at a PR). The inventory covers bot PRs, the user's `(deps)` PRs and the user's PRs labelled
`package-updates`, up to 100 (at the limit,
expand before claiming completeness); other PRs only on request; fetch named PRs directly if missing.

- **Green:** completed successful checks on the current head, mergeable, no blocking review.
  Cancelled, action-required, unknown or absent checks are not green; a timeout is pending. Only a
  completed `cycle.sh` result on the current head proves green, never a rerun still running.
- **Flake:** a known transient failure unrelated to the bump, read in the full failing block (a spec
  name in the log is not proof). Retry once, tracked in the session file; a repeat needs
  investigation. Exceptions: [failures.md](references/failures.md#retries).
- **Stale:** rebase only when GitHub reports a conflict, you are about to push to the branch, or the
  failure is already fixed on main. Being behind main or carrying old checks is not a reason.
- **Real failure:** deterministic type/build/runtime failure. Check main first (`gh run list -R
  "$REPO" --branch main --limit 8 --json conclusion,createdAt,displayTitle,workflowName`), compare
  failing specs, not job names; inspect release notes and usages; fix (Fixes) or report.
- **Major:** a major of a critical dependency is never proposed for an agent merge, even green and
  approved: payment providers (stripe, paypal, transferwise/wise, plaid, gocardless), auth and crypto
  (jsonwebtoken, passport, fido2/webauthn), persistence (sequelize, pg, kysely, redis), web framework
  (express, next, react), GraphQL (graphql, `@apollo/*`), and anything the user names. Label `major`
  (create with color `d93f0b` if missing), list under **Major**; the user merges it from GitHub. Other majors
  are ordinary candidates once their compat fix is reviewed.
- **Security** (`[security]`, Dependabot alerts): first in the batch, never closed for convenience.
- **Blocked:** `renovate/artifacts` red (fix the cause on main, then tick the checkbox), an upstream
  fix, main failing the same test, another PR first, or an ecosystem gate. Label `blocked` (create
  with color `b60205` if missing) and comment once `Blocked by <PR, package or upstream issue>.` with evidence,
  what unblocks it and why it stays open (skip if up to date). When it clears or moves to `major`,
  remove the label and comment `Unblocked:` naming what cleared it, with its link.
- **Leave alone:** another human's work without permission, or insufficient evidence to act.

A Renovate `- abandoned` title suffix is a caution flag (rebase locally, re-check release notes), not
a skip. A Renovate checkbox must never discard foreign commits; `cycle.sh rebase` refuses non-bot or
unknown authors.

## Fixes

For maintenance or investigation requests, go from a deterministic failure to diagnosis and a local
fix without asking (logs, main comparison, repo history and worktree repros need no extra approval).
Allowed fixes: types, imports, snapshots, lockfile or peer-dep resolution, and the call-site changes
the bump requires. Never an unrelated change to get a PR green: that is a real failure to report.
For an upstream bug or ecosystem gate, give the options (hold, fix, close) and what closing does to
Renovate's proposals. Recipes and verification: [fixing.md](references/fixing.md).

## Reviews

Every item gets two reviews before the batch, dependency-only bumps included; green CI is not one.

1. **Own review:** release notes for the whole range (each intermediate major), each breaking change
   checked against our call sites with the grep behind it, what CI exercises there, transitive moves
   for lockfiles, fix diffs reviewed like code ([checklist](references/reviews.md)).
2. **Second agent:** `bash "$SK/scripts/ai-review.sh" <repo> <pr>` (bot findings and coverage), or a
   local `codex review` for unpushed fixes and unreviewed heads. Each finding is **integrated**
   (commit, rerun, resolve the thread) or **dismissed** with a one-line reason, never answered with
   a comment. Never "no findings" without a reviewer that ran on that head.

The batch line carries both (`Own review: …; AI review: …`). An item without its own review or with
an unaddressed finding is not a merge candidate. At most two review/fix cycles per item per session.

## Batch

Maintenance requests get one batch of the concrete actions still needing authorization; status and
review-only requests get findings and next steps, no question. One line per item, head SHA when it
matters, a table for larger batches:

```
Merge (green, fresh, reviewed by you-the-agent and a second agent; your yes = approval from your account, then merged)
  M1  api #12197  @hyperwatch/hyperwatch 4.3.1→5      all checks green, release notes: no breaking change for our 4 call sites; AI review: 1 finding, dismissed (fallback style nit)
Push fix (then back to you for a final review once green)
  F1  api #12194  sentry-javascript v11                 commit ready in wt-api-12194, type-check + sentry suite pass
Awaiting another reviewer
  O1  frontend #12426  @graphql-codegen/cli v7          green; cannot self-approve
Major (label `major`; merged by you from GitHub, not proposed here)
  api #11701  stripe 18→22                              approved by a maintainer, all checks green on a2f8337d
Close
  C1  api #12130  opensearch 3.6.0                      upstream d.ts bug, no fixed release; Renovate re-proposes on the next version
Left alone (no action proposed)
  api #11701 stripe v22: carries another maintainer's commits, 249 behind, needs its authors
```

Security items first; siblings editing the same workflow file merge one at a time
([renovate.md](references/renovate.md#workflow-file-merges)). The user answers "all", ids, ranges
(`M1-M5`) or exceptions; separate ids ("M1 M5") authorize those items only.

## Execute and report

```sh
bash "$SK/scripts/merge.sh" api --approve 12197@3b181078 12431@910e98c3   # after the batch: approve, squash-merge the reviewed heads
bash "$SK/scripts/merge.sh" api 12197@3b181078                            # already approved on GitHub
```

Pass each item as `<pr>@<head sha shown in the batch>`, or the helper merges whatever head is live.
It refreshes state, rejects missing/failed/pending checks, binds review and merge to the checked
head, never bypasses protection. New commits since the batch: inspect before merging. "Push fix":
push ([renovate.md](references/renovate.md#pushing): leases, races), `cycle.sh wait`, then present
the green head (SHA, CI, AI review) in a new batch. A red head, new failure or conflict goes back to
triage, never to the batch. Close with `gh pr close <n> -R "$REPO"` when authorized.

Clean up only worktrees this task created whose work is pushed or deliberately discarded; keep
unpushed fixes and report their paths. Report actions and verified state with full PR links (a
submitted merge may be queued: confirm it merged), then pending work, items left alone, next-session
PRs, the usage table and the retrospective.

## Maintaining this skill

Retrospective items (rule, recipe, flake signature, script, price) are written only once approved,
left uncommitted; after script changes run `python3 "$SK/scripts/test_helpers.py"` (mocked GitHub,
never live PRs). `scripts/flake-signatures.tsv` is the single flake list, `scripts/prices.json` the
model prices. Validate the frontmatter with the skill-creator validator when available.
`agents/openai.yaml` is Codex's UI metadata; keep instructions free of Claude-only tool names.
