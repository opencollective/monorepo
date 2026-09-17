#!/usr/bin/env bash
# Provision a libvirt (QEMU/KVM) Ubuntu Server VM that runs GitHub Actions
# runners as Docker containers, registered to the Open Collective org in the
# "Engineers Self Hosted" runner group, labeled runner-<name> for targeting
# from PRs.
#
# Linux + KVM + libvirt only. The domain shows up in virt-manager
# (QEMU/KVM / qemu:///system). SSH keys and config live under
# ~/.local/share/oc-gh-runners/; the qcow2 is imported into the default
# libvirt pool.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DEFAULT_JOBS=4
DEFAULT_RAM='16G'
DEFAULT_CPUS=8
DEFAULT_DISK='80G'
DEFAULT_ORG='opencollective'
DEFAULT_RUNNER_GROUP='Engineers Self Hosted'
DEFAULT_LOG_TAIL=100
UBUNTU_RELEASE='24.04'
SSH_USER='ubuntu'
LIBVIRT_URI='qemu:///system'
LIBVIRT_POOL='default'
DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/oc-gh-runners"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/oc-gh-runners"
SSH_WAIT_SECONDS=600
RUNNER_WAIT_SECONDS=180
IP_WAIT_SECONDS=180

NAME=''
TOKEN="${GITHUB_RUNNER_TOKEN:-}"
JOBS=''
RAM=''
CPUS=''
DISK=''
ORG=''
RUNNER_GROUP=''
SHORT=''
LABEL=''
ARCH=''
CLOUD_ARCH=''
DATADIR=''
DOMAIN=''
DISK_VOL=''
SEED_VOL=''
LIBVIRT_DISK=''
SEED_LIBVIRT=''
GUEST_IP=''
SSH_KEY=''
CLOUD_IMAGE=''
EXISTING_VM=0
EXISTING_DOMAIN=0
FORCE_RECREATE=0
SSH_OPTS=()
LOG_TAIL="$DEFAULT_LOG_TAIL"

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

die() {
  print_error "$1"
  exit 1
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
       $(basename "$0") logs [--name NAME] [--tail N]
       $(basename "$0") teardown [--name NAME] [--token TOKEN]

Create (or start) a libvirt Ubuntu Server VM with Docker, then register
multiple GitHub Actions runner containers in the org runner group
"${DEFAULT_RUNNER_GROUP}". The VM appears in virt-manager (QEMU/KVM).

Commands:
  (default)              Provision or start the VM and runners
  logs                   Follow runner container logs as [Worker N] ...
  teardown               Unregister workers (config.sh remove) and delete the VM

Options:
  --name NAME            Runner name (e.g. betree or runner-betree).
                         Label becomes runner-<name> (prefix stripped).
  --token TOKEN          GitHub org runner registration token.
                         Also accepted via GITHUB_RUNNER_TOKEN.
                         Expires after about one hour; only needed for first
                         registration (or if runner state was deleted).
  --jobs N               Concurrent jobs / runner containers (default: ${DEFAULT_JOBS})
  --ram SIZE             VM RAM (default: ${DEFAULT_RAM}). Accepts 16, 16G, 16Gb, 16GB.
  --cpus N               VM vCPUs (default: ${DEFAULT_CPUS})
  --disk SIZE            VM disk size (default: ${DEFAULT_DISK})
  --org ORG              GitHub organization (default: ${DEFAULT_ORG})
  --runner-group NAME    Runner group (default: ${DEFAULT_RUNNER_GROUP})
  --force-recreate       If a VM already exists, delete it and all local data
                         then set up from scratch
  --tail N               (logs) Lines per worker to show before following
                         (default: ${DEFAULT_LOG_TAIL})
  -h, --help             Show this help

Token: GitHub org Settings -> Actions -> Runner groups -> ${DEFAULT_RUNNER_GROUP}
-> New runner. Copy the registration token (not a PAT).

Examples:
  $0
  $0 --name betree --jobs 4 --ram 16G --cpus 8
  $0 --name betree --force-recreate
  $0 logs --name betree
  $0 teardown --name betree
  GITHUB_RUNNER_TOKEN=... $0 --name betree

State directory: ${DATA_ROOT}/<name>/
Libvirt domain: oc-gh-runner-<name>
EOF
}

need_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || return 1
}

virsh_cmd() {
  virsh --connect "$LIBVIRT_URI" "$@"
}

normalize_name() {
  local n="$1"
  n="${n,,}"
  n="${n#runner-}"
  printf '%s' "$n"
}

normalize_size() {
  local raw="$1"
  local kind="$2"
  local v
  v="$(printf '%s' "$raw" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
  v="${v%B}"
  if [[ "$v" =~ ^[0-9]+$ ]]; then
    printf '%sG' "$v"
    return 0
  fi
  if [[ "$v" =~ ^[0-9]+[KMGT]$ ]]; then
    printf '%s' "$v"
    return 0
  fi
  die "Invalid ${kind} size '${raw}'. Use something like 16G."
}

size_to_mib() {
  local v num unit
  v="$(normalize_size "$1" ram)"
  num="${v%%[KMGT]*}"
  unit="${v##*[0-9]}"
  case "$unit" in
    T) printf '%s' $((num * 1024 * 1024)) ;;
    G) printf '%s' $((num * 1024)) ;;
    M) printf '%s' "$num" ;;
    K) printf '%s' $(((num + 1023) / 1024)) ;;
    *) die "Cannot convert RAM size '${v}' to MiB." ;;
  esac
}

