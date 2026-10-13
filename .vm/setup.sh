#!/usr/bin/env bash
# Onboarding only. msb owns sandbox configuration, lifecycle, storage, and SSH.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

usage() { echo 'Usage: .vm/setup.sh'; }
fail() { echo "$*" >&2; exit 1; }
if [[ $# == 1 && ( $1 == --help || $1 == -h ) ]]; then usage; exit 0; fi
[[ $# == 0 ]] || { usage >&2; exit 1; }
trap 'echo "Setup failed. Fix the failed stage and rerun .vm/setup.sh; any created sandbox is retained." >&2' ERR

[[ "$(uname -s)" == Linux ]] || fail 'Project setup currently supports Linux KVM hosts.'
[[ "$(id -u)" != 0 ]] || fail 'Run setup as your regular host user, without sudo.'
for tool in git jq msb; do command -v "$tool" >/dev/null || fail "Required host tool is missing: $tool"; done

# Keep numeric overrides bounded for shell arithmetic; msb validates allocation.
positive_integer() {
  [[ $2 =~ ^[0-9]+$ && ${#2} -le 16 ]] || fail "$1 must be a positive integer."
  (( 10#$2 > 0 && 10#$2 <= 9007199254740991 )) || fail "$1 must be a positive integer."
}
export OC_VM_DISK_GB="${OC_VM_DISK_GB-100}"
positive_integer OC_VM_DISK_GB "$OC_VM_DISK_GB"
OC_VM_DISK_GB=$((10#$OC_VM_DISK_GB))
instance_name="${OC_VM_INSTANCE_NAME-oc-dev}"
[[ $instance_name =~ ^[a-zA-Z][a-zA-Z0-9_-]{0,62}$ ]] || fail 'Invalid OC_VM_INSTANCE_NAME.'
overrides=()
if [[ ${OC_VM_CPUS+x} ]]; then
  positive_integer OC_VM_CPUS "$OC_VM_CPUS"
  [[ $((10#$OC_VM_CPUS)) -le 255 ]] || fail 'OC_VM_CPUS must be at most 255.'
  overrides+=(--cpus "$((10#$OC_VM_CPUS))")
fi
if [[ ${OC_VM_MEMORY_MB+x} ]]; then
  positive_integer OC_VM_MEMORY_MB "$OC_VM_MEMORY_MB"
  overrides+=(--memory "$((10#$OC_VM_MEMORY_MB))M")
fi
if [[ ${OC_VM_IMAGE+x} ]]; then
  [[ -n $OC_VM_IMAGE && ! $OC_VM_IMAGE =~ [[:space:]] && ! $OC_VM_IMAGE =~ ^[./-] ]] || fail 'OC_VM_IMAGE must be an OCI image reference.'
  overrides+=("$OC_VM_IMAGE")
fi

export OC_VM_WORKSPACE
OC_VM_WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd -P)"
[[ -d "$OC_VM_WORKSPACE/.git" && -f "$OC_VM_WORKSPACE/.gitmodules" && -f "$OC_VM_WORKSPACE/scripts/run.sh" ]] ||
  fail 'Run setup using the primary monorepo checkout scripts, not a worktree.'
[[ ! $OC_VM_WORKSPACE =~ [:[:cntrl:]] ]] || fail 'Shared paths cannot contain colons or control characters.'
if [[ $OC_VM_WORKSPACE == /workspace/* && -e "$OC_VM_WORKSPACE/${OC_VM_WORKSPACE#/workspace/}" ]]; then
  fail 'The original absolute-path mount would hide checkout files under /workspace.'
fi
for service in api frontend rest pdf images taxes; do
  [[ -f "$OC_VM_WORKSPACE/opencollective-$service/package.json" ]] ||
    fail "Missing opencollective-$service/package.json; prepare this service on the host before setup."
done

export MSB_BACKEND=local
version=$(msb --version)
[[ $version =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]] || fail 'Could not parse the microsandbox version.'
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
[[ ${#major} -le 3 && ${#minor} -le 3 && ${#patch} -le 3 ]] || fail 'Could not parse the microsandbox version.'
(( 10#$major > 0 || 10#$minor > 7 || (10#$minor == 7 && 10#$patch >= 8) )) ||
  fail 'microsandbox v0.7.8 or newer is required.'
msb context --format json | jq -e '.kind == "local"' >/dev/null ||
  fail 'A managed microsandbox profile selected a non-local backend; use a local profile.'
msb doctor
echo "Sharing primary checkout $OC_VM_WORKSPACE at /workspace."

# Inspect required capabilities without mirroring the entire msb config schema.
# Existing sandboxes keep their resources, ports, and additional manual mounts.
validate_sandbox() {
  jq -e --arg workspace "$OC_VM_WORKSPACE" '
    .config as $config |
    ($config.labels["opencollective.workspace"] == $workspace) and
    ($config.labels["opencollective.setup"] == "microsandbox-v1") and
    ((.pending_changes // []) | length == 0) and
    ($config.init.cmd == "/lib/systemd/systemd") and
    ($config.runtime.user == "ubuntu") and
    ($config.runtime.workdir == "/workspace") and
    ($config.runtime.shell == "/bin/bash") and
    ($config.security_profile == "default") and
    ([$workspace, "/workspace"] | unique | all(.[];
      . as $guest | any($config.mounts[]?;
        .type == "Bind" and .host == $workspace and .guest == $guest and
        (.options.readonly != true) and
        .options.override_uid == 1000 and .options.override_gid == 1000))) and
    any($config.mounts[]?;
      .type == "Owned" and .guest == "/var/lib/docker" and
      .storage.kind == "disk" and .storage.capacity_mib > 0)
  ' <<< "$record" >/dev/null ||
    fail "Sandbox $instance_name does not match this workspace or required mounts/runtime, or has pending changes. Inspect it with msb inspect; use another name or resolve its configuration manually."
}

names=$(msb ls --format json)
jq -e 'type == "array" and all(.[]; (.name | type) == "string")' <<< "$names" >/dev/null ||
  fail 'Could not read the sandbox list; setup will not create a sandbox.'
if jq -e --arg name "$instance_name" 'any(.[]; .name == $name)' <<< "$names" >/dev/null; then
  record=$(msb inspect "$instance_name" --format json)
  validate_sandbox
  case "$(jq -r '.status' <<< "$record")" in
    Running) ;;
    Stopped|Crashed|Created) msb start "$instance_name" ;;
    *) fail "Sandbox is $(jq -r '.status' <<< "$record"); resolve its state with msb before setup." ;;
  esac
  echo "Reusing $instance_name with its saved configuration; YAML and OC_VM_* creation settings do not update existing sandboxes. Use msb modify for supported changes."
else
  # Original paths keep nested worktree Git backlinks valid. External paths
  # must be added manually at creation; setup does not discover them.
  mounts=()
  if [[ $OC_VM_WORKSPACE != /workspace ]]; then
    mounts+=(--mount-dir "$OC_VM_WORKSPACE:$OC_VM_WORKSPACE:uid=1000,gid=1000,quota=${OC_VM_DISK_GB}G")
  fi
  # Owned disks are not supported by the v0.7.8 YAML loader.
  msb create --conf "$SCRIPT_DIR/opencollective-msb.yaml" --name "$instance_name" \
    --mount-owned "/var/lib/docker:kind=disk,size=${OC_VM_DISK_GB}G" \
    "${mounts[@]}" "${overrides[@]}"
  record=$(msb inspect "$instance_name" --format json)
  validate_sandbox
fi

msb exec --user root --no-stdin --stream "$instance_name" -- bash /workspace/.vm/provision.sh
msb exec --user ubuntu --no-stdin --stream "$instance_name" -- node /workspace/.vm/guest.mjs stack
msb exec --user ubuntu --no-stdin --stream "$instance_name" -- node /workspace/.vm/guest.mjs doctor
echo "Setup complete. Connect with MSB_BACKEND=local msb ssh $instance_name, then run: run frontend api"
