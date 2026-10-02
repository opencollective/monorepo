#!/usr/bin/env bash
# AI review before the user's review: collect the findings of the bot reviewers on a PR (Codex, CodeRabbit),
# or run Codex locally on an unpushed worktree, so every finding is integrated or dismissed before the batch.
# usage: ai-review.sh <api|frontend|rest|images> <pr-number>            # findings on the PR (threads + bot review bodies)
#        ai-review.sh <api|frontend|rest|images> --worktree <path> [title]   # `codex review --base origin/main` in that worktree
#        ai-review.sh <api|frontend|rest|images> --resolve <thread-id> ...   # mark integrated threads resolved (no comment is posted)
source "$(dirname "$0")/_lib.sh"; resolve_repo "${1:-}"; shift
review_json=$(mktemp "${TMPDIR:-/tmp}/package-review.XXXXXX")
trap 'rm -f "$review_json"' EXIT
BOTS='codex|coderabbit|seer|copilot'
strip() { perl -0pe 's/<details>.*?<summary>(.*?)<\/summary>/[$1] /gs; s/<[^>]+>//g; s/!\[[^\]]*\]\([^)]*\)//g; s/\n+/ /g; s/\s+/ /g'; }
case "${1:-}" in
  --worktree)
    wt="${2:?worktree path}"; title="${3:-}"
    need codex
    if [[ -n "$(git -C "$wt" status --porcelain)" ]]; then
      echo "Commit the worktree changes before reviewing against origin/main: $wt" >&2; exit 2
    fi
    reviewed_head=$(git -C "$wt" rev-parse HEAD)
    reviewed_base=$(git -C "$wt" rev-parse origin/main)
    S="${SCRATCH:-${TMPDIR:-/tmp}}/package-updates"; mkdir -p "$S"
    out=$(mktemp "$S/review-$(basename "$wt").XXXXXX")
    # `codex review` refuses a custom prompt together with --base; the title carries the context
    # CODEX_MODEL overrides the model from ~/.codex/config.toml for this run; only set it when the user asks (cost)
    codex_args=()
    [[ -z "${CODEX_MODEL:-}" ]] || codex_args+=(-c "model=\"$CODEX_MODEL\"")
    rc=0; (cd "$wt" && codex "${codex_args[@]}" review --base origin/main --title "${title:-dependency update}" > "$out" 2>&1) || rc=$?
    # A usage limit or an interrupted run still exits 0 and prints a verdict-looking line: report it as no review
    if [ "$rc" -ne 0 ] || grep -qE "usage limit|Review was interrupted|is not supported when using Codex" "$out"; then
      echo "codex review did NOT complete (exit $rc)"
      echo "transcript: $out"; exit 2
    fi
    # The transcript is long (tool calls, file dumps); the verdict is the block after the last bare "codex" line
    verdict=$(awk '/^codex$/{buf=""; on=1; next} on{buf=buf $0 "\n"} END{printf "%s", buf}' "$out")
    if [[ ! "$verdict" =~ [^[:space:]] ]] \
       || [[ "$(git -C "$wt" rev-parse HEAD)" != "$reviewed_head" ]] \
       || [[ "$(git -C "$wt" rev-parse origin/main)" != "$reviewed_base" ]] \
       || [[ -n "$(git -C "$wt" status --porcelain)" ]]; then
      echo "codex review incomplete: no final verdict or the worktree changed; transcript: $out"; exit 2
    fi
    echo "Reviewed head=$reviewed_head base=$reviewed_base; transcript: $out"
    printf '%s\n' "$verdict" ;;
  --resolve)
    shift
    for id in "$@"; do
      gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id="$id" --jq '"resolved: " + (.data.resolveReviewThread.thread.isResolved|tostring)'
    done ;;
  *)
    pr="${1:?pr number}"
    gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){headRefOid
      reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved isOutdated path line comments(first:1){nodes{author{login} body}}}}
      reviews(last:50){pageInfo{hasPreviousPage} nodes{author{login} state commit{oid} body}}}}}' \
      -f o="${REPO%/*}" -f r="${REPO#*/}" -F n="$pr" > "$review_json"
    head=$(jq -r .data.repository.pullRequest.headRefOid "$review_json")
    if jq -e '.data.repository.pullRequest | .reviewThreads.pageInfo.hasNextPage or .reviews.pageInfo.hasPreviousPage' "$review_json" >/dev/null; then
      echo "Review history truncated; paginate threads/reviews before claiming all findings are addressed." >&2
      exit 2
    fi
    echo "PR #$pr head=${head:0:8}"
    echo "== threads (fix + --resolve, or dismiss with a reason in the batch) =="
    jq -r --arg bots "$BOTS" '.data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.nodes[0].author.login | test($bots; "i"))
      | "\(.id)\t\(if .isResolved then "resolved" elif .isOutdated then "OUTDATED" else "OPEN" end)\t\(.path):\(.line // "-")\t\(.comments.nodes[0].author.login)\t\(.comments.nodes[0].body | gsub("[\\r\\n]+"; " "))"' "$review_json" \
      | while IFS=$'\t' read -r id st loc who body; do printf "%s %-8s %s %s: %s\n" "$id" "$st" "$loc" "$who" "$(strip <<<"$body" | cut -c1-400)"; done
    echo "== bot review bodies on the head commit (CodeRabbit nitpicks live here, not in threads) =="
    jq -r --arg bots "$BOTS" --arg h "$head" '.data.repository.pullRequest.reviews.nodes[] | select(.author.login | test($bots; "i")) | select(.commit.oid == $h) | "\(.author.login) \(.state)\t\(.body | gsub("[\\r\\n]+"; " "))"' "$review_json" \
      | while IFS=$'\t' read -r who body; do printf "%s: %s\n" "$who" "$(strip <<<"$body" | cut -c1-900)"; done
    echo "(bodies from older commits are omitted: re-review happens on every push)" ;;
esac
