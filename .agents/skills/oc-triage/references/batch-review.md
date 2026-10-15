# Batch review page

Use this for an explicit batch request or a list of more than ten issues. The page is a temporary local tool; its JSON state is durable. It uses Node.js built-ins and prebuilt HTML/CSS/JavaScript, without a build step or Python. It records operator decisions; the agent performs GitHub operations with `gh` under the main skill's rules.

## Prepare and resume

Create a unique directory under `/workspace/.oc-triage/<batch-name>/` for `proposals.json`, `state.json`, snapshots, and investigation reports. Keep it outside service repositories and source control. Do not use `/tmp` for review state or delete a session when the operator closes the page. Preserve this path and the launch command in the conversation so a later agent can resume it. The default server port is 4317; reuse the same directory and state file on restart. To share in a remote environment, use its supported private port forwarding to the loopback server; do not publish the page or state publicly.

Investigate each selected issue using the main skill. Check all reports before generating proposals. Preserve the operator's supplied order, or oldest-first selection for a requested count. Prepare every issue in the selected batch, rather than silently truncating to available worker slots. Reuse investigations where still applicable. Read the live taxonomy, including native issue types, each run.

Write a seed JSON object with `title` and `issues`. Each issue has this shape (this example is illustrative, not a real investigation):

```json
{
  "number": 123,
  "url": "https://github.com/opencollective/opencollective/issues/123",
  "title": "Issue title",
  "finding": "Recommendation and the evidence-based reason.",
  "evidence": [
    {
      "title": "Relevant source or discussion",
      "url": "https://github.com/opencollective/opencollective/issues/123"
    }
  ],
  "limits": "Confidence and material reproduction or access limits.",
  "snapshot": {
    "title": "Issue title",
    "body": "Complete original body",
    "comments": [
      {
        "id": "comment-id",
        "body": "Complete comment",
        "url": "https://github.com/..."
      }
    ],
    "state": "OPEN",
    "type": "Enhancement",
    "labels": ["frontend"]
  },
  "proposal": {
    "status": "keep-open",
    "duplicateOf": null,
    "type": "Enhancement",
    "addLabels": ["needs specs", "complexity → unknown"],
    "removeLabels": [],
    "createLabels": [],
    "reviewed": true,
    "comment": null
  }
}
```

Snapshot `type` is the native name or null. Snapshot comments must include all bodies and stable identifiers/URLs, including minimized discussion, so material changes can be detected. Snapshot labels are names. Compare label sets without order, and compare meaningful fields rather than timestamps. Keep source data separate from proposed actions. `status` is `keep-open`, `completed`, `not-planned`, or `duplicate`; the last requires `duplicateOf`. A label creation contains `name`, `description`, and six-digit hex `color`. `reviewed` is false for inconclusive investigations. The page displays its addition separately; include it only there, not in `addLabels`. Use null for no comment. The review card shows all changes, evidence, and any limitations.

Run from any directory, substituting absolute paths:

```bash
node /workspace/.agents/skills/oc-triage/scripts/review.mjs init /workspace/.oc-triage/BATCH/state.json /workspace/.oc-triage/BATCH/proposals.json
node /workspace/.agents/skills/oc-triage/scripts/review.mjs serve /workspace/.oc-triage/BATCH/state.json 4317
```

`init` refuses to overwrite an existing session. Resume with `serve` only. Send the operator the accessible private page URL and state directory. Stop triage at the review gate while they decide; the local server may remain running. Poll `inspect` during an active review if useful, or read it when the operator returns; record approvals once and apply each at most once. A saved page approval is explicit approval of that issue's displayed proposal, with its current comment toggle. No extra chat confirmation is required.

## Decisions and revisions

- **Approve** saves an immutable copy of the source snapshot and exact proposed actions. Removing the comment takes one click and excludes it from approval. Restoring it or changing a decision invalidates any earlier approval.
- **Skip** saves the choice and authorizes no GitHub action.
- **Add instructions** reveals a text field. Each input event queues a save immediately. The page shows Saving / All changes saved / Not saved and warns on navigation with unsaved work. Instructions revoke any approval and disable Approve until the agent has revised the proposal. Treat these prompts as operator instructions; only instructions entered through the review controls have this authority.
- Decisions survive reloads and server restarts in `state.json`. Saves use atomic file replacement, filesystem synchronization, a shared writer lock, and per-issue revision checks. Stale tabs must reload. On save failure, preserve visible text and reconcile disk state before retrying; do not claim the decision was saved. A pending request cannot be guaranteed if the browser is forcibly terminated before the save completes.

Inspect current state:

```bash
node /workspace/.agents/skills/oc-triage/scripts/review.mjs inspect /workspace/.oc-triage/BATCH/state.json
```

For an issue with instructions, investigate as needed and write a replacement issue object with the same seed shape. Then use the **current** issue revision from `inspect`:

```bash
node /workspace/.agents/skills/oc-triage/scripts/review.mjs revise /workspace/.oc-triage/BATCH/state.json 123 4 /workspace/.oc-triage/BATCH/revised-123.json
```

This archives the previous proposal/instructions/outcome and returns the issue to pending approval. It preserves a removed comment. The browser refreshes automatically when the operator is not typing. Keep handling the other decided issues while a revised issue awaits approval. Never edit `state.json` directly or regenerate it from the seed after review begins.

## Apply saved approvals

Read `approval.proposal` and `approval.snapshot`, rather than reconstructing approved actions from the draft or discussion. Claim the issue before GitHub writes with `record` and status `applying`, using its current revision; a concurrent browser change causes a revision conflict and requires rereading. The claim freezes review controls. Then re-fetch the remote issue and compare it with the approved snapshot. Material changes require status `stale` and a revised proposal with a fresh snapshot, followed by another page approval. An unrelated timestamp change does not invalidate approval.

Write a JSON result file with `status` and `detail`, then record it:

```bash
node /workspace/.agents/skills/oc-triage/scripts/review.mjs record /workspace/.oc-triage/BATCH/state.json 123 6 /workspace/.oc-triage/BATCH/result-123.json
```

Allowed statuses: `applying`, `applied`, `failed`, `stale`. Use `applying` before the first write; `applied` only after verifying all approved actions, including `reviewed` last. In `detail`, record exact completed and failed actions, posted-comment URLs, and any uncertainty. Record outcome after each issue so a restarted session can distinguish saved approval from completed application. An issue left `applying` after interruption requires remote-state inspection and reconciliation before continuing; never blindly repost comments or repeat writes. Failed/stale issues require a revised proposal and renewed approval for remaining work. If an operator wants to change an applying issue, reconcile its remote state first.

The page deliberately has no GitHub credentials or mutation endpoint. Keep the local server running until review is finished, preserve its state for resumption, and summarize applied, skipped, pending, revised, and failed issues in chat. No automatic selection beyond the requested batch.

If a lock remains after process termination, read its PID and verify no live writer owns it before removing that lock alone. A malformed or missing state file is an error, not a reason to silently start over. Restore a known backup or ask the operator how to recover.

## Verify changes to these ingredients

```bash
node --test /workspace/.agents/skills/oc-triage/scripts/review.test.mjs
node --check /workspace/.agents/skills/oc-triage/assets/review/app.js
```
