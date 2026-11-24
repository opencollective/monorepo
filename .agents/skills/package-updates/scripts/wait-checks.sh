#!/usr/bin/env bash
# INTERNAL: called by cycle.sh (all modes); use cycle.sh <repo> wait. TIMEOUT_MIN, INTERVAL, SLOW_INTERVAL and
# STUCK_MIN pass through cycle.sh's environment; cycle.sh sets EXPECT_HEAD_CHANGE and HEADS_FILE itself.
# Poll every PR each time; no sticky completion state across head changes.
# After rebase: EXPECT_HEAD_CHANGE=1 and HEADS_FILE captured BEFORE requesting it.
# HEADS_FILE format: one '<pr-number> <head-sha>' per line.
# Polls every INTERVAL while a fast job (lint, types, build) is pending, every SLOW_INTERVAL once only test/e2e
# jobs are left. A check run pending unchanged for STUCK_MIN with no workflow run active on the head is STUCK
# (orphaned by its action, e.g. GraphQL Inspector): reported and counted as red, never waited on forever.
# Exit: 0 all green, 1 a completed check failed or is stuck, 2 invalid configuration, 3 timeout (still pending).
# usage: wait-checks.sh <api|frontend|rest|images|pdf|contributors-svg> <pr-number> ...
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
[[ $# -gt 0 ]] || { echo "at least one PR is required" >&2; exit 2; }
TIMEOUT_MIN="${TIMEOUT_MIN:-45}"; INTERVAL="${INTERVAL:-30}"; SLOW_INTERVAL="${SLOW_INTERVAL:-120}"
STUCK_MIN="${STUCK_MIN:-10}"; SLOW_CHECKS="${SLOW_CHECKS:-test|e2e|cypress|playwright}"
seen=$(mktemp -d); trap 'rm -rf "$seen"' EXIT
if [[ "${EXPECT_HEAD_CHANGE:-0}" == 1 && ! -f "${HEADS_FILE:-}" ]]; then
  echo "EXPECT_HEAD_CHANGE requires HEADS_FILE captured before the rebase request" >&2; exit 2
fi
deadline=$(( $(date +%s) + TIMEOUT_MIN*60 ))
while :; do
  all_done=1; result=0; fast=0
  for pr in "$@"; do
    # a network error is a pending state, not a result: one dropped connection must not end the wait
    if ! js=$(ghr pr view "$pr" -R "$REPO" --json headRefOid,statusCheckRollup,mergeStateStatus); then
      echo "#$pr: GitHub unreachable, still waiting"; all_done=0; fast=1; continue
    fi
    sha=$(jq -r .headRefOid <<<"$js")
    if [[ "${EXPECT_HEAD_CHANGE:-0}" == 1 ]]; then
      old=$(awk -v pr="$pr" '$1 == pr {print $2}' "$HEADS_FILE")
      [[ -n "$old" ]] || { echo "#$pr: missing baseline head" >&2; exit 2; }
      if [[ "$sha" == "$old" ]]; then echo "#$pr: waiting for a new head"; all_done=0; fast=1; continue; fi
    fi
    checks=$(checks_summary <<<"$js")
    if jq -e '.total == 0 or (.pending | length) > 0' <<<"$checks" >/dev/null; then
      pending=$(jq -c '.pending' <<<"$checks")
      jq -e --arg slow "$SLOW_CHECKS" '.total == 0 or any(.pending[]; test($slow; "i") | not)' <<<"$checks" >/dev/null && fast=1
      # stuck: the same pending set for STUCK_MIN, only check runs (not statuses), and no workflow run active on the head
      key="$sha $pending"; now=$(date +%s)
      [[ "$(head -1 "$seen/$pr" 2>/dev/null)" == "$key" ]] || printf '%s\n%s\n' "$key" "$now" > "$seen/$pr"
      since=$(sed -n 2p "$seen/$pr")
      if (( now - since >= STUCK_MIN*60 )) \
         && jq -e '[.statusCheckRollup[] | select(.state == "PENDING")] | length == 0' <<<"$js" >/dev/null \
         && [[ "$(ghr run list -R "$REPO" --commit "$sha" --limit 50 --json status --jq '[.[] | select(.status != "completed")] | length')" == 0 ]]; then
        echo "#$pr: STUCK ($sha) $pending: still in progress but no workflow run is active on this head; rerun its workflow"; result=1
      else
        echo "#$pr: PENDING ($sha)"; all_done=0
      fi
    elif jq -e .green <<<"$checks" >/dev/null; then
      echo "#$pr: GREEN ($sha)"
    else
      echo "#$pr: RED ($sha) $(jq -c .failing <<<"$checks")"; result=1
    fi
  done
  [[ $all_done == 1 ]] && exit "$result"
  if (( $(date +%s) >= deadline )); then echo "TIMEOUT after ${TIMEOUT_MIN}m"; exit 3; fi
  wait_s=$INTERVAL; [[ $fast == 1 ]] || wait_s=$SLOW_INTERVAL
  echo "-- next poll in ${wait_s}s"; sleep "$wait_s"
done
