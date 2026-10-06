#!/usr/bin/env bash
# Configure the guest Git commit identity.
set -euo pipefail
[[ $# == 0 ]] || { echo 'Usage: git-identity.sh' >&2; exit 1; }
cd /workspace
for setting in name email; do
  host_value=$(git config --local --get "user.$setting" || true)
  if [[ -n "$host_value" ]]; then
    git config --global "user.$setting" "$host_value"
    printf 'Using repository Git %s: %s\n' "$setting" "$host_value"
  else
    current=$(git config --global --get "user.$setting" || true)
    if [[ -n "$current" ]]; then
      printf 'Existing Git %s: %s\n' "$setting" "$current"
      continue
    fi
    printf 'Git commit %s (shown on commits): ' "$setting"
    read -r value
    [[ -n "$value" ]] || { echo "Git $setting cannot be empty" >&2; exit 1; }
    git config --global "user.$setting" "$value"
  fi
done
