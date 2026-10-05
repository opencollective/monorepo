# shellcheck shell=bash
# Open Collective monorepo shell shortcuts (sourced from ~/.bashrc in the devcontainer).

_oc_monorepo_root() {
  # The VM's installed script copies supply an explicit root. Otherwise walk
  # upward so these shortcuts also work in service folders and nested worktrees.
  if [[ -n "${OC_MONOREPO_ROOT:-}" ]]; then
    printf '%s\n' "$OC_MONOREPO_ROOT"
    return
  fi
  local directory="$PWD"
  while [[ "$directory" != / ]]; do
    if [[ -f "$directory/.gitmodules" && -f "$directory/scripts/run.sh" ]]; then
      printf '%s\n' "$directory"
      return
    fi
    directory="$(dirname "$directory")"
  done
  # Devcontainer/VM default when invoked outside a recognizable checkout.
  printf '%s\n' /workspace
}

run() {
  local root
  root="$(_oc_monorepo_root)"
  (cd "$root" && "$root/scripts/run.sh" "$@")
}

test() {
  "$(_oc_monorepo_root)/scripts/test.sh" "$@"
}
