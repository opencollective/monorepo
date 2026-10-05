#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=guest-lib.sh
source "$SCRIPT_DIR/guest-lib.sh"
[[ "$EUID" == 0 ]] || guest_error 'Guest provisioning must run as root inside the VM'
# A pristine cloud image need not contain jq. Bootstrap the data reader first.
if ! command -v jq >/dev/null; then
    cloud-init status --wait >/dev/null
    apt-get update >&2
    DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y jq >&2
fi
guest_load_config

bootstrap() {
    export DEBIAN_FRONTEND=noninteractive
    # First boot may still be installing image packages. Never compete for apt locks.
    cloud-init status --wait >/dev/null
    apt-get update >&2
    apt-get -o DPkg::Lock::Timeout=120 dist-upgrade -y >&2
    apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends \
        ca-certificates curl git jq sudo openssh-server build-essential python3 ripgrep rsync tmux \
        postgresql-client openssl unzip xz-utils gnupg gh \
        libgtk2.0-0t64 libgtk-3-0t64 libgbm1 libnotify4 libnss3 libxss1 libasound2t64 libxtst6 xauth xvfb >&2
    install -d -m 755 /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod 644 /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' "$(dpkg --print-architecture)" \
        >/etc/apt/sources.list.d/docker.list
    apt-get update >&2
    apt-get -o DPkg::Lock::Timeout=120 install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >&2
    systemctl enable --now docker >&2
    if ! id "$WORKSPACE_GUEST_USER" >/dev/null 2>&1; then useradd -m -s /bin/bash "$WORKSPACE_GUEST_USER"; fi
    usermod -aG docker,sudo "$WORKSPACE_GUEST_USER"
    printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$WORKSPACE_GUEST_USER" >/etc/sudoers.d/oc-workspace
    chmod 440 /etc/sudoers.d/oc-workspace
    install -d -m 755 /opt/oc-node
    local version
    for version in "${NODE_VERSIONS[@]}"; do install_node "$version"; done
    NODE_DIR="/opt/oc-node/${NODE_VERSIONS[0]}"
    for command in node npm npx; do ln -sfn "$NODE_DIR/bin/$command" "/usr/local/bin/$command"; done
    PATH="$NODE_DIR/bin:$PATH" npm install -g "pm2@$WORKSPACE_PM2_VERSION" >&2
    local tool
    for tool in codex opencode; do
        if [[ ",$WORKSPACE_AGENT_TOOLS," != *",$tool,"* ]]; then
            local package=opencode-ai
            [[ "$tool" != codex ]] || package=@openai/codex
            PATH="$NODE_DIR/bin:$PATH" npm uninstall -g "$package" >&2
            rm -f -- "/usr/local/bin/$tool"
        fi
    done
    IFS=, read -r -a tools <<<"$WORKSPACE_AGENT_TOOLS"
    for tool in "${tools[@]}"; do
        case "$tool" in
            codex) PATH="$NODE_DIR/bin:$PATH" npm install -g "@openai/codex@$WORKSPACE_CODEX_VERSION" >&2 ;;
            opencode) PATH="$NODE_DIR/bin:$PATH" npm install -g "opencode-ai@$WORKSPACE_OPENCODE_VERSION" >&2 ;;
            *) guest_error "Unsupported agent tool: $tool" ;;
        esac
    done
    for command in pm2 codex opencode; do
        [[ ! -x "$NODE_DIR/bin/$command" ]] || ln -sfn "$NODE_DIR/bin/$command" "/usr/local/bin/$command"
    done
    systemctl enable fstrim.timer >&2
    printf 'net.ipv6.conf.all.disable_ipv6=1\nnet.ipv6.conf.default.disable_ipv6=1\n' >/etc/sysctl.d/90-oc-workspace.conf
    sysctl -p /etc/sysctl.d/90-oc-workspace.conf >&2
    # PATH expands in the guest's future shell, not while writing this file.
    # shellcheck disable=SC2016
    printf '\nexport PATH="%s/bin:/usr/local/bin:$PATH"\n' "$NODE_DIR" >/etc/profile.d/oc-workspace.sh
    printf '\n# Workspace shortcuts\nrun() { (cd "%s" && ./scripts/run.sh "$@"); }\noc_test() { "%s/scripts/test.sh" "$@"; }\n' \
        "$WORKSPACE_GUEST_ROOT" "$WORKSPACE_GUEST_ROOT" >"$GUEST_HOME/.bash_aliases"
    chown "$WORKSPACE_GUEST_USER:$WORKSPACE_GUEST_USER" "$GUEST_HOME/.bash_aliases"
    install -d -m 755 /etc/ssh/sshd_config.d
    cat >/etc/ssh/sshd_config.d/00-oc-workspace.conf <<EOF
