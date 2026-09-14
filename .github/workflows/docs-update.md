---
emoji: 📚
name: Docs Update
description: Weekly pass over last week's frontend and API product changes, updating user-facing GitBook docs as a reviewable pull request on opencollective/documentation.
intent: Keep Open Collective user documentation current with recent frontend and API work so contributors, collective admins, and host admins have accurate workflows.
engine: copilot
model: gpt-5.6-luna
on:
  schedule: weekly on sunday
  workflow_dispatch:
  skip-if-match: 'repo:opencollective/documentation is:pr is:open "gh-aw-workflow-id: docs-update" in:body'
permissions:
  contents: read
  issues: read
  pull-requests: read
  copilot-requests: none
timeout-minutes: 90
checkout:
  - fetch-depth: 1
  - repository: opencollective/documentation
    path: ./opencollective-documentation
    current: true
  - repository: opencollective/opencollective-frontend
    path: ./opencollective-frontend
  - repository: opencollective/opencollective-api
    path: ./opencollective-api
network:
  allowed:
    - defaults
    - github
    - node
    - documentation.opencollective.com
    - gitbook.com
    - gitbook-ng.github.io
tools:
  github:
    mode: gh-proxy
    toolsets: [default]
    allowed-repos:
      - opencollective/opencollective-frontend
      - opencollective/opencollective-api
      - opencollective/documentation
    min-integrity: unapproved
  timeout: 120
mcp-servers:
  gitbook:
    url: https://documentation.opencollective.com/~gitbook/mcp
    allowed: ["*"]
    required: false
steps:
  - name: Prefetch last week's frontend and API commits, and open docs PRs
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      set -euo pipefail
      mkdir -p /tmp/gh-aw/data
      SINCE=$(date -u -d '7 days ago' +%Y-%m-%d)
      printf '%s\n' "$SINCE" > /tmp/gh-aw/data/since.txt
      fetch_main_commits() {
        local repo="$1"
        local out="$2"
        gh api --paginate \
          "repos/${repo}/commits?sha=main&since=${SINCE}T00:00:00Z&per_page=100" \
          --jq '.[] | {sha: .sha, url: .html_url, date: .commit.committer.date, author: (.author.login // .commit.author.name // "unknown"), subject: (.commit.message | split("\n")[0]), body: (.commit.message | split("\n") | .[2:] | join("\n"))}' \
          | jq -s '.' > "$out"
      }
      fetch_main_commits opencollective/opencollective-frontend /tmp/gh-aw/data/frontend-main-commits.json
      fetch_main_commits opencollective/opencollective-api /tmp/gh-aw/data/api-main-commits.json
      gh pr list --repo opencollective/documentation --state open --limit 50 \
        --json number,title,url,body,updatedAt \
        > /tmp/gh-aw/data/docs-open-prs.json
      jq '{since: $since, frontend: length}' --arg since "$SINCE" \
        /tmp/gh-aw/data/frontend-main-commits.json > /tmp/gh-aw/data/prefetch-summary.json.tmp
      jq --slurpfile api /tmp/gh-aw/data/api-main-commits.json \
        --slurpfile docs /tmp/gh-aw/data/docs-open-prs.json \
        '. + {api: ($api[0] | length), docsOpen: ($docs[0] | length)}' \
        /tmp/gh-aw/data/prefetch-summary.json.tmp > /tmp/gh-aw/data/prefetch-summary.json
      rm -f /tmp/gh-aw/data/prefetch-summary.json.tmp
      cat /tmp/gh-aw/data/prefetch-summary.json
safe-outputs:
  github-token: ${{ secrets.GH_AW_GITHUB_TOKEN }}
  create-pull-request:
    title-prefix: "[docs] "
    target-repo: opencollective/documentation
    reviewers: [znarf]
    draft: false
    max: 1
    expires: 21
    if-no-changes: ignore
    allowed-files:
      - "**/*.md"
      - ".gitbook/assets/**"
  jobs:
    post-slack-summary:
      description: Post a documentation run summary to Slack
      inputs:
        message:
          description: Slack summary with outcome (PR URL, no-op, or duplicate PR), pages touched, and codepaths covered
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
evals:
  - id: pr_when_gaps
    question: If last week's frontend or API changes included user-facing features with weak docs, does the agent output show edits under opencollective-documentation and a create_pull_request call? If prefetch showed nothing user-facing, answer UNKNOWN.
  - id: noop_when_caught_up
    question: If prefetch showed no user-facing doc gaps (or an open docs PR already covers the same work), does the agent output show noop and no create_pull_request? If gaps were documented, answer UNKNOWN.
  - id: scoped_files
    question: Does the agent output show file changes limited to markdown and .gitbook/assets under opencollective-documentation?
  - id: slack_every_run
    question: Does the agent output show post_slack_summary on this run?
---

