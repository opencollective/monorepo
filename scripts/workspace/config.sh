#!/usr/bin/env bash
# Loaded by the host dispatcher. Config files are never sourced.

workspace_error() {
    printf 'workspace: %s\n' "$*" >&2
    exit 1
}
workspace_log() { printf 'workspace: %s\n' "$*" >&2; }
workspace_require() {
    local command
    for command in "$@"; do
        command -v "$command" >/dev/null || workspace_error "Missing prerequisite: $command"
    done
}

workspace_load_config() {
    local file=$1 line key value name
    # CSV settings are single values in this associative map.
    # shellcheck disable=SC2054
    declare -A defaults=(
        [WORKSPACE_BACKEND]=incus
        [WORKSPACE_REPO_URL]=https://github.com/opencollective/monorepo.git
        [WORKSPACE_REPO_BRANCH]=main
        [WORKSPACE_PROJECTS]=opencollective,api,frontend,documentation,images,pdf,rest,taxes,rss
        [WORKSPACE_SERVICES]=api,frontend
        [WORKSPACE_DEPENDENCY_SERVICES]=db,mail,uploads
        [WORKSPACE_AGENT_TOOLS]=codex,opencode
        [WORKSPACE_CODEX_VERSION]=latest [WORKSPACE_OPENCODE_VERSION]=latest
        [WORKSPACE_NODE_VERSIONS]=24 [WORKSPACE_NPM_VERSION]=11 [WORKSPACE_PM2_VERSION]=latest
        [WORKSPACE_GUEST_OS]=ubuntu/24.04/cloud [WORKSPACE_GUEST_USER]=developer
        [WORKSPACE_GUEST_ROOT]=/workspace [WORKSPACE_MAX_COUNT]=10 [WORKSPACE_CPUS]=4
        [WORKSPACE_MEMORY_GIB]=16 [WORKSPACE_DISK_GIB]=100 [WORKSPACE_STATE_DISK_GIB]=20
        [WORKSPACE_DISK_BUDGET_GIB]=2048 [WORKSPACE_BANDWIDTH_MBIT]=100
        [WORKSPACE_NETWORK_POLICY]=internet-only [WORKSPACE_IMAGE_NAME]=oc-development
        [WORKSPACE_SSH_PORT]=22 [WORKSPACE_TIMEOUT_SECONDS]=900 [WORKSPACE_BUILD_TIMEOUT_SECONDS]=7200
        [WORKSPACE_MIN_HOST_FREE_GIB]=20 [WORKSPACE_STORAGE_MAX_PERCENT]=85
        [WORKSPACE_STATE_DIR]="$HOME/.local/state/oc-workspace"
        [WORKSPACE_INSTALL_DIR]="$HOME/.local/lib/oc-workspace"
        [WORKSPACE_CREDENTIAL_FILES]='{}'
        [INCUS_PROJECT]=orca [INCUS_STORAGE_POOL]=orca-vms [INCUS_POOL_SIZE_GIB]=512
        [INCUS_NETWORK]=orcabr0 [INCUS_SUBNET]=10.231.0.1/24 [INCUS_PROFILE]=oc-workspace
    )
    # Used by the installer in workspace.sh.
    # shellcheck disable=SC2034
    WORKSPACE_CONFIG_KEYS=("${!defaults[@]}")
    local -A overrides=()
    for key in "${!defaults[@]}"; do [[ ! -v $key ]] || overrides[$key]=1; done
    if [[ -f "$file" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            line=${line%$'\r'}
            [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
            [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || workspace_error "Expected KEY=value in $file"
            key=${BASH_REMATCH[1]}
            value=${BASH_REMATCH[2]}
            [[ -v defaults[$key] ]] || workspace_error "Unknown configuration key: $key"
            if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value=${value:1:${#value}-2}; fi
            [[ -v overrides[$key] ]] || printf -v "$key" '%s' "$value"
        done <"$file"
    fi
    for key in "${!defaults[@]}"; do
        if [[ ! -v $key || ("$key" == *_DIR && -z "${!key}") ]]; then
            printf -v "$key" '%s' "${defaults[$key]}"
        fi
        export "${key?}"
    done
    for key in WORKSPACE_MAX_COUNT WORKSPACE_CPUS WORKSPACE_MEMORY_GIB WORKSPACE_DISK_GIB \
        WORKSPACE_STATE_DISK_GIB WORKSPACE_DISK_BUDGET_GIB WORKSPACE_BANDWIDTH_MBIT \
        WORKSPACE_SSH_PORT WORKSPACE_TIMEOUT_SECONDS WORKSPACE_BUILD_TIMEOUT_SECONDS WORKSPACE_MIN_HOST_FREE_GIB \
        WORKSPACE_STORAGE_MAX_PERCENT INCUS_POOL_SIZE_GIB; do
        [[ "${!key}" =~ ^[1-9][0-9]{0,5}$ ]] || workspace_error "$key must be a positive integer"
    done
    ((WORKSPACE_SSH_PORT <= 65535 && WORKSPACE_STORAGE_MAX_PERCENT < 100)) || workspace_error 'Invalid port or storage threshold'
    ((WORKSPACE_STATE_DISK_GIB >= WORKSPACE_MEMORY_GIB + 2)) || workspace_error 'State disk must exceed guest RAM by at least 2 GiB'
    for key in WORKSPACE_BACKEND WORKSPACE_IMAGE_NAME INCUS_PROJECT INCUS_STORAGE_POOL INCUS_NETWORK INCUS_PROFILE; do
        [[ "${!key}" =~ ^[a-z][a-z0-9-]{0,40}$ ]] || workspace_error "Invalid name: $key"
    done
    [[ "$WORKSPACE_GUEST_USER" =~ ^[a-z][a-z0-9_-]{0,30}$ && "$WORKSPACE_GUEST_USER" != root ]] || workspace_error 'Invalid guest user'
    [[ "$WORKSPACE_NETWORK_POLICY" == internet-only ]] || workspace_error 'Only internet-only networking is implemented'
    [[ "$WORKSPACE_GUEST_OS" == ubuntu/24.04/cloud ]] || workspace_error 'Guest provisioning currently supports Ubuntu 24.04 cloud'
    [[ "$WORKSPACE_REPO_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/[^[:space:]]+$ ]] || workspace_error 'Repository URL must use HTTPS without embedded credentials'
    for key in WORKSPACE_GUEST_ROOT WORKSPACE_STATE_DIR WORKSPACE_INSTALL_DIR; do
        [[ "${!key}" =~ ^/[a-zA-Z0-9_./\ -]+$ && "${!key}" != / ]] || workspace_error "$key must be an absolute path using letters, numbers, spaces, dots, underscores or hyphens"
    done
    git check-ref-format --branch "$WORKSPACE_REPO_BRANCH" >/dev/null || workspace_error 'Invalid default branch'
    for key in WORKSPACE_PROJECTS WORKSPACE_SERVICES WORKSPACE_DEPENDENCY_SERVICES WORKSPACE_AGENT_TOOLS; do
        IFS=, read -r -a names <<<"${!key}"
        for name in "${names[@]}"; do
            case "$key:$name" in
                WORKSPACE_PROJECTS:opencollective | WORKSPACE_PROJECTS:api | WORKSPACE_PROJECTS:frontend | WORKSPACE_PROJECTS:documentation | WORKSPACE_PROJECTS:images | WORKSPACE_PROJECTS:pdf | WORKSPACE_PROJECTS:rest | WORKSPACE_PROJECTS:taxes | WORKSPACE_PROJECTS:rss | WORKSPACE_SERVICES:api | WORKSPACE_SERVICES:frontend | WORKSPACE_SERVICES:pdf | WORKSPACE_SERVICES:rest | WORKSPACE_SERVICES:images | WORKSPACE_DEPENDENCY_SERVICES:db | WORKSPACE_DEPENDENCY_SERVICES:mail | WORKSPACE_DEPENDENCY_SERVICES:uploads | WORKSPACE_DEPENDENCY_SERVICES:search | WORKSPACE_AGENT_TOOLS:codex | WORKSPACE_AGENT_TOOLS:opencode) ;;
                *) workspace_error "Unsupported selection: $key=$name" ;;
            esac
        done
    done
    for name in ${WORKSPACE_SERVICES//,/ }; do
        [[ ",$WORKSPACE_PROJECTS," == *",$name,"* ]] || workspace_error "Running service must be a selected project: $name"
    done
    [[ -z "$WORKSPACE_DEPENDENCY_SERVICES" || ",$WORKSPACE_PROJECTS," == *,api,* ]] || workspace_error 'Dependency services require the API project'
    [[ ",$WORKSPACE_SERVICES," != *,api,* || ",$WORKSPACE_DEPENDENCY_SERVICES," == *,db,* ]] || workspace_error 'Running API requires db'
    for key in WORKSPACE_CODEX_VERSION WORKSPACE_OPENCODE_VERSION WORKSPACE_NPM_VERSION WORKSPACE_PM2_VERSION; do
        [[ "${!key}" =~ ^(latest|[0-9]+([.][0-9]+){0,2}(-[a-zA-Z0-9.-]+)?)$ ]] || workspace_error "Invalid version: $key"
    done
    [[ "$WORKSPACE_NODE_VERSIONS" =~ ^[0-9]+([.][0-9]+){0,2}(,[0-9]+([.][0-9]+){0,2})*$ ]] || workspace_error 'Invalid Node versions'
    jq -e 'type == "object" and all(to_entries[]; (.key | startswith("/")) and (.value | IN(".codex/auth.json", ".local/share/opencode/auth.json", ".config/gh/hosts.yml")))' \
        <<<"$WORKSPACE_CREDENTIAL_FILES" >/dev/null || workspace_error 'Invalid credential file map'
    WORKSPACE_CREDENTIAL_FILES=$(jq -c . <<<"$WORKSPACE_CREDENTIAL_FILES")
}

workspace_guest_config() {
    # An explicit allowlist keeps host paths, credentials, and backend state out of the image.
    local key
    for key in WORKSPACE_REPO_URL WORKSPACE_REPO_BRANCH WORKSPACE_PROJECTS WORKSPACE_SERVICES \
        WORKSPACE_DEPENDENCY_SERVICES WORKSPACE_AGENT_TOOLS WORKSPACE_CODEX_VERSION \
        WORKSPACE_OPENCODE_VERSION WORKSPACE_NODE_VERSIONS WORKSPACE_NPM_VERSION \
        WORKSPACE_PM2_VERSION WORKSPACE_GUEST_USER WORKSPACE_GUEST_ROOT WORKSPACE_SSH_PORT \
        WORKSPACE_TIMEOUT_SECONDS; do
        jq -cn --arg key "$key" --arg value "${!key}" '{key: $key, value: $value}'
    done | jq -s 'from_entries'
}
