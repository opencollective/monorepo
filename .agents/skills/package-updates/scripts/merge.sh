#!/usr/bin/env bash
# Merge reviewed heads. --approve records an explicitly authorized review first.
# usage: merge.sh <api|frontend|rest|images|pdf|contributors-svg> [--approve] <pr-number>[@<head-sha-prefix>] ...
# With @sha, the PR is skipped unless its live head still starts with the sha the user reviewed.
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
approve=0
if [[ "${1:-}" == "--approve" ]]; then approve=1; shift; fi
[[ $# -gt 0 ]] || { echo "at least one PR is required" >&2; exit 2; }
me=$(gh api user --jq .login)
merge_err=$(mktemp "${TMPDIR:-/tmp}/package-merge.XXXXXX")
trap 'rm -f "$merge_err"' EXIT
fields=title,state,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,isDraft,author,reviewDecision,latestReviews
result=0
for arg in "$@"; do
  pr="${arg%%@*}"; expected=""
  [[ "$arg" == *@* ]] && expected="${arg#*@}"
  js=$(gh pr view "$pr" -R "$REPO" --json "$fields")
  # GitHub recomputes mergeability after every merge on the base branch: UNKNOWN is transient, ask again
  for attempt in 1 2 3; do
    [[ "$(jq -r .mergeable <<<"$js")" == "UNKNOWN" ]] || break
    sleep 5
    js=$(gh pr view "$pr" -R "$REPO" --json "$fields")
  done
  title=$(jq -r .title <<<"$js")
  sha=$(jq -r .headRefOid <<<"$js")
  if [[ -n "$expected" && "$sha" != "$expected"* ]]; then
    echo "#$pr: head is now $sha, not the reviewed $expected; skipped"; result=1; continue
  fi
  checks=$(checks_summary <<<"$js")
  if ! jq -e '.state == "OPEN" and .isDraft == false and .mergeable == "MERGEABLE"' <<<"$js" >/dev/null; then
    echo "#$pr: not open, ready and mergeable; skipped"; result=1; continue
  fi
  if ! jq -e .green <<<"$checks" >/dev/null; then
    echo "#$pr: checks not green: $(jq -c . <<<"$checks"); skipped"; result=1; continue
  fi
  # Every merge needs an approval, even where branch protection requires none (empty reviewDecision):
  # GitHub's APPROVED decision, an approving review by someone else, or --approve on a PR not ours.
  review=$(jq -r '.reviewDecision // ""' <<<"$js")
  own=0; [[ "$(jq -r .author.login <<<"$js")" == "$me" ]] && own=1
  if [[ "$review" == "CHANGES_REQUESTED" ]]; then echo "#$pr: changes requested by a reviewer; skipped"; result=1; continue; fi
  approved=0
  if [[ "$review" == "APPROVED" ]]; then approved=1
  elif [[ -z "$review" ]] && jq -e --arg me "$me" 'any((.latestReviews // [])[]; .state == "APPROVED" and .author.login != $me)' <<<"$js" >/dev/null; then approved=1
  fi
  if [[ "$approved" != 1 ]]; then
    if [[ "$own" == 1 ]]; then
      echo "#$pr: your own PR needs another maintainer's approval; skipped"; result=1; continue
    fi
    if [[ "$approve" != 1 ]]; then
      echo "#$pr: needs the user's review (rerun with --approve after the batch); skipped"; result=1; continue
    fi
  fi
  if [[ "$approve" == 1 && "$own" != 1 ]]; then
    if ! gh api --method POST "repos/$REPO/pulls/$pr/reviews" -f event=APPROVE -f commit_id="$sha" >/dev/null; then
      echo "#$pr: approval failed"; result=1; continue
    fi
  fi
  if gh pr merge "$pr" -R "$REPO" --squash --match-head-commit "$sha" --subject "$title (#$pr)" --body "" 2>"$merge_err"; then
    echo "#$pr: merge submitted for $sha"
  elif grep -q "without .workflow. scope" "$merge_err"; then
    # The squash would write workflow content absent from the PR head (behind main on that file): rebase, or the token needs the workflow scope
    echo "#$pr: merge failed: the squash would write a workflow file not on the PR head and the gh token lacks the workflow scope; rebase the PR and merge the green head, or the user runs gh auth refresh -s workflow / merges from the web UI"; result=1
  else echo "#$pr: merge failed:"; cat "$merge_err"; result=1; fi
done
exit "$result"
