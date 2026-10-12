#!/usr/bin/env bash
# Onboarding only; use msb directly for sandbox lifecycle and execution.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/../.vm/host.mjs" "$@"
