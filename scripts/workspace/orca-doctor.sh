#!/usr/bin/env bash
# Static Orca wiring checks: no Incus access, VM allocation, or host state writes.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=config.sh
source "$SCRIPT_DIR/config.sh"
workspace_require jq
if [[ -v ORCA_CLI_COMMAND ]]; then
    [[ -n "$ORCA_CLI_COMMAND" ]] || workspace_error 'ORCA_CLI_COMMAND is empty'
    orca_command=$ORCA_CLI_COMMAND
elif [[ -n "${ORCA_DEV_REPO_ROOT:-}" ]]; then
    orca_command=orca-dev
elif [[ $(uname -s) == Linux ]]; then
    # Never fall through to GNOME's /usr/bin/orca on a Linux desktop.
    orca_command=orca-ide
else
    orca_command=orca
fi
report_dir=$(mktemp -d)
trap 'rm -rf -- "$report_dir"' EXIT
workspace_log "Loading the guide from the selected Orca CLI: $orca_command"
"$orca_command" skills get orca-per-workspace-env --json >"$report_dir/guide.json"
workspace_log "Checking workspace-vm wiring in ${1:-$PWD} (no provisioning)"
if "$orca_command" vm recipe doctor workspace-vm --repo-path "${1:-$PWD}" --json >"$report_dir/report.json"; then
    command_status=0
else
    command_status=$?
fi
cat "$report_dir/report.json"
if ((command_status != 0)); then
    printf 'workspace: Orca command failed (exit %s): ' "$command_status" >&2
    printf '%q ' "$orca_command" vm recipe doctor workspace-vm --repo-path "${1:-$PWD}" --json >&2
    printf '\n' >&2
    exit "$command_status"
fi
# A warning can coexist with ok:true. Inspect check statuses, not just ok.
jq -e 'type == "object" and .ok == true and
    ([.. | objects | .status? | select(. == "warn" or . == "fail")] | length == 0)' \
    "$report_dir/report.json" >/dev/null || workspace_error 'Static doctor gate is not clear: resolve every fail/warn before live validation'
