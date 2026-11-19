-- Kids Tracker: dry-run test for migrations 06, 07 and 08
--
-- NOT a migration. It never "succeeds": its last statement always raises an error that carries the report.
--
-- Exact call order
--   ONE call, sent as one multi-statement request so it is one transaction, run as postgres:
--     1. DRYRUN-00-preamble.sql
--     2. 06_activities_tables.sql
--     3. 07_editor_schedule.sql
--     4. 08_get_schedule_activities.sql
--     5. 06_activities_tables.sql        (again: the re-run proof)
--     6. 07_editor_schedule.sql
--     7. 08_get_schedule_activities.sql
--     8. DRYRUN-06-08.sql                (this file)
--   Then, as a SEPARATE call: DRYRUN-99-aftercheck.sql
--   Do not wrap the call in begin and rollback. The error at the end is what ends the transaction.
--
-- What this file can and cannot promise
--   Its first statement refuses to go on unless the preamble ran earlier in this same transaction and the
--   activities tables did not exist before it. So it cannot run against migrations that were applied for
--   real, and it cannot run statement by statement.
--   It ends by raising an error, and an error ends the transaction it is in. This file cannot see what
--   happens after that, so it never says that anything was undone. The caller confirms that from a
--   separate call, with DRYRUN-99-aftercheck.sql.
--
-- What it touches
--   It runs against the live database, which holds real rows in the custody tables. It never puts a
--   value from settings, breaks, swaps, swap_details, share_links or app_users into the report.
--   Checks on those tables report counts, key names and true or false only.
--   Every row it creates is made up: example.test emails, "Dryrun" names, a 555-555-01xx phone number,
--   a made-up address, a map point in the middle of the ocean, a swap dated in the year 1900, and link
--   tokens that are generated at run time (none is written in this file).
--
-- How it pretends to be each kind of user (the same way Supabase does it)
--   set local role anon or authenticated, plus request.jwt.claims holding the made-up email.
--   auth.jwt() reads request.jwt.claims in every Supabase version (newer versions look at
--   request.jwt.claim first and fall back to request.jwt.claims). Check S03 proves the wiring works
--   on this project before any role test is trusted.
--
-- Reading the report
--   The error message starts with: KT DRYRUN txid=... total=... passed=... failed=... expected=...
--   then one line per failed check (name and what it got), then the ids of the passed checks, one line
--   per section. An id such as D13 is the first word of that check's name in this file.
--   total should equal expected. If it does not, a section stopped early and says so in a FAIL line.
--   Error codes: KT000 is the report. KT001, KT002 and KT003 mean the file refused to start.

-- ---------------------------------------------------------------
-- Guard. This must stay the first statement.
-- ---------------------------------------------------------------
do $guard$
declare
  v_txid  bigint;
  v_fresh boolean;
begin
  if to_regclass('pg_temp.kt_dryrun_guard') is null then
    raise exception 'KT DRYRUN REFUSED: the guard from DRYRUN-00-preamble.sql is not there. Either the preamble was not sent first, or this is not one transaction. No test was run. If 06 to 08 were sent just before this, they may now be applied for real: run DRYRUN-99-aftercheck.sql to find out.'
      using errcode = 'KT001';
  end if;
  execute 'select g.txid, g.fresh from pg_temp.kt_dryrun_guard g limit 1' into v_txid, v_fresh;
  if v_txid is distinct from txid_current() then
    raise exception 'KT DRYRUN REFUSED: the guard belongs to a different transaction. No test was run. Run DRYRUN-99-aftercheck.sql to see what is in the database.'
      using errcode = 'KT002';
  end if;
  if not coalesce(v_fresh, false) then
    raise exception 'KT DRYRUN REFUSED: the activities tables already existed before this call started, so 06 to 08 look applied for real. No test was run.'
      using errcode = 'KT003';
  end if;
end
$guard$;

-- ---------------------------------------------------------------
-- Scratch tables and helpers (temporary: gone when the transaction ends)
-- ---------------------------------------------------------------
create temp table if not exists kt_dry (
  n      int generated always as identity,
  name   text,
  ok     boolean,
  detail text
) on commit drop;

create temp table if not exists kt_ctx (
  k text primary key,
  v text
) on commit drop;

-- The custody payload exactly as get_schedule built it before migration 07 (copied from the old schema.sql).
-- Used only to prove, true or false, that the new shared function returns the very same thing.
create or replace function pg_temp.kt_old_payload()
returns jsonb language sql stable set search_path = public as $f$
  select jsonb_build_object(
      'settings',   (select jsonb_build_object('my_name', my_name, 'co_name', co_name, 'anchor', anchor)
                     from public.settings where id = 1),
      'changed_at', (select changed_at from public.settings where id = 1),
      'breaks',     (select coalesce(jsonb_agg(jsonb_build_object('year', year, 'data', data)), '[]'::jsonb)
                     from public.breaks),
      'swaps',      (select coalesce(jsonb_agg(jsonb_build_object(
                         'day', s.day, 'had', s.had, 'caregiver', s.caregiver,
                         'reason', d.reason, 'note', d.note, 'updated_at', s.updated_at) order by s.day), '[]'::jsonb)
                     from public.swaps s left join public.swap_details d on d.day = s.day)
    )
$f$;

-- True only inside the transaction the preamble started, and only if the activities tables were new to it.
-- Every probe asks this first, so no probe can do anything outside a guarded dry run.
create or replace function pg_temp.kt_guard_ok()
returns boolean language plpgsql as $f$
declare
  v_ok boolean;
begin
  if to_regclass('pg_temp.kt_dryrun_guard') is null then
    return false;
  end if;
  execute 'select bool_and(g.txid = txid_current() and g.fresh) from pg_temp.kt_dryrun_guard g' into v_ok;
  return coalesce(v_ok, false);
exception when others then
  return false;
end
$f$;

-- Replace {kt_...} placeholders in a test query with values saved in kt_ctx, safely quoted.
create or replace function pg_temp.kt_fill(p_sql text)
returns text language plpgsql as $f$
declare
  r       record;
  v_sql   text := p_sql;
begin
  for r in select c.k, c.v from pg_temp.kt_ctx c loop
    v_sql := replace(v_sql, '{' || r.k || '}', coalesce(quote_literal(r.v), 'null'));
  end loop;
  return v_sql;
end
$f$;

-- Run one query as a given database role with a given sign-in email, and say what happened:
-- 'ok:<the single value returned>' or 'err:<sqlstate> <start of the message>'. Always switches back.
create or replace function pg_temp.kt_try(p_role text, p_email text, p_sql text)
returns text language plpgsql as $f$
declare
  v_orig text := current_user;
  v_val  text;
  v_out  text;
begin
  if not pg_temp.kt_guard_ok() then
    return 'err:KTGRD not inside the guarded dry-run transaction, nothing was run';
  end if;
  perform set_config('request.jwt.claims',
    case when p_email is null then '{}'
         else json_build_object('email', p_email, 'role', coalesce(p_role, 'authenticated'))::text end,
    true);
  begin
    if p_role is not null then
      execute format('set local role %I', p_role);
    end if;
    execute p_sql into v_val;
    v_out := 'ok:' || coalesce(v_val, 'null');
  exception when others then
    v_out := 'err:' || sqlstate || ' ' || left(sqlerrm, 90);
  end;
  execute format('set local role %I', v_orig);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end
$f$;

-- One check. p_as is postgres, anon, admin, parent or nobody (signed in, but not on the sign-in list).
-- p_expect is the exact outcome wanted ('ok:3'), or an error code prefix ('err:42501'),
-- or null for "any outcome that is not an error".
create or replace function pg_temp.kt_check(p_name text, p_as text, p_sql text, p_expect text)
returns void language plpgsql as $f$
declare
  v_role  text;
  v_email text;
  v_out   text;
  v_ok    boolean;
begin
  v_role := case p_as when 'postgres' then null when 'anon' then 'anon' else 'authenticated' end;
  v_email := case p_as
    when 'admin'  then 'dryrun-admin@example.test'
    when 'parent' then 'dryrun-parent@example.test'
    when 'nobody' then 'dryrun-nobody@example.test'
    else null end;
  v_out := pg_temp.kt_try(v_role, v_email, pg_temp.kt_fill(p_sql));
  v_ok := coalesce(
            (p_expect is null and v_out like 'ok:%')
            or v_out = p_expect
            or (p_expect like 'err:%' and left(v_out, length(p_expect)) = p_expect),
            false);
  insert into pg_temp.kt_dry (name, ok, detail)
  values (p_name, v_ok,
          case when v_ok then left(v_out, 60)
               else 'got ' || left(v_out, 110) || ' | want ' || coalesce(p_expect, 'no error') end);
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail)
  values (p_name, false, 'check could not run: ' || sqlstate || ' ' || left(sqlerrm, 90));
