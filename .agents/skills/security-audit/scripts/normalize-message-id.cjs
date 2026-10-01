#!/usr/bin/env node

/**
 * Filesystem-safe message-id helper.
 * Strips < > @ / and any character outside [A-Za-z0-9._-].
 *
 * Usage: node normalize-message-id.cjs '<id@example.com>'
 */

function normalizeMessageId(value) {
  if (value == null) return "";
  return String(value).replace(/[^A-Za-z0-9._-]/g, "");
}

const GMAIL_ID = /^[A-Za-z0-9]+$/;

/** Report directory slug for Gmail-ingested mail (`gm_<gmailId>`). */
function reportFolderId(gmailId) {
  const id = String(gmailId ?? "").trim();
  if (!id || !GMAIL_ID.test(id)) {
    throw new Error("Invalid gmailId for report folder");
  }
  return `gm_${id}`;
}

/**
 * Canonical report ID for researcher replies and bounty expenses.
 * Prefer the `gm_<gmailId>` folder slug; never return a bare gmailId when `gm_` applies.
 */
function resolveReportId(folderName, meta) {
  const folder = String(folderName ?? "").trim();
  if (folder.startsWith("gm_")) {
    return folder;
  }
  const gmailId = meta?.gmailId == null ? "" : String(meta.gmailId).trim();
  if (gmailId && GMAIL_ID.test(gmailId)) {
    return reportFolderId(gmailId);
  }
  if (meta?.messageId != null && String(meta.messageId).trim()) {
    return normalizeMessageId(meta.messageId);
  }
  return folder;
}

function run(argv) {
  const input = argv[2];
  if (input === undefined) {
    console.error("Usage: node normalize-message-id.cjs <message-id>");
    return 1;
  }
  const normalized = normalizeMessageId(input);
  if (!normalized) {
    console.error("normalized message-id is empty");
    return 1;
  }
  process.stdout.write(`${normalized}\n`);
  return 0;
}

module.exports = { normalizeMessageId, reportFolderId, resolveReportId };

if (require.main === module) process.exit(run(process.argv));