qcow_virtual_bytes() {
  local image="$1"
  local bytes
  bytes="$(qemu-img info "$image" | sed -n 's/^virtual size:.*(\([0-9]*\) bytes).*/\1/p')"
  [[ -n "$bytes" ]] || die "Could not read virtual size of ${image}"
  printf '%s' "$bytes"
}

validate_positive_int() {
  local raw="$1"
  local kind="$2"
  [[ "$raw" =~ ^[1-9][0-9]*$ ]] || die "Invalid ${kind} '${raw}'. Expected a positive integer."
}

prompt_value() {
  local __var="$1"
  local prompt="$2"
  local default="${3:-}"
  local silent="${4:-0}"
  local current="${!__var:-}"
  if [[ -n "$current" ]]; then
    return 0
  fi
  local hint=''
  [[ -n "$default" ]] && hint=" [${default}]"
  if [[ "$silent" == 1 ]]; then
    read -r -s -p "${prompt}${hint}: " current
    echo
  else
    read -r -p "${prompt}${hint}: " current
  fi
  if [[ -z "$current" ]]; then
    current="$default"
  fi
  printf -v "$__var" '%s' "$current"
}

parse_setup_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      --name)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        NAME="$2"
        shift 2
        ;;
      --token)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        TOKEN="$2"
        shift 2
        ;;
      --jobs)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        JOBS="$2"
        shift 2
        ;;
      --ram | --memory)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        RAM="$2"
        shift 2
        ;;
      --cpus | --cpu)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        CPUS="$2"
        shift 2
        ;;
      --disk)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        DISK="$2"
        shift 2
        ;;
      --org)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        ORG="$2"
        shift 2
        ;;
      --runner-group)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        RUNNER_GROUP="$2"
        shift 2
        ;;
      --force-recreate)
        FORCE_RECREATE=1
        shift
        ;;
      *)
        die "Unknown option: $1 (use --help)"
        ;;
    esac
  done
}

parse_logs_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      --name)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        NAME="$2"
        shift 2
        ;;
      --tail)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        LOG_TAIL="$2"
        shift 2
        ;;
      *)
        die "Unknown logs option: $1 (use --help)"
        ;;
    esac
  done
}

parse_teardown_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      --name)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        NAME="$2"
        shift 2
        ;;
      --token)
        [[ $# -ge 2 ]] || die "$1 requires a value"
        TOKEN="$2"
        shift 2
        ;;
      *)
        die "Unknown teardown option: $1 (use --help)"
        ;;
    esac
  done
}

detect_arch() {
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)
      CLOUD_ARCH='amd64'
      ;;
    aarch64 | arm64)
      ARCH='aarch64'
      CLOUD_ARCH='arm64'
      ;;
    *)
      die "Unsupported architecture '${ARCH}'. Need x86_64 or aarch64."
      ;;
  esac
}

