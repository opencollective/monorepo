#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const assets = fileURLToPath(new URL("../assets/review/", import.meta.url));
const clone = (value) => structuredClone(value);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

function validateIssue(issue) {
  if (!Number.isSafeInteger(issue.number) || issue.number < 1)
    throw fail("Invalid issue number");
  if (
    issue.url !==
    `https://github.com/opencollective/opencollective/issues/${issue.number}`
  ) {
    throw fail("Only Open Collective tracker issue URLs are supported");
  }
  if (!issue.title || !issue.finding || !issue.snapshot || !issue.proposal)
    throw fail("Missing issue details");
  const snapshot = issue.snapshot;
  if (
    typeof snapshot.body !== "string" ||
    typeof snapshot.title !== "string" ||
    !["OPEN", "CLOSED"].includes(snapshot.state) ||
    !Array.isArray(snapshot.labels) ||
    !Array.isArray(snapshot.comments)
  ) {
    throw fail("Missing source snapshot fields");
  }
  const p = issue.proposal;
  if (
    !["keep-open", "completed", "not-planned", "duplicate"].includes(p.status)
  )
    throw fail("Invalid proposed status");
  if (p.status === "duplicate" && !Number.isSafeInteger(p.duplicateOf))
    throw fail("Missing canonical issue number");
  if (!["Bug", "Enhancement", "Task", "Support", "Discussion"].includes(p.type))
    throw fail("Invalid native issue type");
  for (const key of ["addLabels", "removeLabels", "createLabels"]) {
    if (!Array.isArray(p[key])) throw fail(`Missing ${key}`);
  }
  for (const key of ["addLabels", "removeLabels"]) {
    if (p[key].some((label) => typeof label !== "string" || !label))
      throw fail("Invalid label name");
  }
  if (
    p.createLabels.some(
      (label) =>
        !label.name ||
        typeof label.description !== "string" ||
        !/^[\da-f]{6}$/i.test(label.color),
    )
  ) {
    throw fail("Invalid label creation");
  }
  if (
    typeof p.reviewed !== "boolean" ||
    !(p.comment === null || typeof p.comment === "string")
  ) {
    throw fail("Invalid comment or reviewed marker");
  }
  if (!Array.isArray(issue.evidence) || typeof issue.limits !== "string")
    throw fail("Missing evidence or limits");
}

function atomicWrite(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    const directory = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function readState(file) {
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state.version !== 1 || !Array.isArray(state.issues))
    throw fail("Unsupported review file");
  return state;
}

