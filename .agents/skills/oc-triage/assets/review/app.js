let state;
let issueTitles = {};
let queue = Promise.resolve();
let saving = 0;
let failed = false;
// Expanded cards stay open across re-renders (saves and background refreshes).
const expanded = new Set();
const $ = (selector) => document.querySelector(selector);
const labels = (values) => (values.length ? values.join(", ") : "None");
const safeLink = (anchor, url) => {
  try {
    if (new URL(url).protocol === "https:") anchor.href = url;
  } catch {
    /* Display invalid evidence as plain text. */
  }
};

function showError(message) {
  $("#error").textContent = message;
  $("#error").hidden = false;
  $("#save").textContent = "Not saved";
}

function submit(number, action, value, rerender = true) {
  saving += 1;
  $("#save").textContent = "Saving…";
  // Serialize keystrokes and decisions; never let a delayed approval overtake instructions.
  queue = queue
    .then(async () => {
      if (failed)
        throw new Error(
          "Reload to reconcile the unsaved change before making more decisions.",
        );
      const issue = state.issues.find((item) => item.number === number);
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Triage-Review": "1" },
        body: JSON.stringify({
          number,
          revision: issue.revision,
          action,
          value,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      state = result;
      if (rerender && saving === 1) render();
    })
    .catch((error) => {
      failed = true;
      updateBulk();
      showError(
        `${error.message} Your text is still visible; copy it before reloading.`,
      );
    })
    .finally(() => {
      saving -= 1;
      if (!saving && !failed) {
        $("#save").textContent = "All changes saved";
        updateProgress();
        updateBulk();
        for (const article of document.querySelectorAll("article"))
          updateStatus(article);
      }
    });
}

const STATUS = {
  "keep-open": { tone: "open", icon: "○" },
  completed: { tone: "success", icon: "✓" },
  "not-planned": { tone: "warning", icon: "⊘" },
  duplicate: { tone: "duplicate", icon: "↗" },
};

const statusText = (p) =>
  p.status === "duplicate"
    ? `Close as duplicate of #${p.duplicateOf}`
    : p.status === "keep-open"
      ? "Keep open"
      : `Close as ${p.status.replace("-", " ")}`;

function chip(text, tone, icon, className = "") {
  const badge = document.createElement("span");
  badge.className = `value-badge tone-${tone} ${className}`.trim();
  const symbol = document.createElement("span");
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = icon;
  badge.append(symbol, document.createTextNode(` ${text}`));
  return badge;
}

// The condensed view: status and comment first, then any other changes.
function renderGlance(article, issue) {
  const p = issue.proposal;
  const primary = article.querySelector(".glance-primary");
  primary.append(
    chip(
      statusText(p),
      STATUS[p.status].tone,
      STATUS[p.status].icon,
      "primary",
    ),
    !p.comment
      ? chip("No comment", "neutral", "—", "primary")
      : issue.includeComment
        ? chip("Comment proposed", "comment", "✎", "primary")
        : chip("Comment removed", "neutral", "✎", "primary removed"),
  );
  const secondary = article.querySelector(".glance-secondary");
  if (p.type !== issue.snapshot.type) {
    const type = chip(p.type, "neutral", "◆");
    type.title = `Type change (was ${issue.snapshot.type || "unset"})`;
    secondary.append(type);
  }
  for (const label of p.addLabels)
    secondary.append(chip(label, "success", "+"));
  for (const label of p.createLabels)
    secondary.append(chip(`${label.name} (new)`, "success", "✦"));
  for (const label of p.removeLabels)
    secondary.append(chip(label, "danger", "−"));
  const r = p.relationships;
  if (r) {
    const changes = Object.values(r).flat().length;
    if (changes) {
      const relations = chip(
        `${changes} relationship change${changes === 1 ? "" : "s"}`,
        "neutral",
        "⇄",
      );
      relations.title = "Show details for the related and blocking issues";
      secondary.append(relations);
    }
  }
  if (!p.reviewed)
    secondary.append(chip("Leave unmarked (inconclusive)", "warning", "○"));
  if (!secondary.childElementCount) {
    const none = document.createElement("span");
    none.className = "hint";
    none.textContent = "No other changes";
    secondary.append(none);
  }
}

function setExpanded(article, open) {
  const number = Number(article.dataset.number);
  if (open) expanded.add(number);
  else expanded.delete(number);
  article.classList.toggle("expanded", open);
  article.querySelector(".details").hidden = !open;
  const toggle = article.querySelector(".toggle-details");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Hide details" : "Show details";
}

function isVisible(issue) {
  const filter = $("#filter").value;
  const statusFilter = $("#status-filter").value;
  const commentFilter = $("#comment-filter").value;
  const status = issue.outcome?.status || issue.decision;
  if (filter !== "all" && status !== filter) return false;
  const proposed = issue.proposal.status;
  if (
    statusFilter !== "all" &&
    (statusFilter === "close"
      ? proposed === "keep-open"
      : proposed !== statusFilter)
  )
    return false;
  return (
    commentFilter === "all" ||
    Boolean(issue.proposal.comment) === (commentFilter === "proposed")
  );
}

// Same rule as each card's Approve button.
const canApprove = (issue) =>
  !issue.outcome && !issue.needsRevision && issue.decision !== "approved";

const bulkTargets = () =>
  state.issues.filter((issue) => isVisible(issue) && canApprove(issue));

function updateBulk() {
  const count = bulkTargets().length;
  $("#approve-all").textContent = `Approve all shown (${count})`;
  $("#approve-all").disabled = !count || failed;
}

function updateProgress() {
  const counts = state.issues.reduce((all, issue) => {
    const status = issue.outcome?.status || issue.decision;
    all[status] = (all[status] || 0) + 1;
    return all;
  }, {});
  $("#progress").textContent =
    `${state.issues.length} issues · ${counts.approved || 0} approved · ${counts.applied || 0} applied · ${counts.instructions || 0} need revision`;
}

function updateStatus(article) {
  const issue = state.issues.find(
    (item) => item.number === Number(article.dataset.number),
  );
  article.dataset.decision = issue.decision;
  article.dataset.outcome = issue.outcome?.status || "";
  article.querySelector(".badge").textContent =
    issue.outcome?.status ||
    (issue.needsRevision ? "Needs revision" : issue.decision);
  article.querySelector(".approve").disabled =
    Boolean(issue.outcome) ||
    issue.needsRevision ||
    issue.decision === "approved";
  article.querySelector(".skip").disabled =
    Boolean(issue.outcome) || issue.decision === "skipped";
  article.querySelector(".toggle-comment").disabled =
    Boolean(issue.outcome) || !issue.proposal.comment;
  article.querySelector(".instructions-button").disabled = Boolean(
    issue.outcome,
  );
  article.querySelector("textarea").disabled = Boolean(issue.outcome);
}

function render() {
  $("#title").textContent = state.title;
  updateProgress();
  updateBulk();
  $("#issues").replaceChildren();
  for (const issue of state.issues) {
    if (!isVisible(issue)) continue;
    const article = $("#card").content.firstElementChild.cloneNode(true);
    article.dataset.number = issue.number;
    const anchor = article.querySelector(".issue-link");
    anchor.textContent = `#${issue.number} · ${issue.title}`;
    safeLink(anchor, issue.url);
    article.querySelector(".summary-text").textContent =
      issue.summary ||
      "Summary not yet provided. Show details to read the original issue.";
    renderGlance(article, issue);
    const details = article.querySelector(".details");
    details.id = `details-${issue.number}`;
    const detailsToggle = article.querySelector(".toggle-details");
    detailsToggle.setAttribute("aria-controls", details.id);
    detailsToggle.onclick = () =>
      setExpanded(article, !expanded.has(issue.number));
    setExpanded(article, expanded.has(issue.number));
    article.querySelector(".finding").textContent = issue.finding;
    article.querySelector(".source-body").textContent = issue.snapshot.body;
    for (const comment of issue.snapshot.comments) {
      const text = document.createElement("pre");
      text.textContent = comment.body;
      article.querySelector(".source-comments").append(text);
    }
    for (const evidence of issue.evidence) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.textContent = evidence.title;
      safeLink(a, evidence.url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a);
      article.querySelector(".evidence").append(li);
    }
    const p = issue.proposal;
    const rows = [
      ["Status", statusText(p)],
      [
        "Type",
        `${p.type}${p.type === issue.snapshot.type ? " (preserve)" : ` (was ${issue.snapshot.type || "unset"})`}`,
      ],
      ["Add labels", labels(p.addLabels)],
      ["Remove labels", labels(p.removeLabels)],
      [
        "Preserve labels",
        labels(
          (issue.snapshot.labels || []).filter(
            (label) => !p.removeLabels.includes(label),
          ),
        ),
      ],
      [
        "Create labels",
        p.createLabels.length
          ? p.createLabels
              .map(
                (label) =>
                  `${label.name}: ${label.description} (#${label.color})`,
              )
              .join("; ")
          : "None",
      ],
      [
        "Reviewed",
        p.reviewed ? "Add last after successful application" : "Leave unmarked",
      ],
    ];
    for (const [key, value] of rows) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = key;
      const td = document.createElement("td");
      const tone =
        key === "Status"
          ? STATUS[p.status].tone
          : key === "Add labels" || key === "Create labels"
            ? "success"
            : key === "Remove labels"
              ? "danger"
              : key === "Reviewed"
                ? p.reviewed
                  ? "success"
                  : "warning"
                : "neutral";
      const icon =
        key === "Status"
          ? STATUS[p.status].icon
          : {
              Type: "◆",
              "Add labels": "+",
              "Remove labels": "−",
              "Preserve labels": "=",
              "Create labels": "✦",
              Reviewed: p.reviewed ? "✓" : "○",
            }[key];
      tr.className = key === "Status" ? "status-row" : "";
      const values =
        key === "Add labels"
          ? p.addLabels
          : key === "Remove labels"
            ? p.removeLabels
            : key === "Preserve labels"
              ? issue.snapshot.labels.filter(
                  (label) => !p.removeLabels.includes(label),
                )
              : [value];
      for (const text of values.length ? values : ["None"])
        td.append(
          text === "None" ? chip(text, "neutral", "—") : chip(text, tone, icon),
        );
      tr.append(th, td);
      article.querySelector("tbody").append(tr);
    }
    const existing = issue.snapshot.relationships;
    const changes = p.relationships;
    for (const [label, key, kind] of [
      ["Related issues", "related", "Related"],
      ["Blocked by", "blockedBy", "BlockedBy"],
      ["Blocks", "blocking", "Blocking"],
      ["Parent", "parent", null],
      ["Sub-issues", "subIssues", null],
    ]) {
      if (!kind && !existing?.[key]?.length) continue;
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = label;
      const td = document.createElement("td");
      const removed = changes?.[`remove${kind}`] || [];
      const urls =
        key === "parent" ? [existing?.parent] : existing?.[key] || [];
      const entries = urls.filter(Boolean).map((url) => ({
        url,
        action: removed.includes(url) ? "Remove" : "Keep",
      }));
      for (const url of changes?.[`add${kind}`] || [])
        entries.push({ url, action: "Add" });
      if (!entries.length) td.textContent = existing ? "None" : "Not inspected";
      const list = document.createElement("ul");
      list.className = "relationship-list";
      for (const { url, action } of entries) {
        const item = document.createElement("li");
        const a = document.createElement("a");
        const match = url.match(
          /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/,
        );
        const name = match
          ? `${match[1] === "opencollective" && match[2] === "opencollective" ? "" : `${match[1]}/${match[2]}`}#${match[3]}`
          : url;
        const title = issueTitles[url];
        a.textContent = `${{ Add: "+", Keep: "=", Remove: "−" }[action]} ${title ? `${title} ${name}` : name}`;
        a.setAttribute("aria-label", `${action}: ${title || "Issue"} ${name}`);
        a.title = `${action} relationship`;
        a.className = `value-badge tone-${{ Add: "success", Keep: "neutral", Remove: "danger" }[action]}`;
        safeLink(a, url);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        item.append(a);
        list.append(item);
      }
      if (entries.length) td.append(list);
      tr.append(th, td);
      article.querySelector("tbody").append(tr);
    }
    // A proposed comment is always visible: it is the public part of an approval.
    const comment = article.querySelector(".comment");
    comment.hidden = !p.comment;
    comment.classList.toggle("removed", !issue.includeComment);
    comment.querySelector("h3").textContent = issue.includeComment
      ? "Proposed comment"
      : "Comment removed - will not be posted";
    comment.querySelector("pre").textContent = p.comment || "";
    const toggle = article.querySelector(".toggle-comment");
    toggle.textContent = issue.includeComment
      ? "Remove comment"
      : "Restore comment";
    toggle.onclick = () =>
      submit(issue.number, "comment", !issue.includeComment);
    article.querySelector(".limits").textContent = issue.limits;
    article.querySelector(".limits").hidden = !issue.limits;
    article.querySelector(".outcome").textContent = issue.outcome?.detail || "";
    article.querySelector(".outcome").hidden = !issue.outcome?.detail;
    article.querySelector(".approve").onclick = () =>
      submit(issue.number, "approve");
    article.querySelector(".skip").onclick = () => submit(issue.number, "skip");
    const instructions = article.querySelector(".instructions");
    const textarea = article.querySelector("textarea");
    instructions.hidden = !issue.instructions && !issue.needsRevision;
    textarea.value = issue.instructions;
    article.querySelector(".instructions-button").onclick = () => {
      instructions.hidden = false;
      textarea.focus();
    };
    textarea.oninput = () => {
      article.querySelector(".approve").disabled = true;
      submit(issue.number, "instructions", textarea.value, false);
    };
    $("#issues").append(article);
    updateStatus(article);
  }
}

