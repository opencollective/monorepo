#!/usr/bin/env bash
# Backend functions consume opaque JSON handles; all Incus calls are local and project-scoped.

incus_local() { incus --force-local --project "$INCUS_PROJECT" "$@"; }
incus_global() { incus --force-local --project default "$@"; }

backend_check() {
    workspace_require incus ip nft sudo lvs ssh ssh-keygen curl timeout
    [[ -r /dev/kvm && -w /dev/kvm ]] || workspace_error 'KVM is unavailable to this user'
    incus_local info >/dev/null
    local total required
    total=$(awk '/MemTotal:/ {print int($2 / 1048576)}' /proc/meminfo)
    required=$(((WORKSPACE_MAX_COUNT + 1) * WORKSPACE_MEMORY_GIB + 8))
    jq -n --arg backend incus --argjson cpus "$(nproc)" --argjson ram "$total" --argjson required "$required" \
        --argjson guestCpus "$(((WORKSPACE_MAX_COUNT + 1) * WORKSPACE_CPUS))" \
        '{backend:$backend,hostCpus:$cpus,hostMemoryGiB:$ram,requiredMemoryGiB:$required,configuredVcpus:$guestCpus}'
    incus --version
    docker --version 2>/dev/null || true # Docker is required in the guest, not on the host.
}

incus_owned_global() {
    local kind=$1 name=$2 owner
    owner=$(incus_global "$kind" get "$name" user.oc-workspace-owner)
    [[ "$owner" == "${OWNER?}" ]] || workspace_error "Refusing to modify unowned $kind: $name"
}