Port $WORKSPACE_SSH_PORT
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowAgentForwarding no
AllowUsers $WORKSPACE_GUEST_USER
EOF
}

manifest() {
    local root="$WORKSPACE_GUEST_ROOT" project file
    file=$(mktemp)
    as_developer git -C "$root" rev-parse HEAD | jq -R --arg project monorepo '{key:$project,value:.}' >"$file"
    IFS=, read -r -a projects <<<"$WORKSPACE_PROJECTS"
    for project in "${projects[@]}"; do
        local path="$root/opencollective-$project"
        [[ "$project" != opencollective ]] || path="$root/opencollective"
        as_developer git -C "$path" rev-parse HEAD | jq -R --arg project "$project" '{key:$project,value:.}' >>"$file"
    done
    jq -n --slurpfile repos "$file" --arg built "$(date -u +%FT%TZ)" \
        --arg node "$(node --version)" --arg docker "$(docker --version)" \
        --arg git "$(git --version)" --arg gh "$(gh --version | head -1)" \
        --arg postgres "$(psql --version)" --arg compose "$(docker compose version --short)" \
        --argjson npm "$(npm list -g --depth=0 --json)" \
        --argjson images "$(docker image ls --digests --format '{{json .}}' | jq -s .)" \
        --argjson config "$(cat /opt/oc-workspace/config.json)" \
        --argjson fingerprints "$(dependency_manifest)" \
        --argjson nodes "$(find /opt/oc-node -mindepth 1 -maxdepth 1 -type d -name 'v*' -printf '%f\n' | jq -Rs 'split("\n")|map(select(length>0))')" \
        '{builtAt:$built,repositories:($repos|from_entries),node:$node,nodeVersions:$nodes,docker:$docker,toolVersions:{git:$git,gh:$gh,postgres:$postgres,compose:$compose},globalPackages:$npm.dependencies,dockerImages:$images,dependencyFingerprints:$fingerprints,config:$config}' \
        >/opt/oc-workspace/image-manifest.json
    rm -f -- "$file"
}

