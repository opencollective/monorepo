#!/usr/bin/env bash
# Live repo facts from the default branch, so references/repo-facts.md does not have to keep them by hand:
# .nvmrc, package.json engines, renovate.json packageRules, required status checks (branch protection) and
# the job names of .github/workflows/ci.yml. Read-only.
# usage: repo-facts.sh [api|frontend|rest|images|pdf|contributors-svg ...] (default: all six)
source "$(dirname "$0")/_lib.sh"
repos=("$@"); [[ ${#repos[@]} -gt 0 ]] || repos=(api frontend rest images pdf contributors-svg)

# raw file content on the default branch; empty output and exit 1 when the file is missing or unreadable
raw() { gh api "repos/$REPO/contents/$1?ref=$branch" -H "Accept: application/vnd.github.raw" 2>/dev/null; }

result=0
for r in "${repos[@]}"; do
  resolve_repo "$r"
  if ! branch=$(gh api "repos/$REPO" --jq .default_branch 2>/dev/null) || [[ -z "$branch" ]]; then
    echo "######## $SHORT ($REPO): unreachable"; echo; result=1; continue
  fi
  echo "######## $SHORT ($REPO), default branch $branch"

  nvmrc=$(raw .nvmrc | head -1 | tr -d '[:space:]' || true)
  echo "node (.nvmrc):    ${nvmrc:-none}"

  if pkg=$(raw package.json) && [[ -n "$pkg" ]]; then
    echo "engines:          $(jq -r '(.engines // "none") | if type == "string" then . else tojson end' <<<"$pkg" 2>/dev/null || echo unreadable)"
  else echo "engines:          no package.json"; fi

  renovate=""
  for f in renovate.json .github/renovate.json .renovaterc.json; do
    renovate=$(raw "$f") && [[ -n "$renovate" ]] && break
    renovate=""
  done
  if [[ -z "$renovate" ]]; then echo "renovate rules:   no renovate.json"
  else
    echo "renovate extends: $(jq -c '.extends // []' <<<"$renovate" 2>/dev/null || echo unreadable)"
    rules=$(jq -r '(.packageRules // [])[] | "  - " + (.description // (tojson | .[0:200]))' <<<"$renovate" 2>/dev/null || echo "  unreadable")
    if [[ -n "$rules" ]]; then echo "renovate rules:"; echo "$rules"; else echo "renovate rules:   none"; fi
  fi

  if checks=$(gh api "repos/$REPO/branches/$branch/protection/required_status_checks" \
        --jq '([.checks[]?.context] + (.contexts // [])) | unique | join(", ")' 2>/dev/null); then
    echo "required checks:  ${checks:-none}"
  else echo "required checks:  unknown (no access)"; fi

  if ci=$(raw .github/workflows/ci.yml) && [[ -n "$ci" ]]; then
    # job ids: the keys indented by two spaces under the top-level `jobs:` block
    jobs=$(awk '/^jobs:/{on=1; next} on && /^[^[:space:]#]/{on=0} on && /^  [A-Za-z0-9_-]+:/{sub(/^  /,""); sub(/:.*/,""); print}' <<<"$ci" | paste -sd, - | sed 's/,/, /g')
    echo "ci.yml jobs:      ${jobs:-none}"
  else echo "ci.yml jobs:      no .github/workflows/ci.yml"; fi
  echo
done
exit "$result"
