---
name: oc-engineering-board
description: Maintain the Open Collective Engineering Board (GitHub org project 21) - fill in Engineering Area, Status and Start/Target dates, add or create issues for engineering work.
---

# Open Collective Engineering Board

The board is https://github.com/orgs/opencollective/projects/21, a **public** record of what the engineering team works on and ships, read mainly by fiscal hosts. Its README (`gh project view 21 --owner opencollective`) is the source of truth for what each Status and Engineering Area means; read it each run. Do what the operator asks: a sweep of incomplete items, a few named issues, or recording new work.

Use `gh`. Board writes need the `project` token scope; if a call is refused for scope, ask the operator to run `! gh auth refresh -s project`.

## Read the board

```bash
gh project view 21 --owner opencollective --format json        # README, project id
gh project field-list 21 --owner opencollective --format json  # field ids, Status option ids
gh project item-list 21 --owner opencollective --limit 500 --format json \
  | jq '.items[] | del(.content.body)'
```

Fields that matter (re-read ids each run; they are stable but authoritative only live):

- **Status**: `Later`, `Next`, `In progress`, `Ongoing`, `Done`.
- **Type**: the GitHub issue type (`Task`, `Bug`, `Enhancement`, `Discussion`, `Support`). Every item gets one. Read ids with `organization(login:"opencollective"){issueTypes(first:30){nodes{id name}}}` and set with `updateIssue(input:{id:<issue node id>,issueTypeId:<type id>})`.
- **Engineering Area**: single select, one area per item. It is an **organization issue field**, not a project field: the project field shows no options, and `gh project item-edit` cannot set it. Read options with `organization(login:"opencollective"){issueFields(first:30){nodes{... on IssueFieldSingleSelect{id name options{id name}} ... on IssueFieldDate{id name}}}}`. If they differ from the README's area list, tell the operator rather than editing the org field.
- **Start date** and **Target date**: also organization issue fields (`IssueFieldDate`). Target date is the board's end date.

Set issue fields on the issue itself, all in one call:

```bash
gh api graphql -f id=<issue node id> -f query='mutation($id:ID!){setIssueFieldValue(input:{issueId:$id,issueFields:[
  {fieldId:"<area field id>",singleSelectOptionId:"<option id>"},
  {fieldId:"<start field id>",dateValue:"2026-09-04"},{fieldId:"<target field id>",dateValue:"2026-10-05"}]}){clientMutationId}}'
```

Read them back with `issue{issueFieldValues(first:10){nodes{... on IssueFieldDateValue{field{... on IssueFieldDate{name}} value} ... on IssueFieldSingleSelectValue{field{... on IssueFieldSingleSelect{name}} name}}}}`. Only Status is set with `gh project item-edit`.

A sweep targets items missing Type, Area, Status, or dates, plus items whose Status disagrees with the issue state (closed but not `Done`, `Done` but open). The Board and Timeline views filter `no:parent-issue`: parent issues are the visible cards, so their fields matter most; fill sub-issues too.

## Infer each field

Gather evidence per issue with one query. Sub-issues, cross-referenced PRs, connected PRs, and closing PRs all count as linked work:

```bash
gh api graphql -F o=opencollective -F r=opencollective -F n=<number> -f query='
query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){
  title state stateReason createdAt closedAt labels(first:30){nodes{name}}
  parent{url}
  subIssues(first:100){nodes{url state createdAt closedAt}}
  closedByPullRequestsReferences(first:50,includeClosedPrs:true){nodes{url createdAt mergedAt state}}
  timelineItems(first:200,itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT]){nodes{
    ... on CrossReferencedEvent{source{... on PullRequest{url createdAt mergedAt state}}}
    ... on ConnectedEvent{subject{... on PullRequest{url createdAt mergedAt state}}}}}}}}'
```

**Start date**: the creation date of the earliest PR that does the issue's work. Skip PRs that only mention the issue in passing (a "see also", a revert of unrelated work). No PR yet: use the date the issue moved to In progress if known, otherwise leave it empty and say so. Planning-only issues (decisions, specs, investigations) start when the discussion or first planning commit began.