async function refresh() {
  if (saving || failed || document.activeElement?.tagName === "TEXTAREA")
    return;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Could not load review");
    const result = await response.json();
    // A user may start typing while the refresh request is in flight.
    if (saving || document.activeElement?.tagName === "TEXTAREA") return;
    if (result.issueTitles) issueTitles = result.issueTitles;
    if (JSON.stringify(state) !== JSON.stringify(result)) {
      state = result;
      render();
    }
    $("#save").textContent = "All changes saved";
    $("#error").hidden = true;
  } catch (error) {
    showError(`${error.message}. Reconnecting…`);
  }
}
for (const id of ["#filter", "#status-filter", "#comment-filter"])
  $(id).onchange = () => {
    if (state) render();
  };
$("#approve-all").onclick = () => {
  const targets = bulkTargets();
  if (!targets.length) return;
  const skipped = targets.filter((issue) => issue.decision === "skipped");
  $("#approve-all-count").textContent =
    `Approve ${targets.length} issue${targets.length === 1 ? "" : "s"} matching the current filters? Each saves the exact proposal shown, including any comment you have not removed.`;
  $("#approve-all-skipped").hidden = !skipped.length;
  $("#approve-all-skipped").textContent =
    `${skipped.length} of them ${skipped.length === 1 ? "is" : "are"} currently skipped and will become approved.`;
  const list = $("#approve-all-list");
  list.replaceChildren();
  for (const issue of targets) {
    const li = document.createElement("li");
    li.textContent = `#${issue.number} · ${issue.title}`;
    list.append(li);
  }
  $("#approve-all-dialog").dataset.numbers = targets
    .map((issue) => issue.number)
    .join(",");
  $("#approve-all-dialog").returnValue = "";
  $("#approve-all-dialog").showModal();
};
$("#approve-all-dialog").onclose = () => {
  const dialog = $("#approve-all-dialog");
  if (dialog.returnValue !== "confirm") return;
  // Approve only what was confirmed and is still shown and approvable now.
  const confirmed = new Set(dialog.dataset.numbers.split(",").map(Number));
  for (const issue of bulkTargets())
    if (confirmed.has(issue.number)) submit(issue.number, "approve");
};
window.addEventListener("beforeunload", (event) => {
  if (saving || failed) {
    event.preventDefault();
    event.returnValue = "";
  }
});
refresh();
setInterval(refresh, 3000);