sanitize() {
    as_developer pm2 kill >&2 || true
    # No containers or runtime volumes are retained, only reusable image layers.
    docker ps -aq | xargs -r docker rm -f >&2
    docker volume ls -q | xargs -r docker volume rm >&2
    systemctl stop docker containerd ssh.service ssh.socket systemd-random-seed.service >&2
    rm -rf -- "$GUEST_HOME/.ssh" "$GUEST_HOME/.codex" "$GUEST_HOME/.local/share/opencode" \
        "$GUEST_HOME/.config/gh" "$GUEST_HOME/.config/oc-workspace" "$GUEST_HOME/.pm2" \
        "$GUEST_HOME/.orca" "$GUEST_HOME/.config/orca" "$GUEST_HOME/.cache/orca" \
        /root/.ssh /root/.docker /root/.codex /root/.config/gh /root/.local/share/opencode
    rm -f -- "$GUEST_HOME/.bash_history" /root/.bash_history /opt/oc-workspace/request.json
    find /home /root -type f \( -name authorized_keys -o -name .env -o -name .env.local -o -name .git-credentials -o -name config.local.env \) -delete
    # Public repos commit development .env.local defaults. Remove only untracked settings.
    local env_file repo
    while IFS= read -r -d '' env_file; do
        repo=$(dirname -- "$env_file")
        if ! as_developer git -C "$repo" ls-files --error-unmatch "$(basename -- "$env_file")" >/dev/null 2>&1; then rm -f -- "$env_file"; fi
    done < <(find "$WORKSPACE_GUEST_ROOT" -name node_modules -prune -o -type f \( -name .env.local -o -name .env.workspace.local \) -print0)
    rm -rf -- /var/lib/docker/network/files
    rm -f -- /var/lib/docker/engine-id /var/lib/systemd/credential.secret /var/lib/systemd/timesync/clock
    rm -f -- /etc/ssh/ssh_host_* /var/lib/systemd/random-seed
    cloud-init clean --logs --machine-id --seed
    truncate -s 0 /etc/machine-id
    rm -f -- /var/lib/dbus/machine-id
    ln -s /etc/machine-id /var/lib/dbus/machine-id
    journalctl --rotate >&2
    journalctl --vacuum-time=1s >&2
    find /var/log -type f -exec truncate -s 0 {} +
    rm -rf -- /tmp/* /var/tmp/*
    sync
    fstrim -av >&2
}

first_boot() {
    cloud-init status --wait >/dev/null
    ssh-keygen -A >&2
    systemctl disable --now ssh.socket >&2
    systemctl enable --now ssh.service docker >&2
    # Clone starts with no authorization key; it is installed by the host afterwards.
}

prepare() {
    first_boot
    if [[ -f "$GUEST_HOME/.config/gh/hosts.yml" ]]; then as_developer gh auth setup-git >&2; fi
    refresh_repositories
    local request=/opt/oc-workspace/request.json url branch ref head root project path
    jq -e '.url|type=="string"' "$request" >/dev/null
    url=$(normalize_repo_url "$(jq -r .url "$request")")
    branch=$(jq -r .branch "$request")
    ref=$(jq -r .ref "$request")
    head=$(jq -r .head "$request")
    [[ "$url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/[^[:space:]]+$ && "$head" =~ ^[a-fA-F0-9]{40,64}$ && "$ref" != -* ]] || guest_error 'Invalid checkout request'
    as_developer git check-ref-format --branch "$branch" >/dev/null
    root="$WORKSPACE_GUEST_ROOT"
    if [[ "$url" != "$(normalize_repo_url "$WORKSPACE_REPO_URL")" ]]; then
        root=''
        IFS=, read -r -a projects <<<"$WORKSPACE_PROJECTS"
        for project in "${projects[@]}"; do
            path="$WORKSPACE_GUEST_ROOT/opencollective-$project"
            [[ "$project" != opencollective ]] || path="$WORKSPACE_GUEST_ROOT/opencollective"
            if [[ "${url##*/}" == "$(basename -- "$(normalize_repo_url "$(as_developer git -C "$path" remote get-url origin)")")" ]]; then
                root=$path
                break
            fi
        done
        [[ -n "$root" ]] || guest_error 'Requested repository is not a configured project'
    fi
    as_developer git -C "$root" remote set-url origin "$url"
    as_developer git -C "$root" fetch --no-recurse-submodules origin "$ref" >&2
    if ! as_developer git -C "$root" cat-file -e "$head^{commit}"; then as_developer git -C "$root" fetch origin "$head" >&2; fi
    as_developer git -C "$root" switch -C "$branch" "$head" >&2
    # Monorepo feature branches may update submodule metadata; initialize after pinning too.
    if [[ "$root" == "$WORKSPACE_GUEST_ROOT" ]]; then as_developer "$root/scripts/init.sh" --projects "$WORKSPACE_PROJECTS" >&2; fi
    install_all_dependencies
    start_stack
    printf '%s\n' "$root" # This is the sole stdout returned to the host.
}

image_check() {
    [[ ! -d "$GUEST_HOME/.ssh" && ! -d "$GUEST_HOME/.codex" && ! -d "$GUEST_HOME/.config/gh" &&
        ! -d "$GUEST_HOME/.local/share/opencode" && ! -d "$GUEST_HOME/.pm2" ]] || guest_error 'Golden image contains runtime/credential state'
    [[ -s /etc/machine-id && -s /etc/ssh/ssh_host_ed25519_key.pub ]] || guest_error 'Fresh machine/host identity was not generated'
    [[ -f /opt/oc-workspace/image-manifest.json ]] || guest_error 'Missing image manifest'
    node --version >&2
    npm --version >&2
    docker compose version >&2
    jq -e --argjson current "$(cat /opt/oc-workspace/config.json)" '.config == $current' /opt/oc-workspace/image-manifest.json >/dev/null
    compose_config
    compose up -d --wait --wait-timeout "$WORKSPACE_TIMEOUT_SECONDS" >&2
    # Validate the actual cached checkout/database/services before promoting the candidate.
    start_stack
}

case "${1:-}" in
    build)
        bootstrap
        refresh_repositories
        install_all_dependencies
        compose_config
        compose pull >&2
        manifest
        ;;
    sanitize) sanitize ;;
    first-boot) first_boot ;;
    prepare) prepare ;;
    image-check)
        first_boot
        image_check
        ;;
    *) guest_error 'Expected build, sanitize, first-boot, prepare, or image-check' ;;
esac