prereq_hints() {
  cat <<EOF
Install libvirt/KVM and cloud-init tooling, then re-run this script.

  Debian/Ubuntu:
    sudo apt install libvirt-daemon-system virtinst qemu-utils cloud-image-utils
    sudo usermod -aG libvirt,kvm "\$USER"

  Fedora:
    sudo dnf install libvirt virt-install qemu-img cloud-utils
    sudo usermod -aG libvirt,kvm "\$USER"

  Arch:
    sudo pacman -S libvirt virt-install qemu-img cloud-utils
    sudo usermod -aG libvirt,kvm "\$USER"

Log out and back in after joining the libvirt and kvm groups. In virt-manager,
connect to "QEMU/KVM" (qemu:///system), not "QEMU/KVM user session".
EOF
}

check_prereqs() {
  [[ "$(uname -s)" == Linux ]] || die "This script supports Linux (libvirt/KVM) only."

  local missing=()
  local cmd
  for cmd in virsh virt-install qemu-img ssh ssh-keygen scp curl; do
    if ! need_cmd "$cmd"; then
      missing+=("$cmd")
    fi
  done
  if ! need_cmd cloud-localds && ! need_cmd genisoimage && ! need_cmd mkisofs && ! need_cmd xorriso; then
    missing+=("cloud-localds (or genisoimage/mkisofs/xorriso)")
  fi
  if [[ ${#missing[@]} -gt 0 ]]; then
    print_error "Missing required tools: ${missing[*]}"
    echo
    prereq_hints
    exit 1
  fi

  if [[ ! -e /dev/kvm ]]; then
    print_error "/dev/kvm not found. KVM is required."
    echo
    prereq_hints
    exit 1
  fi
  if [[ ! -r /dev/kvm ]]; then
    print_error "/dev/kvm is not readable. Add your user to the kvm group and re-login:"
    print_error "  sudo usermod -aG libvirt,kvm $USER"
    exit 1
  fi

  if ! virsh_cmd uri >/dev/null 2>&1; then
    print_error "Cannot connect to ${LIBVIRT_URI}."
    print_error "Add your user to the libvirt group and re-login:"
    print_error "  sudo usermod -aG libvirt,kvm $USER"
    echo
    prereq_hints
    exit 1
  fi
}

ensure_libvirt_network_and_pool() {
  if ! virsh_cmd pool-info "$LIBVIRT_POOL" >/dev/null 2>&1; then
    die "Libvirt storage pool '${LIBVIRT_POOL}' not found. Create it (virt-manager usually does this on first run)."
  fi
  if [[ "$(virsh_cmd pool-info "$LIBVIRT_POOL" | awk '/^State:/ {print $2}')" != running ]]; then
    print_status "Starting libvirt pool '${LIBVIRT_POOL}'..."
    virsh_cmd pool-start "$LIBVIRT_POOL"
  fi
  virsh_cmd pool-autostart "$LIBVIRT_POOL" >/dev/null

  if ! virsh_cmd net-info default >/dev/null 2>&1; then
    die "Libvirt network 'default' not found. It is required for NAT/DHCP."
  fi
  if [[ "$(virsh_cmd net-info default | awk '/^Active:/ {print $2}')" != yes ]]; then
    print_status "Starting libvirt network 'default'..."
    virsh_cmd net-start default
  fi
  virsh_cmd net-autostart default >/dev/null
}

domain_exists() {
  virsh_cmd dominfo "$DOMAIN" >/dev/null 2>&1
}

vm_running() {
  domain_exists || return 1
  [[ "$(virsh_cmd domstate "$DOMAIN" 2>/dev/null | head -n1)" == running ]]
}

volume_exists() {
  local vol="$1"
  virsh_cmd vol-info --pool "$LIBVIRT_POOL" "$vol" >/dev/null 2>&1
}

load_existing_config() {
  local cfg="$DATADIR/config.env"
  [[ -f "$cfg" ]] || return 1
  # shellcheck disable=SC1090
  source "$cfg"
  EXISTING_VM=1
  return 0
}

write_host_config() {
  local old_umask
  old_umask="$(umask)"
  umask 077
  cat >"$DATADIR/config.env" <<EOF
# Generated by setup-gh-self-hosted-runners.sh - do not commit.
SHORT='${SHORT}'
LABEL='${LABEL}'
ORG='${ORG}'
RUNNER_GROUP='${RUNNER_GROUP}'
JOBS='${JOBS}'
RAM='${RAM}'
CPUS='${CPUS}'
DISK='${DISK}'
ARCH='${ARCH}'
DOMAIN='${DOMAIN}'
GUEST_IP='${GUEST_IP}'
LIBVIRT_DISK='${LIBVIRT_DISK}'
EOF
  umask "$old_umask"
}

cloud_image_url() {
  printf 'https://cloud-images.ubuntu.com/releases/%s/release/ubuntu-%s-server-cloudimg-%s.img' \
    "$UBUNTU_RELEASE" "$UBUNTU_RELEASE" "$CLOUD_ARCH"
}

download_cloud_image() {
  local url dest
  url="$(cloud_image_url)"
  dest="${CACHE_DIR}/ubuntu-${UBUNTU_RELEASE}-server-cloudimg-${CLOUD_ARCH}.img"
  mkdir -p "$CACHE_DIR"
  if [[ -f "$dest" ]]; then
    print_status "Using cached Ubuntu cloud image: $dest"
    CLOUD_IMAGE="$dest"
    return 0
  fi
  print_status "Downloading Ubuntu ${UBUNTU_RELEASE} server cloud image (${CLOUD_ARCH})..."
  curl -fL --retry 3 --retry-delay 2 -o "${dest}.partial" "$url"
  mv "${dest}.partial" "$dest"
  CLOUD_IMAGE="$dest"
}

create_staging_disk() {
  local image="$1"
  local disk="$DATADIR/disk.qcow2"
  if [[ -f "$disk" ]]; then
    print_status "Reusing staging disk: $disk"
    return 0
  fi
  print_status "Creating ${DISK} VM disk..."
  qemu-img convert -O qcow2 "$image" "$disk"
  qemu-img resize "$disk" "$DISK" >/dev/null
  rm -f "$DATADIR/known_hosts"
}

upload_volume() {
  local vol="$1"
  local src="$2"
  local format="$3"
  local bytes="$4"

  if volume_exists "$vol"; then
    print_status "Reusing libvirt volume ${vol}"
    return 0
  fi
  print_status "Uploading ${src} to libvirt pool '${LIBVIRT_POOL}' as ${vol}..."
  virsh_cmd vol-create-as "$LIBVIRT_POOL" "$vol" "$bytes" --format "$format" >/dev/null
  if ! virsh_cmd vol-upload --pool "$LIBVIRT_POOL" "$vol" "$src"; then
    virsh_cmd vol-delete --pool "$LIBVIRT_POOL" "$vol" >/dev/null 2>&1 || true
    die "Failed to upload ${src} to libvirt. Is your user in the libvirt group?"
  fi
}

import_disks_to_libvirt() {
  DISK_VOL="oc-gh-runner-${SHORT}.qcow2"
  SEED_VOL="oc-gh-runner-${SHORT}-cidata.iso"

  if volume_exists "$DISK_VOL"; then
    LIBVIRT_DISK="$(virsh_cmd vol-path --pool "$LIBVIRT_POOL" "$DISK_VOL")"
    print_status "Reusing libvirt disk ${LIBVIRT_DISK}"
  else
    [[ -f "$DATADIR/disk.qcow2" ]] || die "Staging disk not found: $DATADIR/disk.qcow2"
    upload_volume "$DISK_VOL" "$DATADIR/disk.qcow2" qcow2 "$(qcow_virtual_bytes "$DATADIR/disk.qcow2")"
    LIBVIRT_DISK="$(virsh_cmd vol-path --pool "$LIBVIRT_POOL" "$DISK_VOL")"
    rm -f "$DATADIR/disk.qcow2"
  fi

  if [[ "$EXISTING_DOMAIN" -eq 0 ]]; then
    [[ -f "$DATADIR/seed.iso" ]] || die "cloud-init seed ISO not found: $DATADIR/seed.iso"
    if ! volume_exists "$SEED_VOL"; then
      upload_volume "$SEED_VOL" "$DATADIR/seed.iso" raw "$(stat -c%s "$DATADIR/seed.iso")"
    fi
    SEED_LIBVIRT="$(virsh_cmd vol-path --pool "$LIBVIRT_POOL" "$SEED_VOL")"
  elif volume_exists "$SEED_VOL"; then
    SEED_LIBVIRT="$(virsh_cmd vol-path --pool "$LIBVIRT_POOL" "$SEED_VOL")"
  fi
}

ensure_ssh_key() {
  SSH_KEY="$DATADIR/id_ed25519"
  if [[ ! -f "$SSH_KEY" ]]; then
    print_status "Generating SSH key for the VM..."
    ssh-keygen -t ed25519 -N '' -f "$SSH_KEY" -C "oc-gh-runner-${SHORT}" >/dev/null
  fi
  chmod 600 "$SSH_KEY"
}

write_cloud_init() {
  local pubkey user_data meta_data old_umask
  pubkey="$(cat "${SSH_KEY}.pub")"
  user_data="$DATADIR/user-data"
  meta_data="$DATADIR/meta-data"
  old_umask="$(umask)"
  umask 077
  cat >"$user_data" <<EOF
#cloud-config
hostname: oc-gh-runner-${SHORT}
manage_etc_hosts: true
users:
  - name: ${SSH_USER}
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: [sudo]
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - ${pubkey}
ssh_pwauth: false
package_update: true
package_upgrade: false
packages:
  - ca-certificates
  - curl
  - gnupg
  - jq
  - qemu-guest-agent
runcmd:
  - [bash, -lc, "curl -fsSL https://get.docker.com | sh"]
  - [usermod, -aG, docker, ${SSH_USER}]
  - [mkdir, -p, /opt/github-runners]
  - [chown, ${SSH_USER}:${SSH_USER}, /opt/github-runners]
  - [systemctl, enable, --now, docker]
  - [systemctl, enable, --now, qemu-guest-agent]
final_message: "oc-gh-runner-${SHORT} cloud-init finished"
EOF
  cat >"$meta_data" <<EOF
instance-id: oc-gh-runner-${SHORT}
local-hostname: oc-gh-runner-${SHORT}
EOF
  umask "$old_umask"
}

make_seed_iso() {
  local seed="$DATADIR/seed.iso"
  local user_data="$DATADIR/user-data"
  local meta_data="$DATADIR/meta-data"
  if [[ "$EXISTING_DOMAIN" -eq 1 ]]; then
    return 0
  fi
  if [[ -f "$seed" && "$EXISTING_VM" -eq 1 ]]; then
    return 0
  fi
  print_status "Building cloud-init seed ISO..."
  if need_cmd cloud-localds; then
    cloud-localds "$seed" "$user_data" "$meta_data"
  elif need_cmd genisoimage; then
    genisoimage -quiet -output "$seed" -volid cidata -joliet -rock \
      -graft-points "user-data=${user_data}" "meta-data=${meta_data}"
  elif need_cmd mkisofs; then
    mkisofs -quiet -output "$seed" -volid cidata -joliet -rock \
      -graft-points "user-data=${user_data}" "meta-data=${meta_data}"
  elif need_cmd xorriso; then
    xorriso -as mkisofs -quiet -o "$seed" -V cidata -joliet -rock \
      -graft-points "user-data=${user_data}" "meta-data=${meta_data}"
  else
    die "No tool available to build a cloud-init seed ISO."
  fi
}

define_or_start_domain() {
  local memory_mib
  memory_mib="$(size_to_mib "$RAM")"

  if domain_exists; then
    EXISTING_DOMAIN=1
    if vm_running; then
      print_status "Libvirt domain ${DOMAIN} is already running."
    else
      print_status "Starting libvirt domain ${DOMAIN}..."
      virsh_cmd start "$DOMAIN"
    fi
    virsh_cmd autostart "$DOMAIN" >/dev/null
    return 0
  fi

  print_status "Defining libvirt domain ${DOMAIN} (${CPUS} vCPU, ${RAM})..."
  local args=(
    virt-install
    --connect "$LIBVIRT_URI"
    --name "$DOMAIN"
    --memory "$memory_mib"
    --vcpus "$CPUS"
    --cpu host
    --import
    --disk "path=${LIBVIRT_DISK},format=qcow2,bus=virtio"
    --disk "path=${SEED_LIBVIRT},device=cdrom,readonly=on"
    --network "network=default,model=virtio"
    --graphics spice
    --noautoconsole
    --wait 0
    --osinfo "detect=on,require=off"
  )
  if [[ "$ARCH" == aarch64 ]]; then
    args+=(--boot uefi)
  fi
  if ! "${args[@]}"; then
    print_warning "virt-install --osinfo failed; retrying with --os-variant generic"
    args=(
      virt-install
      --connect "$LIBVIRT_URI"
      --name "$DOMAIN"
      --memory "$memory_mib"
      --vcpus "$CPUS"
      --cpu host
      --import
      --disk "path=${LIBVIRT_DISK},format=qcow2,bus=virtio"
      --disk "path=${SEED_LIBVIRT},device=cdrom,readonly=on"
      --network "network=default,model=virtio"
      --graphics spice
      --noautoconsole
      --wait 0
      --os-variant generic
    )
    if [[ "$ARCH" == aarch64 ]]; then
      args+=(--boot uefi)
    fi
    "${args[@]}"
  fi
  virsh_cmd autostart "$DOMAIN" >/dev/null
  EXISTING_DOMAIN=1
}

guest_ipv4() {
  local line ip
  line="$(virsh_cmd domifaddr "$DOMAIN" --source lease 2>/dev/null | awk '/ipv4/ {print $4; exit}')"
  if [[ -z "$line" ]]; then
    line="$(virsh_cmd domifaddr "$DOMAIN" --source agent 2>/dev/null | awk '/ipv4/ && $4 !~ /^127\./ {print $4; exit}')"
  fi
  ip="${line%%/*}"
  if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s' "$ip"
    return 0
  fi
  return 1
}

wait_for_guest_ip() {
  print_status "Waiting for guest DHCP address on ${DOMAIN}..."
  local elapsed=0 ip=''
  while [[ "$elapsed" -lt "$IP_WAIT_SECONDS" ]]; do
    if ip="$(guest_ipv4)"; then
      GUEST_IP="$ip"
      print_status "Guest IP: ${GUEST_IP}"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  die "Timed out waiting for an IPv4 address (virsh domifaddr ${DOMAIN}). Is the libvirt 'default' network running?"
}

ssh_guest_opts() {
  local known="$DATADIR/known_hosts"
  SSH_OPTS=(
    -i "$SSH_KEY"
    -o "UserKnownHostsFile=${known}"
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o ConnectTimeout=5
    -o StrictHostKeyChecking=accept-new
    -o LogLevel=ERROR
  )
}

ssh_guest() {
  ssh_guest_opts
  # Intentional: arguments are expanded locally then passed as the remote command.
  # shellcheck disable=SC2029
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${GUEST_IP}" "$@"
}

scp_to_guest() {
  ssh_guest_opts
  scp -q "${SSH_OPTS[@]}" "$@"
}

wait_for_ssh() {
  print_status "Waiting for SSH on ${SSH_USER}@${GUEST_IP} (cloud-init can take several minutes)..."
  local elapsed=0 discovered_ip=''
  while [[ "$elapsed" -lt "$SSH_WAIT_SECONDS" ]]; do
    if ssh_guest true >/dev/null 2>&1; then
      print_status "SSH is up."
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    if ((elapsed % 60 == 0)); then
      print_status "Still waiting for SSH... ${elapsed}s"
      # DHCP address can change once during first boot.
      if discovered_ip="$(guest_ipv4)" && [[ "$discovered_ip" != "$GUEST_IP" ]]; then
        print_status "Guest IP changed ${GUEST_IP} -> ${discovered_ip}"
        GUEST_IP="$discovered_ip"
      fi
    fi
  done
  die "VM did not become reachable via SSH at ${GUEST_IP}."
}

wait_for_docker() {
  print_status "Waiting for cloud-init and Docker inside the VM..."
  ssh_guest bash -s <<'EOS'
set -euo pipefail
if command -v cloud-init >/dev/null 2>&1; then
  sudo cloud-init status --wait || true
fi
for _ in $(seq 1 60); do
  if command -v docker >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    exit 0
  fi
  sleep 5
done
echo "Docker did not become ready" >&2
exit 1
EOS
}

write_guest_files() {
  local guest="$DATADIR/guest"
  local old_umask
  mkdir -p "$guest"
  old_umask="$(umask)"
  umask 077

  cat >"$guest/entrypoint.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /home/runner
STATE_DIR="${RUNNER_STATE_DIR:-/runner-state}"

restore_state() {
  if [[ -f "${STATE_DIR}/.runner" ]]; then
    cp -a "${STATE_DIR}/." /home/runner/
  fi
}

save_state() {
  mkdir -p "$STATE_DIR"
  local f
  for f in .runner .credentials .credentials_rsaparams .env; do
    if [[ -e "/home/runner/${f}" ]]; then
      cp -a "/home/runner/${f}" "${STATE_DIR}/"
    fi
  done
}

if [[ ! -f /home/runner/.runner ]]; then
  restore_state
fi

if [[ ! -f /home/runner/.runner ]]; then
  if [[ -z "${RUNNER_TOKEN:-}" ]]; then
    echo "Runner is not registered and RUNNER_TOKEN is empty." >&2
    exit 1
  fi
  ./config.sh --unattended \
    --url "https://github.com/${GITHUB_ORG}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --runnergroup "${RUNNER_GROUP}" \
    --labels "${RUNNER_LABELS}" \
    --work "${RUNNER_WORKDIR}" \
    --replace
  save_state
fi

exec ./run.sh
EOF
  chmod +x "$guest/entrypoint.sh"

  cat >"$guest/Dockerfile" <<'EOF'
FROM ghcr.io/actions/actions-runner:latest

USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc; \
    chmod a+r /etc/apt/keyrings/docker.asc; \
    . /etc/os-release; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends docker-ce-cli; \
    rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/runner-entrypoint.sh
RUN chmod +x /usr/local/bin/runner-entrypoint.sh

USER runner
ENTRYPOINT ["/usr/local/bin/runner-entrypoint.sh"]
EOF

  local compose="$guest/compose.yml"
  cat >"$compose" <<EOF
name: oc-gh-runner-${SHORT}
services:
EOF
  local i
  for i in $(seq 1 "$JOBS"); do
    cat >>"$compose" <<EOF
  runner-${i}:
    build: .
    image: oc-github-runner:local
    container_name: ${LABEL}-${i}
    init: true
    restart: unless-stopped
    env_file: .env
    environment:
      RUNNER_NAME: ${LABEL}-${i}
      RUNNER_WORKDIR: /opt/github-runners/work/${i}
      RUNNER_STATE_DIR: /runner-state
    group_add:
      - "\${DOCKER_GID}"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/github-runners/work/${i}:/opt/github-runners/work/${i}
      - /opt/github-runners/state/${i}:/runner-state
EOF
  done

  # Docker env_file treats quotes as part of the value; do not quote.
  cat >"$guest/.env" <<EOF
GITHUB_ORG=${ORG}
RUNNER_GROUP=${RUNNER_GROUP}
RUNNER_LABELS=${LABEL}
RUNNER_TOKEN=${TOKEN}
DOCKER_GID=0
EOF
  chmod 600 "$guest/.env"
  umask "$old_umask"
}

guest_has_runner_state() {
  ssh_guest test -f /opt/github-runners/state/1/.runner >/dev/null 2>&1
}

deploy_runners() {
  print_status "Installing ${JOBS} runner container(s) with label ${LABEL}..."
  write_guest_files

  ssh_guest sudo mkdir -p /opt/github-runners
  ssh_guest sudo chown "${SSH_USER}:${SSH_USER}" /opt/github-runners

  local i
  for i in $(seq 1 "$JOBS"); do
    ssh_guest sudo mkdir -p "/opt/github-runners/work/${i}" "/opt/github-runners/state/${i}"
    ssh_guest sudo chown -R 1001:1001 "/opt/github-runners/work/${i}" "/opt/github-runners/state/${i}"
  done

  scp_to_guest \
    "$DATADIR/guest/Dockerfile" \
    "$DATADIR/guest/entrypoint.sh" \
    "$DATADIR/guest/compose.yml" \
    "${SSH_USER}@${GUEST_IP}:/opt/github-runners/"

  if [[ -n "$TOKEN" ]]; then
    scp_to_guest "$DATADIR/guest/.env" "${SSH_USER}@${GUEST_IP}:/opt/github-runners/.env"
  else
    ssh_guest bash -s <<'EOS'
set -euo pipefail
if [[ ! -f /opt/github-runners/.env ]]; then
  echo "Missing /opt/github-runners/.env and no registration token was provided." >&2
  exit 1
fi
EOS
  fi

  ssh_guest chmod 600 /opt/github-runners/.env
  ssh_guest chmod 755 /opt/github-runners/entrypoint.sh

  ssh_guest bash -s <<'EOS'
set -euo pipefail
cd /opt/github-runners
gid="$(stat -c '%g' /var/run/docker.sock)"
if grep -q '^DOCKER_GID=' .env; then
  sed -i "s/^DOCKER_GID=.*/DOCKER_GID=${gid}/" .env
else
  echo "DOCKER_GID=${gid}" >> .env
fi
sg docker -c 'docker compose build --pull'
sg docker -c 'docker compose up -d --remove-orphans'
EOS
}

wait_for_runners() {
  print_status "Waiting for runners to listen for jobs..."
  local elapsed=0
  while [[ "$elapsed" -lt "$RUNNER_WAIT_SECONDS" ]]; do
    if ssh_guest bash -s <<'EOS'
set -euo pipefail
cd /opt/github-runners
sg docker -c 'docker compose logs --no-color' 2>/dev/null | grep -q 'Listening for Jobs'
EOS
    then
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
  print_warning "Timed out waiting for 'Listening for Jobs'. Recent logs:"
  ssh_guest bash -s <<'EOS' || true
cd /opt/github-runners
sg docker -c 'docker compose ps'
sg docker -c 'docker compose logs --tail=40'
EOS
}

print_ready() {
  echo
  echo "================================================="
  print_success "All ready, set the ${LABEL} label on PRs to use this runner"
  echo
  echo "  Group:  ${RUNNER_GROUP}"
  echo "  Label:  ${LABEL}"
  echo "  Jobs:   ${JOBS} containers (${LABEL}-1 ... ${LABEL}-${JOBS})"
  echo "  VM:     ${DOMAIN} (${CPUS} vCPU, ${RAM}, disk ${DISK})"
  echo "  IP:     ${GUEST_IP}"
  echo
  echo "Open in virt-manager: QEMU/KVM -> ${DOMAIN}"
  echo
  echo "SSH into the VM:"
  echo "  ssh -i ${SSH_KEY} ${SSH_USER}@${GUEST_IP}"
  echo
  echo "Follow worker logs:"
  echo "  $0 logs --name ${SHORT}"
  echo
  echo "Manage the VM:"
  echo "  virsh --connect ${LIBVIRT_URI} start ${DOMAIN}"
  echo "  virsh --connect ${LIBVIRT_URI} shutdown ${DOMAIN}"
  echo "  virsh --connect ${LIBVIRT_URI} dominfo ${DOMAIN}"
  echo
  echo "Tear down (unregisters workers, then deletes the VM):"
  echo "  $0 teardown --name ${SHORT}"
  echo "================================================="
}

set_identity_from_name() {
  [[ -n "$NAME" ]] || die "Runner name is required."
  SHORT="$(normalize_name "$NAME")"
  [[ -n "$SHORT" ]] || die "Runner name is empty after stripping 'runner-'."
  [[ "$SHORT" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "Runner name '${SHORT}' must be lowercase alphanumeric plus hyphens."
  LABEL="runner-${SHORT}"
  DATADIR="${DATA_ROOT}/${SHORT}"
  DOMAIN="oc-gh-runner-${SHORT}"
  DISK_VOL="oc-gh-runner-${SHORT}.qcow2"
  SEED_VOL="oc-gh-runner-${SHORT}-cidata.iso"
}

collect_inputs() {
  local cli_jobs="$JOBS"
  local cli_ram="$RAM"
  local cli_cpus="$CPUS"
  local cli_disk="$DISK"
  local cli_org="$ORG"
  local cli_group="$RUNNER_GROUP"

  prompt_value NAME "Runner name (e.g. betree or runner-betree)"
  set_identity_from_name

  local has_existing=0
  if domain_exists || [[ -d "$DATADIR" ]] || [[ -f "$DATADIR/disk.qcow2" ]] || [[ -f "$DATADIR/config.env" ]] || volume_exists "$DISK_VOL"; then
    has_existing=1
  fi

  if [[ "$FORCE_RECREATE" -eq 1 && "$has_existing" -eq 1 ]]; then
    print_warning "--force-recreate: deleting existing VM and data for ${SHORT}"
    delete_libvirt_domain
    if [[ -d "$DATADIR" ]]; then
      rm -rf "$DATADIR"
    fi
    EXISTING_VM=0
    EXISTING_DOMAIN=0
    GUEST_IP=''
    LIBVIRT_DISK=''
    SEED_LIBVIRT=''
  elif [[ "$has_existing" -eq 1 ]]; then
    print_status "Found existing runner VM data for ${SHORT}"
    load_existing_config || true
    EXISTING_VM=1
    if domain_exists; then
      EXISTING_DOMAIN=1
    fi
  fi

  if [[ -n "$cli_jobs" ]]; then JOBS="$cli_jobs"; fi
  if [[ -n "$cli_ram" ]]; then RAM="$cli_ram"; fi
  if [[ -n "$cli_cpus" ]]; then CPUS="$cli_cpus"; fi
  if [[ -n "$cli_disk" ]]; then DISK="$cli_disk"; fi
  if [[ -n "$cli_org" ]]; then ORG="$cli_org"; fi
  if [[ -n "$cli_group" ]]; then RUNNER_GROUP="$cli_group"; fi

  ORG="${ORG:-$DEFAULT_ORG}"
  RUNNER_GROUP="${RUNNER_GROUP:-$DEFAULT_RUNNER_GROUP}"
  DISK="${DISK:-$DEFAULT_DISK}"

  if [[ "$EXISTING_VM" -eq 1 ]]; then
    JOBS="${JOBS:-$DEFAULT_JOBS}"
    RAM="${RAM:-$DEFAULT_RAM}"
    CPUS="${CPUS:-$DEFAULT_CPUS}"
  else
    prompt_value JOBS "Concurrent jobs" "$DEFAULT_JOBS"
    prompt_value RAM "RAM" "$DEFAULT_RAM"
    prompt_value CPUS "CPUs" "$DEFAULT_CPUS"
    prompt_value TOKEN "GitHub runner registration token" '' 1
    [[ -n "$TOKEN" ]] || die "A GitHub runner registration token is required for first-time setup."
  fi

  JOBS="$(printf '%s' "$JOBS" | tr -d ' ')"
  CPUS="$(printf '%s' "$CPUS" | tr -d ' ')"
  validate_positive_int "$JOBS" "jobs"
  validate_positive_int "$CPUS" "cpus"
  RAM="$(normalize_size "$RAM" ram)"
  DISK="$(normalize_size "$DISK" disk)"
}

maybe_prompt_token() {
  if [[ -n "$TOKEN" ]]; then
    return 0
  fi
  if [[ "$EXISTING_VM" -eq 1 ]] && guest_has_runner_state 2>/dev/null; then
    print_status "Existing runner registration found; no token needed."
    return 0
  fi
  prompt_value TOKEN "GitHub runner registration token" '' 1
  [[ -n "$TOKEN" ]] || die "A GitHub runner registration token is required for first-time setup."
}

resolve_existing_runner() {
  if [[ -z "$NAME" ]]; then
    local dir names=()
    shopt -s nullglob
    for dir in "${DATA_ROOT}"/*/; do
      if [[ -f "${dir}config.env" ]]; then
        names+=("$(basename "$dir")")
      fi
    done
    shopt -u nullglob
    if [[ ${#names[@]} -eq 0 ]]; then
      die "No runner VMs found in ${DATA_ROOT}. Pass --name."
    fi
    if [[ ${#names[@]} -gt 1 ]]; then
      die "Multiple runner VMs found (${names[*]}). Pass --name."
    fi
    NAME="${names[0]}"
  fi
  set_identity_from_name
  [[ -f "$DATADIR/config.env" ]] || die "No config at ${DATADIR}/config.env. Run setup first."
  load_existing_config || true
  SSH_KEY="$DATADIR/id_ed25519"
  [[ -f "$SSH_KEY" ]] || die "SSH key not found: ${SSH_KEY}"
  DOMAIN="${DOMAIN:-oc-gh-runner-${SHORT}}"
}

cmd_logs() {
  parse_logs_args "$@"
  validate_positive_int "$LOG_TAIL" "tail"
  detect_arch
  check_prereqs
  resolve_existing_runner

  if ! vm_running; then
    die "Domain ${DOMAIN} is not running. Start it with: virsh --connect ${LIBVIRT_URI} start ${DOMAIN}"
  fi

  local ip=''
  if ip="$(guest_ipv4)"; then
    GUEST_IP="$ip"
  elif [[ -z "${GUEST_IP:-}" ]]; then
    die "Could not determine guest IP. Try: virsh --connect ${LIBVIRT_URI} domifaddr ${DOMAIN}"
  else
    print_warning "virsh did not report a lease; using saved IP ${GUEST_IP}"
  fi

  print_status "Following worker logs on ${DOMAIN} (${GUEST_IP})..."
  ssh_guest_opts
  # shellcheck disable=SC2029
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${GUEST_IP}" \
    "sg docker -c 'docker compose -f /opt/github-runners/compose.yml logs -f --tail=${LOG_TAIL} --no-color'" \
    | sed -u -E \
      -e 's/^runner-([0-9]+)[[:space:]]+\|[[:space:]]*/[Worker \1] /' \
      -e "s/^${LABEL}-([0-9]+)[[:space:]]+\\|[[:space:]]*/[Worker \\1] /"
}

ensure_guest_reachable() {
  if ! domain_exists; then
    return 1
  fi
  if ! vm_running; then
    print_status "Starting ${DOMAIN} so workers can unregister..."
    virsh_cmd start "$DOMAIN"
  fi
  wait_for_guest_ip
  wait_for_ssh
  wait_for_docker || true
  return 0
}

unregister_workers() {
  print_status "Unregistering workers with ./config.sh remove --token ..."
  local token_q label_q
  token_q="$(printf '%q' "$TOKEN")"
  label_q="$(printf '%q' "$LABEL")"
  ssh_guest bash -s <<EOS
set -uo pipefail
TOKEN=${token_q}
LABEL=${label_q}
JOBS=${JOBS}
cd /opt/github-runners
i=1
while [ "\$i" -le "\$JOBS" ]; do
  cname="\${LABEL}-\$i"
  echo "Removing \${cname}..."
  if sg docker -c "docker exec -w /home/runner \${cname} ./config.sh remove --unattended --token \${TOKEN}"; then
    echo "Removed \${cname}"
  else
    echo "Warning: \${cname} did not unregister (it may already be gone)." >&2
  fi
  i=\$((i + 1))
done
sg docker -c 'docker compose down --remove-orphans' || true
EOS
}

delete_libvirt_domain() {
  if domain_exists; then
    print_status "Deleting libvirt domain ${DOMAIN}..."
    virsh_cmd destroy "$DOMAIN" >/dev/null 2>&1 || true
    if ! virsh_cmd undefine "$DOMAIN" --remove-all-storage --nvram >/dev/null 2>&1; then
      virsh_cmd undefine "$DOMAIN" --remove-all-storage >/dev/null 2>&1 || true
    fi
  fi
  if volume_exists "$DISK_VOL"; then
    virsh_cmd vol-delete --pool "$LIBVIRT_POOL" "$DISK_VOL" >/dev/null 2>&1 || true
  fi
  if volume_exists "$SEED_VOL"; then
    virsh_cmd vol-delete --pool "$LIBVIRT_POOL" "$SEED_VOL" >/dev/null 2>&1 || true
  fi
}

cmd_teardown() {
  parse_teardown_args "$@"
  detect_arch
  check_prereqs
  ensure_libvirt_network_and_pool
  resolve_existing_runner
  JOBS="${JOBS:-$DEFAULT_JOBS}"
  validate_positive_int "$JOBS" "jobs"

  prompt_value TOKEN "GitHub runner registration token (for config.sh remove)" '' 1
  [[ -n "$TOKEN" ]] || die "A GitHub runner registration token is required to unregister workers."

  local confirm=''
  read -r -p "Unregister workers and delete VM ${DOMAIN}? [y/N] " confirm
  [[ "$confirm" =~ ^[yY]$ ]] || die "Aborted."

  if ensure_guest_reachable; then
    unregister_workers
  else
    print_warning "Domain ${DOMAIN} is not defined; skipping GitHub unregister."
  fi

  delete_libvirt_domain
  if [[ -d "$DATADIR" ]]; then
    print_status "Removing ${DATADIR}..."
    rm -rf "$DATADIR"
  fi
  print_success "Teardown complete for ${SHORT}."
}

cmd_setup() {
  parse_setup_args "$@"
  detect_arch
  check_prereqs
  ensure_libvirt_network_and_pool
  collect_inputs
  mkdir -p "$DATADIR"
  chmod 700 "$DATADIR"

  ensure_ssh_key

  if [[ "$EXISTING_DOMAIN" -eq 0 ]]; then
    write_cloud_init
    make_seed_iso
    if ! volume_exists "$DISK_VOL"; then
      if [[ ! -f "$DATADIR/disk.qcow2" ]]; then
        download_cloud_image
        create_staging_disk "$CLOUD_IMAGE"
      fi
    fi
    import_disks_to_libvirt
  else
    if volume_exists "$DISK_VOL"; then
      LIBVIRT_DISK="$(virsh_cmd vol-path --pool "$LIBVIRT_POOL" "$DISK_VOL")"
    fi
  fi

  define_or_start_domain
  wait_for_guest_ip
  write_host_config
  wait_for_ssh
  wait_for_docker
  maybe_prompt_token
  deploy_runners
  wait_for_runners
  write_host_config
  print_ready
}

main() {
  case "${1:-}" in
    logs)
      shift
      cmd_logs "$@"
      ;;
    teardown)
      shift
      cmd_teardown "$@"
      ;;
    *)
      cmd_setup "$@"
      ;;
  esac
}

main "$@"
