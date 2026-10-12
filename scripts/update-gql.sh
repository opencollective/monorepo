#!/usr/bin/env bash
# The API must be running for introspection tasks. Turbo orders schema/codegen.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/turbo.mjs" graphql:update "$@"
