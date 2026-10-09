#!/usr/bin/env bash
# Rebase a PR branch onto origin/main in a throwaway worktree (the user's checkout is never touched).
# package.json conflicts are replayed one commit at a time with a three-way merge (reapply-bump.js); lockfile
# conflicts with manifest changes regenerate the lockfile in full. Lockfile-only commits and ambiguous
# manifest changes stop for manual resolution; never discard the resolved versions in a lockfile-only bump.
# usage: local-rebase.sh <api|frontend|rest|images|pdf|contributors-svg> <pr-number> [--push] [--squash]
#   without --push: rebases, prints the worktree path and the expected old sha; you verify, then push with
#     git -C <worktree> push --force-with-lease=<branch>:<old-sha> origin HEAD:<branch>
#   with --push: pushes after a clean rebase only, when the user authorized pushing
#   with --squash: squash the branch's commits into one before rebasing (an agent's 17 small commits over
#     80 commits of main conflict at every step; one commit conflicts once). Only for the user's or an
#     authorized agent's branch, never another human's.
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; pr="${2:?pr number}"; shift 2
push=""; squash=""
for opt in "$@"; do case "$opt" in --push) push=--push ;; --squash) squash=1 ;; *) echo "unknown option $opt" >&2; exit 2 ;; esac; done
[[ -n "$LOCAL_REPO" ]] || { echo "no local checkout for $REPO" >&2; exit 2; }
use_node24 >/dev/null
branch=$(pr_branch "$pr")
S="${SCRATCH:-${TMPDIR:-/tmp}}/package-updates"; mkdir -p "$S"; WT="$S/wt-$SHORT-$pr"
cd "$LOCAL_REPO"
git fetch -q origin main "$branch"
old=$(git rev-parse "origin/$branch")
if [[ -e "$WT" ]]; then
  # Reuse only a worktree in this repository with no commits absent from the PR branch.
  # A clean tree can still contain an unpushed fix or a completed local rebase.
  if git -C "$WT" rev-parse --git-dir >/dev/null 2>&1 \
     && [[ "$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir)" == "$(git rev-parse --path-format=absolute --git-common-dir)" ]] \
     && [[ -z "$(git -C "$WT" status --porcelain)" ]] \
     && git merge-base --is-ancestor "$(git -C "$WT" rev-parse HEAD)" "origin/$branch" \
     && [[ ! -d "$(git -C "$WT" rev-parse --git-path rebase-merge)" && ! -d "$(git -C "$WT" rev-parse --git-path rebase-apply)" ]]; then
    git -C "$WT" checkout -q --detach "origin/$branch"
    echo "reusing clean worktree $WT"
  else
    echo "worktree already exists with unpushed work, changes, a rebase, or another repository; inspect or resume it: $WT" >&2; exit 2
  fi
else
  git worktree add -q --detach "$WT" "origin/$branch"
fi
cd "$WT"
echo "worktree=$WT branch=$branch old=$old behind=$(git rev-list --count HEAD..origin/main)"
if [[ -n "$squash" ]]; then
  base=$(git merge-base HEAD origin/main); n=$(git rev-list --count "$base..HEAD")
  if (( n > 1 )); then
    title=$(gh pr view "$pr" -R "$REPO" --json title --jq .title)
    body=$(git log --reverse --format='- %s' "$base..HEAD")
    git reset -q --soft "$base" && git -c core.hooksPath=/dev/null commit -q -m "$title" -m "Squash of the $n commits of #$pr:" -m "$body"
    echo "squashed $n commits into $(git rev-parse --short HEAD)"
  fi
fi
if git -c core.hooksPath=/dev/null rebase -q origin/main; then
  echo "rebase: clean"
else
  conflicted=$(git diff --name-only --diff-filter=U | sort | tr '\n' ' ' | sed 's/ $//')
  if [[ "$conflicted" == "package-lock.json" || "$conflicted" == "package-lock.json package.json" ]]; then
    # Replay only the conflicted commit, preserving earlier rebased commits.
    echo "rebase: conflict in $conflicted, replaying this commit on the rebased HEAD"
    base=$(git rev-parse REBASE_HEAD^)
    commit=$(git rev-parse REBASE_HEAD)
    if git diff --quiet "$base" "$commit" -- package.json; then
      echo "lockfile-only conflict: stopped to preserve the PR's resolved versions; worktree retained at $WT" >&2
      echo "For an untouched Renovate branch, request Renovate's rebase via rebase.sh. Otherwise resolve manually." >&2
      exit 3
    fi
    node "$SCRIPT_DIR/reapply-bump.js" "$base" "$commit" HEAD
    git checkout --ours -- package-lock.json
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
    npm ls --package-lock-only >/dev/null 2>&1 || { echo "lockfile inconsistent after re-apply, resolve in $WT"; exit 3; }
    git add package.json package-lock.json
    GIT_EDITOR=true git -c core.hooksPath=/dev/null rebase --continue >/dev/null
    git diff origin/main --stat -- package.json package-lock.json
    echo "Conflict resolved locally; verify the result before an explicitly authorized push."
    push=""
  else
    echo "rebase: CONFLICT in: $(tr '\n' ' ' <<<"$conflicted")"
    echo "Resolve in $WT, preserving both the rebased HEAD and this commit; regenerate the full lockfile after resolving the manifest, then:"
    echo "  git add <files> && GIT_EDITOR=true git rebase --continue"
    exit 3
  fi
fi
git log --oneline "origin/main..HEAD" | sed 's/^/  on branch: /'
if [[ "$push" == "--push" ]]; then
  if ! git push -q --force-with-lease="$branch:$old" origin "HEAD:$branch"; then
    echo "push failed; worktree retained at $WT" >&2; exit 1
  fi
  echo "pushed: $branch now $(git rev-parse --short HEAD)"
  cd "$LOCAL_REPO" && git worktree remove --force "$WT"
else
  echo "not pushed. After verifying, run:"
  echo "  git -C $WT push --force-with-lease=$branch:$old origin HEAD:$branch && git -C $LOCAL_REPO worktree remove --force $WT"
fi
