#!/usr/bin/env bash
# Shared helpers for the package-updates skill scripts. Source, do not run.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Map a short repo name (api|frontend|rest|images) or a full slug to owner/repo and a local checkout.
# The local checkout is only used for worktrees (never touched directly): the monorepo
# submodule dir first, then ~/Dev/opencollective/<short>.
resolve_repo() {
  local skill_root; skill_root="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
  case "${1:-}" in
    api|opencollective-api|opencollective/opencollective-api) REPO=opencollective/opencollective-api; SHORT=api ;;
    frontend|opencollective-frontend|opencollective/opencollective-frontend) REPO=opencollective/opencollective-frontend; SHORT=frontend ;;
    rest|opencollective-rest|opencollective/opencollective-rest) REPO=opencollective/opencollective-rest; SHORT=rest ;;
    images|opencollective-images|opencollective/opencollective-images) REPO=opencollective/opencollective-images; SHORT=images ;;
    *) echo "usage: $(basename "$0") <api|frontend|rest|images> ..." >&2; exit 2 ;;
  esac
  LOCAL_REPO=""
  for d in "$skill_root/opencollective-$SHORT" "$HOME/Dev/opencollective/$SHORT"; do
    if [[ -d "$d/.git" ]] || git -C "$d" rev-parse --git-dir >/dev/null 2>&1; then LOCAL_REPO="$d"; break; fi
  done
  export REPO SHORT LOCAL_REPO
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 2; }; }
need gh; need jq

# Node 24 from nvm (the non-interactive shell often defaults to Node 20, and npm ci then fails EBADENGINE)
use_node24() {
  local bin; bin=$(ls -d "$HOME"/.nvm/versions/node/v24.*/bin 2>/dev/null | sort -V | tail -1 || true)
  [[ -n "$bin" ]] && export PATH="$bin:$PATH"
  node -v
}

# gh with up to 3 attempts (api.github.com returns 502/504 now and then)
ghr() { local i; for i in 1 2 3; do gh "$@" && return 0; sleep 3; done; return 1; }

BOT_AUTHORS='app/renovate|app/dependabot|renovate\[bot\]|dependabot\[bot\]'

pr_head_sha() { gh pr view "$1" -R "$REPO" --json headRefOid --jq .headRefOid; }
pr_branch()   { gh pr view "$1" -R "$REPO" --json headRefName --jq .headRefName; }

checks_summary() { jq -f "$SCRIPT_DIR/checks.jq"; }

# Workflow runs (databaseId, workflowName, conclusion) for a commit that failed, or are still running with a failed job
failed_runs_for_sha() {
  gh run list -R "$REPO" --commit "$1" --limit 50 --json databaseId,workflowName,conclusion,status \
    --jq '.[] | select((.conclusion=="failure" or .conclusion=="timed_out" or .conclusion=="cancelled") or (.status!="completed")) | "\(.databaseId)\t\(.workflowName)\t\(if .status=="completed" then .conclusion else .status end)"' \
  | while IFS=$'\t' read -r id wf c; do
      if [[ "$c" == "in_progress" || "$c" == "queued" || "$c" == "pending" || "$c" == "waiting" ]]; then
        # keep an unfinished run only if one of its jobs already failed
        if gh run view "$id" -R "$REPO" --json jobs --jq '[.jobs[] | select(.conclusion=="failure" or .conclusion=="timed_out")] | length' | grep -qv '^0$'; then
          echo -e "$id\t$wf\t$c (still running)"
        fi
      else echo -e "$id\t$wf\t$c"; fi
    done
}
