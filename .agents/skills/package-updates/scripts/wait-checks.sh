#!/usr/bin/env bash
# Poll every PR each time; no sticky completion state across head changes.
# After rebase: EXPECT_HEAD_CHANGE=1 and HEADS_FILE captured BEFORE requesting it.
# HEADS_FILE format: one '<pr-number> <head-sha>' per line.
# usage: wait-checks.sh <api|frontend|rest|images> <pr-number> ...
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
[[ $# -gt 0 ]] || { echo "at least one PR is required" >&2; exit 2; }
TIMEOUT_MIN="${TIMEOUT_MIN:-45}"; INTERVAL="${INTERVAL:-30}"
if [[ "${EXPECT_HEAD_CHANGE:-0}" == 1 && ! -f "${HEADS_FILE:-}" ]]; then
  echo "EXPECT_HEAD_CHANGE requires HEADS_FILE captured before the rebase request" >&2; exit 2
fi
deadline=$(( $(date +%s) + TIMEOUT_MIN*60 ))
while :; do
  all_done=1; result=0
  for pr in "$@"; do
    js=$(gh pr view "$pr" -R "$REPO" --json headRefOid,statusCheckRollup,mergeStateStatus)
    sha=$(jq -r .headRefOid <<<"$js")
    if [[ "${EXPECT_HEAD_CHANGE:-0}" == 1 ]]; then
      old=$(awk -v pr="$pr" '$1 == pr {print $2}' "$HEADS_FILE")
      [[ -n "$old" ]] || { echo "#$pr: missing baseline head" >&2; exit 2; }
      if [[ "$sha" == "$old" ]]; then echo "#$pr: waiting for a new head"; all_done=0; continue; fi
    fi
    checks=$(checks_summary <<<"$js")
    if jq -e '.total == 0 or (.pending | length) > 0' <<<"$checks" >/dev/null; then
      echo "#$pr: PENDING ($sha)"; all_done=0
    elif jq -e .green <<<"$checks" >/dev/null; then
      echo "#$pr: GREEN ($sha)"
    else
      echo "#$pr: RED ($sha) $(jq -c .failing <<<"$checks")"; result=1
    fi
  done
  [[ $all_done == 1 ]] && exit "$result"
  if (( $(date +%s) >= deadline )); then echo "TIMEOUT after ${TIMEOUT_MIN}m"; exit 2; fi
  sleep "$INTERVAL"
done
