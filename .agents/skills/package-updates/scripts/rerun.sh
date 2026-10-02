#!/usr/bin/env bash
# Rerun only the failed jobs of every failed workflow run on a PR's head commit.
# usage: rerun.sh <api|frontend|rest|images> <pr-number> [<pr-number> ...]
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
for pr in "$@"; do
  sha=$(pr_head_sha "$pr")
  runs=$(failed_runs_for_sha "$sha" | cut -f1)
  # Fallback: run ids behind the failing checks themselves (robust right after a run completes)
  [[ -z "$runs" ]] && runs=$(gh pr checks "$pr" -R "$REPO" --json bucket,link --jq '.[] | select(.bucket=="fail") | .link' 2>/dev/null | sed -nE 's#https://github.com/[^/]+/[^/]+/actions/runs/([0-9]+).*#\1#p' | sort -u || true)
  if [[ -z "$runs" ]]; then echo "#$pr: nothing failed on $sha"; continue; fi
  for run in $runs; do
    st=$(gh run view "$run" -R "$REPO" --json status --jq .status 2>/dev/null)
    if [[ "$st" != "completed" ]]; then echo "#$pr: run $run is $st, wait for it to complete before rerunning"; continue; fi
    if gh run rerun "$run" -R "$REPO" --failed; then echo "#$pr: reran failed jobs of run $run"
    else echo "#$pr: could not rerun $run: see error above"; fi
  done
done
