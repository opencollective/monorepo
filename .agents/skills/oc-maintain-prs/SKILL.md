---
name: oc-maintain-prs
description: Keep the operator's open, non-draft GitHub PRs healthy - update stale or conflicting branches with main, address review feedback, fix or re-run red CI, then watch until green. Use for "babysit my PRs", "clean up my open PRs", "get my PRs green", or a sweep of PRs authored by the current user.
---

# Maintain my open PRs

Sweep every open, non-draft PR authored by the current `gh` user and drive each one to green. Use `gh` for all GitHub reads and writes. Work in worktrees per the root `AGENTS.md` (`/workspace/.worktrees/pr-<number>/<repo>`, created from the repo's own checkout), and read that repo's `AGENTS.md` before changing code in it.

The parent agent runs inventory, triage, escalations, flaky-test comments and the report; each PR that needs work gets its own sub-agent for the per-PR steps (3 to 6). See [Delegate per PR](#delegate-per-pr).

Pushing commits to the operator's own PR branches is the expected output of this skill. Everything else outward-facing (merging, closing, force-pushing, resolving a reviewer's thread, changing PR scope) is the operator's call.

## 1. Inventory

```bash
gh search prs --author "@me" --state open --draft=false --limit 100 \
  --json repository,number,title,url,updatedAt,labels
```

Drop every PR labelled `experiment` or `WIP` (case-insensitive) before anything else: those are deliberately parked, so they get no updates, comments or CI re-runs and do not appear in the table. Mention only the count skipped. Operator-named PR URLs still follow this filter unless the operator says to include them.

Accept an operator-supplied narrowing (a repo, PR URLs) instead. For each PR gather one snapshot:

```bash
gh pr view <n> --repo <owner/repo> --json number,title,url,labels,headRefName,headRepositoryOwner,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,commits,statusCheckRollup,latestReviews
```

Unresolved review threads need GraphQL (`pullRequest.reviewThreads { isResolved isOutdated comments }`); also read issue-level comments. Completion: a table of every PR with age of last commit, mergeable state, unresolved thread count and CI state, shown to the operator in one short block before any change.

## 2. Triage each PR into actions

A PR can need several actions; apply them in this order, because a fresh merge changes what CI and reviewers see.

| Need | Condition |
| --- | --- |
| **Update** | `mergeable` is `CONFLICTING`, or the last commit is older than 1 month (bot comments bump `updatedAt`, so judge by commit date), or the branch is behind main and CI is red |
| **Feedback** | unresolved, non-outdated review threads or requested changes |
| **CI** | any failing required check after the update |

A PR needing none of these, with every required check already passing, is **clean**: list it and leave it alone. A PR whose only issue is pending checks stays with the parent, which watches it and dispatches a sub-agent if it turns red or conflicting.

**Escalate** (pause that PR, keep working the others, get the operator's decision with the evidence and a recommendation) when any of these holds:

- conflicts span more than ~3 files, or touch the same logic (not just imports, lockfiles, generated files, or adjacent lines)
- a review comment asks for a redesign, a new approach, or contradicts another comment, or you disagree with it
- the CI fix would grow the diff substantially or change behaviour beyond the PR's intent
- the PR targets a branch other than `main`, or is from a fork you cannot push to

The test is whether the operator would be surprised by the resulting diff. Small, mechanical, obviously-correct work proceeds; judgment calls go to them.

## Delegate per PR

Start **one sub-agent per non-clean PR**, in the background, all in a single message so they run concurrently. Queue within available concurrency when the list is long. If sub-agents are unavailable, say so to the operator and work the PRs one at a time yourself.

**Orca first.** When the Orca CLI is available (`ORCA_CLI_COMMAND` is set, or the [orca-cli](../orca-cli/SKILL.md) skill resolves an executable), look up each non-clean PR's existing Orca session before spawning anything, following [references/orca-sessions.md](references/orca-sessions.md). A PR with a live session gets the brief below sent to that session, which already holds the PR's history and worktree; only PRs without one get a sub-agent.

Brief each sub-agent (or revived session) with:

- the PR's snapshot from step 1 and its triage actions and escalation flags from step 2
- its worktree path (`/workspace/.worktrees/pr-<number>/<repo>`) and the instruction to read that repo's `AGENTS.md`
- a pointer to this file: it owns steps 3 to 6 for this one PR, including the escalation rules in step 2
- any operator instructions that apply to the PR

Each sub-agent pushes to its own PR branch, replies in its PR's threads and re-runs its PR's checks. Everything that crosses PRs or needs the operator goes back to the parent:

- **Escalation**: the sub-agent stops work on the escalated item, finishes the rest, and returns the question, evidence and a recommendation. The parent asks the operator via AskUserQuestion, then resumes the same sub-agent with SendMessage carrying the answer, so its context stays intact.
- **Flaky test**: the sub-agent returns the test's full title, the trimmed assertion and first test-file frame, the failed and passing run URLs, and the PR. The parent dedupes across sub-agents and posts per [Document flaky tests](#document-flaky-tests).

API tests share the `opencollective_test` database and reset it, so concurrent local runs clobber each other. Sub-agents run them under a shared lock: `flock /tmp/oc-api-test.lock ./scripts/test.sh <file>`.

Each sub-agent returns: actions taken, each CI failure's classification with evidence, final check and mergeable state, links to commits and thread replies, and any escalation or flaky-test record. Completion for the parent: every non-clean PR has a returned report, and every escalation is answered and resumed or left waiting on the operator.

## 3. Update against main

Follow [update-branch-with-main](../update-branch-with-main/SKILL.md): fetch, merge `origin/main`, resolve, plain push. Merge rather than rebase so the push never needs force; the operator can ask for a rebase explicitly, in which case confirm before force-pushing with `--force-with-lease`. Conflict resolution keeps both sides when independent. Completion: `gh pr view` reports `mergeable: MERGEABLE` and the merge commit is pushed.

## 4. Address feedback

For each unresolved thread, read the cited code at the PR's current head, then:

- clear, local request: make the change, commit with a Conventional Commit message (see `AGENTS.md`), and reply in the thread with a one-line pointer to the commit
- question: answer it in the thread from the code
- everything else: escalate

Leave threads unresolved; resolving is the reviewer's decision. Completion: every thread is changed, answered, or escalated, and the repo's quality scripts (TypeScript, ESLint, Prettier, relevant tests via `./scripts/test.sh <file>`) pass before pushing.

## 5. Fix or re-run CI

```bash
gh pr checks <n> --repo <owner/repo>
gh run view <run-id> --repo <owner/repo> --log-failed
```

Read the failing log, then classify:

- **Related**: the failure touches code or tests in the PR's diff, or reproduces locally. Fix it, run the failing command locally, push.
- **Unrelated**: infrastructure errors, network timeouts, a test the diff cannot reach, or the same failure on recent `main` runs (`gh run list --branch main --workflow <name>`). Re-run with `gh run rerun <run-id> --failed`.

Allow two re-runs per check. A third failure means the flake is real or the diagnosis is wrong: treat it as related, or escalate. State the classification and evidence for each failure in the final report.

### Document flaky tests

A test is **flaky** when it failed for reasons the diff cannot explain and then passed on re-run, or when the same test fails on unrelated PRs or `main`. Record each one on the shared tracker so the team can see which tests hurt most:

- API tests (mocha unit/GraphQL, `opencollective-api` CI): https://github.com/opencollective/opencollective/issues/6564
- E2E tests (Cypress, `opencollective-frontend` CI): https://github.com/opencollective/opencollective/issues/6484

The parent posts these from the sub-agents' flaky-test records. Both issues are public, so the comment carries only what helps debugging. Never paste tokens, emails of real users, or full logs. Before posting, read the issue's recent comments (`gh api repos/opencollective/opencollective/issues/<n>/comments --paginate`) and search for the test's full title. When it already appears, add a comment only if you have a new error message or a new PR to cite; a repeat of the same failure gets nothing new.

Match the style of existing comments: the failing test's describe path and name, the assertion error with its file and line, a link to the failing run, and the PR. Example:

````markdown
**Flaky on <owner/repo>#<pr>** ([failed run](<run-url>), passed on re-run)

```
1) server/graphql/v2/mutation/ExpenseMutations
     editExpense
       DRAFT
         send notification to invited external user when DRAFT is updated:
   AssertionError: expected sendMessage to have been called with arguments ...
   at test/server/graphql/v2/mutation/ExpenseMutations.test.ts:123:45
```
````

Trim the stack to the assertion and the first test-file frame, and for Cypress include the spec file name and the failed command. Post with `gh issue comment <n> --repo opencollective/opencollective --body-file <file>`. Comment once the re-run has passed, so "flaky" is an observed fact, not a guess; if the re-run fails again, treat it as a real failure instead and post nothing. List every comment posted (with link) in the final report.

## 6. Watch until green

The sub-agent watches its own PR (`gh pr checks <n> --watch --fail-fast`) and handles each state change with steps 3 to 5 again: a new failure, a new conflict because main moved, new review comments. It returns once all required checks pass and the PR is mergeable, or once the only remaining work is escalated. The parent watches pending-only PRs the same way and dispatches a sub-agent when one needs work. The sweep is done when every PR is green and mergeable, or waiting on the operator.

## 7. Report

Built from the sub-agents' reports. One table: PR, actions taken (updated / feedback / CI fix / re-run / flaky test documented), final state, and for escalated or stuck PRs the question or blocker. Do not merge anything.
