#!/usr/bin/env bash
# Real-host acceptance checks. Creates two disposable workspaces and always cleans them up.
# Quoted commands intentionally expand variables in the remote/child shell.
# shellcheck disable=SC2016
set -Eeuo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=config.sh
source "$SCRIPT_DIR/config.sh"
workspace_load_config "$1"
workspace_require ssh jq curl git node ip
CLI=("$SCRIPT_DIR/workspace.sh" --config "$1")
"${CLI[@]}" host-check >&2
[[ -z "${2:-}" || ("$2" == --grow-pool && "${3:-}" =~ ^[1-9][0-9]{0,5}$) ]] || workspace_error 'Usage: smoke [--grow-pool GIB]'
[[ ",$WORKSPACE_SERVICES," == *,api,* && ",$WORKSPACE_DEPENDENCY_SERVICES," == *,db,* ]] || workspace_error 'Smoke requires API and db'
temp=$(mktemp -d)
one="orca-smoke-$(cat /proc/sys/kernel/random/uuid)"
two="orca-smoke-$(cat /proc/sys/kernel/random/uuid)"
cleanup() {
    local rc=$?
    "${CLI[@]}" destroy "$one" >&2 || workspace_log "Cleanup failed: $one"
    "${CLI[@]}" destroy "$two" >&2 || workspace_log "Cleanup failed: $two"
    [[ -z "${listener_pid:-}" ]] || kill "$listener_pid" 2>/dev/null || true
    if [[ -S "$temp/control" && -n "${a:-}" ]]; then ssh -F "$WORKSPACE_STATE_DIR/ssh/config" -S "$temp/control" -O exit "$a" >&2 || true; fi
    rm -rf -- "$temp"
    return "$rc"
}
trap cleanup EXIT
# Public git lookup supplies the same pinned checkout context Orca passes to create.
head=$(git ls-remote "$WORKSPACE_REPO_URL" "refs/heads/$WORKSPACE_REPO_BRANCH" | cut -f1)
[[ "$head" =~ ^[a-f0-9]{40,64}$ ]] || workspace_error 'Could not resolve smoke checkout'
export ORCA_REPO_URL=$WORKSPACE_REPO_URL ORCA_REPO_BRANCH="smoke-${one: -8}"
export ORCA_REPO_REF="refs/heads/$WORKSPACE_REPO_BRANCH" ORCA_REPO_REF_HEAD=$head
export ORCA_RECIPE_RESULT_SCHEMA_VERSION=2
"${CLI[@]}" status >"$temp/before.json"
if [[ "${2:-}" == --grow-pool ]]; then
    "${CLI[@]}" grow-pool "$3"
    "${CLI[@]}" status >"$temp/grown.json"
    jq -e --argjson capacity "$(($3 * 1073741824))" '.storage.capacityBytes == $capacity' "$temp/grown.json" >/dev/null || workspace_error 'Pool growth did not change the backing-file ceiling'
fi
start=$SECONDS
ORCA_VM_INSTANCE_ID=$one "${CLI[@]}" create >"$temp/one.json"
one_seconds=$((SECONDS - start))
start=$SECONDS
ORCA_VM_INSTANCE_ID=$two "${CLI[@]}" create >"$temp/two.json"
two_seconds=$((SECONDS - start))
a=$(jq -r .connection.target.configHost "$temp/one.json")
b=$(jq -r .connection.target.configHost "$temp/two.json")
ip_b=$(jq -r .connection.target.host "$temp/two.json")
SSH=(ssh -F "$WORKSPACE_STATE_DIR/ssh/config" -o BatchMode=yes -o ConnectTimeout=10)
# Exercise the primary checkout and selected binaries over the emitted SSH alias,
# rather than relying only on the provider's management channel.
IFS=, read -r -a agent_tools <<<"$WORKSPACE_AGENT_TOOLS"
for result_file in "$temp/one.json" "$temp/two.json"; do
    alias=$(jq -er .connection.target.configHost "$result_file")
    root=$(jq -er .connection.projectRoot "$result_file")
    printf -v checkout_check 'bash -c %q bash %q %q %q' \
        'set -euo pipefail; cd "$1"; test "$(pwd -P)" = "$1"; test "$(git rev-parse HEAD)" = "$2"; test "$(git symbolic-ref --short HEAD)" = "$3"; shift 3; for tool in "$@"; do command -v "$tool" >/dev/null; done' \
        "$root" "$head" "$ORCA_REPO_BRANCH"
    for tool in "${agent_tools[@]}"; do printf -v checkout_check '%s %q' "$checkout_check" "$tool"; done
    "${SSH[@]}" "$alias" "$checkout_check"
