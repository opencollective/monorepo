-- Worked example: host-scale data for contributions and transactions, loaded into a dev database.
--
-- Written for opencollective/opencollective#8947 (2026-11): it gives the host `opensource` (id 9805 in the dev dump)
-- about 5,500 hosted accounts, 1.5M contributions and 11.5M transactions, plus 640k contributor profiles and a second
-- host, in a few minutes and under 20 GB. It fills "Collectives", "Subscriptions", "Orders" and "Transactions" only:
-- copy the pattern for the tables your entry points read (expenses, activities, members, ...) and check the column
-- lists against the current schema first.
--
-- usage: psql -f heavy-data.example.sql postgres://opencollective@localhost:<port>/opencollective_dvl
-- For a throwaway database only: unique constraints come back as plain unique indexes.
--
-- The pattern:
--   1. save and drop the secondary indexes, disable triggers (loading into indexed tables is far slower)
--   2. INSERT ... SELECT FROM generate_series, with skewed (power law) owners and distinct timestamps
--   3. plant needles: a rare name ("Mehdy" on 30 profiles, "Vox" on 8 accounts) next to common ones
--   4. restore triggers and indexes, VACUUM ANALYZE
\set ON_ERROR_STOP on
\timing on
SET synchronous_commit = off;
SET maintenance_work_mem = '2GB';
SET max_parallel_maintenance_workers = 8;

-- 1. Save and drop secondary indexes for fast bulk load (restored in step 7)
CREATE TABLE IF NOT EXISTS perf_saved_indexes AS
  SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
  WHERE tablename IN ('Collectives', 'Orders', 'Transactions', 'Subscriptions')
    AND indexname NOT IN ('Groups_pkey', 'Donations_pkey', 'Transactions_pkey', 'Subscriptions_pkey')
    AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p'));

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT i.indexname, i.tablename FROM perf_saved_indexes i JOIN pg_indexes p USING (indexname) LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.indexname) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tablename, r.indexname);
    ELSE
      EXECUTE format('DROP INDEX %I', r.indexname);
    END IF;
  END LOOP;
END $$;

-- FKs slow down loads; disable triggers (incl. FK triggers) during load
ALTER TABLE "Collectives" DISABLE TRIGGER ALL;
ALTER TABLE "Orders" DISABLE TRIGGER ALL;
ALTER TABLE "Transactions" DISABLE TRIGGER ALL;
ALTER TABLE "Subscriptions" DISABLE TRIGGER ALL;

-- 2. Name dictionaries
CREATE TEMP TABLE first_names AS SELECT row_number() OVER () AS i, n FROM unnest(ARRAY[
 'James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','William','Elizabeth','David','Barbara','Richard','Susan',
 'Joseph','Jessica','Thomas','Sarah','Charles','Karen','Christopher','Nancy','Daniel','Lisa','Matthew','Betty','Anthony','Margaret',
 'Mark','Sandra','Donald','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle','Kenneth','Dorothy',
 'Kevin','Carol','Brian','Amanda','George','Melissa','Edward','Deborah','Ronald','Stephanie','Timothy','Rebecca','Jason','Sharon',
 'Jeffrey','Laura','Ryan','Cynthia','Jacob','Kathleen','Gary','Amy','Nicholas','Shirley','Eric','Angela','Jonathan','Helen',
 'Pierre','Marie','Jean','Camille','Lucas','Chloe','Hugo','Lea','Mohamed','Fatima','Ahmed','Aisha','Yuki','Hiroshi','Wei','Li',
 'Ravi','Priya','Arjun','Ananya','Carlos','Sofia','Diego','Lucia','Mateo','Valentina','Benjamin','Alice','Xavier','Pia'
]) AS n;
CREATE TEMP TABLE last_names AS SELECT row_number() OVER () AS i, n FROM unnest(ARRAY[
 'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez',
 'Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark',
 'Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams',
 'Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts','Dubois','Durand','Lefebvre','Moreau','Laurent',
 'Simon','Michel','Garnier','Faure','Rousseau','Muller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker',
 'Kumar','Singh','Sharma','Patel','Gupta','Tanaka','Suzuki','Takahashi','Watanabe','Wang','Zhang','Liu','Chen','Yang',
 'Silva','Santos','Oliveira','Souza','Costa','Pereira','Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Kowalski',
 'Nowak','Novak','Horvat','Ivanov','Petrov'
]) AS n;
CREATE TEMP TABLE words AS SELECT row_number() OVER () AS i, n FROM unnest(ARRAY[
 'Open','Free','Fast','Tiny','Rapid','Smart','Simple','Modern','Secure','Reactive','Async','Cloud','Data','Web','Mobile','Code',
 'Dev','Type','Script','Graph','Query','Stream','Pixel','Vector','Matrix','Quantum','Neural','Logic','Byte','Bit','Cipher','Crypto',
 'Node','Rust','Python','Ruby','Go','Java','Swift','Kotlin','Elixir','Haskell','Linux','Unix','Kernel','Shell','Terminal','Editor',
 'Lint','Format','Test','Bench','Build','Pack','Bundle','Deploy','Docker','Kube','Mesh','Proxy','Router','Server','Client','Socket',
 'Parser','Compiler','Runtime','Engine','Framework','Library','Toolkit','Kit','Lab','Hub','Forge','Works','Studio','Project',
 'Foundation','Community','Collective','Initiative','Alliance','Society','Network','Labs','Org','Team','Crew','Guild','Club'
]) AS n;

