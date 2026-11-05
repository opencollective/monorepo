#!/usr/bin/env bash
# Ask Renovate to rebase/retry a PR by ticking the checkbox in its body.
# Renovate acts on its next run (the Mend app polls every few minutes; it does not wait for the schedule window).
# usage: rebase.sh <api|frontend|rest|images|pdf|contributors-svg> <pr-number> [<pr-number> ...]
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
for pr in "$@"; do
  js=$(gh pr view "$pr" -R "$REPO" --json body,author,commits)
  if ! jq -e --arg bots "$BOT_AUTHORS" '.author.login | test($bots)' <<<"$js" >/dev/null; then
    echo "#$pr: not bot-authored; skipped"; continue
  fi
  if ! jq -e --arg bots "$BOT_AUTHORS" '.commits | length > 0 and all(.[]; (.authors | length > 0 and all(.[]; (.login // .name // "") | test($bots))))' <<<"$js" >/dev/null; then
    echo "#$pr: foreign or unknown commit authors; use a local rebase"; continue
  fi
  body=$(jq -r .body <<<"$js")
  if grep -q -- '- \[x\] <!-- rebase-check -->' <<<"$body"; then echo "#$pr: checkbox already ticked, waiting on Renovate"; continue; fi
  if ! grep -q -- '- \[ \] <!-- rebase-check -->' <<<"$body"; then echo "#$pr: no rebase checkbox in body (not a Renovate PR, or body edited); rebase locally instead"; continue; fi
  new=$(sed 's/- \[ \] <!-- rebase-check -->/- [x] <!-- rebase-check -->/' <<<"$body")
  gh pr edit "$pr" -R "$REPO" --body-file - <<<"$new" >/dev/null && echo "#$pr: rebase requested"
done
