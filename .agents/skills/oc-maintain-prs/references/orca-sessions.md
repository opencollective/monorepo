# Reviving Orca sessions per PR

A PR is often already owned by an agent session in an Orca workspace: the one that wrote it, or a previous sweep's. That session holds the PR's history, its worktree and the reviewer context, so sending it the brief beats a fresh sub-agent. Resolve the Orca executable once as the [orca-cli](../../orca-cli/SKILL.md) skill describes (`$ORCA_CLI_COMMAND` when set; never bare `orca` on Linux outside an Orca terminal, which starts the GNOME screen reader). `ORCA` below stands for that executable.

## 1. Find the session

```bash
ORCA reference find <pr-url> --json
```

It returns the workspaces linked to the PR, each with its `agents[]`. Pick one agent per PR:

- `liveness: "live"` only. `exited` and `unverifiable` sessions are not active: the PR gets a sub-agent.
- Skip your own session (`agent.sessionId == $ORCA_AGENT_SESSION_ID`).
- Prefer `linked: true` (recorded evidence the agent worked on this PR). Among the rest, prefer the workspace whose branch is the PR's `headRefName` (`ORCA worktree show --worktree id:<workspace.id> --json`). A workspace on another branch, such as the monorepo root, is not the PR's session.
- Several equally good candidates, or none on the PR's branch: spawn a sub-agent and mention the ambiguity in the report.

If `ORCA reference find` errors (Orca not running, `runtime_access_denied`, unsupported URL), fall back to a sub-agent for that PR and note it; do not start or restart Orca for this.

## 2. Send the brief

Build the same brief as for a sub-agent, with two changes:

- **Worktree**: the session keeps its own workspace path when it is on the PR's branch, instead of `/workspace/.worktrees/pr-<number>/<repo>`.
- **Report channel**: the session cannot return a message to you, so it writes its report (same fields as a sub-agent's, including escalations and flaky-test records) to `/tmp/oc-maintain-prs/<repo>-<number>.md` and appends `STATUS: done` or `STATUS: escalated` as the last line. Create the directory first.

Deliver it through the handle `reference find` returned:

- `terminal: <handle>`: read it first (`ORCA terminal read --terminal <handle> --screen --json`). If the agent is mid-turn or showing a permission menu, leave it alone and spawn a sub-agent instead. Otherwise `ORCA terminal send --terminal <handle> --text "<brief>" --enter --wait-submit 10 --json`.
- `mailbox: orca_session_id:<id>` (a chat session): `ORCA orchestration send --to orca_session_id:<id> --type handoff --subject "oc-maintain-prs: <repo>#<number>" --body "<brief>" --json`.

Done when the receipt shows `accepted: true` (and `turn_started` for terminals). A refused or unaccepted send falls back to a sub-agent; never send the brief twice to the same session.

## 3. Collect the report

Watch the report files (Monitor on `/tmp/oc-maintain-prs/*.md` for a `STATUS:` line), alongside the PR watch in step 6. Treat each report like a sub-agent's:

- **Escalation**: ask the operator, then send the answer to the same handle or mailbox, telling the session to resume and overwrite its report file.
- **Flaky test**: dedupe and post as the parent, as for sub-agents.

A session with no report after its PR's checks settle: read its terminal (or ask via its mailbox) once; if it is stuck or gone, spawn a sub-agent for the remaining work with the session's partial state in the brief.