-- 3. Contributors: 600k individuals + 40k organizations (ids 1_000_001..1_640_000)
INSERT INTO "Collectives" (id, name, slug, type, currency, "isActive", "createdAt", "updatedAt", "publicId", data, "isIncognito")
SELECT 1000000 + g,
  CASE WHEN g <= 600000 THEN
    (CASE WHEN g % 20000 = 0 THEN 'Mehdy' ELSE (SELECT n FROM first_names WHERE i = 1 + (g * 7) % (SELECT count(*) FROM first_names)) END)
    || ' ' || (SELECT n FROM last_names WHERE i = 1 + (g * 13) % (SELECT count(*) FROM last_names))
  ELSE
    (SELECT n FROM words WHERE i = 1 + (g * 11) % (SELECT count(*) FROM words)) || ' ' || (SELECT n FROM last_names WHERE i = 1 + (g * 3) % (SELECT count(*) FROM last_names)) || ' Inc'
  END,
  'perf-c-' || g,
  CASE WHEN g <= 600000 THEN 'USER' ELSE 'ORGANIZATION' END,
  'USD', false,
  timestamp '2016-01-01' + (random() * interval '3600 days'),
  now(),
  'acc_perf' || g,
  CASE WHEN g % 10 = 0 THEN '{"isGuest": true}'::jsonb ELSE '{}'::jsonb END,
  false
FROM generate_series(1, 640000) g;

-- 4. Hosted collectives under opensource (9805): 4000 collectives (ids 2_000_001..2_004_000)
INSERT INTO "Collectives" (id, name, slug, type, currency, "isActive", "HostCollectiveId", "approvedAt", "createdAt", "updatedAt", "publicId", "hostFeePercent")
SELECT 2000000 + g,
  CASE WHEN g % 500 = 0 THEN 'Vox ' || (SELECT n FROM words WHERE i = 1 + g % (SELECT count(*) FROM words))
       ELSE (SELECT n FROM words WHERE i = 1 + (g * 7) % (SELECT count(*) FROM words)) || ' ' || (SELECT n FROM words WHERE i = 1 + (g * 17 / 3) % (SELECT count(*) FROM words)) || ' ' || g END,
  'perf-osc-' || g, 'COLLECTIVE', 'USD', true, 9805,
  timestamp '2016-01-01' + (random() * interval '3000 days'),
  timestamp '2016-01-01' + (random() * interval '3000 days'), now(), 'acc_perfosc' || g, 10
FROM generate_series(1, 4000) g;

-- 4b. Children (events/projects) of hosted collectives (ids 2_100_001..2_101_500)
INSERT INTO "Collectives" (id, name, slug, type, currency, "isActive", "HostCollectiveId", "ParentCollectiveId", "approvedAt", "createdAt", "updatedAt", "publicId")
SELECT 2100000 + g, 'Project ' || g, 'perf-osc-child-' || g, CASE WHEN g % 2 = 0 THEN 'PROJECT' ELSE 'EVENT' END, 'USD', true, 9805,
  2000000 + 1 + (g * 7) % 4000, timestamp '2018-01-01' + (random() * interval '2500 days'), now() - interval '1000 days', now(), 'acc_perfoscchild' || g
FROM generate_series(1, 1500) g;

-- 4c. Collectives under another host (opencollective, 8686) (ids 2_200_001..2_203_000)
INSERT INTO "Collectives" (id, name, slug, type, currency, "isActive", "HostCollectiveId", "approvedAt", "createdAt", "updatedAt", "publicId")
SELECT 2200000 + g, (SELECT n FROM words WHERE i = 1 + (g * 5) % (SELECT count(*) FROM words)) || ' Other ' || g, 'perf-other-' || g, 'COLLECTIVE', 'USD', true, 8686,
  timestamp '2018-01-01' + (random() * interval '2500 days'), now() - interval '2000 days', now(), 'acc_perfother' || g
FROM generate_series(1, 3000) g;

