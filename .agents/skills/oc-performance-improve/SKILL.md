---
name: oc-performance-improve
description: Make one domain of an Open Collective service faster - reproduce the slowness on production-scale data, find the cause by measurement, then ship one PR per fix with before/after timings. Use for "/oc-performance-improve <domain>", a slow page, query or endpoint, or a performance issue to investigate.
argument-hint: <domain, slow page or issue>
---

# Improve performance

You make one domain faster and prove it. The domain is the argument: a feature ("expense security checks"), a page, an endpoint or an issue. Every number you report is a timing you took yourself, on production-scale data, through the real entry point, and a fix ships only with its before and after.

The steps are the same for every service. Tips for a layer live in `references/`; so far only the API and SQL have a file: read [references/api-sql.md](references/api-sql.md) once the slow part is in `opencollective-api` or in a query. For any other layer (frontend rendering, PDF, images), run the same steps with that layer's own measuring tools.

Production is read-only evidence. Measuring and changing happen on this machine.

## 1. Scope

Resolve the domain to its **entry points**: what a user or a job actually triggers (a GraphQL operation, a page load, a REST route, a cron script), each with the code beneath it and the service it lives in. Read that service's `AGENTS.md`. In an issue, every reported symptom is an entry point of its own.

For each one, name its **heaviest caller**: the host, account or input for which it does the most work.

Done when every entry point has its trigger, its code location and its heaviest caller.

## 2. Collect production evidence

Look at what production already measured before building anything: Sentry traces and spans for the entry points (when Sentry tools are available), numbers in the issue, what the operator knows. Keep durations, the accounts affected and the span that owns the time. This tells you what data to build in step 3, and it is the only check on what local data fails to reproduce.

Done when each entry point has a production number or the note "no production evidence".

## 3. Build the loop

The **loop** is one command that drives a real entry point on production-scale data and prints how long it took. Every later step consumes it.

- **Production-scale data** sized to the heaviest caller, in a database of your own. Slowness lives in the largest tenant; the default dev data shows none of it. Fill every table the entry point reads.
- **The real entry point**: the operation as the client sends it, same query and same variables, over HTTP. The slow part is often a sibling of the one you suspected, such as the total count beside the list.
- **An input matrix** per entry point: no filter, a rare value, a common value, a very broad value, no match, a deep page.

Run every cell on unmodified `main`, twice, and keep the second timing. That table is the **baseline**.

Done when the baseline covers every entry point, and each symptom from step 1 is either reproduced or marked "not reproduced locally" with what the local data lacks. Only reproduced symptoms go on to step 4; the others go to the report with the production evidence that would settle them.

## 4. Diagnose

Split each slow cell into its parts (each SQL statement, resolver, request, render) and time them separately until one part owns the time. The cause is a mechanism the measurement shows, stated with its number: a plan node that filters 1.4M rows to return 20, a row estimate of 60 for 5,322 rows.

Done when every slow cell has a cause with its measurement, or is marked unexplained.

## 5. Prototype the fixes

Try each fix by hand in the loop before writing production code (create the index, run the rewritten query), then run the whole matrix again: a fix for the rare value can slow the broad one. Take the lowest rung that reaches the target:

1. an index or planner statistics: results and code paths stay the same
2. a rewrite that returns identical results
3. a contract change: a capped count, a lazy field, a smaller page
4. a product change: defer or drop something

Then check that the gain survives realistic data, since generated data flatters some fixes (see the reference for the layer).

Show the operator one row per fix: cause, timing per cell before and after, risk, and what stays slow. Go on to step 6 when the request already asked for the fixes; otherwise the operator picks.

## 6. Ship one PR per fix

Each fix is its own PR, mergeable and worth merging alone. The root `AGENTS.md` covers worktrees, commits, quality scripts and `oc-maintain-prs`. For every PR:

- **Alone**: measure it without the other fixes applied. Every cell is at least as fast as the baseline.
- **Same results**: a test runs the old and the new path on the same fixtures and compares them, and the loop compares the answers of `main` and the branch (ids and totals) across the matrix.
- **Fallback**: where the new path loses, typically on broad inputs, keep the old path behind a measured threshold.
- **Through the entry point**: the PR's numbers come from the loop against the branch's running service, never from the hand-run prototype.

The PR's evidence is the baseline and the new timing for each cell, plus what the change costs: index size and build time, how long a migration runs and what it locks, any behavior that differs.

Done when each approved fix has a green PR carrying its numbers.

## 7. Report

One table: entry point, input, baseline, after, PR. Then what is still slow and why, what was not reproduced and the evidence that would settle it, and what you left running (database container, servers) with the command that removes each.
