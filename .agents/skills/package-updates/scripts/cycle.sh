#!/usr/bin/env bash
# One CI cycle without an agent: act, wait, summarize. Run it in the background. The only documented interface
# for reruns, rebases and waits (rerun.sh, rebase.sh and wait-checks.sh are its internals).
#   rerun:  rerun.sh (failed jobs only), wait for the reran workflows to start, then wait-checks.sh
#   rerun-full: the same with the whole workflow (expired artifacts, a fix consumed by `prepare` from another repo)
#   rebase: capture heads, rebase.sh (Renovate checkbox, Dependabot update-branch), wait for the new heads
#   wait:   wait-checks.sh only
# Then failures.sh on every red PR: the full output is saved under $S/cycle/, only job names and
# signature lines are printed. Pin each PR to the head you triaged with <pr>@<sha>: a moved head is
# skipped, never acted on. A PR claimed in $S/claims/<repo>-<pr> (a fixer working on it, another
# cycle) is skipped; this script claims its PRs for its own duration.
# Exit: 0 all green, 1 a PR is red or was skipped, 2 invalid usage, 3 timeout (still pending).
# Environment: TIMEOUT_MIN (default 60), and wait-checks.sh's INTERVAL, SLOW_INTERVAL, STUCK_MIN; START_WAIT (s, default 120)
# bounds the wait for a reran workflow to restart.
# usage: cycle.sh <repo> <rerun|rerun-full|rebase|wait> <pr>[@sha] [<pr>[@sha] ...]
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
mode="${1:-}"; shift || true
case "$mode" in rerun|rerun-full|rebase|wait) ;; *) echo "usage: cycle.sh <repo> <rerun|rerun-full|rebase|wait> <pr>[@sha] ..." >&2; exit 2 ;; esac
[[ $# -gt 0 ]] || { echo "at least one PR is required" >&2; exit 2; }
S="${S:-${SCRATCH:-${TMPDIR:-/tmp}}/package-updates}"
claims="$S/claims"; out="$S/cycle"; mkdir -p "$claims" "$out"
stamp="$(date +%Y%m%d-%H%M%S)-$$"
heads="$out/$SHORT-$stamp.heads"; : > "$heads"
skipped=(); prs=(); claimed=()
release() { local p; for p in ${claimed[@]+"${claimed[@]}"}; do rm -f "$claims/$SHORT-$p"; done; }
trap release EXIT

for arg in "$@"; do
  pr="${arg%@*}"; want=""; [[ "$arg" == *@* ]] && want="${arg#*@}"
  claim="$claims/$SHORT-$pr"
  if ! (set -o noclobber; echo "cycle.sh $mode (pid $$)" > "$claim") 2>/dev/null; then
    skipped+=("#$pr: SKIPPED claimed by $(cat "$claim" 2>/dev/null || echo unknown) ($claim)"); continue
  fi
  if ! sha=$(ghr pr view "$pr" -R "$REPO" --json headRefOid --jq .headRefOid); then
    rm -f "$claim"; skipped+=("#$pr: SKIPPED GitHub unreachable"); continue
  fi
  if [[ -n "$want" && "$sha" != "$want"* ]]; then
    rm -f "$claim"; skipped+=("#$pr: SKIPPED head moved from $want to $sha, re-triage"); continue
  fi
  prs+=("$pr"); claimed+=("$pr"); echo "$pr $sha" >> "$heads"
done

echo "== cycle $SHORT $mode $stamp =="
wait_env=()
if [[ ${#prs[@]} -gt 0 && "$mode" == rerun* ]]; then
  full=(); [[ "$mode" == rerun-full ]] && full=(--full)
  action=$(bash "$SCRIPT_DIR/rerun.sh" "$SHORT" ${full[@]+"${full[@]}"} "${prs[@]}" 2>&1) || true
  echo "$action"
  # old completed checks stay visible for a moment: wait until each reran workflow has restarted
  for run in $(sed -nE 's/^#[0-9]+: reran (failed|all) jobs of run ([0-9]+)$/\2/p' <<<"$action"); do
    started=0
    for (( i = 0; i < ${START_WAIT:-120}; i += 5 )); do
      st=$(gh run view "$run" -R "$REPO" --json status --jq .status 2>/dev/null || true)
      [[ -n "$st" && "$st" != completed ]] && { started=1; break; }
      sleep 5
    done
    [[ $started == 1 ]] || echo "run $run: no new attempt seen after ${START_WAIT:-120}s, its checks may be the old ones"
  done
elif [[ ${#prs[@]} -gt 0 && "$mode" == rebase ]]; then
  action=$(bash "$SCRIPT_DIR/rebase.sh" "$SHORT" "${prs[@]}" 2>&1) || true
  echo "$action"
  requested=()
  for pr in "${prs[@]}"; do
    if grep -qE "^#$pr: (rebase requested|checkbox already ticked)" <<<"$action"; then requested+=("$pr")
    else skipped+=("#$pr: SKIPPED $(grep -E "^#$pr: " <<<"$action" | tail -1 | sed "s/^#$pr: //")"); fi
  done
  prs=(${requested[@]+"${requested[@]}"})
  wait_env=(EXPECT_HEAD_CHANGE=1 HEADS_FILE="$heads")
fi

code=0
if [[ ${#prs[@]} -gt 0 ]]; then
  wlog="$out/$SHORT-$stamp.wait.log"
  env ${wait_env[@]+"${wait_env[@]}"} TIMEOUT_MIN="${TIMEOUT_MIN:-60}" \
    bash "$SCRIPT_DIR/wait-checks.sh" "$SHORT" "${prs[@]}" > "$wlog" 2>&1 || code=$?
  [[ $code == 2 ]] && { tail -5 "$wlog"; exit 2; }
fi

echo "== result (exit $code) =="
for pr in ${prs[@]+"${prs[@]}"}; do
  line=$(grep -E "^#$pr: " "$wlog" | tail -1 || true)
  echo "${line:-#$pr: no state recorded, see $wlog}"
  if grep -q ': RED ' <<<"$line"; then
    f="$out/$SHORT-$pr-$stamp.failures.txt"
    bash "$SCRIPT_DIR/failures.sh" "$SHORT" "$pr" 40 > "$f" 2>&1 || true
    grep -E '^== run |^-- job |^   - |classification:|^== renovate' "$f" | head -20 | sed 's/^/   /'
    echo "   full: $f"
  fi
done
for line in ${skipped[@]+"${skipped[@]}"}; do echo "$line"; done
[[ $code == 3 ]] && echo "TIMEOUT: pending PRs are not green; run cycle.sh $SHORT wait on them again"
if [[ $code == 0 && ${#skipped[@]} -gt 0 ]]; then code=1; fi
if [[ ${#prs[@]} -eq 0 ]]; then code=1; fi
exit "$code"
