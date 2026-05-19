---
name: generate-pitch
description: Drafts a product/engineering pitch from raw notes, GitHub issues, and Slack threads using the Open Collective pitch template. Use when the user invokes /generate-pitch, asks for a pitch, project brief, or scoping doc from discussion artifacts.
---

# Generate pitch

Produce a single pitch document from user-supplied context. Read this skill fully before writing the pitch.

## Inputs

The user may provide any combination of:

- **Raw text** — notes, meeting summaries, specs, bullet lists
- **GitHub issues** — URLs, issue numbers, or pasted issue bodies/comments
- **Slack threads** — pasted conversation exports (with or without timestamps)

If GitHub issue URLs or numbers are given and content is missing, fetch issue bodies and relevant comments via GitHub MCP (preferred) or `gh issue view` when available. Do not invent issue content.

If critical context is missing (goal, primary user, or what "done" looks like), ask **one** short round of clarifying questions before drafting. Prefer inferring from context when reasonable; mark uncertainty in the draft only when it would mislead.

## Workflow

1. **Ingest** — Read all provided material. Note actors (e.g. fiscal host admin, collective admin, contributor), pain points, explicit requests, decisions, deferred items, and technical hints.
2. **Synthesize** — Map findings to template sections (see mapping below). Merge duplicates; keep user-voice quotes in **Friction** when they clarify the problem.
3. **Draft** — Fill the pitch template verbatim (structure and headings). Use clear, scannable bullets; avoid implementation detail in **Desired outcomes** (capabilities, not tables/APIs).
4. **Review** — Run the checklist at the end before returning the pitch.

## Section mapping

| Section | Source signals |
| -------- | ---------------- |
| **Title** | Project name or main theme from issues/threads; concise, outcome-oriented |
| **Purpose** | One or two sentences: why this work exists now |
| **Github issue** | Link if provided or fetched; otherwise `N/A` or omit line only if user said there is none |
| **Friction** | Problems, complaints, workarounds; use `>` blockquotes for first-person user statements when available |
| **Desired outcomes** | Observable results for users/stakeholders; bullet list starting with who benefits |
| **Boundaries** | Explicit out-of-scope, "not in v1", related work deferred elsewhere |
| **Traps** | Dependencies, regressions, data migration, permissions, cross-feature coupling, policy/compliance |
| **Solution** | Concrete implementation direction (data model, UI, jobs, integrations) aligned with discussion; not a full spec |

**Tone:** Plain language, complete sentences. No em dashes (use hyphens). Match Open Collective vocabulary from `AGENTS.md` when relevant (Account/Collective, Orders/Contributions, fiscal host).

## Output

Return **only** the filled pitch as markdown, using this template exactly:

```markdown
# Title

Purpose: A short description of what we're trying to achieve
Github issue: Link to the corresponding Github issue (if any)

## Friction

What's the problem(s) we're trying to address. Example:
> I am an admin of a host organization and I would like to be able to track on a monthly basis collective churn.
> I am an admin of a host organization and I would like to get a brief overview of collective activity.

## Desired outcomes

- Fiscal host admins can do X
- Users receive an email when Y
- ...etc

## Boundaries

What is related, but that we should NOT be included in this project.

## Traps

Traps to be aware about. Example: "Feature X depends on this data too. We should make sure we don't break existing functionality in the process".

## Solution

What we're going to implement to solve this. Example:
- Add a new table to store data for X
- Add a new interface to let users manage Y
```

Replace placeholder examples with content derived from inputs. Remove instructional "Example:" lines and generic placeholder bullets unless they remain accurate. Keep **Friction** example blockquotes only when no real user quotes exist and paraphrased quotes would help.

## Parsing tips

**GitHub issues:** Title often suggests **Title**; description → **Friction** / **Purpose**; labels and comments → **Boundaries**, **Traps**, **Solution**.

**Slack:** Distinguish decisions vs brainstorming; prefer agreed direction for **Solution** and open questions for **Traps** or clarifying questions.

**Conflicts:** When sources disagree, prefer the latest explicit decision; note the conflict briefly under **Traps** if it affects scope.

## Checklist before delivery

- [ ] Every template heading is present (`# Title` through `## Solution`)
- [ ] **Purpose** states the goal in one or two sentences
- [ ] **Friction** describes problems, not solutions
- [ ] **Desired outcomes** are testable capabilities, not implementation tasks
- [ ] **Boundaries** name related work explicitly excluded
- [ ] **Traps** include at least one concrete risk when inputs mention dependencies or existing features
- [ ] **Solution** matches **Desired outcomes** and does not expand past **Boundaries**
- [ ] No fabricated links, quotes, or requirements

## After the pitch

Do not create GitHub issues or project tickets unless the user asks separately (e.g. `gh-oc-project-create`).