-- 5. Orders: 1.5M on OSC collectives + 500k elsewhere (ids 100_001..2_100_000)
--    Contributors and collectives are skewed (power law) to mimic big contributors / big collectives.
CREATE TEMP TABLE order_src AS
SELECT g,
  1000000 + 1 + floor(power(random(), 2.5) * 640000)::int AS from_id,
  CASE WHEN g <= 1500000 THEN
    CASE WHEN random() < 0.05 THEN 2100000 + 1 + floor(random() * 1500)::int
         ELSE 2000000 + 1 + floor(power(random(), 2) * 4000)::int END
  ELSE 2200000 + 1 + floor(random() * 3000)::int END AS to_id,
  random() AS r_status,
  timestamp '2016-06-01' + (power(random(), 0.6) * interval '3800 days') AS created_at
FROM generate_series(1, 2000000) g;

INSERT INTO "Subscriptions" (id, amount, currency, interval, "isActive", "activatedAt", "createdAt", "updatedAt", "lastChargedAt", "chargeNumber")
SELECT 500000 + g, 500, 'USD', CASE WHEN g % 5 = 0 THEN 'year' ELSE 'month' END, s.r_status < 0.85, s.created_at, s.created_at, now(),
  s.created_at + interval '30 days', 3
FROM order_src s WHERE s.r_status >= 0.60 AND s.r_status < 0.95;

INSERT INTO "Orders" (id, "CollectiveId", "FromCollectiveId", currency, "totalAmount", description, "SubscriptionId", "createdAt", "updatedAt",
  "processedAt", status, interval, data, "publicId", quantity)
SELECT 100000 + s.g, s.to_id, s.from_id, 'USD', (500 + floor(random() * 10000))::int,
  CASE WHEN s.r_status >= 0.60 AND s.r_status < 0.95 THEN 'Monthly financial contribution to ' ELSE 'Financial contribution to ' END || c.name,
  CASE WHEN s.r_status >= 0.60 AND s.r_status < 0.95 THEN 500000 + s.g END,
  s.created_at, s.created_at, s.created_at,
  CASE WHEN s.r_status < 0.60 THEN 'PAID'
       WHEN s.r_status < 0.85 THEN 'ACTIVE'
       WHEN s.r_status < 0.95 THEN 'CANCELLED'
       WHEN s.r_status < 0.98 THEN 'ERROR'
       ELSE 'PENDING' END,
  CASE WHEN s.r_status >= 0.60 AND s.r_status < 0.95 THEN 'month' END,
  CASE WHEN s.g % 50 = 0 THEN jsonb_build_object('fromAccountInfo', jsonb_build_object('name', 'Guest ' || s.g, 'email', 'guest' || s.g || '@example.com'))
       WHEN s.g % 200 = 1 THEN jsonb_build_object('ponumber', 'PO-' || s.g)
       ELSE '{}'::jsonb END,
  'or_perf' || s.g, 1
FROM order_src s JOIN "Collectives" c ON c.id = s.to_id;

-- 6. Transactions: one charge per PAID order, 1..4 charges per ACTIVE/CANCELLED subscription.
--    Each charge = CONTRIBUTION credit + debit, HOST_FEE credit + debit, PAYMENT_PROCESSOR_FEE debit + credit.
CREATE TEMP TABLE charges AS
SELECT o.id AS order_id, o."CollectiveId" AS to_id, o."FromCollectiveId" AS from_id, o."totalAmount" AS amount,
  o.description, c."HostCollectiveId" AS host_id,
  o."createdAt" + (k - 1) * interval '30 days' AS created_at, gen_random_uuid() AS tg
FROM "Orders" o
JOIN "Collectives" c ON c.id = o."CollectiveId"
CROSS JOIN LATERAL generate_series(1, CASE WHEN o.status IN ('ACTIVE', 'CANCELLED') THEN 1 + (o.id % 4) ELSE 1 END) k
WHERE o.id > 100000 AND o.status IN ('PAID', 'ACTIVE', 'CANCELLED');

CREATE SEQUENCE IF NOT EXISTS perf_tx_seq START 1000001;

INSERT INTO "Transactions" (id, type, kind, description, amount, currency, "createdAt", "updatedAt", "clearedAt", "CollectiveId", "FromCollectiveId",
  "HostCollectiveId", "OrderId", "hostCurrency", "hostCurrencyFxRate", "amountInHostCurrency", "netAmountInCollectiveCurrency",
  "hostFeeInHostCurrency", "paymentProcessorFeeInHostCurrency", "platformFeeInHostCurrency", uuid, "TransactionGroup", "isRefund", "isDebt", "publicId")
