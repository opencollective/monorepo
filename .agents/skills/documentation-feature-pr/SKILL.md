---
name: documentation-feature-pr
description: Drafts user-facing documentation in opencollective-documentation for a requested frontend feature, then offers to commit and open a PR. Pulls latest docs first, checks open PRs via GitHub MCP for duplicates, verifies against frontend code and GitBook. Use when the user invokes /documentation-feature-pr, asks to document a feature, update user docs, or open a documentation PR for a specific workflow.
---

# Documentation feature PR

You are a documentation automation for engineering teams.

Read this skill fully before starting.

## Goal

Keep technical documentation current and useful as the codebase evolves.

## What to document

We expose two public interfaces:

1. Our main frontend, as https://opencollective.com
2. A public GraphQL API

This documentation only covers the frontend. Do NOT document everything related to direct API usage, code implementation or architecture details. The target audience is Open Collective users: contributors, collective admins and host admins.

Document:

- The feature or workflow the user asked for, when user-facing docs are missing, outdated, or unclear.
- Public interfaces, workflows, and operational runbooks tied to that request.

## Scope from the user prompt

The user names the feature, workflow, or doc gap to address. Parse the prompt for:

- **Feature name** and **audience** (contributor, collective admin, host admin).
- **Optional anchors**: GitHub issue/PR URLs, doc page URLs, UI paths, or product terms.

If the request is too vague to identify a concrete user workflow, ask **one** short clarifying question, then continue.

Do **not** scan recent repo changes unless the user explicitly asks; focus on the requested feature.

## Repository

Work **directly** in the local documentation repo:

| Item           | Value                                                            |
| -------------- | ---------------------------------------------------------------- |
| Path           | `/workspace/opencollective-documentation`                        |
| Remote         | `https://github.com/opencollective/opencollective-documentation` |
| Default branch | `main`                                                           |

If the directory is missing or empty, initialize the submodule or clone into that path before continuing.

## How to document

The system uses Gitbook. Learn formatting at https://gitbook-ng.github.io/syntax/markdown.html. Use the **Gitbook MCP** (read-only) to search and read current published content.

The Gitbook MCP does not support writes. Edit markdown files in `/workspace/opencollective-documentation` locally.

**Do not commit, push, or open a PR until the user approves** the draft changes. Make edits first, summarize them, then offer to create a branch, commit, push, and open a PR.

If there are no changes to be made, say so and exit. Notify Slack about run results when the workflow completes (after PR opened, or after no-op / duplicate-PR stop).

## Workflow

Copy this checklist and track progress:

```
Task progress:
- [ ] 1. Sync repo and check for duplicate open PRs
- [ ] 2. Clarify feature scope (if needed)
- [ ] 3. Find existing documentation
- [ ] 4. Verify behavior in frontend source
- [ ] 5. Edit files in opencollective-documentation
- [ ] 6. Present summary and offer commit + PR
- [ ] 7. Notify Slack (when run completes)
```

### 1. Sync repo and check duplicate PRs

**Always start on latest `main`:**

```bash
cd /workspace/opencollective-documentation
git fetch origin
git checkout main
git pull origin main
```

**Check open PRs** on `opencollective/opencollective-documentation` before editing. Read GitHub MCP tool schemas first, then use:

- `list_pull_requests` with `owner: opencollective`, `repo: opencollective-documentation`, `state: open`
- `search_pull_requests` with keywords from the requested feature (title/body terms, page names)

If an **open PR already covers the same feature** (same pages or same user workflow):

- Link the existing PR in your reply.
- Do **not** duplicate the work or open another PR.
- Notify Slack with the duplicate-PR finding and stop.

### 2. Research existing docs

- **GitBook MCP**: `searchDocumentation`, then `getPage` for full content when updating a page.
- **Local repo**: read `SUMMARY.md` and relevant `.md` files under `/workspace/opencollective-documentation`.
- Prefer **updating** an existing page over adding a redundant one.

### 3. Verify behavior in code

Ground docs in the frontend, not assumptions:

- Search `opencollective-frontend` for routes, page components, settings, and user-visible copy for the feature.
- Trace the primary user path (who can do what, where in the UI, constraints, error states worth mentioning).
- Skip API resolver details, internal types, and architecture unless they change what users see or can do.

If behavior cannot be verified and the user did not supply enough context, say what is missing and stop before editing files.

### 4. Edit documentation (local only)

Edit files under `/workspace/opencollective-documentation`:

- Match existing GitBook style: frontmatter (`description`, `icon` when sibling pages use it), headings, FAQ-style sections where appropriate.
- Use Open Collective vocabulary from `AGENTS.md` (Account/Collective, Orders/Contributions, fiscal host).
- No em dashes in new prose (use hyphens).
- Update `SUMMARY.md` when adding a new page; keep hierarchy consistent with nearby topics.

Stay on `main` while drafting, or use a local-only working tree; **do not push** until the user asks.

**No-op exit:** If existing docs already cover the feature accurately, or the request is out of scope (API-only, internal), report that clearly and skip edits. Still notify Slack.

### 5. Present draft and offer PR

After edits, return a **brief** summary (see **Reply style**):

- Docs added/updated (file paths)
- Which frontend codepaths they cover
- Key knowledge gaps addressed
- `git diff` highlights or a concise before/after description

Then **ask the user** whether to commit on a new branch and open a PR. Do not commit unless they confirm.

When the user approves, run:

```bash
cd /workspace/opencollective-documentation
git pull origin main   # sync again before branching
git checkout -b docs/<short-feature-slug>
git add -A
git status
git commit -m "$(cat <<'EOF'
docs: <concise user-facing summary>

<optional body: which pages and workflow covered>
EOF
)"
git push -u origin HEAD
gh pr create --repo opencollective/opencollective-documentation --title "docs: <title>" --body "$(cat <<'EOF'
## Summary
- ...

## Pages
- ...

## Verified against
- opencollective-frontend: <paths or areas>

## Test plan
- [ ] Read updated pages on GitBook preview
- [ ] Confirm steps match current UI
EOF
)"
```

Use `gh` for push and PR creation. Keep the PR documentation-only. Share the PR URL in chat.

### 6. Notify Slack

Post run results when the workflow finishes (PR opened, no-op, or stopped due to duplicate PR). Prefer, in order:

1. **Slack MCP** when available in the session.
2. **`SLACK_WEBHOOK_URL`** env var:

```bash
curl -sS -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"<summary>\"}" \
  "$SLACK_WEBHOOK_URL"
```

Message should include: feature requested, outcome (PR URL, no-op, or existing PR link), and pages touched.

If neither Slack channel is available, state in the chat reply that Slack notification could not be sent and include the same summary for manual posting.

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

## Output

**After drafting:** summary of edits and an offer to commit + open PR.

**After PR (if user approved):** docs added/updated, codepaths covered, knowledge gaps addressed, and PR link.
