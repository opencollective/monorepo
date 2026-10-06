#!/usr/bin/env bash
# Host-side VM administration only. Project code runs in the guest.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Setup uses Bash prompts; other administration uses the Node helper.
# exec preserves terminal input and the final exit code.
if [[ "${1:-}" == setup ]]; then
  shift
  exec bash "$SCRIPT_DIR/../.vm/setup.sh" "$@"
fi
exec node "$SCRIPT_DIR/../.vm/host.mjs" "$@"
