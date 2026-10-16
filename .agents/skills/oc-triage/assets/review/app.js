let state;
let queue = Promise.resolve();
let saving = 0;
let failed = false;
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
      showError(
        `${error.message} Your text is still visible; copy it before reloading.`,
      );
    })
    .finally(() => {
      saving -= 1;
      if (!saving && !failed) {
        $("#save").textContent = "All changes saved";
        updateProgress();
        for (const article of document.querySelectorAll("article"))
          updateStatus(article);
      }
    });
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
  $("#issues").replaceChildren();
  const filter = $("#filter").value;
  for (const issue of state.issues) {
    const status = issue.outcome?.status || issue.decision;
    if (filter !== "all" && status !== filter) continue;
    const article = $("#card").content.firstElementChild.cloneNode(true);
    article.dataset.number = issue.number;
    const anchor = article.querySelector(".issue-link");
    anchor.textContent = `#${issue.number} · ${issue.title}`;
    safeLink(anchor, issue.url);
    article.querySelector(".summary-text").textContent =
      issue.summary ||
      "Summary not yet provided. Expand the original issue below for context.";
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
      [
        "Status",
        p.status === "duplicate"
          ? `Close as duplicate of #${p.duplicateOf}`
          : p.status === "keep-open"
            ? "Keep open"
            : `Close as ${p.status.replace("-", " ")}`,
      ],
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
          ? {
              "keep-open": "open",
              completed: "success",
              "not-planned": "warning",
              duplicate: "duplicate",
            }[p.status]
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
          ? {
              "keep-open": "○",
              completed: "✓",
              "not-planned": "⊘",
              duplicate: "↗",
            }[p.status]
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
      for (const text of values.length ? values : ["None"]) {
        const badge = document.createElement("span");
        badge.className = `value-badge tone-${text === "None" ? "neutral" : tone}`;
        const symbol = document.createElement("span");
        symbol.setAttribute("aria-hidden", "true");
        symbol.textContent = text === "None" ? "—" : icon;
        badge.append(symbol, document.createTextNode(` ${text}`));
        td.append(badge);
      }
      tr.append(th, td);
      article.querySelector("tbody").append(tr);
    }
    article
      .querySelector(".comment")
      .classList.toggle("removed", !issue.includeComment);
    article.querySelector(".comment pre").textContent = issue.includeComment
      ? p.comment
      : "No comment will be posted.";
    const toggle = article.querySelector(".toggle-comment");
    toggle.textContent = issue.includeComment
      ? "Remove comment"
      : "Restore comment";
    toggle.onclick = () =>
      submit(issue.number, "comment", !issue.includeComment);
    article.querySelector(".limits").textContent = issue.limits;
    article.querySelector(".outcome").textContent = issue.outcome?.detail || "";
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
$("#filter").onchange = () => {
  if (state) render();
};
window.addEventListener("beforeunload", (event) => {
  if (saving || failed) {
    event.preventDefault();
    event.returnValue = "";
  }
});
refresh();
setInterval(refresh, 3000);
