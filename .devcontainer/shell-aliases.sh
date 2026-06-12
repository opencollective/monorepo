# Open Collective monorepo shell shortcuts (sourced from ~/.bashrc in the devcontainer).

_oc_monorepo_root() {
  git -C "${PWD}" rev-parse --show-toplevel 2>/dev/null || echo "/workspace"
}

run() {
  "$(_oc_monorepo_root)/scripts/run.sh" "$@"
}

test() {
  "$(_oc_monorepo_root)/scripts/test.sh" "$@"
}
