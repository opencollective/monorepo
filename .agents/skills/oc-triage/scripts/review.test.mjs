import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createReviewServer,
  decide,
  initialize,
  readState,
  recordOutcome,
  revise,
} from "./review.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-triage-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state.json");
  const issue = {
    number: 1,
    title: "Example issue",
    url: "https://github.com/opencollective/opencollective/issues/1",
    finding: "A useful finding",
    limits: "No production reproduction",
    evidence: [],
    snapshot: {
      title: "Example issue",
      body: "Original issue",
      state: "OPEN",
      type: null,
      labels: ["api"],
      comments: [],
    },
    proposal: {
      status: "keep-open",
      type: "Enhancement",
      addLabels: [],
      removeLabels: [],
      createLabels: [],
      reviewed: true,
      comment: "Useful context.",
    },
  };
  initialize(file, { title: "Test review", issues: [issue] });
  return { file, issue };
}

test("approval persists the exact proposal and snapshot; initialization cannot overwrite it", (t) => {
  const { file, issue } = fixture(t);
  decide(file, 1, 1, "approve");
  const saved = readState(file).issues[0];
  assert.equal(saved.decision, "approved");
  assert.deepEqual(saved.approval.proposal, issue.proposal);
  assert.deepEqual(saved.approval.snapshot, issue.snapshot);
  assert.throws(
    () => initialize(file, { title: "Other", issues: [issue] }),
    /already exists/,
  );
  assert.equal(readState(file).issues[0].decision, "approved");
});

test("removing a comment changes only the approved subset and survives reload", (t) => {
  const { file } = fixture(t);
  decide(file, 1, 1, "comment", false);
  decide(file, 1, 2, "approve");
  const saved = readState(file).issues[0];
  assert.equal(saved.proposal.comment, "Useful context.");
  assert.equal(saved.approval.proposal.comment, null);
  assert.equal(saved.approval.proposal.reviewed, true);
  assert.equal(saved.includeComment, false);
});

test("instructions invalidate approval, persist per keystroke, and require a revised proposal", (t) => {
  const { file, issue } = fixture(t);
  decide(file, 1, 1, "approve");
  decide(file, 1, 2, "instructions", "Keep");
  decide(file, 1, 3, "instructions", "Keep open; change type");
  assert.equal(readState(file).issues[0].approval, null);
  assert.equal(
    readState(file).issues[0].instructions,
    "Keep open; change type",
  );
  assert.throws(() => decide(file, 1, 4, "approve"), /updated proposal/);
  revise(file, 1, 4, {
    ...issue,
    proposal: { ...issue.proposal, type: "Discussion" },
  });
  const revised = readState(file).issues[0];
  assert.equal(revised.decision, "pending");
  assert.equal(revised.history[0].instructions, "Keep open; change type");
  decide(file, 1, 5, "approve");
  assert.equal(readState(file).issues[0].approval.proposal.type, "Discussion");
});

test("stale tabs, file locks, and invalid actions cannot overwrite saved decisions", (t) => {
  const { file } = fixture(t);
  decide(file, 1, 1, "skip");
  assert.throws(() => decide(file, 1, 1, "approve"), /changed/);
  fs.writeFileSync(`${file}.lock`, "another process");
  assert.throws(() => decide(file, 1, 2, "approve"), /busy/);
  fs.unlinkSync(`${file}.lock`);
  assert.throws(() => decide(file, 1, 2, "invalid"), /Unknown/);
  assert.equal(readState(file).issues[0].decision, "skipped");
});

test("application claim freezes browser edits and preserves failure details", (t) => {
  const { file, issue } = fixture(t);
  decide(file, 1, 1, "approve");
  recordOutcome(file, 1, 2, {
    status: "applying",
    detail: "Claimed before GitHub writes",
  });
  assert.throws(
    () => decide(file, 1, 3, "comment", false),
    /Application has started/,
  );
  assert.throws(
    () => recordOutcome(file, 1, 3, { status: "applying", detail: "" }),
    /Already claimed/,
  );
  assert.throws(() => revise(file, 1, 3, issue), /Cannot revise/);
  recordOutcome(file, 1, 3, {
    status: "failed",
    detail: "Labels succeeded; comment failed. Inspect remote before retry.",
  });
  assert.match(readState(file).issues[0].outcome.detail, /Labels succeeded/);
  revise(file, 1, 4, issue);
  assert.equal(readState(file).issues[0].decision, "pending");
  assert.equal(readState(file).issues[0].history[0].outcome.status, "failed");
});

test("invalid seeds and missing files fail instead of discarding existing work", (t) => {
  const { file, issue } = fixture(t);
  assert.throws(
    () => initialize(`${file}.other`, { title: "Bad", issues: [issue, issue] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      initialize(`${file}.bad`, {
        title: "Bad",
        issues: [{ ...issue, url: "https://example.com" }],
      }),
    /tracker/,
  );
  assert.throws(() => readState(`${file}.missing`), /ENOENT/);
  fs.writeFileSync(file, "{broken");
  assert.throws(() => readState(file));
});

test("HTTP saves survive server restart; non-review and stale requests are rejected", async (t) => {
  const { file } = fixture(t);
  const start = async () => {
    const server = createReviewServer(file);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  };
  const { server, url } = await start();
  const request = (body, headers = {}) =>
    fetch(`${url}/api/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Triage-Review": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  let response = await request(
    { number: 1, revision: 1, action: "approve" },
    { Origin: "https://example.com" },
  );
  assert.equal(response.status, 403);
  response = await request({ number: 1, revision: 1, action: "skip" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).issues[0].decision, "skipped");
  response = await request({ number: 1, revision: 1, action: "approve" });
  assert.equal(response.status, 409);
  for (const route of ["/", "/app.js", "/style.css"])
    assert.equal((await fetch(url + route)).status, 200);
  assert.equal((await fetch(url + "/state.json")).status, 404);
  await new Promise((resolve) => server.close(resolve));
  const restarted = await start();
  const restored = await (await fetch(restarted.url + "/api/state")).json();
  assert.equal(restored.issues[0].decision, "skipped");
});
