#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ "${1:-}" == --config ]]; then
    CONFIG_FILE=$2
    shift 2
    exec "$SCRIPT_DIR/workspace.sh" --config "$CONFIG_FILE" build-image "$@"
fi
exec "$SCRIPT_DIR/workspace.sh" build-image "$@"
