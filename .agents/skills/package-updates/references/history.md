# Why the rules exist

One bullet per rule: the rule, then the incident that produced it. Read when a rule looks arbitrary;
the rule itself lives in SKILL.md or the reference named.

- **One owner per PR (claims)** → a rebase under a fixer's feet raced its push (contributors-svg #119).
- **Reviewer reports stay short** → five full reviewer reports cost about 600K cache-read tokens in
  the 2026-11-22 session, re-read on every orchestrator turn.
- **Green only from a completed wait on the current head** → api #12399 was reported green while its
  attempt 2 had failed; `merge.sh` caught it.
- **STUCK check runs are rerun, never waited out** → GraphQL Inspector left its check run in progress
  after the workflow finished (api #12611).
- **`allowScripts` entries move with the package** (reviews.md) → missed on Cypress 16 (frontend
  #12485, fixed by #12520): npm 11 ignores the list, so nothing failed locally.
- **Check bot coverage on the head** (reviews.md) → after the force-push of api #12339 (the user's own
  branch) neither bot reviewed the new head; CodeRabbit skips bot PRs with a "skip review" comment
  (api #12414).
- **No local `codex review` for a manifest-only diff on a repo without bot reviewer, but a major
  still states each breaking change** → contributors-svg #139, p-queue 10.
- **Sentry threads count as findings** → missing the `sentry` login hid an open thread on api #12316
  (2026-10-14).
- **Compare Dependabot security PRs with main's lockfile** (security-alerts.md) → pdf had 11 such PRs
  already satisfied on main on 2026-10-02.
- **`Unblocked:` comment when a blocker clears** → rest #731: "rest no longer depends on
  `graphql-request`, #801 removed it"; without it the old "Blocked by" comment still read as current.
- **`major` label for critical majors** → api #11701 (stripe v22) was the first one.
- **Closed updates live on the Dependency Dashboard** (renovate.md) → api #6506 is api's dashboard.
- **Re-check a Renovate branch once CI started after a push** (renovate.md) → contributors-svg #119,
  2026-10-05: a Renovate run in progress force-pushed over the new commit a minute later.
- **Move the commit onto an identical-tree head** (renovate.md) → pdf #1296, 2026-10-02: Renovate
  pushed a new head with the same tree right after a rebase request.
- **Never push a relative ref at the end of a chain** (renovate.md) → one failed step earlier (a bad
  flag, a conflict) silently changed what `HEAD~1` pointed at.
- **Never truncate mutating script output** → `head`/`tail` on a batch can kill it early or hide an
  error.
- **Workflow-file siblings merge one at a time** (renovate.md) → 2026-09-30: api #12217 merged,
  #12218 refused for the workflow scope; images #718 merged; all without the scope.
- **`npm ci --ignore-scripts` in scratch worktrees** (hosts.md) → husky 9's `prepare` wrote
  `core.hooksPath` into the shared git config and disabled the user's hooks.
- **Never pick another Codex model** (reviews.md) → other models can cost much more; the user names
  the fallback.
