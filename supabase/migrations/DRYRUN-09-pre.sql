-- Kids Tracker: dry-run preamble for migration 09. Goes FIRST in the single dry-run call.
--
-- NOT a migration. It changes nothing in the database. It only prepares the transaction it runs in
-- and takes a snapshot of how things look BEFORE 09 (hashes and counts, no data, no emails).
--
-- Exact call order
--   ONE call, sent as one multi-statement request so it is one transaction, run as postgres:
--     1. DRYRUN-09-pre.sql          (this file)
--     2. 09_harden_sign_in.sql
--     3. DRYRUN-09-mid.sql          (second snapshot, then made-up accounts)
--     4. 09_harden_sign_in.sql      (again: the re-run proof)
--     5. DRYRUN-09.sql              (the checks; ends in an error on purpose)
--   Then, as a SEPARATE call: DRYRUN-99-aftercheck-09.sql   (also run it once BEFORE the dry run)
--   Do not wrap the call in begin and rollback. The error at the end of DRYRUN-09.sql ends the transaction.
--   Run it only if the 06 to 08 migrations are already live. 09 stops with an error if they are not.

select set_config('lock_timeout', '5s', true)        as lock_timeout,
       set_config('statement_timeout', '120s', true) as statement_timeout;

create temp table kt9_guard on commit drop as
select txid_current() as txid;

create temp table kt9_before (k text primary key, v text) on commit drop;

insert into kt9_before (k, v)
select 'fn_get_schedule',        md5(pg_get_functiondef('public.get_schedule(text)'::regprocedure))
union all select 'fn_get_editor_schedule', md5(pg_get_functiondef('public.get_editor_schedule(date, date)'::regprocedure))
union all select 'fn_kt_schedule_core',    md5(pg_get_functiondef('public.kt_schedule_core()'::regprocedure))
union all select 'fn_kt_activities',       md5(pg_get_functiondef('public.kt_activities(date, date, boolean)'::regprocedure))
union all select 'fn_is_editor',           md5(pg_get_functiondef('public.is_editor()'::regprocedure))
union all select 'fn_my_who',              md5(pg_get_functiondef('public.my_who()'::regprocedure))
union all select 'n_tables',   (select count(*)::text from pg_tables where schemaname = 'public')
union all select 'n_rls_on',   (select count(*)::text from pg_tables where schemaname = 'public' and rowsecurity)
union all select 'n_policies', (select count(*)::text from pg_policies where schemaname = 'public')
union all select 'n_triggers', (select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
                                where c.relnamespace = 'public'::regnamespace and not g.tgisinternal)
union all select 'n_functions',(select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace)
union all select 'policies_md5',
       (select coalesce(md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|'
                                       || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n'
                                       order by tablename, policyname)), '')
        from pg_policies where schemaname = 'public')
union all select 'table_acl_md5',   -- every table right except MAINTAIN, who holds it
       (select coalesce(md5(string_agg(c.relname || '|' || a.grantee::text || '|' || a.privilege_type, E'\n'
                                       order by c.relname, a.grantee::text, a.privilege_type)), '')
        from pg_class c, lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.privilege_type <> 'MAINTAIN')
union all select 'function_acl_md5',
       (select coalesce(md5(string_agg(proname || '|' || oid::regprocedure::text || '|' || coalesce(proacl::text, ''), E'\n'
                                       order by oid::regprocedure::text)), '')
        from pg_proc where pronamespace = 'public'::regnamespace)
union all select 'server_version_num', current_setting('server_version_num');
