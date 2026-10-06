#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <feature-name>" >&2
  exit 2
fi

git worktree add ".worktrees/$1"
