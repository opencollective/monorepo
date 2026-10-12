#!/usr/bin/env bash
# Compatibility entrypoint for the run shell shortcut.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/turbo.mjs" dev "$@"
