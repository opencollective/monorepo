#!/usr/bin/env node

/**
 * Patch harness/index.json by fingerprint. Never rewrite unrelated rows.
 *
 * Usage:
 *   node patch-index.cjs --mode hunt|bounty|internal --index <file> --fingerprint <id> [options]
 *
 * hunt: upsert title (if missing), verdict, paths union, commitSha, lastSeen, issue;
 *       add source "harness". Does not clear or rewrite reports[]. Does not delete rows.
 * bounty / internal: add source, append/update reports[] (messageId or gmailId, else date
 *       on this fingerprint). Does not clear hunt fields (paths, commitSha).
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateIndex } = require("./validate-index.cjs");

const MODES = new Set(["hunt", "bounty", "internal"]);
const SOURCE_BY_MODE = {
  hunt: "harness",
  bounty: "bounty",
  internal: "internal",
};
const FINGERPRINT_PATTERN = /^oc:[a-z]+:[a-z0-9-]+:.+/;
const REPOS = new Set([
  "opencollective-api",
  "opencollective-frontend",
  "opencollective-rest",
  "opencollective-pdf",
  "opencollective-images",
  "unknown",
]);
const VERDICTS = new Set([
  "confirmed",
  "needs_validation",
  "rejected",
  "invalid",
  "duplicate",
  "intentional",
  "fixed",
  "not_a_vuln",
]);
const EMPTY_INDEX = { version: 1, findings: [] };
const VALIDATOR = path.join(__dirname, "validate-index.cjs");

function usage() {
  return [
    "Usage: node patch-index.cjs --mode hunt|bounty|internal --index <file> --fingerprint <id>",
    "  [--title <text>] [--verdict <verdict>] [--repo <repo>] [--path <path>]...",
    "  [--sha <commit>] [--issue <n>] [--report <json>]",
  ].join("\n");
}

function parseArgs(argv) {
  const out = { paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--mode":
        out.mode = next();
        break;
      case "--index":
        out.index = next();
        break;
      case "--fingerprint":
        out.fingerprint = next();
        break;
      case "--title":
        out.title = next();
        break;
      case "--verdict":
        out.verdict = next();
        break;
      case "--repo":
        out.repo = next();
        break;
      case "--path":
        out.paths.push(next());
        break;
      case "--sha":
        out.sha = next();
        break;
      case "--issue":
        out.issue = next();
        break;
      case "--report":
        out.report = next();
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  return out;
}

function nowLastSeen() {
  return new Date().toISOString();
}

function addSource(sources, source) {
  const next = Array.isArray(sources) ? sources.slice() : [];
  if (!next.includes(source)) next.push(source);
  return next;
}

function unionPaths(existing, incoming) {
  const next = [];
  const seen = new Set();
  for (const value of [...(existing || []), ...(incoming || [])]) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function parseIssue(value) {
  if (value === undefined) return undefined;
  if (value === "" || value === "null") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid --issue ${value}`);
  return n;
}

function parseReport(raw) {
  if (raw === undefined) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("--report is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--report must be a JSON object");
  }
  const report = {
    reporterName: parsed.reporterName == null ? null : parsed.reporterName,
    reporterEmail: parsed.reporterEmail == null ? null : parsed.reporterEmail,
    date: parsed.date,
    bountyUsd: parsed.bountyUsd == null ? null : parsed.bountyUsd,
    gmailId: parsed.gmailId == null ? null : parsed.gmailId,
    messageId: parsed.messageId == null ? null : parsed.messageId,
    path: parsed.path,
  };
  if (Object.prototype.hasOwnProperty.call(parsed, "status")) {
    report.status = parsed.status;
  }
  return report;
}

function reportsMatch(existing, incoming) {
  if (incoming.messageId && existing.messageId && existing.messageId === incoming.messageId) {
    return true;
  }
  if (incoming.gmailId && existing.gmailId && existing.gmailId === incoming.gmailId) {
    return true;
  }
  if (incoming.messageId || incoming.gmailId || existing.messageId || existing.gmailId) {
    return false;
  }
  return existing.date === incoming.date;
}

function upsertReport(reports, incoming) {
  const next = reports.slice();
  const index = next.findIndex((report) => reportsMatch(report, incoming));
  if (index === -1) {
    next.push(incoming);
    return next;
  }
  next[index] = { ...next[index], ...incoming };
  return next;
}

function emptyFinding(args, source) {
  if (!args.title) throw new Error("--title is required when creating a finding");
  return {
    fingerprint: args.fingerprint,
    title: args.title,
    verdict: args.verdict || "needs_validation",
    sources: [source],
    repo: args.repo || "unknown",
    paths: unionPaths([], args.paths),
    commitSha: args.sha || null,
    lastSeen: nowLastSeen(),
    issue: args.issue === undefined ? null : args.issue,
    reports: [],
  };
}

function applyHunt(finding, args, isNew) {
  const next = { ...finding };
  if (isNew || !next.title) {
    if (args.title) next.title = args.title;
  }
  if (args.verdict) next.verdict = args.verdict;
  if (args.repo) next.repo = args.repo;
  next.paths = unionPaths(finding.paths, args.paths);
  if (args.sha) next.commitSha = args.sha;
  next.lastSeen = nowLastSeen();
  if (args.issue !== undefined) next.issue = args.issue;
  next.sources = addSource(finding.sources, "harness");
  next.reports = Array.isArray(finding.reports) ? finding.reports : [];
  return next;
}

function applyIngest(finding, args, source, isNew) {
  const next = { ...finding };
  if (isNew || !next.title) {
    if (args.title) next.title = args.title;
  }
  if (args.verdict) next.verdict = args.verdict;
  if (args.repo) next.repo = args.repo;
  next.paths = unionPaths(finding.paths, args.paths);
  if (args.sha && (isNew || next.commitSha == null)) next.commitSha = args.sha;
  next.lastSeen = nowLastSeen();
  if (args.issue !== undefined && (isNew || next.issue == null || args.issue !== null)) {
    next.issue = args.issue;
  }
  next.sources = addSource(finding.sources, source);
  next.reports = Array.isArray(finding.reports) ? finding.reports.slice() : [];
  if (args.report) next.reports = upsertReport(next.reports, args.report);
  return next;
}

function loadOrCreateIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return { data: { version: 1, findings: [] }, created: true };
  }
  const raw = fs.readFileSync(indexPath, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("index root must be an object");
  }
  if (!Array.isArray(data.findings)) {
    throw new Error("index.findings must be an array");
  }
  return { data, created: false };
}

function writeIndex(indexPath, data) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${indexPath}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, indexPath);
}

function validateAfterWrite(indexPath) {
  const result = spawnSync(process.execPath, [VALIDATOR, indexPath], { encoding: "utf8" });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(output || `validate-index.cjs exited ${result.status}`);
  }
}

function patchIndex(args) {
  const { data } = loadOrCreateIndex(args.index);
  const source = SOURCE_BY_MODE[args.mode];
  const findings = data.findings;
  const existingIndex = findings.findIndex((row) => row && row.fingerprint === args.fingerprint);

  let nextFinding;
  const isNew = existingIndex === -1;
  const current = isNew ? emptyFinding(args, source) : findings[existingIndex];

  if (args.mode === "hunt") {
    nextFinding = applyHunt(current, args, isNew);
  } else {
    nextFinding = applyIngest(current, args, source, isNew);
  }

  if (isNew) {
    findings.push(nextFinding);
  } else {
    findings[existingIndex] = nextFinding;
  }

  data.version = 1;
  data.findings = findings;

  const errors = validateIndex(data);
  if (errors.length > 0) {
    throw new Error(`patched index is invalid:\n${errors.join("\n")}`);
  }

  writeIndex(args.index, data);
  validateAfterWrite(args.index);
  return { created: isNew, fingerprint: args.fingerprint, sources: nextFinding.sources };
}

function run(argv) {
  let args;
  try {
    args = parseArgs(argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 1;
  }

  if (args.help) {
    console.log(usage());
    return 0;
  }

  try {
    if (!args.mode || !MODES.has(args.mode)) throw new Error("invalid or missing --mode");
    if (!args.index) throw new Error("missing --index");
    if (!args.fingerprint) throw new Error("missing --fingerprint");
    if (!FINGERPRINT_PATTERN.test(args.fingerprint)) {
      throw new Error("--fingerprint must match ^oc:[a-z]+:[a-z0-9-]+:.+");
    }
    if (args.verdict && !VERDICTS.has(args.verdict)) throw new Error("invalid --verdict");
    if (args.repo && !REPOS.has(args.repo)) throw new Error("invalid --repo");
    args.issue = parseIssue(args.issue);
    args.report = parseReport(args.report);
    if (args.mode === "hunt") args.report = null;
    args.sha = args.sha || undefined;
    args.paths = (args.paths || []).filter((value) => value.length > 0);

    const result = patchIndex(args);
    console.log(
      `PATCHED: ${result.fingerprint} (${result.created ? "created" : "updated"}; sources=${result.sources.join(",")})`,
    );
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

module.exports = {
  EMPTY_INDEX,
  applyHunt,
  applyIngest,
  parseArgs,
  patchIndex,
  reportsMatch,
  upsertReport,
};

if (require.main === module) process.exit(run(process.argv));