# Docs Update

You are a documentation automation for engineering teams.

## Goal

Keep technical documentation current and useful as the codebase evolves.

## What to document

We expose two public interfaces:

1. Our main frontend, as https://opencollective.com
2. A public GraphQL API

This documentation only covers the frontend. Do NOT document everything related to direct API usage, code implementation or architecture details. The target audience is Open Collective users: contributors, collective admins and host admins.

Document:

- Recently changed features with weak docs.
- Public interfaces, workflows, and operational runbooks.

## Task

Objective: Keep user-facing Open Collective documentation current with frontend and API product changes from the previous week.

Activation: this Sunday (or manual) run, after prefetch. Required evidence:

- `/tmp/gh-aw/data/since.txt`
- `/tmp/gh-aw/data/frontend-main-commits.json`
- `/tmp/gh-aw/data/api-main-commits.json`
- `/tmp/gh-aw/data/docs-open-prs.json`
- `/tmp/gh-aw/data/prefetch-summary.json`

Read those files first. Do not spend the run re-listing commits unless a file is missing. The frontend and API files are commits on `main` since `since.txt` (`sha`, `url`, `date`, `author`, `subject`, `body`).

Workspace checkouts (relative paths, not `/workspace/...`):

| Path                            | GitHub repo                              | Role                                     |
| ------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `opencollective-documentation/` | `opencollective/documentation`           | Edit target (GitBook markdown)           |
| `opencollective-frontend/`      | `opencollective/opencollective-frontend` | Verify user-facing behavior              |
| `opencollective-api/`           | `opencollective/opencollective-api`      | Confirm whether a change is user-visible |

Navigate into the documentation checkout before editing:

```bash
cd ${{ github.workspace }}/opencollective-documentation
```

The system uses GitBook. Formatting: https://gitbook-ng.github.io/syntax/markdown.html. Optionally use the GitBook MCP (read-only) to search and read published content. The MCP does not support writes.

Required effects:

1. From last week's frontend and API commits on `main`, keep only changes that affect what users can see or do on https://opencollective.com. Skip internal refactors, tests, CI, dependencies, developer-only tooling, direct GraphQL/API usage, and features whose docs already match the UI. Prefer a small, focused set of pages. One documentation PR per run.
2. If an open PR in `docs-open-prs.json` already covers the same user workflow (same pages or same feature), call `noop` with the existing PR URL and `post_slack_summary`. Stop.
3. Research existing docs via GitBook MCP (if available) and `opencollective-documentation/SUMMARY.md`. Prefer updating an existing page over adding a redundant one.
4. Verify remaining topics against `opencollective-frontend/` (routes, page components, settings, user-visible copy). Use `opencollective-api/` only when it changes what users see (permissions, eligibility, limits). Do not fabricate behavior. If nothing can be verified, `noop`.
5. Edit only under `opencollective-documentation/`. Match existing GitBook style: frontmatter (`description`, `icon` when siblings use it), `{% hint %}` where nearby pages use hints, FAQ-style sections where appropriate. Vocabulary: Contribution not Order; Account/Collective; fiscal host. No em dashes (use hyphens). Update `SUMMARY.md` when adding a page. If you add or rename a page linked from `SUMMARY.md`, run `npm run validate` from `opencollective-documentation/` (`npm install` first if `node_modules` is missing). Allowed files: `**/*.md` and `.gitbook/assets/**`.
6. If files changed, open one pull request via `create_pull_request` (reviewer `znarf` is assigned automatically). Title starts with `[docs] `. Body: docs added/updated, which frontend/API codepaths they cover, key knowledge gaps addressed, and the prefetch window from `since.txt`.
7. Call `post_slack_summary` with the same summary plus the PR URL when one was opened.

No-op: if prefetch has no user-facing gaps, existing docs already cover the changes, or the run produces no file changes, call `noop` with a short reason and still call `post_slack_summary` (no PR). Do not create an empty pull request.

Do not merge the pull request. Do not edit files outside `opencollective-documentation` markdown and `.gitbook/assets`. Use `gh` for GitHub reads. Use configured safe outputs for all writes.

## Documentation standards

- Explain intent, architecture, and usage.
- Include concrete examples and constraints.
- Keep docs concise and structured for scanning.
- Align with existing docs style and location.

## Guardrails

- Do not fabricate behavior; verify against source code.
- Prefer updating existing docs over creating redundant pages.
- Keep documentation-only PRs clean and focused.
- Do not open a duplicate PR when one is already open for the same feature.

## Safe Outputs

- `create_pull_request` when the run changed allowed files in `opencollective/documentation`.
- `post_slack_summary` on every completed run (including noop).
- `noop` when documentation is already current or nothing user-facing changed.

## Output

If you open a PR, summarize:

- Docs added/updated
- Which codepaths they cover
- Key knowledge gaps addressed