end
$f$;

-- Save one value (worked out as postgres) for later checks to use as {key}.
create or replace function pg_temp.kt_set(p_key text, p_sql text)
returns void language plpgsql as $f$
declare
  v_val text;
begin
  execute pg_temp.kt_fill(p_sql) into v_val;
  insert into pg_temp.kt_ctx (k, v) values (p_key, v_val)
  on conflict (k) do update set v = excluded.v;
  if v_val is null then
    insert into pg_temp.kt_dry (name, ok, detail) values ('SETUP value missing: ' || p_key, false, 'the query returned nothing');
  end if;
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail)
  values ('SETUP value failed: ' || p_key, false, sqlstate || ' ' || left(sqlerrm, 90));
end
$f$;

-- ---------------------------------------------------------------
-- S. Setup and wiring
-- ---------------------------------------------------------------
do $main$
begin
  -- Before anything is written: "what's new" was last bumped before this run started.
  perform pg_temp.kt_check('S01 changed_at older than this run', 'postgres',
    $q$ select (changed_at < now())::text from public.settings where id = 1 $q$, 'ok:true');

  perform pg_temp.kt_set('kt_today',   $q$ select ((now() at time zone 'America/New_York')::date)::text $q$);
  perform pg_temp.kt_set('kt_tok',     $q$ select replace(gen_random_uuid()::text, '-', '') $q$);
  perform pg_temp.kt_set('kt_tok_off', $q$ select replace(gen_random_uuid()::text, '-', '') $q$);

  -- The old payload and the new shared function agree on the live data (true or false only).
  perform pg_temp.kt_check('S02 core payload same as before 07', 'postgres',
    $q$ select (pg_temp.kt_old_payload() = public.kt_schedule_core())::text $q$, 'ok:true');

  perform pg_temp.kt_check('S03 jwt claims reach auth.jwt', 'parent',
    $q$ select (auth.jwt() ->> 'email' = 'dryrun-parent@example.test')::text $q$, 'ok:true');
  perform pg_temp.kt_check('S04 auth.jwt reads request.jwt.claims', 'postgres',
    $q$ select (pg_get_functiondef('auth.jwt()'::regprocedure) like '%request.jwt.claims%')::text $q$, 'ok:true');

  -- Made-up sign-ins: one admin, one parent. Also proves the role rule now allows 'parent'.
  perform pg_temp.kt_check('S05 fake admin and parent added', 'postgres',
    $q$ with x as (insert into public.app_users (email, role)
                   values ('dryrun-admin@example.test', 'admin'), ('dryrun-parent@example.test', 'parent')
                   returning 1)
        select count(*)::text from x $q$, 'ok:2');
  perform pg_temp.kt_check('S06 role rule refuses other roles', 'postgres',
    $q$ with x as (insert into public.app_users (email, role)
                   values ('dryrun-other@example.test', 'other') returning 1)
        select count(*)::text from x $q$, 'err:23514');

  -- Made-up family links: one on, one off. The tokens are generated above, never written in this file.
  perform pg_temp.kt_check('S07 fake links added', 'postgres',
    $q$ with x as (insert into public.share_links (token, label, active)
                   values ({kt_tok}, 'dryrun on', true), ({kt_tok_off}, 'dryrun off', false)
                   returning 1)
        select count(*)::text from x $q$, 'ok:2');

  -- For a later comparison. Held in the scratch table only, never put in the report.
  perform pg_temp.kt_set('kt_counts', $q$ select concat_ws(',',
      (select count(*) from public.settings), (select count(*) from public.breaks),
      (select count(*) from public.swaps), (select count(*) from public.swap_details),
      (select count(*) from public.share_links)) $q$);
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION S stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- A. Re-run proof: object counts after the second pass
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('A01 tables = 14', 'postgres',
    $q$ select count(*)::text from pg_tables where schemaname = 'public' $q$, 'ok:14');
  perform pg_temp.kt_check('A02 tables with RLS on = 14', 'postgres',
    $q$ select count(*)::text from pg_tables where schemaname = 'public' and rowsecurity $q$, 'ok:14');
  perform pg_temp.kt_check('A03 policies = 22', 'postgres',
    $q$ select count(*)::text from pg_policies where schemaname = 'public' $q$, 'ok:22');
  perform pg_temp.kt_check('A04 triggers = 26', 'postgres',
    $q$ select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
        where c.relnamespace = 'public'::regnamespace and not g.tgisinternal $q$, 'ok:26');
  perform pg_temp.kt_check('A05 our functions = 21, no doubles', 'postgres',
    $q$ select count(*)::text || '/' || count(distinct proname)::text from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('my_role', 'touch_changed', 'get_schedule', 'get_editor_schedule', 'is_editor', 'my_who',
                          'kt_clean_kid_ids', 'kt_clean_gear', 'kt_event_core', 'kt_day_text', 'kt_time_text', 'kt_event_label',
                          'kt_log_batch', 'kt_keep_key', 'kt_schedule_core', 'kt_activities',
                          'events_stamp', 'events_log', 'teams_stamp', 'teams_log', 'comments_stamp') $q$, 'ok:21/21');
  perform pg_temp.kt_check('A06 one role rule on app_users', 'postgres',
    $q$ select count(*)::text from pg_constraint
        where conrelid = 'public.app_users'::regclass and contype = 'c' $q$, 'ok:1');
  perform pg_temp.kt_check('A07 import index exists once', 'postgres',
    $q$ select count(*)::text from pg_indexes
        where schemaname = 'public' and indexname = 'events_source_uid_key' $q$, 'ok:1');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION A stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- B. The public (anon) key
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('B01 anon has no table rights', 'postgres',
    $q$ select count(*)::text from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
          and has_table_privilege('anon'::name, c.oid, 'select, insert, update, delete, truncate, references, trigger') $q$, 'ok:0');
  perform pg_temp.kt_check('B02 anon can run get_schedule only', 'postgres',
    $q$ select coalesce(string_agg(p.proname::text, ',' order by p.proname::text collate "C"), '(none)') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname <> 'rls_auto_enable'
          and has_function_privilege('anon'::name, p.oid, 'execute') $q$, 'ok:get_schedule');
  perform pg_temp.kt_check('B03 signed-in can run 5 functions', 'postgres',
    $q$ select coalesce(string_agg(p.proname::text, ',' order by p.proname::text collate "C"), '(none)') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname <> 'rls_auto_enable'
          and has_function_privilege('authenticated'::name, p.oid, 'execute') $q$,
    'ok:get_editor_schedule,get_schedule,is_editor,my_role,my_who');

  perform pg_temp.kt_check('B04 anon cannot read settings',  'anon', $q$ select count(*)::text from public.settings $q$,  'err:42501');
  perform pg_temp.kt_check('B05 anon cannot read swaps',     'anon', $q$ select count(*)::text from public.swaps $q$,     'err:42501');
  perform pg_temp.kt_check('B06 anon cannot read app_users', 'anon', $q$ select count(*)::text from public.app_users $q$, 'err:42501');
  perform pg_temp.kt_check('B07 anon cannot read kids',      'anon', $q$ select count(*)::text from public.kids $q$,      'err:42501');
  perform pg_temp.kt_check('B08 anon cannot read events',    'anon', $q$ select count(*)::text from public.events $q$,    'err:42501');
  perform pg_temp.kt_check('B09 anon cannot read event_log', 'anon', $q$ select count(*)::text from public.event_log $q$, 'err:42501');
  perform pg_temp.kt_check('B10 anon cannot read contacts',  'anon', $q$ select count(*)::text from public.contacts $q$,  'err:42501');
  perform pg_temp.kt_check('B11 anon cannot read homes',     'anon', $q$ select count(*)::text from public.homes $q$,     'err:42501');

  perform pg_temp.kt_check('B12 anon get_schedule good link', 'anon',
    $q$ select (public.get_schedule({kt_tok}) is not null)::text $q$, 'ok:true');
  perform pg_temp.kt_check('B13 anon get_schedule bad link', 'anon',
    $q$ select (public.get_schedule('not-a-real-link') is null)::text $q$, 'ok:true');
  perform pg_temp.kt_check('B14 anon no get_editor_schedule', 'anon',
    $q$ select (public.get_editor_schedule() is null)::text $q$, 'err:42501');
  perform pg_temp.kt_check('B15 anon no my_role',    'anon', $q$ select public.my_role() $q$, 'err:42501');
  perform pg_temp.kt_check('B16 anon no is_editor',  'anon', $q$ select public.is_editor()::text $q$, 'err:42501');
  perform pg_temp.kt_check('B17 anon no my_who',     'anon', $q$ select public.my_who() $q$, 'err:42501');
  perform pg_temp.kt_check('B18 anon no kt_schedule_core', 'anon',
    $q$ select (public.kt_schedule_core() is null)::text $q$, 'err:42501');
  perform pg_temp.kt_check('B19 anon no kt_activities', 'anon',
    $q$ select (public.kt_activities(null, null, true) is null)::text $q$, 'err:42501');

  -- Row level security does not cover truncate, so the right itself must be absent, for every table.
  perform pg_temp.kt_check('B20 nobody can truncate any table', 'postgres',
    $q$ select count(*)::text from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
          and (has_table_privilege('anon'::name, c.oid, 'truncate, references, trigger')
            or has_table_privilege('authenticated'::name, c.oid, 'truncate, references, trigger')) $q$, 'ok:0');
  perform pg_temp.kt_check('B21 signed-in table rights exact', 'postgres',
    $q$ select string_agg(c.relname::text || '=' ||
                 case when has_table_privilege('authenticated'::name, c.oid, 'select') then 'S' else '' end ||
                 case when has_table_privilege('authenticated'::name, c.oid, 'insert') then 'I' else '' end ||
                 case when has_table_privilege('authenticated'::name, c.oid, 'update') then 'U' else '' end ||
                 case when has_table_privilege('authenticated'::name, c.oid, 'delete') then 'D' else '' end,
               ' ' order by c.relname::text collate "C")
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') $q$,
    'ok:app_users= breaks=SIUD contacts=SIUD event_comments=SID event_log=S events=SIUD homes=SIU kids=SIU places=SIUD settings=SIUD share_links=SIUD swap_details=SIUD swaps=SIUD teams=SIUD');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION B stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- C. Parent: who they are, and no way into the custody tables
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('C01 parent my_role = parent', 'parent', $q$ select public.my_role() $q$, 'ok:parent');
  perform pg_temp.kt_check('C02 parent my_who = co',      'parent', $q$ select public.my_who() $q$, 'ok:co');
  perform pg_temp.kt_check('C03 parent is_editor',        'parent', $q$ select public.is_editor()::text $q$, 'ok:true');

  perform pg_temp.kt_check('C04 custody tables that have rows', 'postgres',
    $q$ select count(*)::text || ' of 5' from (
          select (select count(*) from public.settings) as n union all
          select (select count(*) from public.breaks) union all
          select (select count(*) from public.swaps) union all
          select (select count(*) from public.swap_details) union all
          select (select count(*) from public.share_links)) s
        where s.n > 0 $q$, null);

  perform pg_temp.kt_check('C05 parent sees 0 settings',     'parent', $q$ select count(*)::text from public.settings $q$,     'ok:0');
  perform pg_temp.kt_check('C06 parent sees 0 breaks',       'parent', $q$ select count(*)::text from public.breaks $q$,       'ok:0');
  perform pg_temp.kt_check('C07 parent sees 0 swaps',        'parent', $q$ select count(*)::text from public.swaps $q$,        'ok:0');
  perform pg_temp.kt_check('C08 parent sees 0 swap_details', 'parent', $q$ select count(*)::text from public.swap_details $q$, 'ok:0');
  perform pg_temp.kt_check('C09 parent sees 0 share_links',  'parent', $q$ select count(*)::text from public.share_links $q$,  'ok:0');
  perform pg_temp.kt_check('C10 parent cannot read app_users', 'parent', $q$ select count(*)::text from public.app_users $q$, 'err:42501');

  perform pg_temp.kt_check('C11 parent cannot add a link', 'parent',
    $q$ with x as (insert into public.share_links (label, active) values ('dryrun parent link', false) returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('C12 parent cannot add breaks', 'parent',
    $q$ with x as (insert into public.breaks (year, data) values (1900, '{}') returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('C13 parent cannot add a swap', 'parent',
    $q$ with x as (insert into public.swaps (day, had) values (date '1900-01-05', 'me') returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('C14 parent cannot add a sign-in', 'parent',
    $q$ with x as (insert into public.app_users (email, role) values ('dryrun-sneak@example.test', 'admin') returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('C15 parent cannot change sign-ins', 'parent',
    $q$ with x as (update public.app_users set role = role returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('C16 parent update settings hits 0', 'parent',
    $q$ with x as (update public.settings set changed_at = changed_at returning 1)
        select count(*)::text from x $q$, 'ok:0');
  perform pg_temp.kt_check('C17 parent update links hits 0', 'parent',
    $q$ with x as (update public.share_links set label = label returning 1)
        select count(*)::text from x $q$, 'ok:0');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION C stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- D. Parent edits activities: the triggers really run
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('D01 parent adds 3 kids', 'parent',
    $q$ with x as (insert into public.kids (name, color, sort, active)
                   values ('Dryrun Kid A', 'orange', 1, true), ('Dryrun Kid B', 'berry', 2, true),
                          ('Dryrun Kid C', 'navy', 3, false)
                   returning 1)
        select count(*)::text from x $q$, 'ok:3');
  perform pg_temp.kt_check('D02 unknown kid color refused', 'parent',
    $q$ with x as (insert into public.kids (name, color) values ('Dryrun Kid X', 'pink') returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('D03 parent adds 2 places', 'parent',
    $q$ with x as (insert into public.places (name, address, lat, lng, drive_me, drive_co, drive_grandma)
                   values ('Dryrun Field', '1 Dryrun Way, Faketown', 12.345678, -45.678901, 15, 25, null),
                          ('Dryrun Far Gym', '9 Dryrun Road, Faketown', null, null, null, null, null)
                   returning 1)
        select count(*)::text from x $q$, 'ok:2');
  perform pg_temp.kt_check('D04 parent adds 2 teams', 'parent',
    $q$ with x as (insert into public.teams (name, kid_ids, place_id, early_practice, early_game, gear, ical_url)
                   values ('Dryrun Soccer',
                           array[(select id from public.kids where name = 'Dryrun Kid A')],
                           (select id from public.places where name = 'Dryrun Field'),
                           10, 30, array['cleats', 'ball'], 'https://example.test/dryrun-private.ics'),
                          ('Dryrun Far Team',
                           array[(select id from public.kids where name = 'Dryrun Kid B')],
                           (select id from public.places where name = 'Dryrun Far Gym'),
                           0, 0, array[]::text[], null)
                   returning 1)
        select count(*)::text from x $q$, 'ok:2');
  perform pg_temp.kt_check('D05 team with unknown kid refused', 'parent',
    $q$ with x as (insert into public.teams (name, kid_ids) values ('Dryrun Bad Team', array[gen_random_uuid()]) returning 1)
        select count(*)::text from x $q$, 'err:23503');

  -- Six activities in ONE statement. The insert claims they were made by 'me'; the database must say 'co'.
  perform pg_temp.kt_check('D06 parent adds 6 events at once', 'parent',
    $q$ with x as (
          insert into public.events (team_id, kid_ids, kind, title, day, start_time, place_id, place_text, created_by, updated_by)
          values
            ((select id from public.teams where name = 'Dryrun Soccer'),
             array[(select id from public.kids where name = 'Dryrun Kid A')],
             'practice', 'Dryrun E1', {kt_today}::date + 1, time '17:30', null, null, 'me', 'me'),
            ((select id from public.teams where name = 'Dryrun Soccer'),
             array[(select id from public.kids where name = 'Dryrun Kid A')],
             'game', 'Dryrun E2', {kt_today}::date + 3, time '09:00', null, null, 'me', 'me'),
            (null,
             array[(select id from public.kids where name = 'Dryrun Kid B')],
             'lesson', 'Dryrun E3', {kt_today}::date + 5, time '16:00', null, 'Dryrun Studio', 'me', 'me'),
            ((select id from public.teams where name = 'Dryrun Far Team'),
             array[(select id from public.kids where name = 'Dryrun Kid B')],
             'practice', 'Dryrun E4', {kt_today}::date - 30, time '10:00',
             (select id from public.places where name = 'Dryrun Far Gym'), null, 'me', 'me'),
            (null,
             array[(select id from public.kids where name = 'Dryrun Kid A'), (select id from public.kids where name = 'Dryrun Kid B')],
             'other', 'Dryrun E5', {kt_today}::date + 90, time '12:00', null, null, 'me', 'me'),
            (null,
             array[(select id from public.kids where name = 'Dryrun Kid A')],
             'other', 'Dryrun E6', {kt_today}::date + 2, time '08:00', null, null, 'me', 'me')
          returning 1)
        select count(*)::text from x $q$, 'ok:6');

  perform pg_temp.kt_set('kt_e1', $q$ select id::text from public.events where title = 'Dryrun E1' $q$);
  perform pg_temp.kt_set('kt_e4', $q$ select id::text from public.events where title = 'Dryrun E4' $q$);
  perform pg_temp.kt_set('kt_e5', $q$ select id::text from public.events where title = 'Dryrun E5' $q$);
  perform pg_temp.kt_set('kt_e6', $q$ select id::text from public.events where title = 'Dryrun E6' $q$);

  perform pg_temp.kt_check('D07 database stamped who (not page)', 'postgres',
    $q$ select count(*)::text from public.events where created_by = 'co' and updated_by = 'co' $q$, 'ok:6');
  perform pg_temp.kt_check('D08 log: 6 events added by co', 'postgres',
    $q$ select count(*)::text from public.event_log
        where action = 'added' and who = 'co' and event_id is not null and after is not null and before is null $q$, 'ok:6');
  perform pg_temp.kt_check('D09 log: 2 teams added by co', 'postgres',
    $q$ select count(*)::text from public.event_log where action = 'added' and who = 'co' and team_id is not null $q$, 'ok:2');
  perform pg_temp.kt_check('D10 one batch for the 6 events', 'postgres',
    $q$ select count(distinct batch_id)::text from public.event_log
        where event_id in (select id from public.events where title like 'Dryrun E%') $q$, 'ok:1');
  perform pg_temp.kt_check('D11 day and time wording', 'postgres',
    $q$ select public.kt_day_text(date '2030-01-01') || ' / ' || public.kt_time_text(time '09:05') || ' / ' || public.kt_time_text(time '17:30') $q$,
    'ok:Tue Jan 1 / 9:05 a.m. / 5:30 p.m.');

  perform pg_temp.kt_check('D12 parent moves E1 to 6:00', 'parent',
    $q$ with x as (update public.events set start_time = time '18:00' where title = 'Dryrun E1' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D13 log: E1 moved, right wording', 'postgres',
    $q$ select count(*)::text from public.event_log
        where event_id = {kt_e1}::uuid and action = 'changed' and who = 'co'
          and summary like 'moved Dryrun Soccer practice on % from 5:30 p.m. to 6:00 p.m.' $q$, 'ok:1');

  perform pg_temp.kt_check('D14 parent cancels E2', 'parent',
    $q$ with x as (update public.events set status = 'canceled' where title = 'Dryrun E2' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D15 log: E2 canceled', 'postgres',
    $q$ select count(*)::text from public.event_log
        where event_id = (select id from public.events where title = 'Dryrun E2')
          and action = 'canceled' and summary like 'canceled Dryrun Soccer game on %' $q$, 'ok:1');
  perform pg_temp.kt_check('D16 parent restores E2', 'parent',
    $q$ with x as (update public.events set status = 'on' where title = 'Dryrun E2' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D17 log: E2 restored', 'postgres',
    $q$ select count(*)::text from public.event_log
        where event_id = (select id from public.events where title = 'Dryrun E2') and action = 'restored' $q$, 'ok:1');
  perform pg_temp.kt_check('D18 parent cancels E3', 'parent',
    $q$ with x as (update public.events set status = 'canceled' where title = 'Dryrun E3' returning 1)
        select count(*)::text from x $q$, 'ok:1');

  perform pg_temp.kt_check('D19 no-op save of E1 goes through', 'parent',
    $q$ with x as (update public.events set note = note, start_time = start_time where title = 'Dryrun E1' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D20 no-op save wrote no log line', 'postgres',
    $q$ select count(*)::text from public.event_log where event_id = {kt_e1}::uuid $q$, 'ok:2');

  perform pg_temp.kt_check('D21 parent removes E6', 'parent',
    $q$ with x as (delete from public.events where title = 'Dryrun E6' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D22 log kept after removal', 'postgres',
    $q$ select count(*)::text || '/' || (count(*) filter (where action = 'removed' and who = 'co' and before is not null and after is null))::text
        from public.event_log where event_id = {kt_e6}::uuid $q$, 'ok:2/1');

  perform pg_temp.kt_check('D23 parent changes team gear', 'parent',
    $q$ with x as (update public.teams set gear = array['cleats', 'ball', 'shin guards'] where name = 'Dryrun Soccer' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D24 log: team gear changed', 'postgres',
    $q$ select count(*)::text from public.event_log
        where team_id = (select id from public.teams where name = 'Dryrun Soccer')
          and action = 'changed' and who = 'co' and summary like 'changed the team "Dryrun Soccer": gear' $q$, 'ok:1');
  perform pg_temp.kt_check('D25 calendar link never in the log', 'postgres',
    $q$ select count(*)::text from public.event_log
        where before::text like '%ical_url%' or after::text like '%ical_url%'
           or before::text like '%dryrun-private%' or after::text like '%dryrun-private%'
           or summary like '%dryrun-private%' $q$, 'ok:0');
  perform pg_temp.kt_check('D26 summaries start with a verb', 'postgres',
    $q$ select (count(*) > 0 and bool_and(summary ~ '^[a-z]+ ') and bool_and(length(btrim(summary)) > 8))::text
        from public.event_log $q$, 'ok:true');
  perform pg_temp.kt_check('D27 every log line so far is co', 'postgres',
    $q$ select bool_and(who = 'co')::text from public.event_log $q$, 'ok:true');
  perform pg_temp.kt_check('D28 changed_at moved to this run', 'postgres',
    $q$ select (changed_at = now())::text from public.settings where id = 1 $q$, 'ok:true');

  perform pg_temp.kt_check('D29 parent cannot remove a kid', 'parent',
    $q$ with x as (delete from public.kids where name = 'Dryrun Kid C' returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('D30 parent cannot add log lines', 'parent',
    $q$ with x as (insert into public.event_log (action, event_id, summary, batch_id)
                   values ('added', gen_random_uuid(), 'dryrun fake line', gen_random_uuid()) returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('D31 parent cannot change log lines', 'parent',
    $q$ with x as (update public.event_log set summary = summary returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('D32 parent cannot remove log lines', 'parent',
    $q$ with x as (delete from public.event_log returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('D33 parent can read the log', 'parent',
    $q$ select (count(*) > 0)::text from public.event_log $q$, 'ok:true');
  perform pg_temp.kt_check('D34 parent cannot write contacts', 'parent',
    $q$ with x as (insert into public.contacts (who, label, phone) values ('co', 'Dryrun Parent', '555-555-0101') returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('D35 parent saves a home', 'parent',
    $q$ with x as (insert into public.homes (who, address) values ('co', '2 Dryrun Lane, Faketown')
                   on conflict (who) do update set address = excluded.address returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('D36 place in use cannot be removed', 'parent',
    $q$ with x as (delete from public.places where name = 'Dryrun Field' returning 1)
        select count(*)::text from x $q$, 'err:23503');
  perform pg_temp.kt_check('D37 event with unknown kid refused', 'parent',
    $q$ with x as (insert into public.events (kid_ids, title, day, start_time)
                   values (array[gen_random_uuid()], 'Dryrun Bad', {kt_today}::date, time '10:00') returning 1)
        select count(*)::text from x $q$, 'err:23503');
  perform pg_temp.kt_check('D38 event needs a team or a title', 'parent',
    $q$ with x as (insert into public.events (kid_ids, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')], {kt_today}::date, time '10:00') returning 1)
        select count(*)::text from x $q$, 'err:23514');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION D stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- U. Import de-duplication: an upsert on source_uid updates, never doubles
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('U01 parent imports one event', 'parent',
    $q$ with x as (insert into public.events (kid_ids, kind, title, day, start_time, source, source_uid)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'game', 'Dryrun Import', {kt_today}::date + 7, time '10:00', 'file', 'dryrun-uid-1')
                   returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('U02 same id again with a new time', 'parent',
    $q$ with x as (insert into public.events (kid_ids, kind, title, day, start_time, source, source_uid)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'game', 'Dryrun Import', {kt_today}::date + 7, time '11:00', 'file', 'dryrun-uid-1')
                   on conflict (source_uid) do update
                     set kid_ids = excluded.kid_ids, kind = excluded.kind, title = excluded.title,
                         day = excluded.day, start_time = excluded.start_time, source = excluded.source,
                         source_uid = excluded.source_uid
                   returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('U03 one row, new time', 'postgres',
    $q$ select count(*)::text || '/' || max(start_time)::text from public.events where source_uid = 'dryrun-uid-1' $q$, 'ok:1/11:00:00');
  perform pg_temp.kt_check('U04 identical re-import goes through', 'parent',
    $q$ with x as (insert into public.events (kid_ids, kind, title, day, start_time, source, source_uid)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'game', 'Dryrun Import', {kt_today}::date + 7, time '11:00', 'file', 'dryrun-uid-1')
                   on conflict (source_uid) do update
                     set kid_ids = excluded.kid_ids, kind = excluded.kind, title = excluded.title,
                         day = excluded.day, start_time = excluded.start_time, source = excluded.source,
                         source_uid = excluded.source_uid
                   returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('U05 log: added + changed, no more', 'postgres',
    $q$ select coalesce(string_agg(action, ',' order by action collate "C"), '(none)') from public.event_log
        where event_id = (select id from public.events where source_uid = 'dryrun-uid-1') $q$, 'ok:added,changed');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION U stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- K. Ids and keys cannot be changed, and upserts shaped like the API's still work
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('K01 kid id cannot be changed', 'parent',
    $q$ with x as (update public.kids set id = gen_random_uuid() where name = 'Dryrun Kid C' returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('K02 event id cannot be changed', 'parent',
    $q$ with x as (update public.events set id = gen_random_uuid() where title = 'Dryrun E1' returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('K03 team and place ids fixed too', 'parent',
    $q$ with x as (update public.teams set id = gen_random_uuid() where name = 'Dryrun Far Team' returning 1),
             y as (update public.places set id = gen_random_uuid() where name = 'Dryrun Far Gym' returning 1)
        select ((select count(*) from x) + (select count(*) from y))::text $q$, 'err:42501');
  perform pg_temp.kt_check('K04 home key cannot be changed', 'parent',
    $q$ with x as (update public.homes set who = 'me' where who = 'co' returning 1)
        select count(*)::text from x $q$, 'err:42501');
  -- The API writes every column it was sent into the update, the id included ("id = the same id").
  perform pg_temp.kt_check('K05 upsert on id, API shape', 'parent',
    $q$ with x as (insert into public.kids (id, name, color, sort, active)
                   values ((select id from public.kids where name = 'Dryrun Kid C'), 'Dryrun Kid C', 'charcoal', 3, false)
                   on conflict (id) do update
                     set id = excluded.id, name = excluded.name, color = excluded.color,
                         sort = excluded.sort, active = excluded.active
                   returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('K06 that upsert changed the row', 'postgres',
    $q$ select count(*)::text || '/' || max(color) from public.kids where name = 'Dryrun Kid C' $q$, 'ok:1/charcoal');
  perform pg_temp.kt_check('K07 upsert on home key, API shape', 'parent',
    $q$ with x as (insert into public.homes (who, address) values ('co', '3 Dryrun Lane, Faketown')
                   on conflict (who) do update set who = excluded.who, address = excluded.address returning 1)
        select count(*)::text from x $q$, 'ok:1');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION K stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- L. Limits on free text
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('L01 parent saves a messy gear list', 'parent',
    $q$ with x as (update public.teams set gear = array['  cones ', '', 'bibs', '   '] where name = 'Dryrun Far Team' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('L02 gear items trimmed, blanks gone', 'postgres',
    $q$ select array_to_string(gear, '|') from public.teams where name = 'Dryrun Far Team' $q$, 'ok:cones|bibs');
  perform pg_temp.kt_check('L03 title with a line break refused', 'parent',
    $q$ with x as (insert into public.events (kid_ids, title, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'Dryrun' || chr(10) || 'added a forged line', {kt_today}::date, time '10:00') returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L03b Unicode line separator refused', 'parent',
    $q$ with x as (insert into public.events (kid_ids, title, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'Dryrun' || chr(8232) || 'added a forged line', {kt_today}::date, time '10:00') returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L03c ordinary punctuation is fine', 'parent',
    $q$ with x as (update public.events set title = 'Dryrun E5' where title = 'Dryrun E5' returning 1),
             y as (update public.places set note = 'Gate code: none. Park by the "big" oak, it''s on the left (u-turn ok).' || chr(10) || 'Second line.'
                   where name = 'Dryrun Far Gym' returning 1)
        select ((select count(*) from x) + (select count(*) from y))::text $q$, 'ok:2');
  perform pg_temp.kt_check('L04 title over 120 refused', 'parent',
    $q$ with x as (insert into public.events (kid_ids, title, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           repeat('x', 121), {kt_today}::date, time '10:00') returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L05 day far out of range refused', 'parent',
    $q$ with x as (insert into public.events (kid_ids, title, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'Dryrun Far Future', date '2200-01-01', time '10:00') returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L06 team name line break refused', 'parent',
    $q$ with x as (insert into public.teams (name, kid_ids)
                   values ('Dryrun' || chr(13) || chr(10) || 'Team', array[(select id from public.kids where name = 'Dryrun Kid A')]) returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L07 gear over 50 items refused', 'parent',
    $q$ with x as (update public.teams set gear = array(select 'item ' || g from generate_series(1, 51) g)
                   where name = 'Dryrun Far Team' returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L08 gear item over 80 refused', 'parent',
    $q$ with x as (update public.teams set gear = array[repeat('x', 81)] where name = 'Dryrun Far Team' returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L09 comment over 2000 refused', 'parent',
    $q$ with x as (insert into public.event_comments (event_id, body) values ({kt_e1}::uuid, repeat('x', 2001)) returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L10 note over 2000 refused', 'parent',
    $q$ with x as (update public.events set note = repeat('x', 2001) where title = 'Dryrun E1' returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('L11 a long but fair note is fine', 'parent',
    $q$ with x as (update public.places set note = repeat('Bring water. ', 100) where name = 'Dryrun Far Gym' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('L12 parent cannot truncate', 'parent',
    $q$ truncate public.homes $q$, 'err:42501');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION L stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- M. Comments
-- ---------------------------------------------------------------
do $main$
begin
  -- The admin's insert lies about the author and about sharing. The database must correct both.
  perform pg_temp.kt_check('M01 admin adds a private comment', 'admin',
    $q$ with x as (insert into public.event_comments (event_id, body, tagged, share_family, author)
                   values ({kt_e1}::uuid, 'Dryrun private comment', array['co'], true, 'co') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M02 author me, not shared', 'postgres',
    $q$ select author || '/' || share_family::text from public.event_comments where body = 'Dryrun private comment' $q$, 'ok:me/false');
  perform pg_temp.kt_check('M03 parent adds a shared comment', 'parent',
    $q$ with x as (insert into public.event_comments (event_id, body, tagged, share_family, author)
                   values ({kt_e1}::uuid, 'Dryrun shared comment', array['grandma', 'me'], false, 'me') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M04 author co, shared', 'postgres',
    $q$ select author || '/' || share_family::text from public.event_comments where body = 'Dryrun shared comment' $q$, 'ok:co/true');
  perform pg_temp.kt_check('M05 shared comment, outside event', 'parent',
    $q$ with x as (insert into public.event_comments (event_id, body, tagged)
                   values ({kt_e4}::uuid, 'Dryrun outside comment', array['grandma']) returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M06 parent cannot remove admin''s', 'parent',
    $q$ with x as (delete from public.event_comments where body = 'Dryrun private comment' returning 1)
        select count(*)::text from x $q$, 'ok:0');
  perform pg_temp.kt_check('M07 parent adds one to remove', 'parent',
    $q$ with x as (insert into public.event_comments (event_id, body) values ({kt_e1}::uuid, 'Dryrun temp comment') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M08 parent removes their own', 'parent',
    $q$ with x as (delete from public.event_comments where body = 'Dryrun temp comment' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M09 comments cannot be edited', 'parent',
    $q$ with x as (update public.event_comments set body = 'Dryrun edited' where body = 'Dryrun shared comment' returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('M10 unknown tag refused', 'parent',
    $q$ with x as (insert into public.event_comments (event_id, body, tagged)
                   values ({kt_e1}::uuid, 'Dryrun bad tag', array['someone']) returning 1)
        select count(*)::text from x $q$, 'err:23514');
  perform pg_temp.kt_check('M11 three comments remain', 'postgres',
    $q$ select count(*)::text from public.event_comments $q$, 'ok:3');

  -- Removing an event removes its comments. The other person's comment must survive in the log detail.
  perform pg_temp.kt_check('M12 parent adds event E8', 'parent',
    $q$ with x as (insert into public.events (kid_ids, title, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'Dryrun E8', {kt_today}::date + 6, time '15:00') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_set('kt_e8', $q$ select id::text from public.events where title = 'Dryrun E8' $q$);
  perform pg_temp.kt_check('M13 admin comments on E8, shared', 'admin',
    $q$ with x as (insert into public.event_comments (event_id, body, tagged)
                   values ({kt_e8}::uuid, 'Dryrun kept comment', array['grandma']) returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M14 family saw it while E8 existed', 'postgres',
    $q$ select (public.get_schedule({kt_tok})::text like '%Dryrun kept comment%')::text $q$, 'ok:true');
  perform pg_temp.kt_check('M15 parent removes E8', 'parent',
    $q$ with x as (delete from public.events where title = 'Dryrun E8' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('M16 the comment row is gone', 'postgres',
    $q$ select count(*)::text from public.event_comments where body = 'Dryrun kept comment' $q$, 'ok:0');
  perform pg_temp.kt_check('M17 log keeps the comment (before)', 'postgres',
    $q$ select count(*)::text from public.event_log
        where event_id = {kt_e8}::uuid and action = 'removed' and who = 'co' and after is null
          and jsonb_array_length(before -> 'comments') = 1
          and before -> 'comments' @> '[{"author": "me", "body": "Dryrun kept comment", "tagged": ["grandma"], "share_family": true}]'::jsonb
          and (before -> 'comments' -> 0) ? 'at' $q$, 'ok:1');
  perform pg_temp.kt_check('M18 parent can read that detail', 'parent',
    $q$ select (before -> 'comments' -> 0 ->> 'body') from public.event_log
        where event_id = {kt_e8}::uuid and action = 'removed' $q$, 'ok:Dryrun kept comment');
  perform pg_temp.kt_check('M19 family link no longer has it', 'postgres',
    $q$ select (public.get_schedule({kt_tok})::text like '%Dryrun kept comment%')::text $q$, 'ok:false');
  perform pg_temp.kt_check('M20 editor payload does not either', 'parent',
    $q$ select (public.get_editor_schedule()::text like '%Dryrun kept comment%')::text $q$, 'ok:false');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION M stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- N. Admin, and a signed-in person who is on no list
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('N01 admin my_role = admin', 'admin', $q$ select public.my_role() $q$, 'ok:admin');
  perform pg_temp.kt_check('N02 admin my_who = me',     'admin', $q$ select public.my_who() $q$, 'ok:me');
  perform pg_temp.kt_check('N03 admin sees all custody rows', 'admin',
    $q$ select (concat_ws(',',
          (select count(*) from public.settings), (select count(*) from public.breaks),
          (select count(*) from public.swaps), (select count(*) from public.swap_details),
          (select count(*) from public.share_links)) = {kt_counts})::text $q$, 'ok:true');
  perform pg_temp.kt_check('N04 admin can save settings', 'admin',
    $q$ with x as (update public.settings set changed_at = changed_at where id = 1 returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('N05 admin can add a link', 'admin',
    $q$ with x as (insert into public.share_links (label, active) values ('dryrun admin link', false) returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('N06 admin cannot read app_users', 'admin', $q$ select count(*)::text from public.app_users $q$, 'err:42501');

  perform pg_temp.kt_check('N07 admin adds a contact', 'admin',
    $q$ with x as (insert into public.contacts (who, label, phone) values ('grandma', 'Dryrun Grandma', '555-555-0100') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('N08 admin changes a contact', 'admin',
    $q$ with x as (update public.contacts set phone = '555-555-0102' where who = 'grandma' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('N09 parent can read contacts', 'parent', $q$ select count(*)::text from public.contacts $q$, 'ok:1');
  perform pg_temp.kt_check('N10 parent cannot change contacts', 'parent',
    $q$ with x as (update public.contacts set phone = '555-555-0103' returning 1)
        select count(*)::text from x $q$, 'ok:0');

  perform pg_temp.kt_check('N11 admin adds an event', 'admin',
    $q$ with x as (insert into public.events (team_id, kid_ids, kind, title, day, start_time, created_by, updated_by)
                   values ((select id from public.teams where name = 'Dryrun Soccer'),
                           array[(select id from public.kids where name = 'Dryrun Kid A')],
                           'game', 'Dryrun E7', {kt_today}::date + 4, time '13:00', 'co', 'co') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('N12 stamped me, logged me', 'postgres',
    $q$ select e.created_by || '/' || e.updated_by || '/' || (select l.who from public.event_log l where l.event_id = e.id and l.action = 'added')
        from public.events e where e.title = 'Dryrun E7' $q$, 'ok:me/me/me');
  perform pg_temp.kt_check('N13 admin edits E1 note', 'admin',
    $q$ with x as (update public.events set note = 'Dryrun shared note' where title = 'Dryrun E1' returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('N14 E1 made by co, changed by me', 'postgres',
    $q$ select created_by || '/' || updated_by from public.events where title = 'Dryrun E1' $q$, 'ok:co/me');
  perform pg_temp.kt_check('N15 log: E1 note updated by me', 'postgres',
    $q$ select count(*)::text from public.event_log
        where event_id = {kt_e1}::uuid and who = 'me' and action = 'changed'
          and summary like 'updated Dryrun Soccer practice on %: note' $q$, 'ok:1');
  perform pg_temp.kt_check('N16 admin cannot remove a kid', 'admin',
    $q$ with x as (delete from public.kids where name = 'Dryrun Kid C' returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('N17 admin cannot write the log', 'admin',
    $q$ with x as (delete from public.event_log returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('N18 team in use cannot be removed', 'admin',
    $q$ with x as (delete from public.teams where name = 'Dryrun Soccer' returning 1)
        select count(*)::text from x $q$, 'err:23503');
  perform pg_temp.kt_check('N19 admin gets editor schedule', 'admin',
    $q$ select (public.get_editor_schedule() is not null)::text $q$, 'ok:true');

  perform pg_temp.kt_check('X01 nobody has no role', 'nobody', $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt_check('X02 nobody is not an editor', 'nobody', $q$ select public.is_editor()::text $q$, 'ok:false');
  perform pg_temp.kt_check('X03 nobody sees 0 kids', 'nobody', $q$ select count(*)::text from public.kids $q$, 'ok:0');
  perform pg_temp.kt_check('X04 nobody sees 0 events', 'nobody', $q$ select count(*)::text from public.events $q$, 'ok:0');
  perform pg_temp.kt_check('X05 nobody sees 0 settings', 'nobody', $q$ select count(*)::text from public.settings $q$, 'ok:0');
  perform pg_temp.kt_check('X06 nobody cannot add a kid', 'nobody',
    $q$ with x as (insert into public.kids (name, color) values ('Dryrun Kid N', 'navy') returning 1)
        select count(*)::text from x $q$, 'err:42501');
  perform pg_temp.kt_check('X07 nobody gets null schedule', 'nobody',
    $q$ select (public.get_editor_schedule() is null)::text $q$, 'ok:true');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION N stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- P. A private note planted by the fake admin must never come out
-- The swap is made up and dated in the year 1900 so it cannot touch a real day.
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('P01 admin plants a 1900 swap', 'admin',
    $q$ with x as (insert into public.swaps (day, had) values (date '1900-01-05', 'co') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('P02 admin adds its private note', 'admin',
    $q$ with x as (insert into public.swap_details (day, reason, note, pnote)
                   values (date '1900-01-05', 'other', 'Dryrun shared swap note', 'DRYRUN-PNOTE-SENTINEL') returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt_check('P03 parent still sees 0 swap_details', 'parent',
    $q$ select count(*)::text from public.swap_details $q$, 'ok:0');
  perform pg_temp.kt_check('P04 parent still sees 0 swaps', 'parent',
    $q$ select count(*)::text from public.swaps $q$, 'ok:0');
  perform pg_temp.kt_check('P05 family: shared note yes, private no', 'postgres',
    $q$ select (p like '%Dryrun shared swap note%')::text || '/' || (p like '%DRYRUN-PNOTE-SENTINEL%')::text
        from (select public.get_schedule({kt_tok})::text as p) s $q$, 'ok:true/false');
  perform pg_temp.kt_check('P06 anon: shared note yes, private no', 'anon',
    $q$ select (p like '%Dryrun shared swap note%')::text || '/' || (p like '%DRYRUN-PNOTE-SENTINEL%')::text
        from (select public.get_schedule({kt_tok})::text as p) s $q$, 'ok:true/false');
  perform pg_temp.kt_check('P07 editor: shared note yes, private no', 'parent',
    $q$ select (p like '%Dryrun shared swap note%')::text || '/' || (p like '%DRYRUN-PNOTE-SENTINEL%')::text
        from (select public.get_editor_schedule()::text as p) s $q$, 'ok:true/false');
  perform pg_temp.kt_check('P08 link token not in editor payload', 'parent',
    $q$ select (position({kt_tok} in public.get_editor_schedule()::text) > 0 or position({kt_tok_off} in public.get_editor_schedule()::text) > 0)::text $q$, 'ok:false');
  perform pg_temp.kt_check('P09 link token not in family payload', 'postgres',
    $q$ select (position({kt_tok} in public.get_schedule({kt_tok})::text) > 0)::text $q$, 'ok:false');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION P stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- F. What the family link returns
-- At this point the made-up activities are: E1, E2, E3 (canceled), E7 and Import inside the window;
-- E4 (30 days back) and E5 (90 days ahead) outside it; E6 removed.
-- ---------------------------------------------------------------
do $main$
begin
  -- A fingerprint of the core payload, taken after the last write. It lets the anon and parent calls be
  -- compared with it inside the database. Held in the scratch table only, never put in the report.
  perform pg_temp.kt_set('kt_core_md5', $q$ select md5(public.kt_schedule_core()::text) $q$);

  perform pg_temp.kt_check('F01 top-level keys exact', 'postgres',
    $q$ select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.get_schedule({kt_tok})) k $q$,
    'ok:breaks,changed_at,comments,events,kids,log,places,settings,swaps,teams,window');
  perform pg_temp.kt_check('F02 four old keys = core payload', 'postgres',
    $q$ select ((public.get_schedule({kt_tok}) - '{window,kids,places,teams,events,comments,log}'::text[]) = public.kt_schedule_core())::text $q$, 'ok:true');
  perform pg_temp.kt_check('F03 core still same as before 07', 'postgres',
    $q$ select (pg_temp.kt_old_payload() = public.kt_schedule_core())::text $q$, 'ok:true');
  perform pg_temp.kt_check('F04 old keys: types', 'postgres',
    $q$ select concat_ws(',', jsonb_typeof(c -> 'settings'), jsonb_typeof(c -> 'changed_at'), jsonb_typeof(c -> 'breaks'), jsonb_typeof(c -> 'swaps'))
        from (select public.get_schedule({kt_tok}) as c) s $q$, 'ok:object,string,array,array');
  perform pg_temp.kt_check('F05 old keys: settings fields', 'postgres',
    $q$ select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.get_schedule({kt_tok}) -> 'settings') k $q$,
    'ok:anchor,co_name,my_name');
  perform pg_temp.kt_check('F06 old keys: swaps fields', 'postgres',
    $q$ select coalesce(bool_and((select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(e) k) = 'caregiver,day,had,note,reason,updated_at'), true)::text
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'swaps') e $q$, 'ok:true');
  perform pg_temp.kt_check('F07 old keys: breaks fields', 'postgres',
    $q$ select coalesce(bool_and((select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(e) k) = 'data,year'), true)::text
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'breaks') e $q$, 'ok:true');

  perform pg_temp.kt_check('F08 no private key at any depth', 'postgres',
    $q$ select count(*)::text
        from jsonb_path_query(public.get_schedule({kt_tok}), 'strict $.** ? (@.type() == "object")') o,
             lateral jsonb_object_keys(o) k
        where k in ('pnote', 'track_from', 'ical_url', 'lat', 'lng', 'phone', 'before', 'after', 'source_uid') $q$, 'ok:0');
  perform pg_temp.kt_check('F09 the key search does look deep', 'postgres',
    $q$ select (count(*) > 0)::text
        from jsonb_path_query(public.get_schedule({kt_tok}), 'strict $.** ? (@.type() == "object")') o,
             lateral jsonb_object_keys(o) k
        where k = 'kid_ids' $q$, 'ok:true');
  perform pg_temp.kt_check('F10 no private value leaked', 'postgres',
    $q$ select ((public.get_schedule({kt_tok}) - '{settings,changed_at,breaks,swaps}'::text[])::text
               ~ 'dryrun-private|555-555-01|Dryrun Lane|Dryrun Grandma|example\.test|dryrun-uid|12\.345678|45\.678901')::text $q$, 'ok:false');

  perform pg_temp.kt_check('F11 only events inside the window', 'postgres',
    $q$ select string_agg(e ->> 'title', ',' order by e ->> 'title' collate "C")
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'events') e $q$,
    'ok:Dryrun E1,Dryrun E2,Dryrun E3,Dryrun E7,Dryrun Import');
  perform pg_temp.kt_check('F12 canceled event shown canceled', 'postgres',
    $q$ select e ->> 'status' from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'events') e
        where e ->> 'title' = 'Dryrun E3' $q$, 'ok:canceled');
  perform pg_temp.kt_check('F13 event fields exact', 'postgres',
    $q$ select string_agg(distinct ks, ' | ') from (
          select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(e) k) as ks
          from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'events') e) s $q$,
    'ok:arrive_by,created_at,day,end_time,gear,id,kid_ids,kind,note,place_id,place_text,start_time,status,team_id,title,updated_at,updated_by');
  perform pg_temp.kt_check('F14 event value formats', 'postgres',
    $q$ select (e ->> 'start_time') || ' ' || ((e ->> 'day') = ({kt_today}::date + 1)::text)::text || ' ' || jsonb_typeof(e -> 'kid_ids') || ' ' || (e ->> 'updated_by')
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'events') e where e ->> 'title' = 'Dryrun E1' $q$,
    'ok:18:00:00 true array me');

  perform pg_temp.kt_check('F15 only shared comments in window', 'postgres',
    $q$ select coalesce(string_agg(c ->> 'body', ',' order by c ->> 'body' collate "C"), '(none)')
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'comments') c $q$, 'ok:Dryrun shared comment');
  perform pg_temp.kt_check('F16 comment fields exact', 'postgres',
    $q$ select string_agg(distinct ks, ' | ') from (
          select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(c) k) as ks
          from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'comments') c) s $q$,
    'ok:at,author,body,event_id,id,share_family,tagged');
  perform pg_temp.kt_check('F17 only places in use', 'postgres',
    $q$ select coalesce(string_agg(p ->> 'name', ',' order by p ->> 'name' collate "C"), '(none)')
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'places') p $q$, 'ok:Dryrun Field');
  perform pg_temp.kt_check('F18 place fields exact', 'postgres',
    $q$ select string_agg(distinct ks, ' | ') from (
          select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(p) k) as ks
          from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'places') p) s $q$,
    'ok:address,drive_co,drive_grandma,drive_me,id,name,note');
  perform pg_temp.kt_check('F19 only teams in use', 'postgres',
    $q$ select coalesce(string_agg(t ->> 'name', ',' order by t ->> 'name' collate "C"), '(none)')
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'teams') t $q$, 'ok:Dryrun Soccer');
  perform pg_temp.kt_check('F20 team fields exact', 'postgres',
    $q$ select string_agg(distinct ks, ' | ') from (
          select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(t) k) as ks
          from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'teams') t) s $q$,
    'ok:active,early_game,early_practice,gear,id,kid_ids,name,note,place_id');
  perform pg_temp.kt_check('F21 active kids only', 'postgres',
    $q$ select coalesce(string_agg(k ->> 'name', ',' order by k ->> 'name' collate "C"), '(none)')
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'kids') k $q$, 'ok:Dryrun Kid A,Dryrun Kid B');
  perform pg_temp.kt_check('F22 kid fields exact', 'postgres',
    $q$ select string_agg(distinct ks, ' | ') from (
          select (select string_agg(f, ',' order by f collate "C") from jsonb_object_keys(k) f) as ks
          from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'kids') k) s $q$,
    'ok:active,color,id,name,sort');

  perform pg_temp.kt_check('F23 log: nothing for outside events', 'postgres',
    $q$ select count(*)::text from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'log') l
        where l ->> 'event_id' in ({kt_e4}, {kt_e5}) $q$, 'ok:0');
  perform pg_temp.kt_check('F24 log: 3 lines for E1', 'postgres',
    $q$ select count(*)::text from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'log') l
        where l ->> 'event_id' = {kt_e1} $q$, 'ok:3');
  perform pg_temp.kt_check('F25 log: removed E6 still listed', 'postgres',
    $q$ select coalesce(string_agg(l ->> 'action', ',' order by l ->> 'action' collate "C"), '(none)')
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'log') l
        where l ->> 'event_id' = {kt_e6} $q$, 'ok:added,removed');
  perform pg_temp.kt_check('F26 log: team lines, in-use team only', 'postgres',
    $q$ select count(*)::text from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'log') l
        where l ->> 'team_id' is not null $q$, 'ok:2');
  perform pg_temp.kt_check('F27 log line fields exact', 'postgres',
    $q$ select string_agg(distinct ks, ' | ') from (
          select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(l) k) as ks
          from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'log') l) s $q$,
    'ok:action,at,batch_count,batch_id,event_id,id,source,summary,team_id,who');
  -- The whole dry run is one transaction, so every line is in one batch. batch_count must be the full
  -- count for that action, including lines the family link does not get.
  perform pg_temp.kt_check('F28 batch_count is the full count', 'postgres',
    $q$ select bool_and((l ->> 'batch_count')::int = (select count(*) from public.event_log x where x.action = l ->> 'action'))::text
        from jsonb_array_elements(public.get_schedule({kt_tok}) -> 'log') l $q$, 'ok:true');
  perform pg_temp.kt_check('F29 window is 7 back, 60 ahead', 'postgres',
    $q$ select ((p -> 'window' ->> 'from')::date = {kt_today}::date - 7 and (p -> 'window' ->> 'to')::date = {kt_today}::date + 60)::text
        from (select public.get_schedule({kt_tok}) as p) s $q$, 'ok:true');

  perform pg_temp.kt_check('F30 wrong link gets null', 'postgres',
    $q$ select (public.get_schedule('not-a-real-link') is null)::text $q$, 'ok:true');
  perform pg_temp.kt_check('F31 turned-off link gets null', 'postgres',
    $q$ select (public.get_schedule({kt_tok_off}) is null)::text $q$, 'ok:true');
  perform pg_temp.kt_check('F32 empty link gets null', 'postgres',
    $q$ select (public.get_schedule(null) is null and public.get_schedule('') is null)::text $q$, 'ok:true');

  -- The live family page contract: the public key, a good link, and the four old keys untouched.
  perform pg_temp.kt_check('F33 anon: four old keys = core', 'anon',
    $q$ select (md5((public.get_schedule({kt_tok}) - '{window,kids,places,teams,events,comments,log}'::text[])::text) = {kt_core_md5})::text $q$, 'ok:true');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION F stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- G. What a signed-in parent gets from get_editor_schedule
-- ---------------------------------------------------------------
do $main$
begin
  perform pg_temp.kt_check('G01 top-level keys exact', 'parent',
    $q$ select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.get_editor_schedule()) k $q$,
    'ok:breaks,changed_at,comments,events,kids,log,places,settings,swaps,teams,window');
  perform pg_temp.kt_check('G02 four old keys = core payload', 'parent',
    $q$ select (md5((public.get_editor_schedule() - '{window,kids,places,teams,events,comments,log}'::text[])::text) = {kt_core_md5})::text $q$, 'ok:true');
  perform pg_temp.kt_check('G03 every comment, shared or not', 'parent',
    $q$ select coalesce(string_agg(c ->> 'body', ',' order by c ->> 'body' collate "C"), '(none)')
        from jsonb_array_elements(public.get_editor_schedule() -> 'comments') c $q$,
    'ok:Dryrun outside comment,Dryrun private comment,Dryrun shared comment');
  perform pg_temp.kt_check('G04 no private key at any depth', 'parent',
    $q$ select count(*)::text
        from jsonb_path_query(public.get_editor_schedule(), 'strict $.** ? (@.type() == "object")') o,
             lateral jsonb_object_keys(o) k
        where k in ('pnote', 'track_from', 'ical_url', 'lat', 'lng', 'phone', 'before', 'after', 'source_uid') $q$, 'ok:0');
  perform pg_temp.kt_check('G05 no private value leaked', 'parent',
    $q$ select ((public.get_editor_schedule() - '{settings,changed_at,breaks,swaps}'::text[])::text
               ~ 'dryrun-private|555-555-01|Dryrun Lane|Dryrun Grandma|example\.test|dryrun-uid|12\.345678|45\.678901')::text $q$, 'ok:false');
  perform pg_temp.kt_check('G06 every event, no window', 'parent',
    $q$ select string_agg(e ->> 'title', ',' order by e ->> 'title' collate "C")
        from jsonb_array_elements(public.get_editor_schedule() -> 'events') e $q$,
    'ok:Dryrun E1,Dryrun E2,Dryrun E3,Dryrun E4,Dryrun E5,Dryrun E7,Dryrun Import');
  perform pg_temp.kt_check('G07 every place, team and kid', 'parent',
    $q$ select jsonb_array_length(p -> 'places')::text || '/' || jsonb_array_length(p -> 'teams')::text || '/' || jsonb_array_length(p -> 'kids')::text
        from (select public.get_editor_schedule() as p) s $q$, 'ok:2/2/3');
  perform pg_temp.kt_check('G08 date range limits events', 'parent',
    $q$ select coalesce(string_agg(e ->> 'title', ',' order by e ->> 'title' collate "C"), '(none)')
        from jsonb_array_elements(public.get_editor_schedule({kt_today}::date, {kt_today}::date + 2) -> 'events') e $q$,
    'ok:Dryrun E1');
  perform pg_temp.kt_check('G09 log covers outside events too', 'parent',
    $q$ select count(*)::text from jsonb_array_elements(public.get_editor_schedule() -> 'log') l
        where l ->> 'event_id' in ({kt_e4}, {kt_e5}) $q$, 'ok:2');
  perform pg_temp.kt_check('G10 window is open-ended', 'parent',
    $q$ select jsonb_typeof(p -> 'window' -> 'from') || '/' || jsonb_typeof(p -> 'window' -> 'to')
        from (select public.get_editor_schedule() as p) s $q$, 'ok:null/null');
exception when others then
  insert into pg_temp.kt_dry (name, ok, detail) values ('SECTION G stopped early', false, sqlstate || ' ' || left(sqlerrm, 120));
end
$main$;

-- ---------------------------------------------------------------
-- Report. ALWAYS raises, pass or fail. The error ends the transaction this file is running in.
-- This file cannot see what happens to that transaction afterwards, so the message never says that
-- anything was undone. The caller confirms that with DRYRUN-99-aftercheck.sql in a separate call.
-- ---------------------------------------------------------------
do $report$
declare
  v_expected constant int := 214;  -- the number of kt_check calls in this file
  v_note   constant text := 'Dry run only. Confirm from a separate call (DRYRUN-99-aftercheck.sql) that nothing persisted.';
  v_msg    text;
  v_total  int;
  v_pass   int;
  v_fail   int;
  v_failed text;
  v_passed text;
begin
  v_msg := 'KT DRYRUN txid=' || txid_current() || ': the report could not be built. ' || v_note;
  begin
    select count(*), count(*) filter (where d.ok), count(*) filter (where not d.ok)
      into v_total, v_pass, v_fail
      from pg_temp.kt_dry d;
    select coalesce(string_agg('FAIL ' || d.name || ' -> ' || d.detail, E'\n' order by d.n), '(none)')
      into v_failed
      from pg_temp.kt_dry d where not d.ok;
    -- Passed checks are listed by their id only, one line per section, to keep the message short.
    -- The id is the first word of the check's name in this file.
    select coalesce(string_agg(g.ids, E'\n' order by g.first_n), '(none)')
      into v_passed
      from (select min(d.n) as first_n, string_agg(split_part(d.name, ' ', 1), ' ' order by d.n) as ids
            from pg_temp.kt_dry d
            where d.ok
            group by left(d.name, 1)) g;
    v_msg := left(
      'KT DRYRUN txid=' || txid_current() || ' total=' || v_total || ' passed=' || v_pass || ' failed=' || v_fail
      || ' expected=' || v_expected || E'\n' || v_note
      || E'\nFAILED:\n' || v_failed || E'\nPASSED (ids):\n' || v_passed,
      9000);
  exception when others then
    v_msg := 'KT DRYRUN txid=' || txid_current() || ': the report could not be built (' || sqlstate || '). ' || v_note;
  end;
  raise exception '%', v_msg using errcode = 'KT000';
end
$report$;
