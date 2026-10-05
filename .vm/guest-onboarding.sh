#!/usr/bin/env bash
# Only interactive, guest-local identity/credential steps live here.
set -euo pipefail
[[ "${1:-}" == git ]] || { echo 'Usage: guest-onboarding.sh git' >&2; exit 1; }
cd /workspace
for setting in name email; do
  # Preserve guest-local identity on reruns; host Git configuration is never read.
  current=$(git config --global --get "user.$setting" || true)
  if [[ -n "$current" ]]; then
    printf 'Existing Git %s: %s\n' "$setting" "$current"
  else
    read -r -p "Git $setting: " value
    [[ -n "$value" ]] || { echo "Git $setting cannot be empty" >&2; exit 1; }
    # This guest is a dedicated development machine; make identity available to submodules.
    git config --global "user.$setting" "$value"
  fi
done
# The helper detects forwarded GitHub access, falls back to public HTTPS clones,
# and selects only missing repos so existing branches and remotes are preserved.
node /opt/oc-vm/guest.mjs initialize
