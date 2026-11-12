---
name: oc-performance-improve
description: "Make one domain of an Open Collective service faster: reproduce at production scale, find the cause, ship measured fixes as independent PRs. Usage: /oc-performance-improve <domain>"
disable-model-invocation: true
---

# Improve the performance of a domain

The argument is a **domain**: a feature area in the operator's words ("expense security checks", "host dashboard search"), optionally with a service. You make it measurably faster and prove the gain with numbers taken before and after, on the same data, through the same entry point users go through.

Three words carry the method:

- **Lab**: a private copy of the service and its data at production scale, where slow paths are slow for the same reason as in production.
- **Baseline**: the timing of an unchanged `main` in the lab. A change counts only against a baseline.
- **Parity**: the fix returns exactly what the old code returned. A faster wrong answer is a bug.

Work in worktrees per the root `AGENTS.md` and read the service's `AGENTS.md` first. Per-service know-how lives in `references/<service>.md`; read the one for your service before step 2:

- `opencollective-api`: [references/api.md](references/api.md) (lab setup, GraphQL to SQL, Postgres techniques and traps)
- Any other service (frontend included): no reference yet. Follow the same steps with that service's own tools, and at the end propose a `references/<service>.md` from what you learned.

## 1. Scope the domain

Resolve the domain to one service and a list of **entry points**: the GraphQL operations, pages, endpoints or jobs a user or cron actually triggers. Find them from the code (resolvers, the frontend queries that call them) and from evidence that they are slow: the issue the operator links, Sentry traces and slow spans when a Sentry tool is available, production logs the operator pastes. Record for each entry point where the evidence comes from; code that only looks expensive is a suspicion, listed as such.

When a domain spans services, pick the one where the time is spent. A slow page is usually a slow API operation; take the frontend's real query documents as the entry points.

Done when you have a short table of entry points, each with its evidence or marked "suspected".

## 2. Build the lab and take the baseline

Build the lab from the service's reference. The data decides everything that follows:

- **Scale** it to the largest real tenant for this domain (ask the operator for row counts if the issue has none). The dev database is thousands of rows; plans at that size say nothing.
- **Shape** it like production: skewed distributions (a few huge accounts, a long tail), varied values in every column the queries filter or sort on, and rows in every table the entry points read. Uniform or constant columns produce planner behaviour that exists only in your lab.
- **Plant** inputs across the selectivity range (a rare, a medium, a common and a near-universal value) so you see where a fix helps and where it hurts.

Run unchanged `main` against the lab and time every entry point through its real interface, several runs each, with the exact request the client sends.

Done when every entry point has a baseline number, or is recorded as "not reproduced" with the data it would need. An entry point that is fast in the lab and slow in production means the lab is missing something: say which tables are empty, and carry it into the report as open.

## 3. Find the cause

For each slow entry point, go from the request to the work it causes (SQL statements, external calls, loops) and name the cause in one sentence backed by one piece of evidence: a plan node, a row count, a call count. "No index leads on X: 11M rows removed by filter" is a cause. "The query is complex" is a symptom; keep digging.

Prototype the fix at the lowest level that shows the gain (raw SQL, a script) before touching application code, and check parity there too: same IDs, same order, same counts as the original, across the planted inputs. Record the prototypes that lost, with their numbers; they belong in the report.

Done when each slow entry point has a cause, a prototype with a measured gain and a parity check, or an explicit "cause not found".

## 4. Report and wait

Show the operator, in chat:

- the baseline table;
- per entry point: cause, proposed fix, measured prototype gain, what it costs (index size and build time, added code, behaviour change), and the inputs it leaves slow or makes slower;
- the fixes ranked by gain for cost, and how you would split them into PRs;
- what the lab could not reproduce.

Then stop. The operator chooses what gets implemented.

## 5. Implement as independent PRs

One cause per PR, each on its own branch from `origin/main`, each mergeable and deployable alone. Schema-only changes (an index, statistics) are their own PR: they are the safest to ship first and the easiest to revert. When a client change depends on a server change, they are two PRs and the body states the deploy order.

Each PR carries:

- a **parity test**: the optimized path and the original path run on the same fixtures and must return the same rows. When the fix has a fallback (a cap, a threshold), test both sides of it;
- for migrations, a comment in the migration answering what a reviewer will ask: is it online, what does it lock and for how long, what happens if it is interrupted or re-run, and why any unusual SQL is written the way it is.

## 6. Measure through the real interface

Run `main` and the branch side by side against the same lab database, on two ports. For each entry point and each planted input, record the timing of both and a signature of the result (count plus a hash of the returned IDs). Signatures must match.

Before the baseline run, remove everything prototypes left in the lab (indexes, statistics, tables), or the baseline is already faster than `main`.

Done when every claimed gain has a before and an after measured this way. A gain seen only in a raw prototype is reported as "prototype only".

## 7. Open the PRs

Write each body with the `pr` skill. The evidence section holds:

- one sentence on the lab data and its scale;
- a before/after table per entry point and input, with result counts;
- the parity statement;
- for schema changes, build time and size on the lab;
- the inputs that did not improve or got slower, stated plainly;
- a caveat that the lab is one idle machine with everything in memory, so production numbers are worse in absolute terms.

Add merge and deploy order when PRs depend on each other. Then run `oc-maintain-prs` on them.

Finish by telling the operator what remains: entry points not reproduced, causes not found, lab containers and servers still running (with the commands to stop them), and anything a production trace should confirm after deploy.
