#!/usr/bin/env bash
# Shared guest operations. Functions can also be exercised by host-side unit tests.

dependency_fingerprint() {
    local repo=$1 node_version=$2 npm_version=$3 file
    {
        printf 'node=%s\nnpm=%s\nSKIP_POSTINSTALL=1\nHUSKY=0\n' "$node_version" "$npm_version"
        for file in package.json package-lock.json .npmrc .nvmrc; do
            printf '%s\n' "$file"
            if [[ -f "$repo/$file" ]]; then cat "$repo/$file"; else printf 'absent\n'; fi
        done
    } | sha256sum | cut -d ' ' -f 1
}

guest_log() { printf 'guest: %s\n' "$*" >&2; }
guest_error() {
    guest_log "$*"
    exit 1
}

dependency_manifest() {
    local file
    for file in "$GUEST_HOME"/.cache/oc-workspace/dependencies/*; do
        [[ -f "$file" ]] || continue
        jq -cn --arg key "$(basename -- "$file")" --arg value "$(cat "$file")" '{key:$key,value:$value}'
    done | jq -s from_entries
}

guest_load_config() {
    local key value
    while IFS=$'\t' read -r key value; do
        [[ "$key" =~ ^WORKSPACE_[A-Z_]+$ ]] || guest_error 'Invalid guest config'
        printf -v "$key" '%s' "$value"
        export "${key?}"
    done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' /opt/oc-workspace/config.json)
    GUEST_HOME="/home/$WORKSPACE_GUEST_USER"
    IFS=, read -r -a NODE_VERSIONS <<<"$WORKSPACE_NODE_VERSIONS"
    NODE_DIR="/opt/oc-node/${NODE_VERSIONS[0]}"
}

as_developer() {
    runuser -u "$WORKSPACE_GUEST_USER" -- env HOME="$GUEST_HOME" \
        PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin" npm_config_cache="$GUEST_HOME/.npm" "$@"
}

install_node() {
    local selector=$1 arch version directory tarball temp
    [[ "$selector" =~ ^[0-9]+([.][0-9]+){0,2}$ ]] || guest_error "Unsupported Node version: $selector"
    case $(uname -m) in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) guest_error 'Unsupported guest architecture' ;; esac
    version=$(curl --fail --silent --show-error --location https://nodejs.org/dist/index.json |
        jq -er --arg selector "$selector" '[.[] | .version | select(. == ("v"+$selector) or startswith("v"+$selector+"."))][0]')
    directory="/opt/oc-node/$version"
    if [[ ! -x "$directory/bin/node" ]]; then
        temp=$(mktemp -d)
        tarball="node-$version-linux-$arch.tar.xz"
        curl -fsSL "https://nodejs.org/dist/$version/$tarball" -o "$temp/$tarball"
        curl -fsSL "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$temp/SHASUMS256.txt"
        (cd "$temp" && awk -v file="$tarball" '$2 == file' SHASUMS256.txt | sha256sum -c -) >&2
        mkdir -p "$directory"
        tar -xJf "$temp/$tarball" --strip-components=1 -C "$directory"
        rm -rf -- "$temp"
    fi
    [[ "$selector" == "$version" ]] || ln -sfn "$directory" "/opt/oc-node/$selector"
    PATH="$directory/bin:$PATH" "$directory/bin/npm" install -g "npm@$WORKSPACE_NPM_VERSION" >&2
}

use_project_node() {
    local selector=${NODE_VERSIONS[0]}
    if [[ -f "$1/.nvmrc" ]]; then
        selector=$(tr -d '[:space:]' <"$1/.nvmrc")
        selector=${selector#v}
    fi
    [[ "$selector" =~ ^[0-9]+([.][0-9]+){0,2}$ ]] || guest_error 'Numeric .nvmrc versions are required'
    if [[ ! -x "/opt/oc-node/$selector/bin/node" ]]; then install_node "$selector"; fi
    NODE_DIR="/opt/oc-node/$selector"
}

normalize_repo_url() {
    local url=$1
    url=${url/#git@github.com:/https://github.com/}
    url=${url/#ssh:\/\/git@github.com\//https://github.com/}
    url=${url%/}
    printf '%s\n' "${url%.git}"
}

verify_project_checkout() {
    local repo=$1 branch=$2 head=$3 sparse git_dir common_dir
    [[ $(as_developer git -C "$repo" rev-parse --show-toplevel) == "$repo" &&
    $(as_developer git -C "$repo" rev-parse --is-bare-repository) == false ]] || guest_error 'Orca requires an ordinary primary checkout at projectRoot'
    if sparse=$(as_developer git -C "$repo" config --bool core.sparseCheckout); then
        [[ "$sparse" != true ]] || guest_error 'Orca provisioned-root does not support sparse checkouts'
    else
        [[ $? == 1 ]] || guest_error 'Cannot read checkout configuration'
    fi
    git_dir=$(as_developer git -C "$repo" rev-parse --absolute-git-dir)
    common_dir=$(as_developer git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
    [[ "$git_dir" == "$common_dir" ]] || guest_error 'Orca provisioned-root requires a primary checkout, not a linked worktree'
    [[ $(as_developer git -C "$repo" rev-parse HEAD) == "$head" &&
    $(as_developer git -C "$repo" symbolic-ref --short HEAD) == "$branch" ]] || guest_error 'Checkout does not match the requested branch and pinned commit'
}

refresh_repositories() {
    local root=$WORKSPACE_GUEST_ROOT
    if [[ ! -d "$root/.git" ]]; then
        mkdir -p "$root"
        chown "$WORKSPACE_GUEST_USER:$WORKSPACE_GUEST_USER" "$root"
        as_developer git clone -- "$WORKSPACE_REPO_URL" "$root" >&2
    fi
    as_developer git config --global --unset-all url.https://github.com/.insteadOf || true
    as_developer git config --global --add url.https://github.com/.insteadOf git@github.com:
    as_developer git config --global --add url.https://github.com/.insteadOf ssh://git@github.com/
    as_developer git -C "$root" remote set-url origin "$WORKSPACE_REPO_URL"
    as_developer git -C "$root" fetch --no-recurse-submodules origin "+refs/heads/$WORKSPACE_REPO_BRANCH:refs/remotes/origin/$WORKSPACE_REPO_BRANCH" >&2
    as_developer git -C "$root" switch -C "$WORKSPACE_REPO_BRANCH" "refs/remotes/origin/$WORKSPACE_REPO_BRANCH" >&2
    as_developer "$root/scripts/init.sh" --projects "$WORKSPACE_PROJECTS" >&2
}

install_project_dependencies() {
    local repo=$1 name marker fingerprint
    [[ -f "$repo/package.json" ]] || return 0
    use_project_node "$repo"
    name=$(basename -- "$repo")
    marker="$GUEST_HOME/.cache/oc-workspace/dependencies/$name"
    fingerprint=$(dependency_fingerprint "$repo" "$("$NODE_DIR/bin/node" --version)" "$(PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/npm" --version)")
    if [[ -d "$repo/node_modules" && -f "$marker" && $(cat "$marker") == "$fingerprint" ]]; then
        guest_log "Reusing installed dependencies: $name"
        return
    fi
    guest_log "Installing dependencies: $name"
    if [[ -f "$repo/package-lock.json" ]]; then
        (cd "$repo" && as_developer env SKIP_POSTINSTALL=1 HUSKY=0 npm ci --prefer-offline) >&2
    else
        (cd "$repo" && as_developer env SKIP_POSTINSTALL=1 HUSKY=0 npm install --prefer-offline --package-lock=false) >&2
    fi
    install -d -o "$WORKSPACE_GUEST_USER" -g "$WORKSPACE_GUEST_USER" "$GUEST_HOME/.cache/oc-workspace/dependencies"
    printf '%s\n' "$fingerprint" >"$marker"
    chown "$WORKSPACE_GUEST_USER:$WORKSPACE_GUEST_USER" "$marker"
}

install_all_dependencies() {
    local project repo
    IFS=, read -r -a projects <<<"$WORKSPACE_PROJECTS"
    for project in "${projects[@]}"; do
        repo="$WORKSPACE_GUEST_ROOT/opencollective-$project"
        [[ "$project" != opencollective ]] || repo="$WORKSPACE_GUEST_ROOT/opencollective"
        install_project_dependencies "$repo"
    done
    NODE_DIR="/opt/oc-node/${NODE_VERSIONS[0]}"
}

compose_config() {
    local service file
    local -a args=()
    if [[ -z "$WORKSPACE_DEPENDENCY_SERVICES" ]]; then
        printf '{"services":{}}\n' >/opt/oc-workspace/compose.json
        return
    fi
    IFS=, read -r -a services <<<"$WORKSPACE_DEPENDENCY_SERVICES"
    for service in "${services[@]}"; do
        file="$WORKSPACE_GUEST_ROOT/opencollective-api/docker-compose/$service.yml"
        [[ -f "$file" ]] || guest_error "Missing dependency Compose file: $file"
        args+=(-f "$file")
    done
    # Published ports belong to this guest, never the physical host. Restrict to guest loopback.
    POSTGRES_MEMORY_LIMIT=2gb MAILPIT_MEMORY_LIMIT=512mb RUSTFS_MEMORY_LIMIT=1gb OPENSEARCH_MEMORY_LIMIT=2gb \
        docker compose "${args[@]}" config --format json |
        jq 'del(.name) | .services |= with_entries(.value.ports = [(.value.ports // [])[] | .host_ip = "127.0.0.1"])' \
            >/opt/oc-workspace/compose.json
}

compose() {
    [[ -n "$WORKSPACE_DEPENDENCY_SERVICES" ]] || return 0
    docker compose -p oc-workspace -f /opt/oc-workspace/compose.json "$@"
}

wait_for_http() {
    local url=$1 deadline=$((SECONDS + WORKSPACE_TIMEOUT_SECONDS))
    until curl --silent --fail --max-time 5 "$url" >/dev/null; do
        ((SECONDS < deadline)) || guest_error "Timed out waiting for $url"
        sleep 2
    done
}

write_runtime_env() {
    local file="$GUEST_HOME/.config/oc-workspace/runtime.env"
    install -d -m 700 -o "$WORKSPACE_GUEST_USER" -g "$WORKSPACE_GUEST_USER" "$(dirname -- "$file")"
    if [[ ! -f "$file" ]]; then
        {
            printf 'SESSION_SECRET=%s\nJWT_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)"
        } >"$file"
        chmod 600 "$file"
        chown "$WORKSPACE_GUEST_USER:$WORKSPACE_GUEST_USER" "$file"
    fi
    # Only this generated file is read as data, with a fixed allowlist.
    local key value
    while IFS='=' read -r key value; do
        case "$key" in SESSION_SECRET | JWT_SECRET)
            printf -v "$key" '%s' "$value"
            export "${key?}"
            ;;
        *) guest_error 'Invalid runtime setting' ;; esac
    done <"$file"
    export NODE_ENV=development OC_ENV=development PG_HOST=127.0.0.1 MAILPIT_HOST=127.0.0.1
    export AWS_KEY=user AWS_SECRET=password AWS_S3_REGION=us-east-1 AWS_S3_ENDPOINT=http://127.0.0.1:9000 AWS_S3_SSL_ENABLED=false AWS_S3_FORCE_PATH_STYLE=true
    export API_URL=http://127.0.0.1:3060 API_KEY=dvl-1510egmf4a23d80342403fb599qd HOSTNAME=127.0.0.1
    export WEBSITE_URL=http://localhost:3000 PDF_SERVICE_URL=http://127.0.0.1:3002 REST_URL=http://127.0.0.1:3003 IMAGES_URL=http://127.0.0.1:3001
}

start_stack() {
    compose_config
    compose up -d --wait --wait-timeout "$WORKSPACE_TIMEOUT_SECONDS" >&2
    write_runtime_env
    local api="$WORKSPACE_GUEST_ROOT/opencollective-api" deadline=$((SECONDS + WORKSPACE_TIMEOUT_SECONDS))
    if [[ ",$WORKSPACE_DEPENDENCY_SERVICES," == *,db,* ]]; then
        until pg_isready -h 127.0.0.1 -U postgres >/dev/null; do
            ((SECONDS < deadline)) || guest_error 'PostgreSQL startup timed out'
            sleep 2
        done
        use_project_node "$api"
        (cd "$api" && as_developer npm run postinstall) >&2
        if ! psql -h 127.0.0.1 -U postgres -Atc 'SELECT datname FROM pg_database' | grep -qx opencollective_test; then
            (cd "$api" && as_developer npm run db:restore:test) >&2
        fi
    fi
    if [[ ",$WORKSPACE_DEPENDENCY_SERVICES," == *,uploads,* ]]; then
        until (cd "$api" && as_developer npm run script scripts/dev/init-local-s3.ts) >&2; do
            ((SECONDS < deadline)) || guest_error 'RustFS bucket initialization timed out'
            sleep 2
        done
    fi
    local service repo
    IFS=, read -r -a services <<<"$WORKSPACE_SERVICES"
    for service in "${services[@]}"; do
        repo="$WORKSPACE_GUEST_ROOT/opencollective-$service"
        use_project_node "$repo"
        (cd "$repo" && as_developer env NODE_OPTIONS="--require=/opt/oc-workspace/loopback.cjs" pm2 start "$NODE_DIR/bin/npm" --name "$service" -- run dev) >&2
    done
    [[ ",$WORKSPACE_SERVICES," != *,api,* ]] || wait_for_http http://127.0.0.1:3060/status
    [[ ",$WORKSPACE_SERVICES," != *,frontend,* ]] || wait_for_http http://127.0.0.1:3000
}
