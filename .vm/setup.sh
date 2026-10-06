#!/usr/bin/env bash
# Prepare the VM and development stack from an interactive host terminal.
set -euo pipefail
[[ $# == 0 ]] || { echo 'Usage: scripts/vm.sh setup' >&2; exit 1; }
[[ -t 0 && -t 1 ]] || { echo 'Run setup in an interactive host terminal.' >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM="$SCRIPT_DIR/../scripts/vm.sh"

"$VM" up
"$VM" guest bash /workspace/.vm/git-identity.sh
"$VM" guest node /workspace/.vm/guest.mjs stack
"$VM" guest node /workspace/.vm/guest.mjs doctor
printf '\nSetup complete. Connect with ssh oc-dev, then run: run frontend api\n'