**Target date**: the issue's `closedAt` when it was closed as completed. The board publishes no planned dates, so leave Target date empty for open items, and for `not planned` closures propose removing the item rather than dating it. Watch for **retroactive issues**: an issue opened after its PRs merged and closed minutes later records already-shipped work, so `closedAt` is the bookkeeping date. Use the last relevant PR's `mergedAt` instead.

**Parent issues**: Start date is the earliest start among the parent's own PRs and its sub-issues; Target date is the last sub-issue completion, set only once the parent is closed.

**Status**: closed as completed → `Done`. Open with an open or merged PR, or active sub-issues → `In progress`. Continuous work with no end (security report handling, support escalations) → `Ongoing`. Open and untouched → `Later`, or `Next` only when the operator says it is next. Keep an existing human-set `Next` or `Later`; propose changing it only on evidence such as a newly opened PR.

**Type**: `Bug` when the work fixes broken behavior; `Enhancement` for new or improved functionality that users see; `Task` for removals, migrations, maintenance, cleanup, tests and CI, monitoring, internal tooling, compliance work and security reports or fixes. A parent grouping mostly fixes is `Bug`. Keep a type already set by a human.

**Engineering Area**: pick the README area that best describes why the work exists, not which service it touches. Labels guide the choice (`security` → Security; `test` → Testing & CI; `developer experience` → Developer experience; `technical-debt` → Technical debt; provider labels such as `stripe`, `paypal`, `wise` → Payment processors). Sub-issues usually share the parent's area. When two areas fit equally, ask.

Dates are best guesses: state the evidence (PR link and date) behind each one so the operator can correct it.

## Security work

Issues from the private `opencollective/opencollective-security` repository may sit on the board; their contents are redacted for the public. Never put vulnerability details into a public issue, card title, or comment. The README states the public convention: security work appears as **Security fix** cards added once the fix is deployed, plus an ongoing **Security report handling** card. When asked to record a security fix publicly, create the generic card after deployment and keep details in the private repository.

## Add or create items

New issues go to `opencollective/opencollective`, never to a service repository:

```bash
gh issue create --repo opencollective/opencollective --title '...' --body-file <file>
gh api graphql -f id=<issue node id> -f t=<type id> -f query='mutation($id:ID!,$t:ID!){updateIssue(input:{id:$id,issueTypeId:$t}){issue{issueType{name}}}}'
gh project item-add 21 --owner opencollective --url <issue-url>
```

Search existing issues first (`gh issue list --repo opencollective/opencollective --search '...' --state all`) to avoid duplicates; link an existing issue instead when one covers the work. Keep titles user-visible and plain: the board is read by fiscal hosts. To group work, create a parent issue and attach children with `gh api graphql` `addSubIssue`. An issue has one parent, so `addSubIssue` would pull an issue out of the internal planning parent it already has (such as a `[Project] ...` cycle issue). Attach only issues with no parent, and list the others in the new card's body.

When grouping someone's work into bigger units, cluster their merged and open PRs by theme. Propose a card only when the theme took real time, either one large PR or many related ones, and leave one-off small fixes out. Work removing an unused feature goes under **Unused features removed, with notice** (#8987) as a sub-issue. When the PRs merged before the issue existed, create it, close it as completed, and date it from the PRs.

## Preview, then apply

Before any write, show the operator one table per batch: item link, current → proposed value for each changed field, and the evidence behind each date. Mark unchanged fields as unchanged and uncertain guesses as uncertain. Wait for approval; approval of a table covers exactly that table. Creating issues and removing items always need explicit approval, even inside a broader "go ahead".

Apply Status with `gh project item-edit` (item `id` from `item-list`, project id from `project view`), and Area and dates with `setIssueFieldValue` (above; `{fieldId:...,delete:true}` clears one):

```bash
gh project item-edit --project-id <PVT_id> --id <PVTI_id> --field-id <field_id> --single-select-option-id <option_id>
gh project item-edit --project-id <PVT_id> --id <PVTI_id> --field-id <field_id> --clear
```

Re-read the edited items after writing and report the final values, with any failures and what remains unfilled.

## Learning

When the operator corrects an inference (an area choice, a date rule, a status convention), and the correction is a general rule rather than a one-off, update this skill in place: edit the relevant section, keep it narrow, and mention the change in the final report.
