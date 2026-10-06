#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

git submodule sync --recursive

git submodule update \
  --init \
  --recursive \
  --jobs "$(nproc)"

git submodule foreach --recursive 'git checkout main'
