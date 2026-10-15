#!/usr/bin/env bash
# Runs as root inside the sandbox against the shared workspace.
set -euo pipefail
[[ $# == 0 ]] || { echo 'Usage: provision.sh' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(id -u)" == 0 ]] || { echo 'Provisioning requires root' >&2; exit 1; }
[[ -f /etc/os-release ]] && source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || {
  echo 'Provisioning supports Ubuntu 24.04; another image needs a compatible provisioner.' >&2
  exit 1
}
[[ "$(cat /proc/1/comm)" == systemd ]] || { echo 'Boot the sandbox with --init /lib/systemd/systemd.' >&2; exit 1; }
[[ "$(findmnt -n -o FSTYPE /var/lib/docker)" == ext4 ]] || {
  echo 'Docker requires its owned ext4 data disk at /var/lib/docker.' >&2
  exit 1
}

# Include native build dependencies and headless-browser libraries used by tests.
sudo -iu ubuntu test -w /workspace

# Configure VM SSH access before the host connects.
bash /workspace/.vm/configure-ssh.sh

# Raise the task limits. The image ships kernel.pid_max=8192, and systemd derives
# DefaultTasksMax (15%) from it, so services and sessions get pids.max=1228. Agent
# sessions, the dev stack and parallel Playwright workers exhaust that and crash
# with "Target crashed". Both settings take effect after the VM restarts.
install -d -m 755 /etc/sysctl.d /etc/systemd/system.conf.d
printf 'kernel.pid_max = 4194304\n' > /etc/sysctl.d/60-oc-pid-max.conf
printf '[Manager]\nDefaultTasksMax=65536\n' > /etc/systemd/system.conf.d/60-oc-tasks-max.conf
sysctl -q -p /etc/sysctl.d/60-oc-pid-max.conf
systemctl daemon-reexec

# Include native build dependencies and headless-browser libraries used by the
# existing development/test workflow, plus tools for root-disk growth below.

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git openssh-client sudo \
  build-essential pkg-config jq unzip zip rsync ripgrep tmux vim less zsh \
  postgresql-client-16 \
  libgtk-3-0t64 libgbm-dev libnotify-dev libnss3 libxss1 libasound2t64 \
  libxtst6 xauth xvfb libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  fonts-liberation libpango-1.0-0 libpangocairo-1.0-0

# Ubuntu's OCI image normally supplies uid 1000. Native bind ownership maps
# shared files to this guest account, without changing host UID/GID or files.
if ! id ubuntu >/dev/null 2>&1; then useradd --create-home --uid 1000 --shell /bin/bash ubuntu; fi
[[ "$(id -u ubuntu)" == 1000 && "$(id -g ubuntu)" == 1000 ]] || {
  echo 'The image must provide ubuntu with UID/GID 1000.' >&2; exit 1
}
install -d -o ubuntu -g ubuntu /home/ubuntu
usermod -s /bin/bash -aG sudo ubuntu
printf 'ubuntu ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/oc-development
chmod 440 /etc/sudoers.d/oc-development
# Login shells define a project `test` shortcut; invoke the filesystem probe
# directly so reprovisioning cannot accidentally launch the project test runner.
sudo -u ubuntu /usr/bin/test -w /workspace

# Use signed official repositories; never mount the host's Docker socket.
architecture=$(dpkg --print-architecture)
install -d -m 755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 644 /etc/apt/keyrings/docker.asc
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' "$architecture" \
  > /etc/apt/sources.list.d/docker.list
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli.gpg
chmod 644 /etc/apt/keyrings/githubcli.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main\n' "$architecture" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin gh
usermod -aG docker ubuntu
# Package archives are unnecessary on the default 4 GiB writable root.
apt-get clean
rm -rf /var/lib/apt/lists/*

# Docker 29+ may store image contents in containerd outside /var/lib/docker.
# Keep using classic overlay2 so all image/container/volume data uses our disk.
install -d /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  printf '{"storage-driver":"overlay2","features":{"containerd-snapshotter":false}}\n' > /etc/docker/daemon.json
fi
systemctl enable --now docker
[[ "$(docker info --format '{{.Driver}} {{.DockerRootDir}}')" == 'overlay2 /var/lib/docker' ]] || {
  echo 'Docker must use overlay2 at /var/lib/docker; check /etc/docker/daemon.json.' >&2; exit 1
}

# System PATH links make tools usable in noninteractive SSH/editor commands.
sudo -iu ubuntu bash "$SCRIPT_DIR/install-tools.sh" "$SCRIPT_DIR/versions.json"
node_version=$(jq -er '.node' "$SCRIPT_DIR/versions.json")
for executable in node npm npx codex opencode eslint prettier tsc pm2; do
  target="/home/ubuntu/.nvm/versions/node/v$node_version/bin/$executable"
  [[ -e "$target" ]] || { echo "Missing installed executable: $target" >&2; exit 1; }
  ln -sfn "$target" "/usr/local/bin/$executable"
done
# Leave room for future updates on the default writable root.
sudo -iu ubuntu npm cache clean --force
rm -rf /home/ubuntu/.nvm/.cache

# Source the shared primary checkout's shell hooks.
printf -v source_line 'source %q' "$SCRIPT_DIR/user-shell.sh"
for shell_file in /home/ubuntu/.bashrc /home/ubuntu/.profile; do
  touch "$shell_file"
  if ! rg -qFx "$source_line" "$shell_file"; then printf '\n%s\n' "$source_line" >> "$shell_file"; fi
  chown ubuntu:ubuntu "$shell_file"
done

echo 'Sandbox toolchain ready.'
