# Cloudflare worker contract (superseded)

Live operator path: `dashboard/` in [opencollective/opencollective-security](https://github.com/opencollective/opencollective-security). This file is the on-disk ingest/send contract. A Cloudflare worker that opens PRs is not implemented and is not the send gate. Never run a model in a mail poller.

## Ingest (Gmail to reports/)

For each chosen security@ message:

1. Folder id = `gm_<gmailId>` (`reportFolderId` in `normalize-message-id.cjs`; Gmail id must be alphanumeric).
2. Dedup: if a report with the same `gmailId` already exists under `reports/` (any folder), do not write another.
3. Write `meta.json`, `body.txt`, `raw.eml`, `attachments/` as needed under that folder. Prefer leaving `reply.md` for triage.
4. Set status `TO_REVIEW`. Store `gmailId` and `threadId` when available.

Do not open a GitHub PR from the dashboard. Do not fire `repository_dispatch`.

## Attachments

Reject obvious executables and files larger than **10MB**. Do not put binaries in the LLM path.

## Send

1. Read `reply.md` and `meta.json` from the report folder.
2. Send the reply in-thread and CC `security@opencollective.com`.
3. Archive the original Gmail message.
4. Set `status` = `CLOSED` and `sentAt`.

Never send when `reply.md` is missing or empty. Never send a second time when `status` is already `CLOSED`.

## Prompt / model boundary

Triage runs via `HARNESS_CMD` (default `agent`) and must prefetch with `prefetch-bounty-report.cjs`. **`raw.eml` never goes in an LLM prompt** unless a human applied `allow-raw-eml`.
