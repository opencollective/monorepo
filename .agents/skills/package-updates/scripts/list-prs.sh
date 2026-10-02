#!/usr/bin/env bash
# Inventory of open dependency PRs (Renovate + Dependabot, plus the user's own "(deps)" PRs) with everything
# triage needs: check state, mergeability, review state, own PR, commits behind main, foreign (non-bot)
# commits, age of the last check. REVIEW: APPR (approved) / REQ (review required, explicit approval is needed) /
# OWN (the user's PR: can't self-approve, needs another reviewer).
# usage: list-prs.sh <api|frontend|rest|images|pdf> [--json] [--fast]
#   --fast: one API call for the whole repo (no per-PR "behind" count, no mergeability retry); for a quick status.
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift || true
json=""; fast=""
for opt in "$@"; do case "$opt" in --json) json=1 ;; --fast) fast=1 ;; *) echo "unknown option $opt" >&2; exit 2 ;; esac; done
me=$(gh api user --jq .login)
raw=$(ghr pr list -R "$REPO" --state open --limit 100 \
  --json number,title,headRefName,headRefOid,updatedAt,isDraft,mergeable,mergeStateStatus,statusCheckRollup,labels,author,reviewDecision)
if [[ "$(jq length <<<"$raw")" -ge 100 ]]; then
  echo "Inventory may be truncated at 100 open PRs; expand or paginate before claiming completeness." >&2
fi
raw=$(jq --arg bots "$BOT_AUTHORS" --arg me "$me" '[.[] | select((.author.login | test($bots)) or (.author.login == $me and (.title | test("\\(deps"))))
      | . + {review: (if .author.login == $me then "OWN" elif .reviewDecision == "APPROVED" then "APPR" else "REQ" end)}]' <<<"$raw")
# Commit authors for every open PR in one GraphQL call (small pages: 100 PRs x 30 commits x 3 authors)
authors=$(ghr api graphql -f query='query($o:String!,$r:String!){repository(owner:$o,name:$r){pullRequests(states:OPEN,first:100){nodes{number
  commits(last:30){pageInfo{hasPreviousPage} nodes{commit{authors(first:3){pageInfo{hasNextPage} nodes{user{login} name}}}}}}}}}' -f o="${REPO%/*}" -f r="${REPO#*/}" 2>/dev/null \
  | jq -c --arg bots "$BOT_AUTHORS" '[.data.repository.pullRequests.nodes[] | {key: (.number|tostring),
      value: (if .commits.pageInfo.hasPreviousPage or any(.commits.nodes[]; .commit.authors.pageInfo.hasNextPage or (.commit.authors.nodes | length) == 0)
        then null else ([.commits.nodes[].commit.authors.nodes[] | (.user.login // .name // "unknown") | select(test($bots) | not)] | unique) end)}] | from_entries' 2>/dev/null) || authors='{}'
[[ "$authors" == \{* ]] || authors='{}'
raw=$(jq --argjson authors "$authors" '[.[] | . + {commitAuthors: ($authors[(.number|tostring)] // null)}]' <<<"$raw")
# GitHub computes mergeability lazily: the first call often says UNKNOWN, ask again for those
if [[ -z "$fast" ]] && jq -e '[.[] | select(.mergeable == "UNKNOWN")] | length > 0' <<<"$raw" >/dev/null; then
  sleep 5
  raw=$(jq -c '.[]' <<<"$raw" | while read -r pr; do
    if [[ "$(jq -r .mergeable <<<"$pr")" == "UNKNOWN" ]]; then
      m=$(ghr pr view "$(jq -r .number <<<"$pr")" -R "$REPO" --json mergeable,mergeStateStatus 2>/dev/null || echo '{}')
      jq -c --argjson m "$m" '. + $m' <<<"$pr"
    else echo "$pr"; fi
  done | jq -s .)
fi
# behind_by needs one API call per PR (skipped with --fast); foreign authors come from the commits already listed
enriched=$(jq -c '.[]' <<<"$raw" | while read -r pr; do
  branch=$(jq -r .headRefName <<<"$pr")
  behind=null
  if [[ -z "$fast" ]]; then behind=$(ghr api "repos/$REPO/compare/main...$branch" --jq .behind_by 2>/dev/null || true); [[ "$behind" =~ ^[0-9]+$ ]] || behind=null; fi
  foreign=$(jq -c '.commitAuthors // empty' <<<"$pr")
  if [[ -z "$foreign" ]]; then  # the GraphQL call failed or the PR was missing from it: fall back to one call for this PR
    foreign=$(ghr pr view "$(jq -r .number <<<"$pr")" -R "$REPO" --json commits 2>/dev/null | jq -c --arg bots "$BOT_AUTHORS" '[.commits[] | (if (.authors | length) == 0 then [{login: "unknown"}] else .authors end)[] | (.login // .name // "unknown") | select(test($bots) | not)] | unique' 2>/dev/null) || foreign='["unknown"]'
    [[ "$foreign" == \[* ]] || foreign='["unknown"]'
  fi
  checks=$(checks_summary <<<"$pr")
  jq -c --argjson checks "$checks" --argjson behind "${behind:-null}" --argjson foreign "${foreign:-[]}" '
    . + {behind: $behind,
         foreign: $foreign,
         failing: $checks.failing,
         pending: $checks.pending,
         green: $checks.green,
         lastCheck: ([.statusCheckRollup[] | .completedAt // .startedAt // empty] | max // null),
         labels: [.labels[].name]}
    | del(.statusCheckRollup, .commitAuthors)' <<<"$pr"
done | jq -s 'sort_by(.updatedAt) | reverse')
if [[ -n "$json" ]]; then echo "$enriched"; exit 0; fi
printf "%-6s %-5s %-6s %-11s %-7s %-7s %-8s %s\n" PR AUTH DRAFT MERGEABLE REVIEW BEHIND FOREIGN TITLE
jq -r '.[] | [.number, (.author.login|sub("app/";"")|.[0:4]), .isDraft, .mergeable, .review, (.behind // "?" | tostring), (if (.foreign|length)>0 then "yes" else "-" end), .title] | @tsv' <<<"$enriched" \
  | while IFS=$'\t' read -r n a d m r b f t; do printf "%-6s %-5s %-6s %-11s %-7s %-7s %-8s %s\n" "$n" "$a" "$d" "$m" "$r" "$b" "$f" "$t"; done
echo
jq -r '.[] | "#\(.number): " + (if (.failing|length)>0 then "FAILING " + (.failing|join(", ")) elif (.pending|length)>0 then "pending (\(.pending|length))" elif .green then "green" else "no successful checks" end)
  + (if .mergeable=="CONFLICTING" then " | CONFLICTING" else "" end)
  + (if (.foreign|length)>0 then " | foreign commits by \(.foreign|join(","))" else "" end)
  + (if (.labels|index("blocked")) then " | label:blocked" else "" end)
  + (if (.title|test("abandoned")) then " | abandoned by Renovate" else "" end)
  + " | last check \(.lastCheck // "?" | .[0:10])"' <<<"$enriched"
