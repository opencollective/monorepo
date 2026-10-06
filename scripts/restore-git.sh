#!/usr/bin/env bash
# Restore the workspace Git metadata hidden by remove-git.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${OC_MONOREPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$PROJECT_ROOT"
BACKUP_DIR="$PROJECT_ROOT/.git-backup"

fail() { echo "Error: $*" >&2; exit 1; }
[[ $# -eq 0 ]] || fail 'Usage: scripts/restore-git.sh'

if [[ -e .git || -L .git ]]; then
  [[ -d .git && ! -L .git ]] || fail 'Only ordinary workspace clones with a .git directory are supported.'
  [[ ! -e "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || fail 'Both .git and .git-backup exist; resolve the conflict without overwriting either.'
  echo 'Workspace Git is already available.'
  exit 0
fi
[[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" && -d "$BACKUP_DIR/git" && ! -L "$BACKUP_DIR/git" ]] || fail 'No valid hidden Git backup found at .git-backup/git.'
git --git-dir="$BACKUP_DIR/git" rev-parse --git-dir > /dev/null || fail 'The hidden Git backup is not a Git repository.'
mv "$BACKUP_DIR/git" .git
# Preserve any unrelated files that might have been placed in the backup folder.
if [[ -z "$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  rmdir "$BACKUP_DIR"
fi
echo 'Workspace Git restored. Hide it again with scripts/remove-git.sh.'
