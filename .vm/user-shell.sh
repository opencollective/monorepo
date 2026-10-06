# shellcheck shell=bash
# Shared guest conveniences. Executables also have system PATH links for SSH.

# SSH login starts in the developer's home. Enter the checkout for interactive
# sessions; preserve command working directories and nested shells elsewhere.
if [[ $- == *i* && -n "${SSH_CONNECTION:-}" && "$PWD" == "$HOME" && -d /workspace ]]; then
  cd /workspace || return
fi

export NVM_DIR="$HOME/.nvm"
if [[ -f "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
fi
# shellcheck disable=SC1091
source /opt/oc-vm/shared/shell-aliases.sh

# Use the provisioning copy of shared scripts: the freshly cloned checkout may
# predate this VM feature. Resolve the working checkout from the current directory.
run() {
  OC_MONOREPO_ROOT="$(_oc_monorepo_root)" /opt/oc-vm/shared/run.sh "$@"
}
test() {
  OC_MONOREPO_ROOT="$(_oc_monorepo_root)" /opt/oc-vm/shared/test.sh "$@"
}
oc-dependencies() {
  # Keep optional dependencies opt-in. A stable Compose project name reuses the
  # same guest containers and volumes across setup and interactive invocations.
  if (($# == 0)); then set -- db mail uploads; fi
  OC_MONOREPO_ROOT="$(_oc_monorepo_root)" COMPOSE_PROJECT_NAME=oc-development \
    /opt/oc-vm/shared/start-dependencies.sh --engine docker --detach "$@"
}
