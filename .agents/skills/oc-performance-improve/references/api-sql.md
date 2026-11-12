# API and SQL

Tips for the steps of [SKILL.md](../SKILL.md) when the slow part is in `opencollective-api` or in Postgres. They come from opencollective/opencollective#8947 (slow host dashboard searches, 2026-11); extend this file when a run teaches something new.

## Heavy database (step 3)

Give yourself a Postgres container on its own port. The dev database on `postgres:5432` and `opencollective_test` are shared with other agents and worktrees, and a heavy load or a prototype index there changes their results.

```bash
docker ps -a --filter name=perf-     # reuse a heavy database that already exists
docker run -d --name perf-<slug>-postgres -p 5434:5432 -e POSTGRES_HOST_AUTH_METHOD=trust --shm-size=2g postgres:16 \
  postgres -c shared_buffers=2GB -c work_mem=16MB -c maintenance_work_mem=1GB -c max_wal_size=8GB \
  -c random_page_cost=1.1 -c effective_cache_size=8GB -c log_min_duration_statement=100 -c 'log_line_prefix=%m [%p] '

# from the API checkout: dev dump, then migrations
PGPORT=5434 ./scripts/db_restore.sh -d opencollective_dvl -h localhost
PG_URL=postgres://opencollective@localhost:5434/opencollective_dvl npm run db:migrate
```

Then generate the data. [assets/heavy-data.example.sql](../assets/heavy-data.example.sql) is a worked example for contributions and transactions on one host; copy its pattern for your tables. What makes generated data trustworthy:

