#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=config.sh
source "$SCRIPT_DIR/config.sh"
CONFIG_FILE="$SCRIPT_DIR/config.local.env"
[[ -f "$CONFIG_FILE" ]] || CONFIG_FILE="$SCRIPT_DIR/../../.env.workspace.local"
if [[ "${1:-}" == --config ]]; then
    [[ -f "${2:-}" ]] || workspace_error '--config requires an existing file'
    CONFIG_FILE=$(realpath -- "$2")
    shift 2
fi
ACTION=${1:-help}
shift || true
workspace_require bash jq git flock realpath
workspace_load_config "$CONFIG_FILE"
BACKEND_FILE="$SCRIPT_DIR/backends/$WORKSPACE_BACKEND.sh"
[[ -f "$BACKEND_FILE" ]] || workspace_error "Backend is not installed: $WORKSPACE_BACKEND"
# Backends are trusted code shipped with the installed dispatcher, not config paths.
# shellcheck source=backends/incus.sh
source "$BACKEND_FILE"

workspace_state() {
    mkdir -p "$WORKSPACE_STATE_DIR/instances" "$WORKSPACE_STATE_DIR/locks" "$WORKSPACE_STATE_DIR/ssh/hosts"
    chmod 700 "$WORKSPACE_STATE_DIR"
    exec 8>"$WORKSPACE_STATE_DIR/locks/state.lock"
    flock -w 60 8
    if [[ ! -f "$WORKSPACE_STATE_DIR/owner" ]]; then cat /proc/sys/kernel/random/uuid >"$WORKSPACE_STATE_DIR/owner"; fi
    OWNER=$(cat "$WORKSPACE_STATE_DIR/owner")
    [[ "$OWNER" =~ ^[a-f0-9-]{36}$ ]] || workspace_error 'Invalid state owner'
    flock -u 8
}

workspace_id() {
    [[ "$1" =~ ^orca-[a-z0-9-]{1,48}$ ]] || workspace_error 'Expected an Orca instance ID (orca-...)'
}

workspace_lock() {
    workspace_id "$1"
    exec 9>"$WORKSPACE_STATE_DIR/locks/$1.lock"
    flock -w 60 9 || workspace_error 'Workspace operation already running'
}

workspace_record() {
    local id=$1
    workspace_id "$id"
    [[ -f "$WORKSPACE_STATE_DIR/instances/$id/record.json" ]] || workspace_error "No managed workspace: $id"
    RECORD=$(cat "$WORKSPACE_STATE_DIR/instances/$id/record.json")
    jq -e --arg owner "$OWNER" --arg backend "$WORKSPACE_BACKEND" --arg id "$id" \
        '.owner == $owner and .backend == $backend and .instanceId == $id' <<<"$RECORD" >/dev/null ||
        workspace_error 'Workspace ownership does not match this installation'
    HANDLE=$(jq -c '.handle' <<<"$RECORD")
}

workspace_payload() {
    local payload
    payload=$(cat)
    jq -e --arg action "$ACTION" '.schemaVersion == 1 and .mode == $action and (.instanceId | type == "string")' \
        <<<"$payload" >/dev/null || workspace_error 'Invalid Orca lifecycle payload'
    INSTANCE_ID=$(jq -r '.instanceId' <<<"$payload")
    workspace_lock "$INSTANCE_ID"
    jq -e --arg owner "$OWNER" --arg backend "$WORKSPACE_BACKEND" --arg id "$INSTANCE_ID" \
        '.recipeResult.userData | .owner == $owner and .provider == $backend and .instanceId == $id' \
        <<<"$payload" >/dev/null || workspace_error 'Lifecycle payload ownership mismatch'
    if [[ "$ACTION" == destroy && ! -d "$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID" ]]; then exit 0; fi
    workspace_record "$INSTANCE_ID"
}

workspace_upload_scripts() {
    local handle=$1
    backend_exec "$handle" root install -d -m 755 /opt/oc-workspace
    local file
    for file in guest.sh guest-lib.sh loopback.cjs; do backend_push "$handle" "$SCRIPT_DIR/$file" "/opt/oc-workspace/$file" root 755; done
}

