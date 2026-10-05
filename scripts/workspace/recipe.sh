#!/usr/bin/env bash
# Portable recipe entry point. Only locate the installation here; all VM lifecycle
# operations run in the trusted host installation, outside guest agent checkouts.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=config.sh
source "$SCRIPT_DIR/config.sh"
CONFIG_FILE="$SCRIPT_DIR/../../.env.workspace.local"
if [[ "${1:-}" == --config ]]; then
    [[ -f "${2:-}" ]] || workspace_error '--config requires an existing file'
    CONFIG_FILE=$(realpath -- "$2")
    shift 2
fi
case "${1:-}" in create | suspend | resume | destroy) ;; *) workspace_error 'Expected an Orca lifecycle action' ;; esac
workspace_require jq git realpath
workspace_load_config "$CONFIG_FILE"
installed="$WORKSPACE_INSTALL_DIR/workspace.sh"
[[ -x "$installed" ]] || workspace_error 'Trusted lifecycle installation is missing; run scripts/workspace/workspace.sh install on the host'
[[ $(realpath -- "$installed") != "$(realpath -- "$SCRIPT_DIR/workspace.sh")" ]] || workspace_error 'Lifecycle installation must differ from the checkout'
# Keep stdin, stdout, checkout context, and exit status intact for Orca.
exec "$installed" "$@"
