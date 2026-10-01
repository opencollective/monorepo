#!/usr/bin/env node

/**
 * Group harness/index.json findings by reporter from reports[] and print markdown.
 * Usage: node generate-index-readme.cjs [--index <file>]
 */

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile, validateIndex } = require("./validate-index.cjs");

function parseArgs(argv) {
  let indexPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--index") {
      i += 1;
      if (i >= argv.length) throw new Error("missing value for --index");
      indexPath = argv[i];
    } else if (!argv[i].startsWith("--") && !indexPath) {
      indexPath = argv[i];
    } else {
      throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return indexPath;
}

function defaultIndexPath() {
  const envRoot = process.env.OC_SECURITY_REPO;
  const candidates = [
    envRoot ? path.join(envRoot, "harness", "index.json") : null,
    path.join(process.cwd(), "opencollective-security", "harness", "index.json"),
    "/workspace/opencollective-security/harness/index.json",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function reporterHeading(report) {
  const name = report.reporterName || "Unknown reporter";
  if (report.reporterEmail) return `${name} (${report.reporterEmail})`;
  return name;
}

function bountyCell(value) {
  if (value == null) return "-";
  if (typeof value === "number") return `$${value}`;
  return String(value);
}

function run(argv) {
  let indexPath;
  try {
    indexPath = parseArgs(argv.slice(2)) || defaultIndexPath();
  } catch (error) {
    console.error(error.message);
    console.error("Usage: node generate-index-readme.cjs [--index <file>]");
    return 1;
  }

  let data;
  try {
    data = readJsonFile(indexPath);
  } catch (error) {
    console.error(`Failed to read index: ${error.message}`);
    return 1;
  }

  const errors = validateIndex(data);
  if (errors.length > 0) {
    for (const message of errors) console.error("ERROR:", message);
    console.error("FAIL: index is invalid");
    return 1;
  }

  const groups = new Map();
  const unattributed = [];

  for (const finding of data.findings) {
    if (!Array.isArray(finding.reports) || finding.reports.length === 0) {
      unattributed.push(finding);
      continue;
    }
    for (const report of finding.reports) {
      const heading = reporterHeading(report);
      if (!groups.has(heading)) groups.set(heading, []);
      groups.get(heading).push({ finding, report });
    }
  }

  const lines = [
    "# Findings by reporter",
    "",
    "Generated from `harness/index.json`. Do not edit by hand; regenerate with `scripts/generate-index-readme.cjs`.",
    "",
  ];

  const headings = [...groups.keys()].sort((a, b) => a.localeCompare(b, "en"));
  for (const heading of headings) {
    const rows = groups.get(heading).slice().sort((a, b) => {
      if (a.report.date !== b.report.date) return a.report.date < b.report.date ? -1 : 1;
      return a.finding.title.localeCompare(b.finding.title, "en");
    });
    lines.push(`## ${heading}`, "", "| Date | Title | Bounty | Verdict |", "| ---- | ----- | ------ | ------- |");
    for (const row of rows) {
      lines.push(
        `| ${row.report.date} | ${row.finding.title} | ${bountyCell(row.report.bountyUsd)} | ${row.finding.verdict} |`,
      );
    }
    lines.push("");
  }

  if (unattributed.length > 0) {
    lines.push("## Unattributed (no report)", "", "| Last seen | Title | Verdict | Sources |", "| --------- | ----- | ------- | ------- |");
    for (const finding of unattributed) {
      lines.push(
        `| ${finding.lastSeen} | ${finding.title} | ${finding.verdict} | ${finding.sources.join(", ")} |`,
      );
    }
    lines.push("");
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (require.main === module) process.exit(run(process.argv));