SELECT nextval('perf_tx_seq'), t.type, t.kind::"enum_Transactions_kind", t.description, t.amount, 'USD', ch.created_at, ch.created_at, ch.created_at,
  t.collective_id, t.from_id, t.host_id, ch.order_id, 'USD', 1, t.amount, t.amount, 0, 0, 0, gen_random_uuid(), ch.tg, false, false,
  'tx_perf' || currval('perf_tx_seq')
FROM charges ch
CROSS JOIN LATERAL (VALUES
  ('CREDIT', 'CONTRIBUTION', ch.description, ch.amount, ch.to_id, ch.from_id, ch.host_id),
  ('DEBIT', 'CONTRIBUTION', ch.description, -ch.amount, ch.from_id, ch.to_id, NULL::int),
  ('CREDIT', 'HOST_FEE', 'Host Fee', ch.amount / 10, ch.host_id, ch.to_id, ch.host_id),
  ('DEBIT', 'HOST_FEE', 'Host Fee', -ch.amount / 10, ch.to_id, ch.host_id, ch.host_id),
  ('DEBIT', 'PAYMENT_PROCESSOR_FEE', 'Stripe payment processor fee', -ch.amount / 30, ch.to_id, 9805, ch.host_id),
  ('CREDIT', 'PAYMENT_PROCESSOR_FEE', 'Stripe payment processor fee', ch.amount / 30, 9805, ch.to_id, ch.host_id)
) AS t(type, kind, description, amount, collective_id, from_id, host_id);

-- 6b. Expenses paid by OSC collectives to contributors: 400k debit/credit pairs
INSERT INTO "Transactions" (id, type, kind, description, amount, currency, "createdAt", "updatedAt", "clearedAt", "CollectiveId", "FromCollectiveId",
  "HostCollectiveId", "hostCurrency", "hostCurrencyFxRate", "amountInHostCurrency", "netAmountInCollectiveCurrency",
  "hostFeeInHostCurrency", "paymentProcessorFeeInHostCurrency", "platformFeeInHostCurrency", uuid, "TransactionGroup", "isRefund", "isDebt", "publicId")
SELECT nextval('perf_tx_seq'), t.type, 'EXPENSE', e.description, t.amount, 'USD', e.created_at, e.created_at, e.created_at,
  t.collective_id, t.from_id, t.host_id, 'USD', 1, t.amount, t.amount, 0, 0, 0, gen_random_uuid(), e.tg, false, false,
  'tx_perf' || currval('perf_tx_seq')
FROM (
  SELECT g, 2000000 + 1 + floor(power(random(), 2) * 4000)::int AS col_id, 1000000 + 1 + floor(random() * 600000)::int AS payee_id,
    (1000 + floor(random() * 100000))::int AS amount,
    (SELECT n FROM words WHERE i = 1 + g % (SELECT count(*) FROM words)) || ' maintenance work ' || to_char(timestamp '2017-01-01' + (g % 3000) * interval '1 day', 'Mon YYYY') AS description,
    timestamp '2017-01-01' + (random() * interval '3500 days') AS created_at, gen_random_uuid() AS tg
  FROM generate_series(1, 400000) g
) e
CROSS JOIN LATERAL (VALUES
  ('DEBIT', -e.amount, e.col_id, e.payee_id, 9805),
  ('CREDIT', e.amount, e.payee_id, e.col_id, NULL::int)
) AS t(type, amount, collective_id, from_id, host_id);

SELECT setval('"Groups_id_seq"', (SELECT max(id) FROM "Collectives"));
SELECT setval('"Donations_id_seq"', (SELECT max(id) FROM "Orders"));
SELECT setval('"Transactions_id_seq"', (SELECT max(id) FROM "Transactions"));
SELECT setval('"Subscriptions_id_seq1"', (SELECT max(id) FROM "Subscriptions"));

-- 7. Restore triggers and indexes, refresh planner statistics
ALTER TABLE "Collectives" ENABLE TRIGGER ALL;
ALTER TABLE "Orders" ENABLE TRIGGER ALL;
ALTER TABLE "Transactions" ENABLE TRIGGER ALL;
ALTER TABLE "Subscriptions" ENABLE TRIGGER ALL;
SELECT indexdef || ';' FROM perf_saved_indexes WHERE NOT EXISTS (SELECT 1 FROM pg_indexes p WHERE p.indexname = perf_saved_indexes.indexname) \gexec
VACUUM ANALYZE "Collectives";
VACUUM ANALYZE "Orders";
VACUUM ANALYZE "Transactions";
VACUUM ANALYZE "Subscriptions";

-- 8. Refresh the materialized views your entry points read (list them with \dm), for example:
-- REFRESH MATERIALIZED VIEW "AdminCommunityTransactionSummary";