done
[[ $("${SSH[@]}" "$a" cat /etc/machine-id) != "$("${SSH[@]}" "$b" cat /etc/machine-id)" ]] || workspace_error 'Machine IDs match'
[[ $("${SSH[@]}" "$a" cat /etc/ssh/ssh_host_ed25519_key.pub) != "$("${SSH[@]}" "$b" cat /etc/ssh/ssh_host_ed25519_key.pub)" ]] || workspace_error 'SSH host keys match'
[[ $(jq -r .connection.target.identityFile "$temp/one.json") != "$(jq -r .connection.target.identityFile "$temp/two.json")" ]] || workspace_error 'Client identities match'
"${SSH[@]}" "$a" 'set -e; test -z "${SSH_AUTH_SOCK:-}"; test ! -e /run/incus/unix.socket; ! findmnt -t 9p,virtiofs | grep -q /workspace'
"${SSH[@]}" "$a" "psql -h 127.0.0.1 -U opencollective -d opencollective_dvl -c 'CREATE TABLE workspace_smoke_marker (id integer)'" >&2
[[ $("${SSH[@]}" "$b" "psql -h 127.0.0.1 -U opencollective -d opencollective_dvl -Atc \"SELECT count(*) FROM pg_tables WHERE tablename = 'workspace_smoke_marker'\"") == 0 ]] || workspace_error 'Database isolation failed'
"${SSH[@]}" "$a" 'set -e; docker volume create workspace-smoke-only; docker run --rm -v workspace-smoke-only:/marker alpine sh -c "echo isolated > /marker/check"' >&2
"${SSH[@]}" "$b" '! docker volume inspect workspace-smoke-only >/dev/null 2>&1'
# SSH provides a known live sibling listener.
"${SSH[@]}" "$a" "! timeout 5 bash -c '</dev/tcp/$ip_b/$WORKSPACE_SSH_PORT'"
gateway=$(jq -er .network.gateway "$temp/before.json")
[[ "$gateway" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || workspace_error 'Backend must report its IPv4 gateway for isolation acceptance'
node -e 'const fs=require("fs"),s=require("net").createServer(c=>c.end());s.listen(0,"0.0.0.0",()=>fs.writeFileSync(process.argv[1],String(s.address().port)))' "$temp/listener-port" &
listener_pid=$!
for ((attempt = 0; attempt < 50; attempt++)); do
    [[ ! -f "$temp/listener-port" ]] || break
    sleep 0.1
done
host_port=$(cat "$temp/listener-port")
"${SSH[@]}" "$a" "! timeout 5 bash -c '</dev/tcp/$gateway/$host_port'"
"${SSH[@]}" "$a" 'set -e; curl -fsS --max-time 15 https://github.com >/dev/null; getent hosts github.com >/dev/null'
# Test every host address and a real LAN/VPN endpoint supplied by the operator.
while IFS= read -r host_ip; do
    "${SSH[@]}" "$a" "! timeout 3 bash -c '</dev/tcp/$host_ip/$host_port'"
done < <(ip -j -4 address show | jq -r '.[].addr_info[] | select(.family=="inet") | .local')
if [[ -n "${WORKSPACE_SMOKE_LAN_IP:-}" ]]; then
    [[ "$WORKSPACE_SMOKE_LAN_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || workspace_error 'Invalid LAN test IP'
    [[ "${WORKSPACE_SMOKE_LAN_PORT:-22}" =~ ^[0-9]{1,5}$ ]] || workspace_error 'Invalid LAN test port'
    timeout 5 bash -c 'exec 3<>/dev/tcp/"$1"/"$2"' bash "$WORKSPACE_SMOKE_LAN_IP" "${WORKSPACE_SMOKE_LAN_PORT:-22}" || workspace_error 'LAN endpoint must first be reachable from the host'
    "${SSH[@]}" "$a" "! timeout 5 bash -c '</dev/tcp/$WORKSPACE_SMOKE_LAN_IP/${WORKSPACE_SMOKE_LAN_PORT:-22}'"
else
    workspace_error 'Set WORKSPACE_SMOKE_LAN_IP to a known reachable LAN/VPN endpoint (optional WORKSPACE_SMOKE_LAN_PORT); required to validate LAN isolation'
fi
# Forward API over an authenticated SSH connection, choosing an unused local port.
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
"${SSH[@]}" -M -S "$temp/control" -fNT -o ExitOnForwardFailure=yes -L "127.0.0.1:$port:127.0.0.1:3060" "$a"
curl -fsS "http://127.0.0.1:$port/status" >/dev/null
"${SSH[@]}" -S "$temp/control" -O exit "$a" >&2
# A transient systemd service must retain the same PID/start time and boot ID.
"${SSH[@]}" "$a" 'sudo systemd-run --unit=workspace-smoke-process /usr/bin/sleep infinity' >&2
fingerprint() { "${SSH[@]}" "$a" 'set -e; p=$(systemctl show workspace-smoke-process -p MainPID --value); cat /proc/sys/kernel/random/boot_id; echo "$p"; cut -d " " -f22 "/proc/$p/stat"'; }
before_process=$(fingerprint)
"${SSH[@]}" "$a" "printf 'uncommitted\n' > '$WORKSPACE_GUEST_ROOT/workspace-smoke-uncommitted'"
payload() { jq -n --arg mode "$1" --arg id "$one" --slurpfile result "$temp/one.json" '{schemaVersion:1,mode:$mode,instanceId:$id,recipeResult:$result[0]}'; }
payload suspend | "${CLI[@]}" suspend
"${CLI[@]}" status >"$temp/suspended.json"
jq -e --arg id "$one" '[.instances[] | select(.instanceId==$id)][0].status == "Stopped"' "$temp/suspended.json" >/dev/null
payload resume | "${CLI[@]}" resume >"$temp/resumed.json"
[[ $(fingerprint) == "$before_process" ]] || workspace_error 'VM rebooted instead of restoring memory/process state'
"${SSH[@]}" "$a" "grep -qx uncommitted '$WORKSPACE_GUEST_ROOT/workspace-smoke-uncommitted'"
"${SSH[@]}" "$a" "psql -h 127.0.0.1 -U opencollective -d opencollective_dvl -Atc 'SELECT count(*) FROM workspace_smoke_marker'" >&2
"${CLI[@]}" status >"$temp/after.json"
"${SSH[@]}" "$a" "set -e; dd if=/dev/urandom of='$WORKSPACE_GUEST_ROOT/workspace-smoke-discard' bs=1M count=256 status=none; sync"
"${CLI[@]}" status >"$temp/written.json"
"${SSH[@]}" "$a" "set -e; rm '$WORKSPACE_GUEST_ROOT/workspace-smoke-discard'; sync; sudo fstrim -av" >&2
"${CLI[@]}" status >"$temp/trimmed.json"
jq -e --slurpfile written "$temp/written.json" \
    '(.storage.thinPool.data_percent|tonumber) < ($written[0].storage.thinPool.data_percent|tonumber) and .storage.allocatedBytes < $written[0].storage.allocatedBytes' \
    "$temp/trimmed.json" >/dev/null || workspace_error 'TRIM did not reclaim both thin-pool blocks and host file allocation; inspect discard support before activation'
# Confirm provider removal and managed identity cleanup before reporting success.
"${CLI[@]}" destroy "$one" >&2
"${CLI[@]}" destroy "$two" >&2
"${CLI[@]}" status >"$temp/destroyed.json"
jq -e --arg one "$one" --arg two "$two" \
    '[.instances[] | select(.instanceId == $one or .instanceId == $two)] | length == 0' \
    "$temp/destroyed.json" >/dev/null || workspace_error 'Destroyed workspace VMs still exist'
for id in "$one" "$two"; do
    [[ ! -e "$WORKSPACE_STATE_DIR/instances/$id" && ! -e "$WORKSPACE_STATE_DIR/ssh/hosts/$id" ]] || workspace_error 'Destroyed workspace SSH/state files remain'
done
jq -n --argjson first "$one_seconds" --argjson second "$two_seconds" --slurpfile before "$temp/before.json" --slurpfile after "$temp/after.json" \
    '{passed:true,startupSeconds:[$first,$second],allocatedBytesBefore:$before[0].storage.allocatedBytes,allocatedBytesAfter:$after[0].storage.allocatedBytes,incrementalAllocatedBytes:($after[0].storage.allocatedBytes-$before[0].storage.allocatedBytes)}'
