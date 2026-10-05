#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Run from the monorepo root so formatter behavior is independent of the caller.
cd "$SCRIPT_DIR/../.."
for command in shellcheck shfmt prettier node; do command -v "$command" >/dev/null || {
    printf 'Missing check tool: %s\n' "$command" >&2
    exit 1
}; done
files=(scripts/workspace/*.sh scripts/workspace/backends/*.sh scripts/workspace/test/*.sh)
for file in "${files[@]}"; do bash -n "$file"; done
shellcheck --source-path=SCRIPTDIR -x "${files[@]}"
shfmt -d -i 4 -ci "${files[@]}"
node --check scripts/workspace/loopback.cjs
prettier --check scripts/workspace/*.mjs scripts/workspace/*.cjs docs/workspace-environments.md .github/workflows/monorepo-tests.yml
node --test scripts/init.test.mjs scripts/workspace/*.test.mjs
