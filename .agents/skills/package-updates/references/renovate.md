# Renovate and Dependabot branches: rebases, pushes, closed updates, merges

When to rebase at all is in SKILL.md (Triage, **Stale**); who may push or discard commits is in
SKILL.md, Authorization. This file is the how.

## Renovate PR anatomy

Branch `renovate/<slug>`, title `fix(deps): update dependency X to vN` / `chore(deps): update ...` /
`chore(deps): lock file maintenance` (weekly). The body ends with
`- [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box`. Ticking it (editing
the body to `[x]`) makes Renovate rebase onto main and force-push on its next run, which also
retriggers CI. Renovate sets two commit statuses of its own: `renovate/stability-days` (minimum
release age) and `renovate/artifacts`, which fails when Renovate could not regenerate the lockfile in
its sandbox; that failure has no CI run behind it, only an "Artifact update problem" comment.

Renovate stops auto-rebasing a branch once someone else pushes to it (the branch is "modified").
Ticking the box on a modified branch makes Renovate rebuild the branch from its own update, which
drops the foreign commits. So: push a compat fix onto a Renovate branch only when it is already
rebased on current main; if it later needs a rebase, do it locally (`local-rebase.sh`), never
through the checkbox. An `- abandoned` title suffix is Renovate's, not the package's: Renovate no
longer updates that PR (it carries foreign commits, or a newer major replaced the target).

## Choosing the rebase

| Branch                                                         | How                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Untouched Renovate branch, lockfile maintenance included       | `cycle.sh <repo> rebase <pr>@<sha>`: Renovate regenerates the intended update            |
| Dependabot                                                     | `cycle.sh <repo> rebase` too: GitHub's update-branch API, never a bot comment            |
| Foreign commits of the user or a previously authorized agent   | `local-rebase.sh` in a fixer, then push with an explicit lease (below)                   |
| Another human's commits                                        | Leave alone unless authorized for that PR                                                |

A local rebase stops on lockfile-only conflicts and keeps the worktree for manual resolution:
installing over main's lockfile can silently drop the update.

```sh
bash "$SK/scripts/local-rebase.sh" api 11945            # prepares locally; does not push
bash "$SK/scripts/local-rebase.sh" api 11945 --squash   # several small commits overlapping main: squash first
```

- Preserve the original head SHA for `--force-with-lease=<branch>:<old-sha>`.
- `--squash` only for the user's or an authorized agent's branch, never another human's.
- Resolve overlapping manifest changes deliberately; do not blindly restore the PR's older pins.
  Preserve main's new behaviour and run tests added by intervening migrations.
- Local rebases preserve unpushed worktrees, stop on ambiguous conflicts, and keep the complete
  regenerated lockfile. Inspect and verify the result before pushing.
- `--push` is only for an already-authorized clean rebase; after conflict resolution the script stops
  short of pushing.

## Pushing

- Append commits with an ordinary push. After a rebase, use an explicit expected-SHA lease taken
  from the remote head used to prepare the worktree. Re-read the live head before pushing; if it
  changed, inspect and reconcile the new work instead of replacing the lease with the newer SHA.
- Expand short SHAs with `git rev-parse <short>`; never type or compose a full one. Push a SHA you
  printed and checked, never a relative ref like `HEAD~1` at the end of a multi-step chain: one
  failed step earlier silently changes what it points at. Verify with `git ls-remote` afterwards.
- **Renovate force-push race.** On a Renovate branch, check again once CI has started: a Renovate run
  already in progress can force-push over the new commit a minute later. If the head lost the
  commit, re-apply it on Renovate's new head and push again; Renovate then sees the branch as
  modified.
- **Identical-tree head.** Renovate can push a new head with an identical tree right after a rebase
  request: when the live head moved and `git diff <tested-head> <new-head>` is empty, move the commit
  onto the new head (`git rebase --onto <new-head> HEAD~1`, then lease on the new head).
- A fix pushed to a bot PR from the user's account costs their approval (`repo-facts.md`): say so in
  the push batch item, or land the fix on main as its own PR and let the bot rebase.
- After replacing a PR's implementation or when its body is empty, rewrite the body (`fixing.md` §5).

## Revisiting closed updates

Updates whose PR a human closed (ESM-only packages, ecosystem gates, upstream bugs) sit under
"PR Closed (Blocked)" on the repo's Renovate Dependency Dashboard issue. Once the repo is caught up,
or when the user asks:

```sh
bash "$SK/scripts/recreate.sh" api                 # list closed entries with the close date and last human comment
bash "$SK/scripts/recreate.sh" api 10407 9976      # tick their "recreate" checkboxes (PR number or branch)
```

Re-check each close reason against today's state first (Node version, peer ranges, upstream fixes,
`fixing.md` §6). Tick only the ones whose reason no longer holds. Renovate reopens one PR per package
on its next run, which then follows the normal flow: triage, any needed compat fix on the Renovate
branch, review, batch. Preserve the bot's individual PRs unless the user asks for a combined update.
Entries left closed are reported with the reason that still holds.

## Workflow-file merges

Items that edit `.github/workflows/` merge without the `workflow` token scope as long as the squash
result keeps each workflow file exactly as on the PR head. GitHub refuses the merge only when it
would write new workflow content: the PR is behind main on a workflow file it edits, typically
because a sibling PR (another digest or actions bump on the same file) merged first. Order the batch
so those siblings merge one at a time: after each merge, rebase the next one (`cycle.sh rebase`; a
plain rebase needs no new review), wait for green, then `merge.sh --approve` on the new head. If a
merge is still refused, the approval has already landed: put `gh auth refresh -s workflow` in the
report (check scopes with `gh api user -i --silent 2>&1 | grep -i x-oauth-scopes`) or leave the merge
to the web UI.
