---
safe-outputs:
  jobs:
    post-slack-summary:
      description: Post a workflow run summary to Slack
      inputs:
        message:
          description: Run summary following the calling workflow's reporting requirements
          required: true
          type: string
      env:
        SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
      steps:
        # Use the small fallback artifact only. Merging with the full `agent` artifact
        # overwrites agent_output.json and can leave a non-JSON file at the expected path.
        - name: Download agent output fallback
          continue-on-error: true
          uses: actions/download-artifact@v8
          with:
            name: agent-output-fallback
            path: ${{ runner.temp }}/gh-aw/safe-jobs/
        - name: Post to Slack
          env:
            SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          run: |
            set -euo pipefail
            if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
              echo "SLACK_WEBHOOK_URL is not set; skipping Slack post"
              exit 0
            fi
            slack_message_from_agent_json() {
              local path="$1"
              [ -f "$path" ] || return 1
              jq -e . >/dev/null 2>&1 <"$path" || return 1
              jq -r '[.items[]? | select(.type == "post_slack_summary") | .message] | last // empty' "$path"
            }
            slack_message_from_ndjson_lines() {
              local path="$1"
              [ -f "$path" ] || return 1
              local line msg last=""
              while IFS= read -r line || [ -n "$line" ]; do
                [ -z "$line" ] && continue
                msg=$(jq -r 'if .type == "post_slack_summary" then .message else empty end' <<<"$line" 2>/dev/null) || continue
                [ -n "$msg" ] && last="$msg"
              done <"$path"
              [ -n "$last" ] && printf '%s' "$last"
            }
            SEARCH_ROOT="${RUNNER_TEMP}/gh-aw/safe-jobs"
            MESSAGE=""
            while IFS= read -r candidate; do
              msg=$(slack_message_from_ndjson_lines "$candidate" 2>/dev/null || true)
              [ -n "$msg" ] && MESSAGE="$msg"
            done < <(find "$SEARCH_ROOT" -type f -name 'safeoutputs.jsonl' 2>/dev/null | sort -u)
            if [ -z "$MESSAGE" ]; then
              while IFS= read -r candidate; do
                msg=$(slack_message_from_agent_json "$candidate" 2>/dev/null || true)
                if [ -z "$msg" ]; then
                  msg=$(slack_message_from_ndjson_lines "$candidate" 2>/dev/null || true)
                fi
                [ -n "$msg" ] && MESSAGE="$msg"
              done < <(find "$SEARCH_ROOT" -type f -name 'agent_output.json' 2>/dev/null | sort -u)
            fi
            if [ -z "$MESSAGE" ]; then
              echo "No Slack message in agent output (searched under ${SEARCH_ROOT}); skipping"
              exit 0
            fi
            PAYLOAD=$(jq -n --arg text "$MESSAGE" '{text:$text}')
            curl -sS -f -X POST -H 'Content-type: application/json' --data "$PAYLOAD" "$SLACK_WEBHOOK_URL"
---
