---
emoji: 📚
name: Docs Update
description: Weekly review of frontend and API product changes, catching up after missed runs, updating user-facing GitBook docs as a reviewable pull request on opencollective/documentation.
intent: Keep Open Collective user documentation current with recent frontend and API work so contributors, collective admins, and host admins have accurate workflows.
imports:
  - shared/post-slack-summary.md
engine: copilot
model: gpt-5.6-luna
on:
  schedule: weekly on sunday
  workflow_dispatch:
permissions:
  actions: read
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
tools:
  github:
    mode: gh-proxy
    toolsets: [default]
    allowed-repos:
      - opencollective/monorepo
      - opencollective/opencollective-frontend
      - opencollective/opencollective-api
      - opencollective/documentation
    min-integrity: unapproved
  timeout: 120
steps:
  - name: Prefetch documentation context
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: node "$GITHUB_WORKSPACE/.github/workflows/scripts/docs-update-context.mjs"
safe-outputs:
  github-token: ${{ secrets.GH_AW_GITHUB_MCP_SERVER_TOKEN || secrets.GH_AW_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
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
evals:
  - id: pr_when_gaps
    question: If context.json contains verifiable user-facing documentation gaps not covered by existing docs or open PRs, does the agent edit documentation and call create_pull_request, even when other topics are already covered? Otherwise answer UNKNOWN.
  - id: noop_when_caught_up
    question: If all verifiable topics are covered by existing docs or open PRs, or there are no user-facing changes, does the agent call noop without create_pull_request? If uncovered gaps were documented, answer UNKNOWN.
  - id: duplicate_coverage
    question: If open PRs overlap candidate topics, does the agent inspect their bodies and diffs and skip only covered topics, rather than treating a shared page as full coverage or stopping the entire run? If no overlap exists, answer UNKNOWN.
  - id: coverage_window
    question: Does the agent review context.json's full since-to-until window, include it in its PR and Slack summaries when applicable, and mention the seven-day fallback when previousSuccessfulRunUrl is null?
  - id: scoped_files
    question: Does the agent output show file changes limited to markdown and .gitbook/assets under opencollective-documentation?
  - id: slack_every_run
    question: Does the agent output show post_slack_summary on this run?
---

# Docs Update

## Scope

Keep user documentation current for contributors, collective admins, and host admins using https://opencollective.com. Document changes to what they can see or do, including API changes that affect website permissions, eligibility, or limits. Skip internal refactors, tests, CI, dependencies, developer tooling, direct API usage, and architecture.

## Process

1. Read `/tmp/gh-aw/data/context.json` first: `since`, `until`, `previousSuccessfulRunUrl`, `frontendCommits`, `apiCommits`, and `openDocsPrs`. Review the entire window, which may exceed a week after failed or missed runs. Do not re-list commits. If the context is missing or incomplete, report the failure rather than treating it as an empty window.
2. Find user-facing documentation gaps using `opencollective-documentation/SUMMARY.md` and existing pages. For overlapping open PRs, inspect their bodies and diffs with `gh`. Skip only topics already covered; sharing a page alone does not establish coverage. Continue with unrelated or uncovered topics.
3. Verify candidate topics against routes, components, settings, and user-visible copy in `opencollective-frontend/`. Use `opencollective-api/` to confirm behavior affecting website users. Do not fabricate behavior. Prefer a small, focused set of existing pages over redundant new pages.
4. Edit only markdown and `.gitbook/assets/**` inside `opencollective-documentation/` (the `opencollective/documentation` repository). Match nearby GitBook frontmatter, hints, and FAQ conventions. Explain workflows with concrete examples and relevant constraints. Use Contribution rather than Order, Account/Collective, and fiscal host; use hyphens rather than em dashes. Update `SUMMARY.md` for added or renamed pages, then run `npm run validate` from that checkout after any edits. No dependency installation is needed.

## Completion

- When validated files changed, use `create_pull_request` to open one focused PR. The configured prefix is `[docs] ` and reviewer is `znarf`. Summarize pages updated, source codepaths verified, gaps addressed, and the exact `since`-to-`until` window. Do not merge it.
- If no verifiable, uncovered topics remain or no files changed, call `noop` with a short reason and relevant existing PR URLs. Do not create an empty PR.
- Always call `post_slack_summary` with the outcome, pages and codepaths covered, coverage window, and relevant PR URLs when available. If `previousSuccessfulRunUrl` is null, state that no eligible previous run was found and the initial seven-day window was used.
- Use `gh` for GitHub reads and configured safe outputs for external writes. Keep all file edits within the allowed documentation paths.