function transaction(file, change) {
  // Shared by the server and CLI: concurrent processes never overwrite each other.
  const lock = `${file}.lock`;
  let fd;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw fail("Review file busy; retry after the current save", 409);
    throw error;
  }
  try {
    fs.writeFileSync(fd, String(process.pid));
    const state = readState(file);
    change(state);
    state.updatedAt = new Date().toISOString();
    atomicWrite(file, state);
    return state;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function initialize(file, input) {
  if (fs.existsSync(file))
    throw fail("Review file already exists; resume it instead");
  if (!input.title || !Array.isArray(input.issues) || !input.issues.length)
    throw fail("Empty review");
  const numbers = new Set();
  const issues = input.issues.map((issue) => {
    validateIssue(issue);
    if (numbers.has(issue.number)) throw fail("Duplicate issue number");
    numbers.add(issue.number);
    return {
      ...clone(issue),
      revision: 1,
      decision: "pending",
      includeComment: issue.proposal.comment !== null,
      instructions: "",
      needsRevision: false,
      approval: null,
      outcome: null,
      history: [],
    };
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Exclusive creation prevents accidentally replacing another review.
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(
      fd,
      `${JSON.stringify({ version: 1, title: input.title, updatedAt: new Date().toISOString(), issues }, null, 2)}\n`,
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return readState(file);
}

function current(state, number, revision) {
  const issue = state.issues.find((item) => item.number === number);
  if (!issue) throw fail("Issue not found", 404);
  if (issue.revision !== revision)
    throw fail("This issue changed. Reload before deciding.", 409);
  return issue;
}

export function decide(file, number, revision, action, value) {
  return transaction(file, (state) => {
    const issue = current(state, number, revision);
    if (issue.outcome)
      throw fail(
        "Application has started. The agent must resolve or revise this issue.",
        409,
      );
    if (action === "approve") {
      if (issue.needsRevision)
        throw fail(
          "Instructions need an updated proposal before approval",
          409,
        );
      issue.decision = "approved";
      issue.approval = {
        approvedAt: new Date().toISOString(),
        snapshot: clone(issue.snapshot),
        proposal: clone(issue.proposal),
      };
      if (!issue.includeComment) issue.approval.proposal.comment = null;
    } else if (action === "skip") {
      issue.decision = "skipped";
      issue.approval = null;
    } else if (action === "comment") {
      if (typeof value !== "boolean") throw fail("Expected comment toggle");
      issue.includeComment = value && issue.proposal.comment !== null;
      issue.decision = "pending";
      issue.approval = null;
    } else if (action === "instructions") {
      if (typeof value !== "string" || value.length > 20000)
        throw fail("Invalid instructions");
      issue.instructions = value;
      issue.needsRevision = true;
      issue.decision = "instructions";
      issue.approval = null;
    } else throw fail("Unknown action");
    issue.revision += 1;
  });
}

export function revise(file, number, revision, replacement) {
  return transaction(file, (state) => {
    const issue = current(state, number, revision);
    validateIssue(replacement);
    if (replacement.number !== issue.number)
      throw fail("Replacement issue number differs");
    if (["applying", "applied"].includes(issue.outcome?.status))
      throw fail("Cannot revise an applying or applied issue");
    issue.history.push({
      revision: issue.revision,
      proposal: issue.proposal,
      snapshot: issue.snapshot,
      instructions: issue.instructions,
      approval: issue.approval,
      outcome: issue.outcome,
    });
    const included = issue.includeComment;
    for (const key of [
      "title",
      "url",
      "summary",
      "finding",
      "evidence",
      "limits",
      "snapshot",
      "proposal",
    ])
      issue[key] = clone(replacement[key]);
    issue.includeComment = included && issue.proposal.comment !== null;
    issue.decision = "pending";
    issue.needsRevision = false;
    issue.approval = null;
    issue.outcome = null;
    issue.revision += 1;
  });
}

export function recordOutcome(file, number, revision, outcome) {
  return transaction(file, (state) => {
    const issue = current(state, number, revision);
    if (issue.decision !== "approved" || !issue.approval)
      throw fail("Issue has no approved proposal");
    if (
      !["applying", "applied", "failed", "stale"].includes(outcome.status) ||
      typeof outcome.detail !== "string"
    ) {
      throw fail("Invalid outcome");
    }
    if (issue.outcome?.status === "applied")
      throw fail("Issue already applied");
    if (outcome.status === "applying" && issue.outcome)
      throw fail("Already claimed; inspect remote state before recovery");
    issue.outcome = { ...clone(outcome), recordedAt: new Date().toISOString() };
    issue.revision += 1;
  });
}

export function createReviewServer(file) {
  readState(file);
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/state")
        return send(200, readState(file));
      if (req.method === "POST" && url.pathname === "/api/decision") {
        // JSON plus same-origin requests prevents other sites submitting local decisions.
        if (
          req.headers["content-type"] !== "application/json" ||
          req.headers["x-triage-review"] !== "1"
        )
          throw fail("Invalid request", 403);
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}` &&
          req.headers.origin !== `https://${req.headers.host}`
        ) {
          throw fail("Cross-origin requests are not supported", 403);
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 100000)
            throw fail("Request too large", 413);
        }
        const { number, revision, action, value } = JSON.parse(body);
        return send(200, decide(file, number, revision, action, value));
      }
      const files = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
      };
      if (req.method === "GET" && Object.hasOwn(files, url.pathname)) {
        const [name, type] = files[url.pathname];
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        return res.end(fs.readFileSync(path.join(assets, name)));
      }
      send(404, { error: "Not found" });
    } catch (error) {
      send(error.status || 500, { error: error.message });
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, statePath, ...args] = process.argv.slice(2);
  try {
    if (!statePath)
      throw fail(
        "Usage: review.mjs init|serve|inspect|revise|record STATE [arguments]",
      );
    const file = path.resolve(statePath);
    if (command === "init")
      initialize(file, JSON.parse(fs.readFileSync(args[0], "utf8")));
    else if (command === "inspect")
      console.log(JSON.stringify(readState(file), null, 2));
    else if (command === "revise")
      revise(
        file,
        Number(args[0]),
        Number(args[1]),
        JSON.parse(fs.readFileSync(args[2], "utf8")),
      );
    else if (command === "record")
      recordOutcome(
        file,
        Number(args[0]),
        Number(args[1]),
        JSON.parse(fs.readFileSync(args[2], "utf8")),
      );
    else if (command === "serve") {
      const port = Number(args[0] || 4317);
      const server = createReviewServer(file);
      server.on("error", (error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
      server.listen(port, "127.0.0.1", () =>
        console.log(
          `Review: http://127.0.0.1:${server.address().port}\nState: ${file}`,
        ),
      );
    } else throw fail("Unknown command");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