- **Volumes of the heaviest caller.** The example gives Open Source Collective 5,500 hosted accounts, 1.5M contributions and 11.5M transactions. Take real volumes from the operator or the issue when you can.
- **Other tenants too**, so the heavy one is a share of each table as in production (about 60% of transactions in the example).
- **Skew**: a power law (`power(random(), 2)`) for who owns the rows, so a few accounts are huge and most are small.
- **Distinct values wherever production has them**: timestamps, amounts, names. A constant shared by thousands of generated rows becomes a "most common value" the planner exploits (see [Checking a fix](#checking-a-fix-steps-5-and-6)).
- **Needles**: plant a rare value (a name on 30 rows) beside common ones, so the input matrix has both ends.
- **Every table the entry point reads.** In the 2026-11 run the account detail panel was fast locally because no expenses, activities or members were generated, and its production slowness stayed unverified.
- After loading: restore indexes, `VACUUM ANALYZE`, and refresh the materialized views the entry point reads (`\dm`).

For Mocha, restore a second database in the same container and point tests at it:

```bash
PGPORT=5434 ./scripts/db_restore.sh -d opencollective_test -h localhost
NODE_ENV=test TZ=UTC PG_URL=postgres://opencollective@localhost:5434/opencollective_test npx mocha <file>
```

## The loop (step 3)

- **Two APIs on the same heavy database**: the `main` checkout on one port for the baseline, your worktree on another. From each: `PORT=<port> PG_URL=postgres://opencollective@localhost:5434/opencollective_dvl npx babel-node --extensions .js,.ts server/index.ts`.
- **Restart the worktree's API after every code change or branch switch.** It runs without a file watcher, and a stale process reports the old timings with no error. Before trusting a cell, check that the two ports differ where you expect them to.
- **Start and stop servers from script files.** A `pkill -f <pattern>` or `pgrep -f <pattern>` typed inline matches your own shell, because the pattern is in its command line.
- **Token**: `PG_URL=... npm run -s script scripts/generate-jwt.ts id <UserId>` signs one locally for an admin of the heavy account. Keep it in a file outside the repos. (`scripts/generate-token-from-slug.sh` at the monorepo root reaches production: leave it to the operator.)
- **The operation**: [scripts/extract-operation.js](../scripts/extract-operation.js) prints a dashboard query from the frontend's generated types, so you send what the browser sends. Take the variables from the component that runs it.
- **Run it**: [scripts/gql.sh](../scripts/gql.sh) prints the HTTP status and the seconds, and saves the response. Name every operation: the dev API answers a slow anonymous operation with a validation `TypeError`.
- **Compare two APIs**: for each input, hash `totalCount` plus the returned ids from both ports (`jq -c '[.totalCount, [.nodes[].legacyId]]' | md5sum`). Equal hashes and two timings per cell are both the parity check and the evidence table.

## Finding the slow statement (step 4)

One GraphQL field usually runs several statements: the page, the total count, tab counters, loaders. List them all with their durations before choosing one:

```bash
docker logs --since <time before the request> perf-<slug>-postgres 2>&1 | grep 'LOG:  duration'
docker logs --since <time> perf-<slug>-postgres 2>&1 | grep -A1 '\[<pid>\] LOG:  duration: <ms>' > slow.log
python3 -I scripts/pg-log-to-sql.py slow.log > slow.sql      # inlines the $1, $2 parameters
(echo 'EXPLAIN (ANALYZE, BUFFERS)'; cat slow.sql) | psql postgres://opencollective@localhost:5434/opencollective_dvl
```

In the plan, read three things: which node owns the time, `Rows Removed by Filter`, and estimated against actual rows on every node.

## Plan patterns

| What the plan shows | Cause | Fix that worked |
| --- | --- | --- |
| A join of the tenant's whole table, then a filter removing millions of rows | One `OR` of `ILIKE`s across columns of several joined tables: no index can serve it | **Search arms**: resolve the matching account ids first, then one single-table subquery per searched column, `UNION`ed, used as `id IN (...)`. Contributions search 5.0 s to 0.18 s |
| Estimated rows far below actual (60 for 5,322), then a nested loop run thousands of times | Correlated predicates (`"HostCollectiveId" = x AND "approvedAt" IS NOT NULL`): the planner multiplies their selectivities | Extended statistics: `CREATE STATISTICS ... (mcv) ON "HostCollectiveId", (("approvedAt" IS NOT NULL) IS TRUE)`, and the same expression in the query. First page 3.1 s to 0.014 s |
| Statistics on an expression exist, the estimate does not move | The query spells the condition differently. A bare `x IS NOT NULL` is never matched to expression statistics | Write the query with the statistics' exact expression |
| A partial index exists, the plan scans the table | The query does not repeat the index's `WHERE` predicate, so the planner cannot prove it applies | Add the predicate to the query, verbatim |
| The small set of matches is computed, but the plan still walks the big table and probes it | Planner prefers the tenant's index order | `WITH matches AS MATERIALIZED (...)` |
| The list is fast, `count(*)` over every match takes seconds | Counting is proportional to matches, whatever the page size | Capped count: `SELECT count(*) FROM (<query> LIMIT <max + 1>) t`, an optional `maxTotalCount` argument, and "500+" in the UI |
| An index on the tenant is walked in sort order with most rows filtered out | No index has tenant, filter column and sort column together | Btree on `(tenant, filter, sort DESC) WHERE "deletedAt" IS NULL`. Recent transactions per account 1.7-4.8 s to 0.01-0.06 s |
| `ILIKE '%term%'` scans the table | No trigram index on the column | `GIN (<column> gin_trgm_ops)`. It helps selective terms; a term found in most rows stays slow, so pair it with a fallback |

Two more lessons from the search arms:

- **Count instead of trusting an estimate** when code branches on a size. The planner estimated 1.47M rows for a subquery that returned none. `SELECT count(*) FROM (<arm> LIMIT <max + 1>) t` is exact up to the threshold and cheap.
- **A deterministic shape beats a clever one.** A single-table `OR` over pre-resolved ids was sometimes fast and sometimes walked the tenant's index; `UNION` arms in a materialized CTE gave the same plan every time.

## Checking a fix (steps 5 and 6)

- **Rule out a data artifact.** For any gain from statistics or from a plan change, find the generated columns with few or repeated values, randomize them, `ANALYZE`, and measure again. Plain multi-column statistics on `("HostCollectiveId", "approvedAt")` looked like a fix only because 1,500 generated accounts shared one `approvedAt`; with distinct dates the estimate was back to 84 rows.
- **Prefix prototypes with `perf_`** (indexes, statistics) so `\di perf_*` finds them all. The heavy database accumulates them, and a leftover one silently helps the next measurement.
- **Measure each PR alone**: drop the other fixes' indexes and statistics, run the matrix, restore them. In the 2026-11 run the search rewrite was measured with and without the index of a sibling PR, to show it was at least as fast as `main` either way.
- **`ANALYZE` the table** after creating statistics or an expression index; the planner ignores them until then.
- **Parity tests**: run the same fixtures and assertions through both paths by stubbing the new path's builder (sinon) to return `null` for the second pass. Restore the stub after each call.

## Migrations

- Indexes on large tables go through `createIndexesConcurrently` and `dropIndexesConcurrently` in `migrations/lib/concurrent-indexes.ts`.
- Run the migration up and down against the heavy database and record the build time and `pg_size_pretty(pg_relation_size('<index>'))`. At 11.5M transactions: 11 s and 519 MB for a three-column btree, 97 s and 617 MB for a trigram index on descriptions.
- Say in the migration's comment how long it runs and what it locks, including any `ANALYZE`. Reviewers ask whether it can time out during a deployment.

## Contract changes

- Make them additive and optional (a new argument with the old behavior as default, a new field), so the API PR merges and deploys alone.
- The frontend PR uses the same branch name; its e2e CI then runs against the API branch. When the frontend's `lib/graphql/schemaV2.graphql` lags behind API `main`, apply only your PR's schema additions, so the diff stays yours. State in the frontend PR that it needs the API change deployed first.
- A rewrite of how user input reaches SQL (search terms, filters) gets the `security` label on the API PR.
