const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const patchPath = path.join(__dirname, "patch-index.cjs");
const CLI_TIMEOUT_MS = 5000;
const FINGERPRINT = "oc:api:idor:edit-expense-payout";

function runPatch(indexPath, extraArgs) {
  return spawnSync(process.execPath, [patchPath, "--index", indexPath, ...extraArgs], {
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
  });
}

function readIndex(indexPath) {
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function huntArgs() {
  return [
    "--mode", "hunt",
    "--fingerprint", FINGERPRINT,
    "--title", "editExpense payout IDOR",
    "--verdict", "confirmed",
    "--repo", "opencollective-api",
    "--path", "server/graphql/v2/mutation/ExpenseMutations.ts",
    "--sha", "abc1234",
    "--issue", "42",
  ];
}

function bountyReport() {
  return {
    reporterName: "Alex",
    reporterEmail: "alex@example.com",
    date: "2026-09-17",
    bountyUsd: 300,
    gmailId: "gmail-1",
    messageId: "msgid-1",
    path: "reports/2026-09/msgid-1/",
    status: "open",
  };
}

test("hunt then bounty on the same fingerprint keeps hunt fields and the report", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patch-index-"));
  const indexPath = path.join(directory, "index.json");
  try {
    const hunt = runPatch(indexPath, huntArgs());
    assert.equal(hunt.status, 0, hunt.stderr);
    assert.match(hunt.stdout, /created/);

    const afterHunt = readIndex(indexPath);
    assert.equal(afterHunt.findings.length, 1);
    assert.deepEqual(afterHunt.findings[0].sources, ["harness"]);
    assert.deepEqual(afterHunt.findings[0].reports, []);
    assert.equal(afterHunt.findings[0].commitSha, "abc1234");
    assert.deepEqual(afterHunt.findings[0].paths, [
      "server/graphql/v2/mutation/ExpenseMutations.ts",
    ]);

    const bounty = runPatch(indexPath, [
      "--mode", "bounty",
      "--fingerprint", FINGERPRINT,
      "--title", "should not overwrite hunt title",
      "--report", JSON.stringify(bountyReport()),
    ]);
    assert.equal(bounty.status, 0, bounty.stderr);

    const afterBounty = readIndex(indexPath);
    assert.equal(afterBounty.findings.length, 1);
    const finding = afterBounty.findings[0];
    assert.equal(finding.title, "editExpense payout IDOR");
    assert.equal(finding.verdict, "confirmed");
    assert.equal(finding.commitSha, "abc1234");
    assert.equal(finding.issue, 42);
    assert.deepEqual(finding.paths, ["server/graphql/v2/mutation/ExpenseMutations.ts"]);
    assert.deepEqual(finding.sources, ["harness", "bounty"]);
    assert.equal(finding.reports.length, 1);
    assert.equal(finding.reports[0].messageId, "msgid-1");
    assert.equal(finding.reports[0].bountyUsd, 300);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("hunt does not wipe reports added by bounty", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patch-index-"));
  const indexPath = path.join(directory, "index.json");
  try {
    const firstHunt = runPatch(indexPath, huntArgs());
    assert.equal(firstHunt.status, 0, firstHunt.stderr);

    const bounty = runPatch(indexPath, [
      "--mode", "bounty",
      "--fingerprint", FINGERPRINT,
      "--report", JSON.stringify(bountyReport()),
    ]);
    assert.equal(bounty.status, 0, bounty.stderr);

    const secondHunt = runPatch(indexPath, [
      "--mode", "hunt",
      "--fingerprint", FINGERPRINT,
      "--verdict", "fixed",
      "--path", "server/graphql/v2/object/Expense.ts",
      "--report", JSON.stringify({
        reporterName: "ignored",
        reporterEmail: null,
        date: "2026-09-18",
        bountyUsd: null,
        gmailId: null,
        messageId: "should-not-land",
        path: "reports/2026-09/should-not-land/",
      }),
    ]);
    assert.equal(secondHunt.status, 0, secondHunt.stderr);

    const data = readIndex(indexPath);
    assert.equal(data.findings.length, 1);
    const finding = data.findings[0];
    assert.equal(finding.verdict, "fixed");
    assert.deepEqual(finding.paths, [
      "server/graphql/v2/mutation/ExpenseMutations.ts",
      "server/graphql/v2/object/Expense.ts",
    ]);
    assert.equal(finding.commitSha, "abc1234");
    assert.deepEqual(finding.sources, ["harness", "bounty"]);
    assert.equal(finding.reports.length, 1);
    assert.equal(finding.reports[0].messageId, "msgid-1");
    assert.equal(finding.reports[0].reporterName, "Alex");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bounty does not clear hunt paths or commitSha", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patch-index-"));
  const indexPath = path.join(directory, "index.json");
  try {
    assert.equal(runPatch(indexPath, huntArgs()).status, 0);
    const bounty = runPatch(indexPath, [
      "--mode", "bounty",
      "--fingerprint", FINGERPRINT,
      "--sha", "ffff9999",
      "--report", JSON.stringify(bountyReport()),
    ]);
    assert.equal(bounty.status, 0, bounty.stderr);
    const finding = readIndex(indexPath).findings[0];
    assert.equal(finding.commitSha, "abc1234");
    assert.deepEqual(finding.paths, [
      "server/graphql/v2/mutation/ExpenseMutations.ts",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
