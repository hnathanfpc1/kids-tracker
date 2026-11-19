-- Kids Tracker: dry-run preamble. Goes FIRST in the single dry-run call.
--
-- NOT a migration. It changes nothing in the database. It only prepares the transaction it runs in.
--
-- Exact call order
--   ONE call, sent as one multi-statement request so it is one transaction, run as postgres:
--     1. DRYRUN-00-preamble.sql          (this file)
--     2. 06_activities_tables.sql
--     3. 07_editor_schedule.sql
--     4. 08_get_schedule_activities.sql
--     5. 06_activities_tables.sql        (again: the re-run proof)
--     6. 07_editor_schedule.sql
--     7. 08_get_schedule_activities.sql
--     8. DRYRUN-06-08.sql
--   Then, as a SEPARATE call: DRYRUN-99-aftercheck.sql
--   Do not wrap the call in begin and rollback. The error at the end of DRYRUN-06-08.sql ends the transaction.
--
-- What it does
--   1. Limits, for this transaction only: give up after 5 seconds if a lock cannot be had (so the call
--      never queues behind the live site), and stop any single statement after 120 seconds.
--   2. Leaves a guard: a temporary table that exists only until this transaction ends. It records the
--      transaction's id and whether the activities tables already existed. DRYRUN-06-08.sql refuses to
--      start without it, so the test cannot run against migrations that were applied for real, and it
--      cannot run statement by statement.

select set_config('lock_timeout', '5s', true)        as lock_timeout,
       set_config('statement_timeout', '120s', true) as statement_timeout;

create temp table kt_dryrun_guard on commit drop as
select txid_current()                        as txid,
       (to_regclass('public.kids') is null)  as fresh;
