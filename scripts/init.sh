#!/usr/bin/env bash
# Clone missing Open Collective projects as independent repositories.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${OC_MONOREPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$PROJECT_ROOT"
# shellcheck source=scripts/projects.sh
source "$SCRIPT_DIR/projects.sh"

project_short_name() {
  printf '%s\n' "${1#opencollective-}"
}

resolve_project() {
  local input="${1,,}" path
  for ((i=0; i<${#PROJECT_REPOSITORIES[@]}; i+=2)); do
    path="${PROJECT_REPOSITORIES[i]}"
    if [[ "$input" == "$path" || "$input" == "$(project_short_name "$path")" ]]; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  return 1
}

usage() {
  cat <<'HELP'
Usage: scripts/init.sh [--shallow] [--projects PROJECTS]

Options:
  --shallow             Clone new projects with --depth 1 --single-branch
  --projects PROJECTS   Comma-separated short names (api, frontend) or full directory names
                        (default: all projects)
  -h, --help            Show this help message

Missing projects are cloned on main. Existing directories are left untouched.
Workspace Git is kept as-is; hide it manually with scripts/remove-git.sh.
HELP
}

main() {
  local shallow=false filter='' project resolved path url existing seen
  local -a selected=() failed=() clone_args=(--branch main)
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --shallow) shallow=true; shift ;;
      --projects)
        if [[ -z "${2:-}" ]]; then
          echo 'Error: --projects requires a comma-separated list of projects' >&2
          return 1
        fi
        filter="$2"
        shift 2
        ;;
      -h|--help) usage; return 0 ;;
      *) echo "Error: Unknown option: $1. Use --help for usage information." >&2; return 1 ;;
    esac
  done

  if [[ -n "$filter" ]]; then
    local -a inputs=()
    IFS=',' read -r -a inputs <<< "$filter"
    for project in "${inputs[@]}"; do
      project="${project#"${project%%[![:space:]]*}"}"
      project="${project%"${project##*[![:space:]]}"}"
      [[ -n "$project" ]] || continue
      if ! resolved=$(resolve_project "$project"); then
        echo "Error: Unknown project: $project" >&2
        echo 'Available projects:' >&2
        for ((i=0; i<${#PROJECT_REPOSITORIES[@]}; i+=2)); do
          path="${PROJECT_REPOSITORIES[i]}"
          echo "  $(project_short_name "$path") ($path)" >&2
        done
        return 1
      fi
      seen=false
      for existing in "${selected[@]}"; do
        [[ "$existing" != "$resolved" ]] || seen=true
      done
      if [[ "$seen" == false ]]; then selected+=("$resolved"); fi
    done
    if [[ ${#selected[@]} -eq 0 ]]; then
      echo 'Error: No projects selected. Use --projects with a comma-separated list.' >&2
      return 1
    fi
  else
    for ((i=0; i<${#PROJECT_REPOSITORIES[@]}; i+=2)); do
      selected+=("${PROJECT_REPOSITORIES[i]}")
    done
  fi
  if [[ "$shallow" == true ]]; then clone_args+=(--depth 1 --single-branch); fi

  for path in "${selected[@]}"; do
    if [[ -d "$path" ]]; then
      echo "Skipping $path (existing directory left untouched)"
      continue
    fi
    if [[ -e "$path" || -L "$path" ]]; then
      echo "Error: $path already exists and is not a directory" >&2
      failed+=("$path")
      continue
    fi
    for ((i=0; i<${#PROJECT_REPOSITORIES[@]}; i+=2)); do
      if [[ "${PROJECT_REPOSITORIES[i]}" == "$path" ]]; then
        url="${PROJECT_REPOSITORIES[i+1]}"
        break
      fi
    done
    echo "Cloning $path on main..."
    if ! git clone "${clone_args[@]}" -- "$url" "$path"; then
      failed+=("$path")
    fi
  done
  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "Error: Failed to clone: ${failed[*]}. Resolve the errors and rerun setup." >&2
    return 1
  fi
  echo 'Setup complete. Check README.md for the next steps.'
}

main "$@"
