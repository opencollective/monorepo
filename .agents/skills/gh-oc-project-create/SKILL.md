---
name: gh-oc-project-create
description: Creates and documents Open Collective core-team project issues on opencollective/opencollective via GitHub MCP—main `[Project]` issue with milestone and org project 5, plus linked sub-issues with types and optional area/complexity labels. Use when the user invokes /gh-oc-project-create, asks to file an OC project issue, or wants project issues with sub-issues on the OpenCollective GitHub repo.
---

# OpenCollective project issue creation (GitHub MCP)

## Hard prerequisite

1. Confirm the **GitHub MCP server is enabled** for this workspace.
2. If **no GitHub MCP** (no GitHub server, no tools): **stop immediately**. Tell the user the GitHub MCP must be enabled. **Do not** use the `gh` CLI, raw REST/GraphQL from the terminal, browser automation, or other substitutes.

Before **any** GitHub MCP call: **read the tool schema** for that tool (parameters, required fields, naming). Tool names differ by MCP implementation; always map this workflow to the actual tools available.

## Repository and routing

| Item             | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Repository       | `opencollective/opencollective`                                                                 |
| Base URL         | `https://github.com/opencollective/opencollective`                                              |
| Main issue label | `project`                                                                                       |
| Org project      | `https://github.com/orgs/opencollective/projects/5` (Open Collective org, **project number 5**) |

## Inputs to collect (ask if missing)

- **Project name** (used in title after `[Project]`).
- **Milestone** — usually a cycle token like `Y26C3`. **If not provided, ask** which milestone to use; resolve it to the repo milestone the GitHub MCP expects (often by **title**).
- **Overview**, **boundaries**, and **desired outcomes** (raw notes are fine).
- For **each sub-issue**: title, body (implementation-focused), **type** (`Enhancement`, `Task`, or `Bug`), and **optional labels** from the allowed set below.

Ask follow-up questions whenever scope, ownership, or breakdown is unclear.

## Main (parent) issue

### Title

`[Project] Project name`  
(keep `project name` is concise)

### Body

Use the repo template as a starting point:

`https://raw.githubusercontent.com/opencollective/opencollective/refs/heads/main/.github/ISSUE_TEMPLATE/project.md`

Omit or shrink template sections that do not apply; keep the doc skimmable.

### Metadata (main issue)

- **Labels:** include `project`.
- **Milestone:** set per user (after confirming which milestone if omitted).
- **Project:** add the issue to **org project 5** (`opencollective` org) using the GitHub MCP’s project APIs (see tool schemas for the correct project identifier format—numeric ID, node ID, etc.).

Create the **main issue first** and record its number or URL; sub-issues depend on it.

## Sub-issues

When the user asks for sub-issues (or when breaking work down from desired outcomes):

1. Create **one issue per actionable item**. Bodies should be **implementation-oriented** and may **differ slightly** from the parent’s desired outcomes (splitting work, ordering, technical tasks).
2. **Link each as a sub-issue of the main project issue** using whatever parent/child or sub-issue relationship the GitHub MCP exposes—follow the MCP tool docs exactly.
3. Set **issue type** on each sub-issue to one of: **Enhancement**, **Task**, **Bug** (use the MCP’s mechanism for GitHub issue types).
4. **Optional labels** — only from this list, when relevant:
   - `frontend`
   - `api`
   - `pdf`
   - `complexity → complex`
   - `complexity → simple`
   - `complexity → minimal`
   - `complexity → medium`

   Do not invent new labels unless the user explicitly asks and understands they must exist on the repo.

5. Sub-issues typically **do not** need the `project` label unless the user requests it; the parent carries the project umbrella.
6. Sub-issues are usually titled as: "Project name: Sub-issue title". Example: "PDF export reliability: Add streaming support for large datasets".
7. We usually don't use analytics or tracking in our UIs. Unless the user explicitly asks for it, do not mention these.

## Workflow summary

1. Verify GitHub MCP → if absent, **stop**.
2. Read relevant MCP tool schemas (create issue, update issue, milestones, labels, org project, sub-issue/parent linking, issue types).
3. Gather project name, milestone (ask if missing), overview, boundaries, outcomes, and sub-issue plan.
4. Create **main** issue: title, body from template, `project` label, milestone, add to **project 5**.
5. Create **sub-issues** with types and optional labels; **link each to the main issue** as sub-issues.
6. Reply with links to the main issue and all sub-issues; briefly map sub-issues to outcomes if helpful.

## Examples

**Main title:** `[Project] PDF export reliability`

**Main Desired Outcomes (short):**

- Users can export host reports without timeouts.
- Errors surface actionable messages.

**Sub-issues (illustrative):** a Task to profile the export path, an Enhancement for streaming responses, a Bug for a specific 500 on large datasets—each with type and labels like `api` and `complexity → medium`.