backend_setup() {
    backend_check >&2
    [[ "$INCUS_SUBNET" =~ ^([0-9]{1,3}\.){3}1/24$ ]] || workspace_error 'INCUS_SUBNET must be an IPv4 .1/24 subnet'
    # Detect overlap before creating a network (including routes in non-main tables).
    "$SCRIPT_DIR/network-check.sh" "$INCUS_SUBNET" "$INCUS_NETWORK"
    if incus_global storage show "$INCUS_STORAGE_POOL" >/dev/null 2>&1; then
        incus_owned_global storage "$INCUS_STORAGE_POOL"
        incus_global query "/1.0/storage-pools/$INCUS_STORAGE_POOL" | jq -e '.driver == "lvm"' >/dev/null || workspace_error 'Owned storage pool must use LVM'
        sudo test -f "$(incus_global storage get "$INCUS_STORAGE_POOL" source)" || workspace_error 'Owned storage pool must be file-backed'
        [[ $(incus_global storage get "$INCUS_STORAGE_POOL" lvm.use_thinpool) != false ]] || workspace_error 'Storage must use LVM thin provisioning'
    else
        # No source, wipe, physical device, or existing host volume group is accepted.
        incus_global storage create "$INCUS_STORAGE_POOL" lvm "size=${INCUS_POOL_SIZE_GIB}GiB" \
            lvm.use_thinpool=true "user.oc-workspace-owner=$OWNER" >&2
    fi
    if incus_global network show "$INCUS_NETWORK" >/dev/null 2>&1; then incus_owned_global network "$INCUS_NETWORK"; else
        incus_global network create "$INCUS_NETWORK" --type bridge \
            "ipv4.address=$INCUS_SUBNET" ipv4.nat=true ipv6.address=none \
            "user.oc-workspace-owner=$OWNER" >&2
    fi
    if incus_local project show "$INCUS_PROJECT" >/dev/null 2>&1; then
        [[ $(incus_local project get "$INCUS_PROJECT" user.oc-workspace-owner) == "$OWNER" ]] || workspace_error 'Project is not owned by this installation'
    else
        incus_global project create "$INCUS_PROJECT" \
            -c features.images=true -c features.profiles=true -c features.storage.volumes=true \
            -c features.networks=false -c restricted=true \
            -c "user.oc-workspace-owner=$OWNER" >&2
    fi
    incus_local project set "$INCUS_PROJECT" \
        restricted=true restricted.devices.disk=block restricted.devices.nic=managed \
        restricted.virtual-machines.lowlevel=block restricted.virtual-machines.nesting=block \
        "restricted.networks.access=$INCUS_NETWORK" "restricted.storage-pools.access=$INCUS_STORAGE_POOL" \
        limits.containers=0 "limits.instances=$((WORKSPACE_MAX_COUNT + 1))" \
        "limits.virtual-machines=$((WORKSPACE_MAX_COUNT + 1))" \
        "limits.cpu=$(((WORKSPACE_MAX_COUNT + 1) * WORKSPACE_CPUS))" \
        "limits.memory=$(((WORKSPACE_MAX_COUNT + 1) * WORKSPACE_MEMORY_GIB))GiB" \
        "limits.disk=${WORKSPACE_DISK_BUDGET_GIB}GiB" \
        "limits.disk.pool.$INCUS_STORAGE_POOL=${WORKSPACE_DISK_BUDGET_GIB}GiB" limits.networks=0 >&2
    if ! incus_local profile show "$INCUS_PROFILE" >/dev/null 2>&1; then incus_local profile create "$INCUS_PROFILE" >&2; fi
    jq -n --arg name "$INCUS_PROFILE" --arg cpu "$WORKSPACE_CPUS" --arg ram "${WORKSPACE_MEMORY_GIB}GiB" \
        --arg disk "${WORKSPACE_DISK_GIB}GiB" --arg state "${WORKSPACE_STATE_DISK_GIB}GiB" \
        --arg pool "$INCUS_STORAGE_POOL" --arg network "$INCUS_NETWORK" --arg bandwidth "${WORKSPACE_BANDWIDTH_MBIT}Mbit" \
        '{name:$name,description:"Isolated Open Collective workspace",config:{"limits.cpu":$cpu,"limits.memory":$ram,
        "migration.stateful":"true","security.nesting":"false","boot.autostart":"false","boot.host_shutdown_action":"stateful-stop"},
        devices:{root:{type:"disk",path:"/",pool:$pool,size:$disk,"size.state":$state},eth0:{type:"nic",network:$network,
        name:"eth0","security.port_isolation":"true","security.ipv4_filtering":"true","security.mac_filtering":"true","limits.max":$bandwidth}}}' |
        incus_local profile edit "$INCUS_PROFILE" >&2
    # Root-owned installation: a VM cannot modify its enforcement rules.
    sudo install -d -m 755 /usr/local/lib/oc-workspace
    sudo install -m 755 "$SCRIPT_DIR/firewall.sh" "/usr/local/lib/oc-workspace/firewall-$INCUS_NETWORK.sh"
    local unit tmp
    unit="oc-workspace-firewall-$INCUS_NETWORK.service"
    tmp=$(mktemp "$WORKSPACE_STATE_DIR/firewall-unit.XXXXXX")
    cat >"$tmp" <<EOF
[Unit]
Description=Open Collective workspace network isolation ($INCUS_NETWORK)
After=incus.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/lib/oc-workspace/firewall-$INCUS_NETWORK.sh $INCUS_NETWORK $INCUS_SUBNET $WORKSPACE_SSH_PORT
[Install]
WantedBy=multi-user.target
EOF
    sudo install -m 644 "$tmp" "/etc/systemd/system/$unit"
    rm -f -- "$tmp"
    sudo systemctl daemon-reload
    sudo systemctl enable "$unit" >&2
    sudo systemctl restart "$unit" >&2
    backend_guard
    workspace_log 'Host setup complete. Run install, build-image, then register-project.'
}

backend_handle() {
    jq -cn --arg name "oc-$1" --arg project "$INCUS_PROJECT" --arg owner "$OWNER" --arg role "$2" \
        '{name:$name,project:$project,owner:$owner,role:$role}'
}

incus_handle() {
    local handle=$1
    jq -e --arg project "$INCUS_PROJECT" --arg owner "$OWNER" \
        '.project == $project and .owner == $owner and (.name | test("^oc-orca-[a-z0-9-]{1,48}$")) and (.role | IN("workspace","builder"))' \
        <<<"$handle" >/dev/null || workspace_error 'Invalid Incus handle'
    INCUS_INSTANCE=$(jq -r '.name' <<<"$handle")
}

