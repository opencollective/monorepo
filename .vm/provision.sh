#!/usr/bin/env bash
# Runs as root through Incus, without a forwarded SSH agent.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

[[ "$(id -u)" == 0 ]] || { echo 'Provisioning requires root' >&2; exit 1; }
[[ -f /etc/os-release ]] && source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || {
  echo 'This provisioner supports Ubuntu 24.04; another image needs a compatible provisioner.' >&2
  exit 1
}

# Incus uploads these provisioning assets through the guest agent. Keep a guest-local
# copy for later onboarding; no synced folder is needed to run shared scripts.
install -d -m 755 /opt/oc-vm
cp -R /tmp/oc-vm/. /opt/oc-vm/
find /opt/oc-vm -type d -exec chmod 755 {} +
find /opt/oc-vm -name '*.sh' -exec chmod 755 {} +
# Save validated resource/checkout settings. Host forwarding approval is separate
# and is never uploaded as a provisioning input.
printf '%s\n' "$1" > /etc/opencollective-vm.json
chmod 644 /etc/opencollective-vm.json

# Include native build dependencies and headless-browser libraries used by the
# existing development/test workflow, plus tools for root-disk growth below.
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git openssh-client \
  build-essential pkg-config jq unzip zip rsync ripgrep tmux vim less zsh \
  postgresql-client-16 cloud-guest-utils e2fsprogs xfsprogs lvm2 \
  libgtk-3-0t64 libgbm-dev libnotify-dev libnss3 libxss1 libasound2t64 \
  libxtst6 xauth xvfb libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  fonts-liberation libpango-1.0-0 libpangocairo-1.0-0

# The Incus root disk size grows the virtual disk, not its partition/filesystem.
root_device=$(readlink -f "$(findmnt -n -o SOURCE /)")
growth_device="$root_device"
volume_group=''
if [[ "$(lsblk -dn -o TYPE "$root_device")" == lvm ]]; then
  # Images can use LVM: grow the backing partition and PV before extending the LV.
  # Multiple PVs need a deliberate storage policy, so refuse that layout here.
  volume_group=$(lvs --noheadings -o vg_name "$root_device" | xargs)
  readarray -t physical_volumes < <(pvs --noheadings -o pv_name --select "vg_name=$volume_group" | awk '{print $1}')
  [[ ${#physical_volumes[@]} == 1 ]] || { echo 'Expected a single-PV root volume group' >&2; exit 1; }
  growth_device="${physical_volumes[0]}"
fi
parent_device=$(lsblk -dn -o PKNAME "$growth_device")
partition=$(cat "/sys/class/block/${growth_device##*/}/partition")
if [[ -z "$parent_device" || -z "$partition" ]]; then
  echo "Unsupported root layout: $root_device. Expected a partition on the VM root disk." >&2
  exit 1
fi
# growpart reports NOCHANGE on reprovisioning; that is an expected success state.
growth=$(growpart "/dev/$parent_device" "$partition" 2>&1) || {
  [[ "$growth" == *NOCHANGE* ]] || { echo "$growth" >&2; exit 1; }
}
if [[ -n "$volume_group" ]]; then
  pvresize "$growth_device"
  free_extents=$(vgs --noheadings -o vg_free_count "$volume_group" | xargs)
  if ((free_extents > 0)); then lvextend -l +100%FREE "$root_device"; fi
fi
case "$(findmnt -n -o FSTYPE /)" in
  ext4) resize2fs "$root_device" ;;
  xfs) xfs_growfs / ;;
  *) echo 'Unsupported root filesystem; use ext4 or XFS.' >&2; exit 1 ;;
esac

# Use signed official repositories; never copy the host's Docker socket.
install -d -m 755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 644 /etc/apt/keyrings/docker.asc
printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' \
  > /etc/apt/sources.list.d/docker.list
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli.gpg
chmod 644 /etc/apt/keyrings/githubcli.gpg
printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main\n' \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin gh
usermod -aG docker ubuntu
systemctl enable --now docker

# System-level PATH links make Node and agents usable in Orca/noninteractive SSH.
# Install under the developer's nvm directory, not root's. PATH links are needed
# because noninteractive SSH/Orca processes may never source shell startup files.
sudo -iu ubuntu bash /opt/oc-vm/install-tools.sh
node_version=$(jq -er '.node' /opt/oc-vm/versions.json)
for executable in node npm npx codex opencode eslint prettier tsc pm2; do
  target="/home/ubuntu/.nvm/versions/node/v$node_version/bin/$executable"
  [[ -e "$target" ]] || { echo "Missing installed executable: $target" >&2; exit 1; }
  ln -sfn "$target" "/usr/local/bin/$executable"
done

# Refuse an unexpected owner instead of recursively chowning someone else's data.
# clone preserves an existing checkout and uses public HTTPS on the first boot.
if [[ ! -e /workspace ]]; then
  install -d -o ubuntu -g "$(id -gn ubuntu)" /workspace
fi
[[ "$(stat -c %U /workspace)" == ubuntu ]] || {
  echo '/workspace already exists with another owner; resolve it before provisioning.' >&2
  exit 1
}
sudo -iu ubuntu node /opt/oc-vm/guest.mjs clone
# Both interactive shells and login shells get the same guest conveniences.
# Append the source line once so repeated provisioning does not duplicate hooks.
for shell_file in /home/ubuntu/.bashrc /home/ubuntu/.profile; do
  touch "$shell_file"
  if ! rg -qF 'source /opt/oc-vm/user-shell.sh' "$shell_file"; then
    printf '\nsource /opt/oc-vm/user-shell.sh\n' >> "$shell_file"
  fi
  chown "ubuntu:$(id -gn ubuntu)" "$shell_file"
done

echo 'VM ready. Run ./scripts/vm.sh setup on the host to initialize repositories and credentials.'
