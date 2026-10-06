#!/usr/bin/env bash
# Configure and validate VM SSH access.
set -euo pipefail

# Run in a subshell so rollback traps and temporary state stay local. Tests source
# this function and pass temporary config paths and fake service commands.
configure_ssh() (
  config=${1:-/etc/ssh/sshd_config}
  policy=${2:-/etc/ssh/oc-development.conf}
  sshd=${3:-/usr/sbin/sshd}
  service_command=${4:-systemctl}
  transaction=$(mktemp -d "${config}.oc-vm.XXXXXX")
  cp -p "$config" "$transaction/config.before"
  had_policy=false
  if [[ -e "$policy" ]]; then
    cp -p "$policy" "$transaction/policy.before"
    had_policy=true
  fi
  validated=false
  cleanup() {
    status=$?
    trap - EXIT
    if [[ "$validated" == false ]]; then
      cp -p "$transaction/config.before" "$config"
      if [[ "$had_policy" == true ]]; then
        cp -p "$transaction/policy.before" "$policy"
      else
        rm -f "$policy"
      fi
    fi
    rm -rf "$transaction"
    exit "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  cat > "$transaction/policy.new" <<'POLICY'
# Managed by the Open Collective VM launcher.
UsePAM yes
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowAgentForwarding no
POLICY
  chmod 644 "$transaction/policy.new"
  mv -f "$transaction/policy.new" "$policy"

  # First values win. Include our policy before existing Includes/Match blocks.
  include="Include $policy"
  {
    printf '%s\n' "$include"
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" != "$include" ]]; then printf '%s\n' "$line"; fi
    done < "$transaction/config.before"
  } > "$transaction/config.new"
  chmod --reference="$transaction/config.before" "$transaction/config.new"
  mv -f "$transaction/config.new" "$config"

  effective_settings() {
    timeout 30 "$sshd" -T -f "$config" -C user=ubuntu,host=localhost,addr=127.0.0.1
  }
  settings=$(effective_settings)
  # Keep an existing SFTP subsystem; duplicate declarations are syntax errors.
  if ! grep -q '^subsystem sftp ' <<< "$settings"; then
    cp -p "$policy" "$transaction/policy.new"
    printf 'Subsystem sftp internal-sftp\n' >> "$transaction/policy.new"
    mv -f "$transaction/policy.new" "$policy"
    settings=$(effective_settings)
  fi
  for required in 'usepam yes' 'pubkeyauthentication yes' 'passwordauthentication no' \
    'kbdinteractiveauthentication no' 'permitrootlogin no' 'allowagentforwarding no'; do
    if ! grep -Fxq "$required" <<< "$settings"; then
      echo 'Guest SSH configuration overrides the required login policy' >&2
      exit 1
    fi
  done
  timeout 30 "$sshd" -t -f "$config"
  validated=true
  # A reload failure leaves validated config in place for the next invocation.
  timeout 30 "$service_command" reload-or-restart ssh
  echo 'Guest SSH ready: PAM enabled, key login enabled, password login disabled.'
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ "$(id -u)" == 0 ]] || { echo 'Guest SSH configuration requires root' >&2; exit 1; }
  install -d -m 755 /run/sshd
  configure_ssh /etc/ssh/sshd_config /etc/ssh/oc-development.conf /usr/sbin/sshd systemctl
fi
