#!/usr/bin/env bash
# Onboarding only; use msb directly for sandbox lifecycle and execution.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# == 1 && $1 == setup ]]; then
  exec bash "$SCRIPT_DIR/../.vm/setup.sh"
elif [[ $# == 1 && ( $1 == --help || $1 == -h ) ]]; then
  echo 'Usage: scripts/vm.sh setup (or .vm/setup.sh)'
else
  echo 'Usage: scripts/vm.sh setup; use msb directly for sandbox administration.' >&2
  exit 1
fi
