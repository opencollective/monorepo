#!/usr/bin/env bash
# Run a command under a named lock shared by every agent on this machine (macOS has no flock).
# Blocking by default; LOCK_TRY=1 returns 75 at once when the lock is held.
# usage: with-lock.sh <name> <command> [args ...]
#   with-lock.sh api-test ./scripts/test.sh test/server/graphql/v2/mutation/OrderMutations.test.ts
set -euo pipefail
name="${1:?lock name}"; shift
[[ $# -gt 0 ]] || { echo "usage: with-lock.sh <name> <command> [args ...]" >&2; exit 2; }
dir="${OC_LOCK_DIR:-/tmp/oc-locks}"; mkdir -p "$dir"
lock="$dir/$name.lock"
waited=0
until mkdir "$lock" 2>/dev/null; do
  owner=$(cat "$lock/pid" 2>/dev/null || true)
  # a holder that died leaves its directory behind: take it over
  if [[ -n "$owner" ]] && ! kill -0 "$owner" 2>/dev/null; then
    echo "lock $name: holder $owner is gone, taking it over" >&2; rm -rf "$lock"; continue
  fi
  [[ "${LOCK_TRY:-0}" == 1 ]] && { echo "lock $name held by pid ${owner:-?} ($(cat "$lock/owner" 2>/dev/null || echo unknown))" >&2; exit 75; }
  (( waited % 60 == 0 )) && echo "lock $name held by pid ${owner:-?}, waiting" >&2
  sleep "${LOCK_POLL:-5}"; waited=$(( waited + ${LOCK_POLL:-5} ))
done
echo $$ > "$lock/pid"; echo "${LOCK_OWNER:-$*}" > "$lock/owner"
trap 'rm -rf "$lock"' EXIT
"$@"
