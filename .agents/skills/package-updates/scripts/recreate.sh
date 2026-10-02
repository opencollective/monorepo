#!/usr/bin/env bash
# Revisit updates whose Renovate PR was closed: list them from the Dependency Dashboard, or tick their
# "recreate" checkbox so Renovate reopens the PR on its next run (the Mend app polls every few minutes).
# usage: recreate.sh <api|frontend|rest|images|pdf>                          list "PR Closed (Blocked)" entries with the close reason
#        recreate.sh <api|frontend|rest|images|pdf> <pr-number|branch> ...   tick those entries
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift

dashboard() {
  gh issue list -R "$REPO" --state open --author app/renovate --search 'Dependency Dashboard in:title' \
    --json number,body --jq '.[0] // empty'
}
js=$(dashboard)
[[ -n "$js" ]] || { echo "no open Dependency Dashboard issue in $REPO" >&2; exit 2; }
issue=$(jq -r .number <<<"$js")
# One line per entry: <ticked> <branch> <pr-number> <title>
entries() {
  jq -r .body <<<"$1" | grep -E -- '^ - \[[ x]\] <!-- recreate-branch=' |
    sed -E 's/^ - \[(.)\] <!-- recreate-branch=([^ ]+) -->\[(.*)\]\(\.\.\/pull\/([0-9]+)\).*/\1\t\2\t\4\t\3/'
}

if [[ $# -eq 0 ]]; then
  echo "Dependency Dashboard #$issue, PR Closed (Blocked):"
  entries "$js" | while IFS=$'\t' read -r ticked branch pr title; do
    [[ "$ticked" == x ]] && state="recreate requested" || state="closed"
    reason=$(gh pr view "$pr" -R "$REPO" --json closedAt,comments --jq \
      '"closed \(.closedAt[0:10]); " + ([.comments[] | select(.author.login | test("renovate|dependabot|coderabbit|codecov|codex") | not) | .body | gsub("\n"; " ")][-1] // "no human comment")[0:160]')
    echo "#$pr  $branch  $title  [$state]  $reason"
  done
  exit 0
fi

body=$(jq -r .body <<<"$js")
targets=()
for want in "$@"; do
  line=$(entries "$js" | awk -F'\t' -v w="$want" '$2 == w || $3 == w' | head -1)
  if [[ -z "$line" ]]; then echo "$want: not in PR Closed (Blocked) on #$issue; skipped"; continue; fi
  IFS=$'\t' read -r ticked branch pr _ <<<"$line"
  if [[ "$ticked" == x ]]; then echo "#$pr ($branch): already ticked, waiting on Renovate"; continue; fi
  body=$(B="$branch" perl -pe 's/^ - \[ \] (<!-- recreate-branch=\Q$ENV{B}\E -->)/ - [x] $1/' <<<"$body")
  targets+=("$branch")
done
[[ ${#targets[@]} -gt 0 ]] || exit 0

# Renovate rewrites the dashboard body on every run: edit from the body just read, then verify
gh issue edit "$issue" -R "$REPO" --body-file - <<<"$body" >/dev/null
after=$(dashboard)
for branch in "${targets[@]}"; do
  if entries "$after" | awk -F'\t' -v b="$branch" '$2 == b && $1 == "x"' | grep -q .; then
    echo "$branch: recreate requested on #$issue"
  else
    echo "$branch: tick not found after edit (Renovate rewrote the dashboard?); run again" >&2; status=1
  fi
done
exit "${status:-0}"