backend_assert() {
    incus_handle "$1"
    local config
    config=$(incus_local config show "$INCUS_INSTANCE" --expanded)
    # Query JSON for ownership; config show is YAML and is retained for human diagnostics only.
    [[ -n "$config" ]] || workspace_error 'Missing instance configuration'
    [[ $(incus_local config get "$INCUS_INSTANCE" user.oc-workspace-owner) == "$OWNER" &&
    $(incus_local config get "$INCUS_INSTANCE" user.oc-workspace-role) == "$(jq -r .role <<<"$1")" ]] ||
        workspace_error 'Incus instance ownership mismatch'
}

backend_workspace_count() {
    incus_local list --format json | jq --arg owner "$OWNER" \
        '[.[] | select(.config["user.oc-workspace-owner"] == $owner and .config["user.oc-workspace-role"] == "workspace")] | length'
}

incus_storage_report() {
    local source vg thin
    source=$(incus_global storage get "$INCUS_STORAGE_POOL" source)
    sudo test -f "$source" || workspace_error 'Expected an Incus-managed regular pool file'
    vg=$(incus_global storage get "$INCUS_STORAGE_POOL" lvm.vg_name)
    thin=$(incus_global storage get "$INCUS_STORAGE_POOL" lvm.thinpool_name)
    [[ "$vg" =~ ^[a-zA-Z0-9_-]+$ && "$thin" =~ ^[a-zA-Z0-9_-]+$ ]] || workspace_error 'Invalid pool volume names'
    sudo lvs --reportformat json --units b --nosuffix -o lv_size,data_percent,metadata_percent "$vg/$thin" |
        jq --arg source "$source" --argjson capacity "$(sudo stat -c %s -- "$source")" \
            --argjson allocated "$(($(sudo stat -c %b -- "$source") * 512))" \
            --argjson free "$(sudo df -B1 --output=avail "$source" | tail -1 | tr -d ' ')" \
            '{source:$source,capacityBytes:$capacity,allocatedBytes:$allocated,hostFreeBytes:$free,thinPool:.report[0].lv[0]}'
}

backend_guard() {
    local report
    incus_owned_global storage "$INCUS_STORAGE_POOL"
    report=$(incus_storage_report)
    jq -e --argjson min "$((WORKSPACE_MIN_HOST_FREE_GIB * 1073741824))" --argjson max "$WORKSPACE_STORAGE_MAX_PERCENT" \
        '.hostFreeBytes >= $min and (.thinPool.data_percent | tonumber) < $max and (.thinPool.metadata_percent | tonumber) < $max' \
        <<<"$report" >/dev/null || workspace_error 'Host or thin-pool space threshold exceeded; run status and grow-pool/trim'
    sudo systemctl restart "oc-workspace-firewall-$INCUS_NETWORK.service" >&2
}

backend_create() {
    local handle=$1 image=$2
    incus_handle "$handle"
    if incus_exists; then
        backend_assert "$handle"
        return
    fi
    [[ "$image" == images:* ]] || incus_image "$image" >/dev/null
    incus_local init "$image" "$INCUS_INSTANCE" --vm --profile "$INCUS_PROFILE" \
        -c "user.oc-workspace-owner=$OWNER" -c "user.oc-workspace-role=$(jq -r .role <<<"$handle")" >&2
}

backend_builder() {
    local image="$WORKSPACE_IMAGE_NAME"
    if [[ "$2" == --rebuild ]] || ! incus_local image info "$image" >/dev/null 2>&1; then image="images:$WORKSPACE_GUEST_OS"; fi
    backend_create "$1" "$image"
}

backend_start() {
    local handle=$1 state available
    backend_assert "$handle"
    state=$(incus_local list "^$INCUS_INSTANCE$" --format json | jq -r '.[0].status')
    if [[ "$state" != Running ]]; then
        available=$(awk '/MemAvailable:/ {print int($2 / 1048576)}' /proc/meminfo)
        ((available >= WORKSPACE_MEMORY_GIB + 2)) || workspace_error 'Insufficient available host RAM to start this VM'
        incus_local start "$INCUS_INSTANCE" >&2 # Incus restores saved state unless --stateless is requested.
    fi
    local deadline=$((SECONDS + WORKSPACE_TIMEOUT_SECONDS))
    until incus_local exec "$INCUS_INSTANCE" -- true >/dev/null 2>&1; do
        ((SECONDS < deadline)) || workspace_error 'Timed out waiting for the Incus guest agent'
        sleep 2
    done
}

