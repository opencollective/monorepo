# opencollective-api performance reference

Know-how for `oc-performance-improve` on the API. Almost every slow API path is a slow Postgres query, so this is mostly about Postgres. Helper scripts are in [../assets/api/](../assets/api/).

## Lab

**Database.** Give the lab its own Postgres container. The shared dev database is a few thousand rows and other agents use it; the compose one is capped at a quarter of a CPU.

```bash
docker run -d --name perf-<slug>-postgres -p 5434:5432 -e POSTGRES_HOST_AUTH_METHOD=trust --shm-size=2g postgres:16 \
  postgres -c shared_buffers=2GB -c work_mem=16MB -c maintenance_work_mem=1GB -c max_wal_size=8GB \
  -c random_page_cost=1.1 -c effective_cache_size=8GB -c statement_timeout=0
PGPORT=5434 ./scripts/db_restore.sh -d opencollective_dvl -h localhost          # from the API repo
PG_URL=postgres://opencollective@localhost:5434/opencollective_dvl npm run db:migrate
```

The dev dump is old: `db:migrate` runs many migrations first. For tests, restore a test database into the same container and run `NODE_ENV=test TZ=UTC PG_URL=<its url> npx mocha <file>`.

**Data.** Generate it in SQL with `generate_series`; inserting through the models is far too slow for millions of rows. [example-generate-large-host.sql](../assets/api/example-generate-large-host.sql) and [example-finalize.sql](../assets/api/example-finalize.sql) show the pattern for a large host (18.5M transactions, 2M orders, 649k accounts in about 15 minutes):

1. save the secondary index definitions of the target tables in a table, drop them, `DISABLE TRIGGER ALL`;
2. insert with power-law skew, name dictionaries, and random dates and amounts;
3. re-enable triggers, recreate the saved indexes, `VACUUM ANALYZE`.

Generate every table the entry points read (expenses, activities, members, legal documents), not only the big ones.

**API.** Start `main` and the branch on separate ports against the lab:

```bash
PORT=3065 PG_URL=<lab url> npx babel-node --extensions .js,.ts server/index.ts
npm run -s script scripts/generate-jwt.ts id <userId> > /tmp/perf/jwt.txt       # a user with access to the data
PORT=3065 JWT_FILE=/tmp/perf/jwt.txt assets/api/gql.sh query.graphql '{"slug":"..."}'
```

Use the documents the frontend sends: [extract-doc.js](../assets/api/extract-doc.js) prints one from the frontend's generated types. Name every operation; anonymous ones fail validation.

**Waiting on long jobs.** Run generators and index builds in the background and wait on their exit, or on a marker file they write last. A `pgrep -f <script name>` loop matches its own command line and never ends.

## From a GraphQL operation to SQL

Let Postgres tell you which statements are slow instead of reading resolvers and guessing:

```sql
ALTER SYSTEM SET log_min_duration_statement = 100; SELECT pg_reload_conf();
```

Send the operation, then `docker logs --since <ts> perf-<slug>-postgres | grep -A1 "LOG:  duration"`. Each entry is a parameterized statement plus a `DETAIL: parameters:` line; [log2sql.py](../assets/api/log2sql.py) inlines the parameters into runnable SQL. Prefix it with `EXPLAIN (ANALYZE, BUFFERS)`.

A collection resolver usually issues two statements: the page and its `totalCount`. Time them separately; they often have different causes and different fixes.

## Reading the plan

Read estimated against actual rows first. The patterns found so far:

| Plan shows | Cause | Fix |
| --- | --- | --- |
| `Rows Removed by Filter` in the millions under an index scan | No index leads on the selective column | Composite index led by the equality columns, ending on the sort column |
| Estimate off by 10x or more on a pair of conditions, then a sort of a huge set where an ordered index walk would do | Correlated columns treated as independent | Extended statistics (below) |
| Seq scan or full join under an `OR` of `ILIKE`s across joined tables | No index can serve an OR that spans tables | One arm per field, `UNION`ed (below) |
| The count costs as much as the whole unfiltered join | An exact count visits every row | Capped count (below) |

## Techniques

**Indexes.**

- Match the query's `ORDER BY` in the index's last column (`"createdAt" DESC`), or Postgres ignores the index for a `LIMIT` query.
- Tables are soft-deleted: make indexes partial on `"deletedAt" IS NULL`, as the existing ones are.
- A partial or expression index is used only when the query repeats the index's predicate or expression exactly. Check that the application emits it.
- `Transactions` already has about 45 indexes. Check `pg_indexes` for one to extend or replace before adding, and report the new index's size and build time.
- The `pg_search` trigram indexes on `Collectives` exclude guest, incognito and private accounts, so they cannot serve admin-side search.
- Before adding a second index type on a column (GIN next to GiST), measure: on `Orders.description` it bought 17 ms for 122 MB.
- Migrations use `createIndexesConcurrently` / `dropIndexesConcurrently` from `migrations/lib/concurrent-indexes.ts`: built online, idempotent, cleans up invalid leftovers, runs `ANALYZE`, and does nothing if the index was already built by hand.

**Extended statistics** fix a mis-estimate on correlated columns without changing the query: `CREATE STATISTICS ... (mcv) ON col, (expression) FROM table`, then `ANALYZE`. Two traps:

- The planner matches an expression statistic only on the identical expression. `("approvedAt" IS NOT NULL)` did not match; `(("approvedAt" IS NOT NULL) IS TRUE)` did, and the query had to be rewritten to emit that form. Verify with `EXPLAIN` that the estimate moved.
- Confirm on shuffled data. A statistics fix looked perfect (2.9 s to 5 ms) only because 1,500 generated rows shared one timestamp; with distinct values the estimate was as wrong as before. Randomize the columns involved, re-`ANALYZE`, re-measure, then report.

**Search across joined tables.** Resolve the matching accounts first (trigram GIN on `Collectives.name` and `slug`), then `UNION` one indexable arm per searched field inside `WITH matches AS MATERIALIZED` (without `MATERIALIZED` the planner sometimes drives from the wrong side). `buildSearchArms` in `server/lib/sql-search.ts` does this once opencollective/opencollective-api#12500 is merged; until then, read it on that PR. It wins on selective terms (15 s to 30 ms) and loses on broad ones (5 s to 8.6 s), so it counts matches up to a limit and falls back to the original conditions beyond it. Count them for real: planner estimates for `ILIKE` are off by orders of magnitude. A single-table `OR` over pre-resolved IDs was 40 times slower than the arms.

**Capped counts.** `SELECT count(*) FROM (<query> LIMIT n+1)` turns a count over every row into a bounded one. In GraphQL it is opt-in (`maxTotalCount`, `totalCountIsCapped` on the orders collection) so existing clients keep exact totals; the frontend asks for `offset + 10_000` and shows "500+ pages". It helps unfiltered and broad lists and does nothing for a rare search term, where finding the rows is the cost.

**ORMs.** Sequelize builds the joined-OR SQL behind most collection resolvers; read what it emitted in the log before blaming the schema. Kysely fragments are embedded into Sequelize queries with `compileToInlineSQL`. New complex queries go in Kysely; existing ones stay where they are (see the API's `AGENTS.md`).

## Limits of the lab

- Everything is in memory on an idle machine. Report ratios and plan changes with confidence, absolute times with the caveat.
- The repository does not say how migrations run at deploy or whether a statement timeout applies there. For any migration that is not a concurrent index, ask the operator, and write the answer into the migration comment.
- Leave no `perf_*` prototype indexes or statistics behind when taking a baseline: `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'perf_%'`, and `pg_statistic_ext` for statistics.
