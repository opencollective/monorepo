#!/usr/bin/env bash
# Hide workspace Git without changing service repositories or Git settings files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${OC_MONOREPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$PROJECT_ROOT"
PROJECT_ROOT="$(pwd -P)"
BACKUP_DIR="$PROJECT_ROOT/.git-backup"

fail() { echo "Error: $*" >&2; exit 1; }
[[ $# -eq 0 ]] || fail 'Usage: scripts/remove-git.sh'

if [[ ! -e .git && ! -L .git ]]; then
  if [[ -d "$BACKUP_DIR/git" && ! -L "$BACKUP_DIR" && ! -L "$BACKUP_DIR/git" ]]; then
    echo 'Workspace Git is already hidden. Restore it with scripts/restore-git.sh.'
    exit 0
  fi
  fail 'No workspace .git directory or hidden Git backup found.'
fi
[[ -d .git && ! -L .git ]] || fail 'Only ordinary workspace clones with a .git directory are supported.'
[[ ! -e "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || fail '.git-backup already exists; restore or resolve it before hiding Git.'
[[ "$(git rev-parse --show-toplevel)" == "$PROJECT_ROOT" ]] || fail 'The Git directory does not belong to this workspace.'

# Other workspace worktrees depend on the metadata that would be moved.
preflight_file=$(mktemp)
trap 'rm -f "$preflight_file"' EXIT
git worktree list --porcelain -z > "$preflight_file"
while IFS= read -r -d '' line; do
  [[ "$line" == 'worktree '* ]] || continue
  path="${line#worktree }"
  if [[ "$path" != "$PROJECT_ROOT" && ( -e "$path/.git" || -L "$path/.git" ) ]]; then
    fail "Workspace worktree $path depends on root Git. Remove that worktree before hiding Git."
  fi
done < "$preflight_file"

umask 077
mkdir "$BACKUP_DIR"
if ! mv .git "$BACKUP_DIR/git"; then
  rmdir "$BACKUP_DIR"
  fail 'Could not hide workspace Git.'
fi
echo 'Workspace Git hidden. Restore it with scripts/restore-git.sh.'
