#!/usr/bin/env bash
# Show failed jobs, error excerpts, and signatures from isolated failure summaries.
# Without a supported summary, whole-log matches are incidental hints, never a diagnosis.
# usage: failures.sh <api|frontend|rest|images> <pr-number> [max-lines-per-job]
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; pr="${2:?pr number}"; max="${3:-30}"
SIG="$SCRIPT_DIR/flake-signatures.tsv"
sha=$(pr_head_sha "$pr")
echo "PR #$pr head=$sha"
echo "== changed packages =="
gh pr diff "$pr" -R "$REPO" 2>/dev/null | awk '/^diff --git/{p=($0 ~ /package\.json$/ && $0 !~ /package-lock/)} p && /^[-+] +"/' || true
echo
# Renovate's own status: "renovate/artifacts" fails when Renovate could not regenerate the lockfile. No CI run to read;
# the reason is in Renovate's "Artifact update problem" comment. Fix the cause on main, then tick the rebase checkbox.
if gh api "repos/$REPO/commits/$sha/status" --jq '.statuses[] | select(.context=="renovate/artifacts") | .state' 2>/dev/null | grep -q failure; then
  echo "== renovate/artifacts: Renovate failed to regenerate package-lock.json (not a CI failure) =="
  gh api "repos/$REPO/issues/$pr/comments" --jq '[.[] | select(.user.login=="renovate[bot]" and (.body|test("Artifact update problem")))] | last | .body' 2>/dev/null \
    | sed -n '/^```/,/^```/p' | grep -v '^```' | grep -E 'npm (error|ERR)|error|Error' | head -8 | sed 's/^/   /' || true
  echo "   classification:"
  echo "   - renovate-artifacts: lockfile regeneration failed in Renovate's sandbox (see references/failures.md, usually engines.npm / npm major drift)"
  echo
fi
runs=$(failed_runs_for_sha "$sha")
if [[ -z "$runs" ]]; then
  echo "No failed workflow runs on head commit. Checks may be pending, cancelled by a newer push, or already rerun."
  gh pr checks "$pr" -R "$REPO" 2>/dev/null | grep -v -E '\bpass\b' || true
  exit 0
fi
while IFS=$'\t' read -r run wf concl; do
  echo "== run $run ($wf, $concl) =="
  gh run view "$run" -R "$REPO" --json jobs --jq '.jobs[] | select(.conclusion=="failure" or .conclusion=="timed_out") | "\(.databaseId)\t\(.name)"' \
  | while IFS=$'\t' read -r job name; do
      echo "-- job $job: $name"
      # gh prefixes every line with "<job>\t<step>\t<timestamp> "; drop that and ANSI colours
      log=$(gh run view -R "$REPO" --job "$job" --log 2>/dev/null | cut -f3- | perl -pe 's/^\S+ //; s/(?:\e|\^\[)\[[0-9;]*m//g' || true)
      # while the run is still in progress `gh run view --log` prints nothing; the REST endpoint works for finished jobs
      [[ -z "$log" ]] && log=$(gh api --allow-escape-sequences "repos/$REPO/actions/jobs/$job/logs" 2>/dev/null | perl -pe 's/(?:\e|\^\[)\[[0-9;]*m//g; s/^\S+ //' || true)
      grep -E '✖|[0-9]+ failing|AssertionError|CypressError|Timed out|Error:|error TS|ERR!|deadlock|FAIL |npm error|exit code|##\[error\]' <<<"$log" \
        | grep -v -E 'node_modules|^\s*$' | awk '!seen[$0]++' | tail -n "$max" | cut -c1-240 || true
      failure_block=$(awk -f "$SCRIPT_DIR/failure-block.awk" <<<"$log")
      if [[ -n "$failure_block" ]]; then
        printf '%s\n' "$failure_block" | sed -n '1,60p' | cut -c1-240 | sed 's/^/   | /'
        echo "   failure-summary signatures (verify the cause before retrying):"
        evidence="$failure_block"
      else
        echo "   classification: unclassified (no supported failure summary)"
        echo "   incidental whole-log hints only; not a diagnosis or a reason to retry:"
        evidence="$log"
      fi
      hit=0
      while IFS=$'\t' read -r pat label; do
        [[ -z "$pat" ]] && continue
        if grep -q -E -- "$pat" <<<"$evidence"; then echo "   - $label"; hit=1; fi
      done < <(grep -v '^#' "$SIG")
      if [[ $hit == 0 ]]; then echo "   - unclassified: read the log (gh run view -R $REPO --job $job --log)"; fi
    done
done <<<"$runs"
