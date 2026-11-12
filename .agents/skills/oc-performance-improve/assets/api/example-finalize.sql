-- Run after the generator: re-enables triggers, recreates the saved indexes, refreshes statistics.
\set ON_ERROR_STOP on
\timing on
SET maintenance_work_mem = '2GB';
SET max_parallel_maintenance_workers = 8;
ALTER TABLE "Collectives" ENABLE TRIGGER ALL;
ALTER TABLE "Orders" ENABLE TRIGGER ALL;
ALTER TABLE "Transactions" ENABLE TRIGGER ALL;
ALTER TABLE "Subscriptions" ENABLE TRIGGER ALL;
SELECT indexdef || ';' FROM perf_saved_indexes WHERE NOT EXISTS (SELECT 1 FROM pg_indexes p WHERE p.indexname = perf_saved_indexes.indexname) \gexec
VACUUM ANALYZE "Collectives";
VACUUM ANALYZE "Orders";
VACUUM ANALYZE "Transactions";
VACUUM ANALYZE "Subscriptions";
