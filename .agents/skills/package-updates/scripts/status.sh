#!/usr/bin/env bash
# Fast status: repositories in parallel, no behind-main queries or logs.
# usage: status.sh [api|frontend|rest|images ...] (default: all four)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
repos=("$@"); [[ ${#repos[@]} -gt 0 ]] || repos=(api frontend rest images)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pids=()
for i in "${!repos[@]}"; do
  bash "$SCRIPT_DIR/list-prs.sh" "${repos[$i]}" --fast > "$tmp/$i" 2>&1 &
  pids+=("$!")
done
result=0
for i in "${!repos[@]}"; do
  echo "######## ${repos[$i]}"
  if ! wait "${pids[$i]}"; then echo "Status unavailable for ${repos[$i]}"; result=1; fi
  cat "$tmp/$i"
  echo
done
exit "$result"