workspace_upload_config() {
    local handle=$1 file
    file=$(mktemp "$WORKSPACE_STATE_DIR/guest-config.XXXXXX")
    workspace_guest_config >"$file"
    backend_push "$handle" "$file" /opt/oc-workspace/config.json root 644
    rm -f -- "$file"
}

workspace_credentials() {
    local handle=$1 entry src dest
    while IFS= read -r entry; do
        src=$(jq -r '.key' <<<"$entry")
        dest=$(jq -r '.value' <<<"$entry")
        [[ -f "$src" && ! -L "$src" ]] || workspace_error "Credential must be a regular, non-symlink file: $src"
        [[ $(stat -c %u -- "$src") == "$UID" ]] || workspace_error 'Credential file must be owned by the current user'
        (((8#$(stat -c %a -- "$src") & 077) == 0)) || workspace_error 'Credential files must not be accessible to group/others'
        backend_exec "$handle" root install -d -o "$WORKSPACE_GUEST_USER" -g "$WORKSPACE_GUEST_USER" -m 700 "/home/$WORKSPACE_GUEST_USER/$(dirname -- "$dest")"
        backend_push "$handle" "$src" "/home/$WORKSPACE_GUEST_USER/$dest" "$WORKSPACE_GUEST_USER" 600
    done < <(jq -c 'to_entries[]' <<<"$WORKSPACE_CREDENTIAL_FILES")
}

workspace_ssh() {
    local id=$1 handle=$2 root=$3 folder host keys alias
    folder="$WORKSPACE_STATE_DIR/instances/$id"
    alias="oc-$id"
    workspace_require ssh ssh-keygen timeout
    [[ -f "$folder/id_ed25519" ]] || ssh-keygen -q -t ed25519 -N '' -f "$folder/id_ed25519" >&2
    backend_exec "$handle" root install -d -m 700 -o "$WORKSPACE_GUEST_USER" -g "$WORKSPACE_GUEST_USER" "/home/$WORKSPACE_GUEST_USER/.ssh"
    backend_push "$handle" "$folder/id_ed25519.pub" "/home/$WORKSPACE_GUEST_USER/.ssh/authorized_keys" "$WORKSPACE_GUEST_USER" 600
    host=$(backend_address "$handle")
    [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || workspace_error 'Backend did not return an IPv4 address'
    keys=$(backend_exec "$handle" root cat /etc/ssh/ssh_host_ed25519_key.pub)
    [[ "$keys" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+ ]] || workspace_error 'Invalid guest SSH host key'
    printf '%s %s\n' "$alias,$host" "$keys" >"$folder/known_hosts"
    cat >"$WORKSPACE_STATE_DIR/ssh/hosts/$id" <<EOF
Host $alias
    HostName $host
    User $WORKSPACE_GUEST_USER
    Port $WORKSPACE_SSH_PORT
    IdentityFile "$folder/id_ed25519"
    IdentityAgent none
    IdentitiesOnly yes
    ForwardAgent no
    ForwardX11 no
    StrictHostKeyChecking yes
    HostKeyAlias $alias
    UserKnownHostsFile "$folder/known_hosts"
EOF
    printf 'Include "%s/hosts/*"\n' "$WORKSPACE_STATE_DIR/ssh" >"$WORKSPACE_STATE_DIR/ssh/config"
    # Verify effective user configuration too: a preceding Host * must not weaken policy.
    local effective
    effective=$(ssh -G "$alias" 2>/dev/null)
    [[ "$effective" == *"forwardagent no"* && "$effective" == *"stricthostkeychecking true"* &&
        "$effective" == *"identityagent none"* && "$effective" == *"hostname $host"* &&
        "$effective" == *"hostkeyalias $alias"* && "$effective" == *"identitiesonly yes"* &&
        "$effective" == *"userknownhostsfile $folder/known_hosts"* ]] ||
        workspace_error 'SSH Include is missing/overridden; run install and put its Include before Host *'
    timeout "$WORKSPACE_TIMEOUT_SECONDS" ssh -F "$WORKSPACE_STATE_DIR/ssh/config" -o BatchMode=yes -o ConnectTimeout=10 "$alias" true >&2
    jq -n --arg id "$id" --arg owner "$OWNER" --arg provider "$WORKSPACE_BACKEND" \
        --arg alias "$alias" --arg host "$host" --arg root "$root" --arg user "$WORKSPACE_GUEST_USER" \
        --arg identity "$folder/id_ed25519" --argjson port "$WORKSPACE_SSH_PORT" \
        '{schemaVersion:2,checkoutMode:"provisioned-root",connection:{type:"ssh",projectRoot:$root,
        target:{label:$alias,configHost:$alias,host:$host,port:$port,username:$user,
        identityFile:$identity,identityAgent:"none",identitiesOnly:true,relayGracePeriodSeconds:300}},
        userData:{provider:$provider,instanceId:$id,owner:$owner}}'
}

workspace_cleanup_failed() {
    local id=$1
    workspace_log "Cleaning up failed creation: $id"
    if [[ -f "$WORKSPACE_STATE_DIR/instances/$id/record.json" ]]; then
        workspace_record "$id"
        if ! backend_destroy "$HANDLE" >&2; then
            workspace_log "Cleanup failed; retained registry and SSH files. Retry destroy for $id."
            return
        fi
        rm -rf -- "$WORKSPACE_STATE_DIR/instances/$id"
        rm -f -- "$WORKSPACE_STATE_DIR/ssh/hosts/$id"
    fi
}

workspace_create() (
    local id=${ORCA_VM_INSTANCE_ID:-} folder handle root result request
    [[ -n "$id" ]] || workspace_error 'Create requires Orca context; use smoke for a standalone lifecycle check'
    workspace_lock "$id"
    folder="$WORKSPACE_STATE_DIR/instances/$id"
    if [[ -f "$folder/result.json" ]]; then
        workspace_record "$id"
        backend_assert "$HANDLE"
        backend_guard
        backend_start "$HANDLE" >&2
        root=$(jq -r '.connection.projectRoot' "$folder/result.json")
        result=$(workspace_ssh "$id" "$HANDLE" "$root")
        printf '%s\n' "$result" >"$folder/result.json.tmp"
        mv -- "$folder/result.json.tmp" "$folder/result.json"
        printf '%s\n' "$result"
        exit
    fi
    [[ ! -d "$folder" ]] || workspace_error 'Incomplete creation exists; destroy it before retrying'
    [[ -n "${ORCA_REPO_URL:-}" && -n "${ORCA_REPO_BRANCH:-}" && -n "${ORCA_REPO_REF:-}" &&
        "${ORCA_REPO_REF_HEAD:-}" =~ ^[a-fA-F0-9]{40,64}$ ]] || workspace_error 'Missing provisioned-root checkout context (doctor --provision does not supply it); use smoke'
    git check-ref-format --branch "$ORCA_REPO_BRANCH" >/dev/null
    [[ "$ORCA_REPO_REF" != -* ]] || workspace_error 'Invalid requested ref'
    exec 7>"$WORKSPACE_STATE_DIR/locks/allocation.lock"
    flock -w 60 7
    local count
    count=$(backend_workspace_count)
    ((count < WORKSPACE_MAX_COUNT)) || workspace_error 'Workspace limit reached'
    backend_guard
    mkdir -m 700 "$folder"
    # Persist the intended handle before allocation so failed starts are recoverable.
    handle=$(backend_handle "$id" workspace)
    jq -n --arg id "$id" --arg owner "$OWNER" --arg backend "$WORKSPACE_BACKEND" --argjson handle "$handle" \
        '{instanceId:$id,owner:$owner,backend:$backend,handle:$handle}' >"$folder/record.json"
    trap 'rc=$?; if (( rc != 0 )); then workspace_cleanup_failed "$id"; fi' EXIT
    backend_create "$handle" "$WORKSPACE_IMAGE_NAME" >&2
    flock -u 7
    backend_start "$handle" >&2
    workspace_upload_config "$handle"
    backend_exec "$handle" root /opt/oc-workspace/guest.sh first-boot >&2
    workspace_credentials "$handle"
    request=$(jq -n --arg url "$ORCA_REPO_URL" --arg branch "$ORCA_REPO_BRANCH" --arg ref "$ORCA_REPO_REF" \
        --arg head "$ORCA_REPO_REF_HEAD" '{url:$url,branch:$branch,ref:$ref,head:$head}')
    printf '%s\n' "$request" >"$folder/request.json"
    backend_push "$handle" "$folder/request.json" /opt/oc-workspace/request.json root 644
    root=$(backend_exec "$handle" root /opt/oc-workspace/guest.sh prepare)
    [[ "$root" == "$WORKSPACE_GUEST_ROOT" || "$root" =~ ^"$WORKSPACE_GUEST_ROOT"/opencollective-[a-z]+$ ]] || workspace_error 'Guest returned an invalid project root'
    result=$(workspace_ssh "$id" "$handle" "$root")
    printf '%s\n' "$result" >"$folder/result.json.tmp"
    mv -- "$folder/result.json.tmp" "$folder/result.json"
    printf '%s\n' "$result"
)

workspace_build_image() (
    local rebuild=${1:-} id handle candidate published=false
    [[ -z "$rebuild" || "$rebuild" == --rebuild ]] || workspace_error 'Usage: build-image [--rebuild]'
    exec 9>"$WORKSPACE_STATE_DIR/locks/image.lock"
    flock -w 60 9
    backend_guard
    id="orca-build-$(cat /proc/sys/kernel/random/uuid)"
    handle=$(backend_handle "$id" builder)
    candidate="$WORKSPACE_IMAGE_NAME-$(date -u +%Y%m%d%H%M%S)-${id: -8}"
    trap 'rc=$?; backend_destroy "$handle" >&2 || workspace_log "Builder cleanup failed: $id"; if (( rc != 0 )) && [[ "$published" == true ]]; then backend_image_discard "$candidate" >&2 || true; fi' EXIT
    backend_builder "$handle" "$rebuild" >&2
    backend_start "$handle" >&2
    workspace_upload_scripts "$handle" >&2
    workspace_upload_config "$handle" >&2
    BACKEND_EXEC_TIMEOUT=$WORKSPACE_BUILD_TIMEOUT_SECONDS backend_exec "$handle" root /opt/oc-workspace/guest.sh build >&2
    backend_exec "$handle" root /opt/oc-workspace/guest.sh sanitize >&2
    published=true
    backend_publish "$handle" "$candidate" >&2
    backend_destroy "$handle" >&2
    # Reuse the one reserved slot for validation of the actual published artifact.
    backend_create "$handle" "$candidate" >&2
    backend_start "$handle" >&2
    backend_exec "$handle" root /opt/oc-workspace/guest.sh image-check >&2
    backend_destroy "$handle" >&2
    backend_promote "$candidate" >&2
    published=false
    workspace_log "Golden image refreshed: $candidate (previous image retained)"
)

workspace_install() {
    local key tmp
    [[ "$WORKSPACE_INSTALL_DIR/" != "$SCRIPT_DIR/"* ]] || workspace_error 'Install directory must be outside source'
    mkdir -p "$WORKSPACE_INSTALL_DIR" "$HOME/.ssh"
    cp -R -- "$SCRIPT_DIR/." "$WORKSPACE_INSTALL_DIR/"
    # The installation has its own effective config; no checkout is consulted by lifecycle commands.
    : >"$WORKSPACE_INSTALL_DIR/config.local.env"
    for key in "${WORKSPACE_CONFIG_KEYS[@]}"; do
        printf '%s=%s\n' "$key" "${!key}" >>"$WORKSPACE_INSTALL_DIR/config.local.env"
    done
    chmod 600 "$WORKSPACE_INSTALL_DIR/config.local.env"
    printf 'Include "%s/hosts/*"\n' "$WORKSPACE_STATE_DIR/ssh" >"$WORKSPACE_STATE_DIR/ssh/config"
    local include="Include \"$WORKSPACE_STATE_DIR/ssh/config\""
    if [[ ! -f "$HOME/.ssh/config" ]] || ! rg_or_grep "$include" "$HOME/.ssh/config"; then
        tmp=$(mktemp "$HOME/.ssh/config.XXXXXX")
        printf '%s\n' "$include" >"$tmp"
        [[ ! -f "$HOME/.ssh/config" ]] || cat "$HOME/.ssh/config" >>"$tmp"
        mv -- "$tmp" "$HOME/.ssh/config"
    fi
    workspace_log "Installed trusted lifecycle scripts in $WORKSPACE_INSTALL_DIR"
}

rg_or_grep() { grep -qFx -- "$1" "$2"; }

workspace_register() {
    local path=${1:-${ORCA_REPO_PATH:-$PWD}} command
    path=$(realpath -- "$path")
    [[ $(git -C "$path" rev-parse --show-toplevel) == "$path" ]] || workspace_error 'Register the repository root'
    [[ ! -e "$path/orca.yaml" ]] || workspace_error 'orca.yaml exists; merge the documented recipe manually'
    [[ -x "$WORKSPACE_INSTALL_DIR/workspace.sh" ]] || workspace_error 'Run install first'
    command="$WORKSPACE_INSTALL_DIR/workspace.sh"
    cat >"$path/orca.yaml" <<EOF
environmentRecipes:
  - id: workspace-vm
    name: Isolated development VM
    checkoutMode: provisioned-root
    create: '"$command" create'
    suspend: '"$command" suspend'
    resume: '"$command" resume'
    destroy: '"$command" destroy'
EOF
    local exclude
    exclude=$(git -C "$path" rev-parse --git-path info/exclude)
    [[ "$exclude" == /* ]] || exclude="$path/$exclude"
    printf '\n/orca.yaml\n' >>"$exclude"
    workspace_log "Registered local recipe in $path/orca.yaml"
}

case "$ACTION" in
    help)
        cat <<'EOF'
Usage: workspace.sh [--config FILE] COMMAND [ARGUMENT]
  host-check                   Read-only prerequisite/capacity report
  install                      Install trusted host scripts and SSH Include
  setup                        Create owned Incus project/pool/network/profiles/firewall
  register-project [PATH]      Write an ignored local Orca recipe
  build-image [--rebuild]       Build or refresh and validate the golden image
  rollback-image               Swap active and previous golden images
  create | suspend | resume | destroy    Orca lifecycle commands
  destroy ID                   Remove an owned VM manually
  status                       Resource, storage and registry report
  grow-pool GIB                Increase the backing-file capacity ceiling
  trim                         Run guest TRIM and report storage (does not lower capacity)
  doctor [PATH]                Check host, installed Orca contract and recipe
  smoke                        Real-host SSH, lifecycle and isolation smoke test
EOF
        ;;
    host-check) backend_check ;;
    *)
        workspace_state
        case "$ACTION" in
            install) workspace_install ;;
            setup) backend_setup ;;
            register-project) workspace_register "${1:-$PWD}" ;;
            build-image) workspace_build_image "${1:-}" ;;
            rollback-image)
                exec 9>"$WORKSPACE_STATE_DIR/locks/image.lock"
                flock -w 60 9
                backend_rollback
                ;;
            create) workspace_create ;;
            suspend | resume | destroy)
                if [[ "$ACTION" == destroy && -n "${1:-}" ]]; then
                    INSTANCE_ID=$1
                    workspace_lock "$INSTANCE_ID"
                    [[ -d "$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID" ]] || exit 0
                    workspace_record "$INSTANCE_ID"
                else workspace_payload; fi
                [[ "$ACTION" == destroy ]] || backend_assert "$HANDLE"
                case "$ACTION" in
                    suspend) backend_suspend "$HANDLE" >&2 ;;
                    resume)
                        backend_guard
                        backend_start "$HANDLE" >&2
                        root=$(jq -r '.connection.projectRoot' "$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID/result.json")
                        result=$(workspace_ssh "$INSTANCE_ID" "$HANDLE" "$root")
                        printf '%s\n' "$result" >"$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID/result.json.tmp"
                        mv -- "$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID/result.json.tmp" "$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID/result.json"
                        printf '%s\n' "$result"
                        ;;
                    destroy)
                        backend_destroy "$HANDLE" >&2
                        rm -rf -- "$WORKSPACE_STATE_DIR/instances/$INSTANCE_ID"
                        rm -f -- "$WORKSPACE_STATE_DIR/ssh/hosts/$INSTANCE_ID"
                        ;;
                esac
                ;;
            status) backend_status ;;
            grow-pool) backend_grow "${1:-}" ;;
            trim) backend_trim ;;
            doctor)
                backend_check
                workspace_require orca-ide
                orca-ide skills get orca-per-workspace-env --json
                orca-ide vm recipe doctor workspace-vm --repo-path "${1:-$PWD}" --json
                ;;
            smoke) "$SCRIPT_DIR/smoke.sh" "$CONFIG_FILE" "$@" ;;
            *) workspace_error "Unknown command: $ACTION" ;;
        esac
        ;;
esac
