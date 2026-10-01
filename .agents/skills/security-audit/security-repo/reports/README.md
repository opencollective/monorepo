# Reports inbox

One folder per security@ email. The local dashboard writes this tree; send of `reply.md` is a dashboard action (see the live repo `dashboard/README.md`).

## Tree

```
reports/<year>-<month>/<report-folder-id>/
  meta.json       Structured headers and ingest facts (schema: report-meta.schema.json)
  body.txt        Plain-text body (prefetch this; never put raw.eml in an LLM prompt)
  raw.eml         Original message; do not send to a model unless label allow-raw-eml
  attachments/    Rejected if executable or larger than 10MB
  reply.md        Paste-ready reply; required before send
```

`<year>-<month>` is the email date (`YYYY-MM`). `<report-folder-id>` is `gm_<gmailId>` from dashboard ingest (`reportFolderId` in `normalize-message-id.cjs`). Legacy folders may still use a `normalize-message-id.cjs` slug from `Message-ID`; dedup uses `gmailId` in `meta.json`.

## Status

`meta.json` `status`:

- `TO_REVIEW` - ingested, not yet triaged
- `REVIEWING` - local harness is running
- `REVIEWED` - `reply.md` written; waiting for operator send
- `CLOSED` - reply sent and `sentAt` recorded

Never send from an empty `reply.md`. After send, `status: CLOSED` and `sentAt` so the message is not sent twice.

## Prefetch for triage

```
node .agents/skills/security-audit/scripts/prefetch-bounty-report.cjs reports/YYYY-MM/<id>/
```

Writes `/tmp/gh-aw/data/report-summary.json` (meta + size-capped untrusted body). Fails if `meta.json` is invalid. Never includes `raw.eml`.