backend_exec() {
    local handle=$1 user=$2
    shift 2
    backend_assert "$handle"
    if [[ "$user" == root ]]; then
        timeout "${BACKEND_EXEC_TIMEOUT:-$WORKSPACE_TIMEOUT_SECONDS}" incus --force-local --project "$INCUS_PROJECT" exec "$INCUS_INSTANCE" -- "$@"
    else
        timeout "${BACKEND_EXEC_TIMEOUT:-$WORKSPACE_TIMEOUT_SECONDS}" incus --force-local --project "$INCUS_PROJECT" exec "$INCUS_INSTANCE" -- runuser -u "$user" -- "$@"
    fi
}

backend_push() {
    local handle=$1 src=$2 dest=$3 user=$4 mode=$5 uid gid
    backend_assert "$handle"
    [[ "$dest" == /* ]] || workspace_error 'Guest file destination must be absolute'
    uid=$(incus_local exec "$INCUS_INSTANCE" -- id -u "$user")
    gid=$(incus_local exec "$INCUS_INSTANCE" -- id -g "$user")
    incus_local file push "$src" "$INCUS_INSTANCE$dest" --uid "$uid" --gid "$gid" --mode "$mode" >&2
}

backend_address() {
    backend_assert "$1"
    incus_local query "/1.0/instances/$INCUS_INSTANCE/state?project=$INCUS_PROJECT" | jq -er \
        '[.network.eth0.addresses[] | select(.family == "inet" and .scope == "global") | .address][0]'
}

backend_suspend() {
    backend_assert "$1"
    local state
    state=$(incus_local list "^$INCUS_INSTANCE$" --format json | jq -r '.[0].status')
    [[ "$state" != Running ]] || incus_local stop "$INCUS_INSTANCE" --stateful >&2
}

backend_destroy() {
    incus_handle "$1"
    if ! incus_exists; then return; fi
    backend_assert "$1"
    incus_local delete "$INCUS_INSTANCE" --force >&2
}

incus_exists() {
    local instances
    # Read errors must propagate; only a successful empty list means absence.
    instances=$(incus_local list --format json) || workspace_error 'Cannot read Incus instance inventory'
    jq -e --arg name "$INCUS_INSTANCE" 'any(.[]; .name == $name)' <<<"$instances" >/dev/null
}

backend_publish() {
    backend_assert "$1"
    incus_local stop "$INCUS_INSTANCE" --timeout 60 >&2
    incus_local publish "$INCUS_INSTANCE" --compression zstd --alias "$2" "user.oc-workspace-owner=$OWNER" >&2
}

incus_image() {
    local metadata fingerprint
    fingerprint=$(incus_local image alias list --format json | jq -er --arg name "$1" '[.[] | select(.name == $name) | .target][0]')
    metadata=$(incus_local query "/1.0/images/$fingerprint?project=$INCUS_PROJECT")
    jq -e --arg owner "$OWNER" '.properties["user.oc-workspace-owner"] == $owner and .public == false' <<<"$metadata" >/dev/null ||
        workspace_error 'Image ownership/privacy mismatch'
    jq -r .fingerprint <<<"$metadata"
}

backend_image_discard() {
    local aliases fingerprint
    aliases=$(incus_local image alias list --format json)
    jq -e --arg name "$1" 'any(.[]; .name==$name)' <<<"$aliases" >/dev/null || return 0
    fingerprint=$(incus_image "$1")
    jq -e --arg fp "$fingerprint" --arg active "$WORKSPACE_IMAGE_NAME" --arg previous "$WORKSPACE_IMAGE_NAME-previous" \
        'all(.[]; (.name != $active and .name != $previous) or .target != $fp)' <<<"$aliases" >/dev/null ||
        workspace_error 'Refusing to discard an active/rollback image; inspect image aliases'
    incus_local image delete "$1" >&2
}

backend_promote() {
    local candidate=$1 fingerprint old previous aliases
    fingerprint=$(incus_image "$candidate")
    [[ "$fingerprint" =~ ^[a-f0-9]{64}$ ]] || workspace_error 'Invalid published image fingerprint'
    aliases=$(incus_local image alias list --format json)
    old=$(jq -r --arg alias "$WORKSPACE_IMAGE_NAME" '.[] | select(.name == $alias) | .target' <<<"$aliases")
    previous=$(jq -r --arg alias "$WORKSPACE_IMAGE_NAME-previous" '.[] | select(.name == $alias) | .target' <<<"$aliases")
    if [[ -n "$old" ]]; then
        incus_image "$WORKSPACE_IMAGE_NAME" >/dev/null
        # PUT updates the active alias atomically. Previous is updated before active.
        if [[ -n "$previous" ]]; then
            incus_local query -X PUT -d "$(jq -n --arg target "$old" '{target:$target}')" "/1.0/images/aliases/$WORKSPACE_IMAGE_NAME-previous?project=$INCUS_PROJECT" >&2
        else incus_local image alias create "$WORKSPACE_IMAGE_NAME-previous" "$old" >&2; fi
        if ! incus_local query -X PUT -d "$(jq -n --arg target "$fingerprint" '{target:$target}')" "/1.0/images/aliases/$WORKSPACE_IMAGE_NAME?project=$INCUS_PROJECT" >&2; then
            # Restore rollback state when activation fails, while active remains unchanged.
            if [[ -n "$previous" ]]; then
                incus_local query -X PUT -d "$(jq -n --arg target "$previous" '{target:$target}')" "/1.0/images/aliases/$WORKSPACE_IMAGE_NAME-previous?project=$INCUS_PROJECT" >&2
            else incus_local image alias delete "$WORKSPACE_IMAGE_NAME-previous" >&2; fi
            workspace_error 'Image activation failed; current image preserved'
        fi
    else incus_local image alias create "$WORKSPACE_IMAGE_NAME" "$fingerprint" >&2; fi
}

backend_status() {
    jq -n --argjson storage "$(incus_storage_report)" --argjson logical "$((WORKSPACE_DISK_BUDGET_GIB * 1073741824))" \
        --arg gateway "${INCUS_SUBNET%/*}" \
        --argjson instances "$(incus_local list --format json | jq --arg owner "$OWNER" '[.[] | select(.config["user.oc-workspace-owner"] == $owner) | {instanceId:(.name|ltrimstr("oc-")),providerMetadata:{name},status,role:.config["user.oc-workspace-role"]}]')" \
        '{logicalDiskBudgetBytes:$logical,storage:$storage,network:{gateway:$gateway},instances:$instances}'
}

backend_rollback() {
    backend_promote "$WORKSPACE_IMAGE_NAME-previous"
}

backend_grow() {
    local new=$1 current
    [[ "$new" =~ ^[1-9][0-9]{0,5}$ ]] || workspace_error 'grow-pool requires capacity in GiB'
    exec 9>"$WORKSPACE_STATE_DIR/locks/storage.lock"
    flock -w 60 9
    incus_owned_global storage "$INCUS_STORAGE_POOL"
    current=$(incus_global storage get "$INCUS_STORAGE_POOL" source)
    sudo test -f "$current" || workspace_error 'Expected an Incus-managed regular pool file'
    ((new * 1073741824 > $(sudo stat -c %s -- "$current"))) || workspace_error 'Only pool growth is supported; never truncate a pool file'
    incus_global storage set "$INCUS_STORAGE_POOL" "size=${new}GiB" >&2
}

backend_trim() {
    local handle record
    for record in "$WORKSPACE_STATE_DIR"/instances/*/record.json; do
        [[ -f "$record" ]] || continue
        handle=$(jq -c .handle "$record")
        backend_assert "$handle"
        if [[ $(incus_local list "^$INCUS_INSTANCE$" --format json | jq -r '.[0].status') == Running ]]; then
            backend_exec "$handle" root fstrim -av >&2
        fi
    done
    incus_global storage volume list "$INCUS_STORAGE_POOL" >&2
    workspace_log 'Guest TRIM complete. Recheck status; host reclamation depends on discard passthrough and snapshot references.'
}
