---
name: package-updates
description: Review and maintain dependency-update PRs (Renovate, Dependabot, and lockfile maintenance) in Open Collective api, frontend, rest, images, and pdf. Use for inventory, CI triage, retries, rebases, compatibility fixes, and authorized merges. Status and review requests remain read-only.
---

# Package updates

Maintain dependency PRs through investigation, verification, and the actions the user authorized.
Scope is api, frontend, rest, images and pdf unless the user names a repo or PR. A review-only request produces findings;
it does not authorize retries, edits to PRs, pushes, or merges. Reviewing this skill's own files does
not start maintenance on live PRs.

Read [references/repo-facts.md](references/repo-facts.md) once per maintenance session. Its dated
observations are starting points: verify relevant workflow, engine, and branch-protection settings
before relying on them. Read [references/failures.md](references/failures.md) for red checks and
[references/fixing.md](references/fixing.md) before changing service code, along with that repo's AGENTS.md.

## Execution

- `SK` is the directory of this SKILL.md; run scripts as `bash "$SK/scripts/<name>.sh"` (needs `gh`,
  `jq`; fixes need the repo's Node/npm, see `use_node24` in `_lib.sh`).
- Long waits: use the host's background or yielded-process mechanism. In Codex, start the command
  with a short `exec_command` yield, then use `write_stdin` with its session ID; if the orchestration
  tool itself yields a cell ID, resume it with `functions.wait`. Keep individual waits under 60s
  and give concise progress updates during long CI or review runs.
- Set `S="${SCRATCH:-${TMPDIR:-/tmp}}/package-updates"` and `mkdir -p "$S"` for
  worktrees and inventory outside the user's checkouts. Existing worktrees are preserved:
  inspect or resume them. `git worktree list` in each repo also shows worktrees left by other agent
  sessions. Check worktrees before redoing work on the same PR; the scratch path depends on
  `SCRATCH` and `TMPDIR`, not on which agent is running.
- Ask for missing authorization only after preparing the concrete batch. Use a question tool
  only if it supports approval requests in the current mode; otherwise ask in the final message.
  Codex's Plan-mode `request_user_input` is not an approval tool. Elapsed time is not consent.
  Authorization given earlier in the session persists.
- The user's shell may be zsh: an unquoted `$var` does not word-split (loop with `bash -c`), and
  `$H:refs/...` applies the `:r` modifier. Brace every variable next to a colon: `"${H}:refs/heads/<branch>"`.
- Re-read live PR state right before asking or acting: the user often approves, merges or comments
  from GitHub while a question is open. A batch item already done there is reported, never re-run.

## Keep output useful

- Cache inventory once per repo and reuse its fields. Query again for omitted PRs, pagination,
  missing evidence, or changed state.
- Never print a PR body whole (Renovate bodies carry full release notes):
  `gh pr view N --json body -q .body | sed -n '/Release Notes/,/Configuration/p' | head -60`.
- Bound read-only output with `head`/`tail`; never truncate a mutating script's output.
- Batch authorization requests; report the final state together and keep progress updates concise.

## Authorization

For a maintenance request, inventory, log reading, one justified retry per distinct failure,
rebases of untouched bot branches, and local fix preparation are routine work. For a review-only
request, keep these actions read-only.

Prepare a concrete, verified result before asking for any authorization still needed:

| Action                                                   | Authorization                            |
| -------------------------------------------------------- | ---------------------------------------- |
| Push a fix or locally rebased branch; open a fix/prep PR | User approval, unless already authorized |
| Record a GitHub approving review; merge; close           | User approval, unless already authorized |
| Modify another human's PR or discard their commits       | Explicit authorization for that PR       |
| Comments (except §1 blocked marking), branch deletion    | Explicit authorization for that action   |

Merging is two steps. The review batch (§5) is step one: the user's yes on a merge item is their
review, recorded on GitHub as an approval from their account. Step two is automatic: the PR is
merged as soon as it is green and reviewed (`merge.sh --approve`). This covers only PRs that are
already green when the user reviews them. A PR that receives a fix (a pushed commit, a rebase with
code changes) needs a final human review of its new head: approve only once CI on that head is
green **and** the user has approved it in a new batch, and merge only after that approval has
landed on GitHub. A yes to "push fix" authorizes the push, never the approval or the merge. Their own PRs cannot be
self-approved: use an existing qualifying review or report the missing reviewer. Administrative
bypass is not the default remedy. Do not re-ask for
actions already authorized. Never post comments, except the blocked-PR comment (§1). Never run `gh pr merge --admin` yourself.

## 1. Inventory and triage

```sh
bash "$SK/scripts/status.sh"                                          # fast status: all repos, no behind-main queries
bash "$SK/scripts/list-prs.sh" api --json > "$S/inventory-api.json"   # full inventory; jq from this file afterwards
```

A plain "status" ask gets the fast path: run `status.sh`, report from its output (green, red job
names, conflicting, foreign commits, blocked label) with the recommended next steps, and stop. No
log downloads, no release notes, no rebases, no AI reviews; investigate a specific PR only when the
user points at it or asks for a full triage.

Inventory includes bot PRs and the authenticated user's `(deps)` PRs, mergeability, reviews,
commits behind main, foreign authors, and check state. It queries up to 100 open PRs; if that limit
is reached, expand the inventory before claiming completeness. Prefetch once into `$S` and read
the file; GitHub is queried again only to refresh right before acting (`merge.sh` does its own
refresh). Only include non-dependency PRs when requested. Fetch explicitly named PRs directly if absent
from the inventory filter.

For every PR, choose **green**, **flake**, **stale**, **real failure**, **blocked**, or **leave alone**.

```sh
bash "$SK/scripts/failures.sh" api 12194
```

- **Green:** checks completed successfully, mergeable, no unresolved blocking review. Cancelled,
  action-required, unknown, or absent checks are not green. The scripts ignore pending CodeRabbit
  and Seer advisory checks; GitHub still enforces required checks at merge time.
- **Flake:** logs show a known transient failure unrelated to the bump. Read the full failing block;
  a spec name appearing in the log is not proof of a flake. `failures.sh` classifies isolated
  failure summaries; when it cannot isolate one, whole-log matches are incidental hints only. Retry once. A repeated failure requires
  investigation, but does not by itself prove the dependency caused it.
- **Stale:** conflicting, checks about a week old, or main contains a needed fix. Rebase instead of
  rerunning stale artifacts. Do not rebase a fresh, green, mergeable PR just because it is behind.
- **Real failure:** deterministic type/build/runtime failure; inspect release notes and usages.
- **Major:** a major bump of a critical dependency is never proposed for an agent merge, even when
  green and approved. Critical means payment providers (stripe, paypal, transferwise/wise, plaid,
  gocardless), auth and crypto (jsonwebtoken, passport, fido2/webauthn), persistence (sequelize, pg,
  kysely, redis), the web framework (express, next, react) and the GraphQL stack (graphql, @apollo/*),
  plus anything the user names. Put the `major` label on the PR (create it with color `d93f0b` if the
  repo lacks it; routine, no batch) and list the PR under **Major** in the batch as information: the
  user merges it themselves from GitHub. Other majors (lint tooling, build tooling, small libraries)
  are ordinary candidates once their compat fix is reviewed.
- Security bumps (`[security]` in the title, Dependabot alerts) come first in the batch and are
  never closed for convenience. An `abandoned` title is a caution flag (stale, re-check the
  release notes), not a skip.
- **Blocked:** `renovate/artifacts` red (lockfile regeneration failed in Renovate's sandbox, nothing
  to rerun: fix the cause on main, usually `engines.npm` drift, then tick the checkbox), an upstream
  fix is needed, main itself fails the same test, another PR must merge first, or an ecosystem gate
  (a dependency that doesn't support the new version yet). **Mark every blocked PR on GitHub**, as
  routine work that needs no batch: add the `blocked` label (if the repo lacks it, create it with color
  `b60205` like api's) and post one comment starting `Blocked by <PR, package or upstream issue>.`,
  then why (evidence: version, peer range, failing check), what unblocks it, and why it stays open
  rather than closed. Skip if already labelled with an up-to-date comment. When the blocker clears,
  remove the label.
- A repeated failure exhausts the routine retry budget; investigate before retrying again. A cancelled shard next to a failed one is
  fail-fast collateral, not a second failure.
- **Leave alone:** another human's work without permission, or insufficient evidence to act.

Check main before blaming the bump:
`gh run list -R "$REPO" --branch main --limit 8 --json conclusion,createdAt,displayTitle,workflowName`.
Compare failing logs/specs, not merely job names. Foreign commits must never be discarded by a
Renovate checkbox; the helper refuses branches with non-bot or unknown commit authors.

## 2. Retry or rebase when authorized

```sh
bash "$SK/scripts/rerun.sh" api 12198 12199
bash "$SK/scripts/rebase.sh" api 12175
bash "$SK/scripts/local-rebase.sh" api 11945    # prepares locally; does not push
```

Track attempted retries in session notes; `rerun.sh` does not enforce the one-retry budget itself.
Read/download logs first. If the fix is in another repo consumed by `prepare`, rerun the whole
workflow, not just failed jobs. Cancel first only if that run is still active, then await completion
before `gh run rerun <id> -R "$REPO"`.

Prefer `rebase.sh` for untouched Renovate branches, including lockfile maintenance: Renovate
regenerates the intended update. A local rebase stops on lockfile-only conflicts and retains the
worktree for manual resolution; installing over main's lockfile can silently drop the update.

The Renovate checkbox rebuilds the branch and may discard custom commits. Use a local rebase for
foreign commits belonging to the user or previously authorized agents, preserving the original
head SHA for `--force-with-lease=<branch>:<old-sha>`. For an authorized branch with several small
commits overlapping changes on main, consider `local-rebase.sh … --squash` before rebasing.
Resolve overlapping manifest changes deliberately; do not blindly restore the PR's older pins.
Preserve main's new behavior and run tests added by intervening migrations. Local rebases preserve
unpushed worktrees, stop on ambiguous conflicts, and keep the complete regenerated lockfile.
Inspect and verify the result before pushing. `--push` is only for an already-authorized clean
rebase; after conflict resolution the script stops short of pushing. For Dependabot use GitHub's
update-branch API, not a bot comment.

**Revisiting closed updates.** Updates whose PR a human closed (ESM-only packages, ecosystem gates,
upstream bugs) sit under "PR Closed (Blocked)" on the repo's Renovate Dependency Dashboard issue
(api #6506). Once the repo is caught up, or when the user asks:

```sh
bash "$SK/scripts/recreate.sh" api                 # list closed entries with the close date and last human comment
bash "$SK/scripts/recreate.sh" api 10407 9976      # tick their "recreate" checkboxes (PR number or branch)
```

Re-check each close reason against today's state first (Node version, peer ranges, upstream fixes,
`fixing.md` §6). Tick only the ones the reason no longer holds for; ticking is routine once the user
asked to revisit. Renovate reopens one PR per package on its next run, which then follows the normal
flow: triage, any needed compat fix on the Renovate branch (§3), AI review, batch. Preserve the
bot's individual PRs unless the user asks for a combined update. Entries left
closed are reported with the reason that still holds.

## 3. Investigate and prepare fixes

For maintenance or investigation requests, continue from a deterministic failure into diagnosis and
local fix preparation without asking whether to investigate. Reading logs, comparing main, checking
repo history, and reproducing in an isolated worktree need no additional task approval. A plain
status request stops after the fast inventory (§1). Request any missing push/merge authorization
only after the fix is concrete and verified.

Follow [references/fixing.md](references/fixing.md): read release notes for each intermediate major,
inventory usage, choose a compat commit, prep PR, or replacement branch, then implement in a
scratch worktree. Follow the service's AGENTS.md, disable hooks only for the scratch workflow,
and run required type, lint, format and relevant tests. Commit locally; push only when authorized.
Allowed fixes: types, imports, snapshots, lockfile or peer-dep resolution, and the call-site
changes the bump requires. Never an unrelated change to get a PR green; that is a "real failure"
to report, not to paper over.

For lockfile maintenance, inspect transitive changes as well as package.json: an unchanged manifest
can still split a shared runtime registry across dependency versions. For WebAuthn's
`Cannot get schema for 'ECDSASigValue' target`, use the ASN.1 recipe in
[references/failures.md](references/failures.md#webauthn-asn1-schema-registry-mismatch).

Green CI on a compat commit (a human's or an agent's) proves only what the tests exercise. When the
commit rewrites a matching surface (routes, parsers, schemas), diff the behaviour on the real input
matrix, old version against new, before calling it ready; see the Express 5 recipe in
[references/fixing.md](references/fixing.md#express-5-route-syntax-path-to-regexp-v8).

To attribute a local failure to the bump, compare with `origin/main` under the same environment
and run the failing suite alone (rest's suites hit a live API and time out under a full run).
Record root cause, changed files, verification, worktree path, and destination for the batch.
For an upstream bug or ecosystem gate, explain the options (hold, fix, or close) and the effect
of closing on Renovate's future proposals. Re-check dated ecosystem notes before using them.

## 4. Wait and re-triage

```sh
TIMEOUT_MIN=45 bash "$SK/scripts/wait-checks.sh" api 12198 12199
```

Start with a short tool yield and continue the process while keeping the user informed. Exit 0
means all watched PRs are green, 1 means completed checks include failures, 2 means timeout or
invalid configuration. The helper rechecks every PR on every poll, including heads that changed.

For a rebase, capture `<pr-number> <head-sha>` lines in a `HEADS_FILE` **before** requesting it, then
run with `EXPECT_HEAD_CHANGE=1 HEADS_FILE=<absolute-path>`. This waits for Renovate's new head
rather than returning the old head's result. For reruns, verify the requested run's new attempt
has started before polling PR checks; old completed checks can remain briefly visible.

Any repeat failure goes back to investigation. A timeout is a pending state, not success.
Typical historical durations are 20–26 minutes for API tests and 3–25 minutes per e2e shard.

## 4b. AI review first, then the user

Before an item reaches the batch, it gets an AI review and every finding is integrated or dismissed:

```sh
bash "$SK/scripts/ai-review.sh" api 12197                 # Codex + CodeRabbit findings on the PR head (threads and review bodies)
bash "$SK/scripts/ai-review.sh" rest --worktree "$S/wt-rest-671" "Hyperwatch v5"   # unpushed fix: codex review --base origin/main
bash "$SK/scripts/ai-review.sh" api --resolve <thread-id>  # after a fix is committed for that thread; never a comment
```

- Codex and CodeRabbit review api and frontend PRs on every push. On images and rest the Codex connector reviews only
  when someone comments `@codex review` (the user posts it, not the agent); read its threads with `ai-review.sh`. Otherwise PRs get the local `codex review` in a worktree of the PR head. Unpushed fixes always get the local review.
- Each finding is either **integrated** (commit on the branch, rerun the checks, resolve the thread) or
  **dismissed** with a one-line reason. Nothing is left unanswered, nothing is posted as a comment.
- The batch line carries the outcome: `AI review: 2 findings, 1 fixed (date bounds), 1 dismissed (nit,
constants already used)`. An item with an unaddressed finding is not a merge candidate yet.
- Dependency-only bumps with no code change and no bot finding say `AI review: none` and move on.
- After integrating findings, review the new head. Limit automated review/fix cycles to two per
  item per session; report remaining substantive findings and hold the merge. No findings does
  not prove a review ran: verify the reviewed SHA and report missing or incomplete coverage.
  `ai-review.sh --worktree` exits 2 when Codex stops early (usage limit, interruption): the batch line
  then says `AI review: pending (Codex limit until <time>)`, never `none`. If the configured model is refused
  ("model is not supported when using Codex with a ChatGPT account"), stop and ask the user: never switch
  to another model (`CODEX_MODEL`) on your own, other models can cost much more. Do not edit `~/.codex/config.toml`.
- Resolve GitHub threads only within existing authorization, after the fix is pushed and verified.
  A local commit alone does not resolve the PR finding.
- The routine for "check feedback" on a PR (what the user calls "the usual"): read the open threads
  with `ai-review.sh`; verify each finding against the installed package source and a live repro; fix with a
  test that fails on the current head and passes with the fix; push, resolve the thread, wait for
  CI and present the green head. "The usual" authorizes push and resolve on that PR, not approval
  or merge. Review summaries and `@codex review` comments are not threads and cannot be resolved.
  Local reviews require committed, clean worktrees and report the reviewed head and base SHAs.
  A missing final verdict or truncated GitHub review history is incomplete coverage; inspect the
  transcript or paginate before reporting a completed review.

## 5. One concrete approval batch

For maintenance requests, batch concrete actions still needing authorization. Execute actions
already authorized without asking again. For status and review-only requests, report findings
and recommended next steps without an approval question.

```
Merge (green, fresh, AI-reviewed; your yes = approval from your account, then merged)
  M1  api #12197  @hyperwatch/hyperwatch 4.3.1→5      all checks green, release notes: no breaking change for our 4 call sites; AI review: 1 finding, dismissed (fallback style nit)
  M2  frontend #12431  framer-motion→motion            green after rebase, your import-migration commits on the branch
Push fix (then back to you for a final review once green)
  F1  api #12194  sentry-javascript v11                 commit ready in wt-api-12194, type-check + sentry suite pass
Awaiting another reviewer
  O1  frontend #12426  @graphql-codegen/cli v7          green; cannot self-approve
Major (label `major`; green and approved, merged by you from GitHub, not proposed here)
  api #11701  stripe 18→22                              approved by a maintainer, all checks green on a2f8337d
Close
  C1  api #12130  opensearch 3.6.0                      upstream d.ts bug, no fixed release; Renovate re-proposes on the next version
Left alone (no action proposed)
  api #11701 stripe v22: carries another maintainer's commits, 249 behind, needs its authors
```

Items that edit `.github/workflows/` merge without the `workflow` token scope as long as the squash
result keeps each workflow file exactly as on the PR head. GitHub refuses the merge only when it would
write new workflow content: the PR is behind main on a workflow file it edits, typically because a
sibling PR (another digest or actions bump on the same file) merged first. Order the batch so those
siblings merge one at a time: after each merge, rebase the next one (`rebase.sh`, a plain rebase needs
no new review), wait for green, then `merge.sh --approve` on the new head. If a merge is still refused,
the approval has already landed: put `gh auth refresh -s workflow` in the report (check scopes with
`gh api user -i --silent 2>&1 | grep -i x-oauth-scopes`) or leave the merge to the web UI.

One line per item with the head SHA when it matters. The user answers with "all", item ids, ranges
(`M1-M5`), or exceptions. Separate ids ("M1 M5") authorize those items only. Use a table for larger batches.

## 6. Execute and report

```sh
bash "$SK/scripts/merge.sh" api --approve 12197 12431   # after the batch: approve from the user's account, squash-merge
bash "$SK/scripts/merge.sh" api 12197                   # PR already approved on GitHub
```

The merge helper refreshes state, rejects missing/failed/pending checks, binds the review and the
merge to the checked head, reports missing approval for the user's own PRs, and never bypasses
branch protection. New commits since the batch → inspect before merging. For "push fix": push,
wait (§4), then present the green head in a new batch for the user's final review (head SHA, CI
result, AI review outcome). Only after their yes: `merge.sh --approve` on that exact head. A red
head, a new failure or a conflict goes back to §1, never to the batch.

Close with `gh pr close <n> -R "$REPO"` when authorized. Append commits with an ordinary push;
use an explicit expected-SHA lease after rebasing, taken from the remote head used to prepare the
worktree. Re-read the live head before pushing; if it changed, inspect and reconcile the new work
instead of replacing the lease with the newer SHA. Expand
short SHAs with `git rev-parse <short>`, never type or compose a full one. Push a SHA you printed and checked, never a
relative ref like `HEAD~1` at the end of a multi-step chain: one failed step earlier (a bad flag,
a conflict) silently changes what `HEAD~1` points at. Verify with `git ls-remote` after the push. Clean up only worktrees created by this task
whose work is safely pushed or deliberately discarded; retain unpushed fixes and report paths.

Report actions and verified current state using full PR links, then pending work and items left
alone. A successful merge submission may enter a queue; confirm the PR is merged before saying
so. Keep intermediate progress concise. Bound verbose read-only output, but never truncate
mutating script output with `head`/`tail`: it can kill a batch early or hide an error.

## Maintaining this skill

Run `python3 "$SK/scripts/test_helpers.py"` after helper changes. Tests use temporary Git repos
and mocked GitHub responses; they never mutate live PRs.
Validate the skill frontmatter with the skill-creator validator when available. Codex discovers
this repository skill under `.agents/skills/package-updates`; `agents/openai.yaml` supplies its UI
metadata. Keep the shared instructions independent of Claude-only tool names or directories.
