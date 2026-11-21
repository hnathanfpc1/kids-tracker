-- Kids Tracker: dry-run test for migration 09
--
-- NOT a migration. It never "succeeds": its last statement always raises an error that carries the report.
--
-- Exact call order
--   ONE call, sent as one multi-statement request so it is one transaction, run as postgres:
--     1. DRYRUN-09-pre.sql
--     2. 09_harden_sign_in.sql
--     3. DRYRUN-09-mid.sql          (second snapshot, then made-up accounts)
--     4. 09_harden_sign_in.sql      (again: the re-run proof)
--     5. DRYRUN-09.sql              (this file)
--   Then, as a SEPARATE call: DRYRUN-99-aftercheck-09.sql  (run it once before as well, and compare)
--   Do not wrap the call in begin and rollback. The error at the end is what ends the transaction.
--
-- What it touches
--   It runs against the live database. It never puts a value from settings, breaks, swaps, swap_details,
--   share_links, app_users or auth.users into the report: counts, labels and true or false only.
--   The live admin rows are only counted. Every row it creates is made up: example.test emails,
--   "Dryrun9" names, a swap dated in the year 1900. All of it is rolled back by the final error.
--
-- How it pretends to be each kind of user
--   set local role anon or authenticated, plus request.jwt.claims holding a made-up token body:
--   {"sub": <made-up user id>, "email": <made-up email>, "role": "authenticated"}. auth.uid() reads the
--   "sub" claim, which is what the new my_role() uses. Check W01 proves the wiring works on this project.
--
-- Made-up accounts are inserted straight into auth.users as postgres by DRYRUN-09-mid.sql (id, aud, role,
-- email, email_confirmed_at, banned_until, deleted_at, is_anonymous, is_sso_user only). If this project has extra triggers or
-- required columns on auth.users, the insert fails and W02 and SETUP lines say so. That is a failed
-- rehearsal, not a problem in 09.
--
-- Reading the report
--   KT DRYRUN09 txid=... total=... passed=... failed=... expected=...  then one line per failed check,
--   then the ids of the passed checks. Error codes: KT000 is the report. KT001 and KT002 mean the file
--   refused to start.

do $guard$
begin
  if to_regclass('pg_temp.kt9_guard') is null or to_regclass('pg_temp.kt9_before') is null
     or to_regclass('pg_temp.kt9_u') is null then
    raise exception 'KT DRYRUN09 REFUSED: DRYRUN-09-pre.sql and DRYRUN-09-mid.sql did not both run earlier in this transaction. No test was run. Run DRYRUN-99-aftercheck-09.sql to see what is in the database.'
      using errcode = 'KT001';
  end if;
  if (select g.txid from pg_temp.kt9_guard g limit 1) is distinct from txid_current() then
    raise exception 'KT DRYRUN09 REFUSED: the guard belongs to a different transaction. No test was run.'
      using errcode = 'KT002';
  end if;
end
$guard$;

create temp table kt9_dry (
  n int generated always as identity, name text, ok boolean, detail text
) on commit drop;

-- True only inside the transaction the preamble started.
create or replace function pg_temp.kt9_guard_ok()
returns boolean language plpgsql as $f$
declare v_ok boolean;
begin
  if to_regclass('pg_temp.kt9_guard') is null then return false; end if;
  execute 'select bool_and(g.txid = txid_current()) from pg_temp.kt9_guard g' into v_ok;
  return coalesce(v_ok, false);
exception when others then
  return false;
end
$f$;

-- Replace {id_<label>} with the made-up user's id, safely quoted.
create or replace function pg_temp.kt9_fill(p_sql text)
returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select u.label, u.id from pg_temp.kt9_u u loop
    v := replace(v, '{id_' || r.label || '}', quote_literal(r.id::text));
  end loop;
  return v;
end
$f$;

-- The token body for a label. 'postgres', 'anon' and 'none' carry no token.
--   attack   = the email claim of the listed admin, but the user id of an unlisted confirmed account
--   subonly  = the user id of the listed admin, with an email claim that is not on the list
--   ghost    = the email claim of the listed admin, with a user id that does not exist
create or replace function pg_temp.kt9_claims(p_label text)
returns text language plpgsql as $f$
declare v jsonb;
begin
  v := case p_label
    when 'postgres' then '{}'::jsonb
    when 'anon'     then '{}'::jsonb
    when 'none'     then '{}'::jsonb
    when 'attack'   then (select jsonb_build_object('sub', (select id from pg_temp.kt9_u where label = 'unlisted'),
                            'email', (select email from pg_temp.kt9_u where label = 'admin'), 'role', 'authenticated'))
    when 'subonly'  then (select jsonb_build_object('sub', (select id from pg_temp.kt9_u where label = 'admin'),
                            'email', 'someone-else@example.test', 'role', 'authenticated'))
    when 'ghost'    then (select jsonb_build_object('sub', gen_random_uuid(),
                            'email', (select email from pg_temp.kt9_u where label = 'admin'), 'role', 'authenticated'))
    else (select jsonb_build_object('sub', u.id, 'email', u.email, 'role', 'authenticated')
          from pg_temp.kt9_u u where u.label = p_label)
  end;
  return coalesce(v, '{}'::jsonb)::text;
end
$f$;

-- Run one query as a role with a token body. Returns 'ok:<single value>' or 'err:<sqlstate> <start of message>'.
create or replace function pg_temp.kt9_try(p_role text, p_claims text, p_sql text)
returns text language plpgsql as $f$
declare
  v_orig text := current_user;
  v_val  text;
  v_out  text;
begin
  if not pg_temp.kt9_guard_ok() then
    return 'err:KTGRD not inside the guarded dry-run transaction, nothing was run';
  end if;
  perform set_config('request.jwt.claims', p_claims, true);
  begin
    if p_role is not null then execute format('set local role %I', p_role); end if;
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

-- One check. p_as: postgres, anon, none (signed in, no token body), or a made-up account label.
create or replace function pg_temp.kt9_check(p_name text, p_as text, p_sql text, p_expect text)
returns void language plpgsql as $f$
declare v_role text; v_out text; v_ok boolean;
begin
  v_role := case p_as when 'postgres' then null when 'anon' then 'anon' else 'authenticated' end;
  v_out  := pg_temp.kt9_try(v_role, pg_temp.kt9_claims(p_as), pg_temp.kt9_fill(p_sql));
  v_ok := coalesce(v_out = p_expect or (p_expect like 'err:%' and left(v_out, length(p_expect)) = p_expect), false);
  insert into pg_temp.kt9_dry (name, ok, detail)
  values (p_name, v_ok, case when v_ok then left(v_out, 60) else 'got ' || left(v_out, 110) || ' | want ' || p_expect end);
exception when others then
  insert into pg_temp.kt9_dry (name, ok, detail)
  values (p_name, false, 'check could not run: ' || sqlstate || ' ' || left(sqlerrm, 90));
end
$f$;

-- Compare a function's current definition hash with the one taken before 09.
create or replace function pg_temp.kt9_same(p_name text, p_key text, p_now_sql text)
returns void language plpgsql as $f$
begin
  perform pg_temp.kt9_check(p_name, 'postgres',
    format($q$ select ((%s) = (select v from pg_temp.kt9_before where k = %L))::text $q$, p_now_sql, p_key), 'ok:true');
end
$f$;

-- ---------------------------------------------------------------
-- S. Setup that must come AFTER the second run of 09 (made up, rolled back)
--    Each write block calls pg_temp.kt9_require() first, outside its error handler.
-- ---------------------------------------------------------------
do $setup0$
begin
  perform pg_temp.kt9_require();
  insert into pg_temp.kt9_dry (name, ok, detail)
  select 'SETUP made-up accounts failed in DRYRUN-09-mid.sql', false, b.v
  from pg_temp.kt9_before b where b.k = 'setup_failed';
end
$setup0$;

-- 'nopin': a listed, confirmed admin account whose row has no user_id, added after 09's backfill ran.
do $setup1$
begin
  perform pg_temp.kt9_require();
  begin
    insert into pg_temp.kt9_u (label, id, email) values ('nopin', gen_random_uuid(), 'dryrun9-nopin@example.test');
    insert into auth.users (id, aud, role, email, email_confirmed_at)
    select u.id, 'authenticated', 'authenticated', u.email, now() from pg_temp.kt9_u u where u.label = 'nopin';
    insert into public.app_users (email, role, user_id)
    select u.email, 'admin', null from pg_temp.kt9_u u where u.label = 'nopin';
  exception when others then
    insert into pg_temp.kt9_dry (name, ok, detail)
    values ('SETUP nopin account failed', false, sqlstate || ' ' || left(sqlerrm, 120));
  end;
end
$setup1$;

-- Made-up rows dated 1900 or labelled dryrun9 in the custody tables, so "0 rows" checks are not vacuous.
do $setup2$
begin
  perform pg_temp.kt9_require();
  begin
    insert into public.swaps (day, had) values (date '1900-01-01', 'me');
    insert into public.swap_details (day, note) values (date '1900-01-01', 'dryrun9');
    insert into public.breaks (year, data) values (1900, '{}'::jsonb);
    insert into public.share_links (label) values ('dryrun9');
  exception when others then
    insert into pg_temp.kt9_dry (name, ok, detail)
    values ('SETUP made-up custody rows failed', false, sqlstate || ' ' || left(sqlerrm, 120));
  end;
end
$setup2$;

-- ---------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------
do $main$
declare
  v_admins int;
  v_pass   int;
  v_parents int;
  v_pinned int;
begin
  perform pg_temp.kt9_require();
  -- W. Wiring
  perform pg_temp.kt9_check('W01 token sub reaches auth.uid()', 'admin',
    $q$ select (auth.uid() = {id_admin}::uuid)::text $q$, 'ok:true');
  perform pg_temp.kt9_check('W02 fifteen made-up accounts exist', 'postgres',
    $q$ select count(*)::text from auth.users where email like 'dryrun9-%@example.test' $q$, 'ok:15');

  -- G. Lock-out guard on the LIVE admin rows (counts only, made-up rows excluded)
  select count(*) into v_admins from public.app_users where role = 'admin' and email not like '%@example.test';
  select count(*) into v_pass
  from public.app_users a
  where a.role = 'admin' and a.email not like '%@example.test'
    and exists (select 1 from auth.users u
                where u.id = a.user_id and lower(u.email) = a.email and u.email_confirmed_at is not null and u.deleted_at is null
                  and (u.banned_until is null or u.banned_until <= now())
                  and coalesce(u.is_anonymous, false) = false and coalesce(u.is_sso_user, false) = false);
  insert into pg_temp.kt9_dry (name, ok, detail)
  values ('G01 at least one live admin row is pinned and passes every new condition', v_pass > 0,
          v_pass || ' of ' || v_admins || ' live admin rows pass' || case when v_pass = 0 then ' - LOCK-OUT, DO NOT RUN 09' else '' end);
  insert into pg_temp.kt9_dry (name, ok, detail)
  values ('G02 every live admin row is pinned and passes', v_pass = v_admins and v_admins > 0,
          v_pass || ' of ' || v_admins || case when v_pass < v_admins then ' - one row would not sign in after 09 (not a lock-out)' else '' end);
  select count(*) into v_parents from public.app_users where role = 'parent' and email not like '%@example.test';
  insert into pg_temp.kt9_dry (name, ok, detail)
  values ('G03 no live parent row yet', v_parents = 0, v_parents || ' live parent rows');
  -- B. The pin. Counts only.
  select count(*) into v_pinned from public.app_users
   where role = 'admin' and email not like '%@example.test' and user_id is not null;
  insert into pg_temp.kt9_dry (name, ok, detail)
  values ('B01 pinned live admin rows equal passing live admin rows', v_pinned = v_pass and v_pass > 0,
          v_pinned || ' pinned, ' || v_pass || ' pass, ' || v_admins || ' admin rows');
  perform pg_temp.kt9_check('B02 second run pinned the confirmed unpinned admin (bf)', 'postgres',
    $q$ select (select (a.user_id = u.id)::text from public.app_users a join auth.users u on lower(u.email) = a.email where u.id = {id_bf}) $q$, 'ok:true');
  perform pg_temp.kt9_check('B03 second run did not pin the parent row (bfp)', 'postgres',
    $q$ select (select (a.user_id is null)::text from public.app_users a join auth.users u on lower(u.email) = a.email where u.id = {id_bfp}) $q$, 'ok:true');
  perform pg_temp.kt9_check('B04 second run did not pin the unconfirmed admin (bfu)', 'postgres',
    $q$ select (select (a.user_id is null)::text from public.app_users a join auth.users u on lower(u.email) = a.email where u.id = {id_bfu}) $q$, 'ok:true');
  perform pg_temp.kt9_check('B05 second run did not pin the SSO admin (bfs)', 'postgres',
    $q$ select (select (a.user_id is null)::text from public.app_users a join auth.users u on lower(u.email) = a.email where u.id = {id_bfs}) $q$, 'ok:true');
  perform pg_temp.kt9_check('B06 the second run changed no live sign-in row', 'postgres',
    $q$ select ((select coalesce(md5(string_agg(a.email || '|' || a.role || '|' || coalesce(to_jsonb(a) ->> 'user_id', ''), E'\n' order by a.email)), '')
                 from public.app_users a where a.email not like '%@example.test')
                = (select v from pg_temp.kt9_before where k = 'mid_live_app_users'))::text $q$, 'ok:true');
  perform pg_temp.kt9_check('B07 the second run left my_role unchanged', 'postgres',
    $q$ select (md5(pg_get_functiondef('public.my_role()'::regprocedure)) = (select v from pg_temp.kt9_before where k = 'mid_my_role'))::text $q$, 'ok:true');
  perform pg_temp.kt9_check('B08 the second run left table rights unchanged', 'postgres',
    $q$ select ((select coalesce(md5(string_agg(c.relname || '|' || x.grantee::text || '|' || x.privilege_type, E'\n'
                                          order by c.relname, x.grantee::text, x.privilege_type)), '')
                 from pg_class c, lateral aclexplode(c.relacl) x
                 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r')
                = (select v from pg_temp.kt9_before where k = 'mid_table_acl_all'))::text $q$, 'ok:true');
  perform pg_temp.kt9_check('B09 the second run left function rights unchanged', 'postgres',
    $q$ select ((select coalesce(md5(string_agg(proname || '|' || oid::regprocedure::text || '|' || coalesce(proacl::text, ''), E'\n'
                                          order by oid::regprocedure::text)), '')
                 from pg_proc where pronamespace = 'public'::regnamespace)
                = (select v from pg_temp.kt9_before where k = 'mid_function_acl'))::text $q$, 'ok:true');
  perform pg_temp.kt9_check('B10 user_id is unique when set', 'postgres',
    $q$ insert into public.app_users (email, role, user_id)
        select 'dryrun9-dup@example.test', 'admin', user_id from public.app_users where user_id is not null limit 1
        returning 'x' $q$, 'err:23505');
  perform pg_temp.kt9_check('B11 user_id is a nullable uuid', 'postgres',
    $q$ select (select (data_type = 'uuid' and is_nullable = 'YES')::text from information_schema.columns
                where table_schema = 'public' and table_name = 'app_users' and column_name = 'user_id') $q$, 'ok:true');
  perform pg_temp.kt9_check('B12 the unique rule is a partial unique index', 'postgres',
    $q$ select (select (indexdef like '%UNIQUE%' and indexdef like '%WHERE%')::text from pg_indexes
                where schemaname = 'public' and indexname = 'app_users_user_id_key') $q$, 'ok:true');
  perform pg_temp.kt9_check('B13 no right was added on app_users', 'postgres',
    $q$ select count(*)::text from pg_class c, lateral aclexplode(c.relacl) x
        where c.oid = 'public.app_users'::regclass and x.grantee in (0, (select oid from pg_roles where rolname in ('anon')),
              (select oid from pg_roles where rolname = 'authenticated')) $q$, 'ok:0');

  -- R. my_role() behaviour
  perform pg_temp.kt9_check('R01 listed and confirmed admin gets admin', 'admin',    $q$ select public.my_role() $q$, 'ok:admin');
  perform pg_temp.kt9_check('R02 listed and confirmed parent gets parent', 'parent', $q$ select public.my_role() $q$, 'ok:parent');
  perform pg_temp.kt9_check('R03 listed but unconfirmed gets null', 'unconf',        $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R04 banned gets null', 'banned',                        $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R05 ban already over gets the role', 'expban',          $q$ select public.my_role() $q$, 'ok:parent');
  perform pg_temp.kt9_check('R06 deleted gets null', 'deleted',                      $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R07 anonymous sign-in gets null', 'anonuser',           $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R08 confirmed but unlisted gets null', 'unlisted',      $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R09 admin email claim with another user id gets null', 'attack', $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R10 admin user id with a different email claim gets admin', 'subonly', $q$ select public.my_role() $q$, 'ok:admin');
  perform pg_temp.kt9_check('R11 admin email claim with an unknown user id gets null', 'ghost', $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R12 signed in with no token body gets null', 'none',    $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R13 anon cannot run my_role', 'anon',                   $q$ select public.my_role() $q$, 'err:42501');
  perform pg_temp.kt9_check('R14 my_role uses auth.uid, the pin and the SSO test, not the token email', 'postgres',
    $q$ select (pg_get_functiondef('public.my_role()'::regprocedure) like '%auth.uid()%'
            and pg_get_functiondef('public.my_role()'::regprocedure) like '%user_id%'
            and pg_get_functiondef('public.my_role()'::regprocedure) like '%is_sso_user%'
            and pg_get_functiondef('public.my_role()'::regprocedure) not like '%jwt()%')::text $q$, 'ok:true');
  perform pg_temp.kt9_check('R15 my_role is stable, security definer, search_path public', 'postgres',
    $q$ select (select (p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public'])::text
                from pg_proc p where p.oid = 'public.my_role()'::regprocedure) $q$, 'ok:true');
  perform pg_temp.kt9_check('R16 my_role execute: not public, not anon, yes authenticated', 'postgres',
    $q$ select (not has_function_privilege('anon', 'public.my_role()', 'execute')
            and has_function_privilege('authenticated', 'public.my_role()', 'execute')
            and not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
                            where p.oid = 'public.my_role()'::regprocedure and a.grantee = 0))::text $q$, 'ok:true');

  perform pg_temp.kt9_check('R17 admin pinned by the second run gets admin (bf)', 'bf', $q$ select public.my_role() $q$, 'ok:admin');
  perform pg_temp.kt9_check('R18 parent row never pinned gets null (bfp)', 'bfp',      $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R19 unconfirmed unpinned admin gets null (bfu)', 'bfu',   $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R20 listed confirmed account with no user_id gets null', 'nopin', $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R21 list row pinned to a different id gets null (recreated account)', 'stale', $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R22 SSO account with a listed pinned email gets null', 'sso', $q$ select public.my_role() $q$, 'ok:null');
  perform pg_temp.kt9_check('R23 SSO account with no pin gets null (bfs)', 'bfs',      $q$ select public.my_role() $q$, 'ok:null');

  -- E. is_editor() and my_who()
  perform pg_temp.kt9_check('E01 is_editor admin', 'admin',     $q$ select public.is_editor()::text $q$, 'ok:true');
  perform pg_temp.kt9_check('E02 is_editor parent', 'parent',   $q$ select public.is_editor()::text $q$, 'ok:true');
  perform pg_temp.kt9_check('E03 is_editor unconfirmed', 'unconf', $q$ select public.is_editor()::text $q$, 'ok:false');
  perform pg_temp.kt9_check('E04 is_editor unlisted', 'unlisted',  $q$ select public.is_editor()::text $q$, 'ok:false');
  perform pg_temp.kt9_check('E05 is_editor attack token', 'attack', $q$ select public.is_editor()::text $q$, 'ok:false');
  perform pg_temp.kt9_check('E06 my_who admin is me', 'admin',   $q$ select public.my_who() $q$, 'ok:me');
  perform pg_temp.kt9_check('E07 my_who parent is co', 'parent', $q$ select public.my_who() $q$, 'ok:co');
  perform pg_temp.kt9_check('E08 my_who banned is null', 'banned', $q$ select public.my_who() $q$, 'ok:null');
  perform pg_temp.kt9_check('E09 my_who attack token is null', 'attack', $q$ select public.my_who() $q$, 'ok:null');
  perform pg_temp.kt9_check('E10 anon cannot run is_editor', 'anon', $q$ select public.is_editor()::text $q$, 'err:42501');
  perform pg_temp.kt9_check('E11 anon cannot run my_who', 'anon',    $q$ select public.my_who() $q$, 'err:42501');

  -- P. A parent cannot reach the custody tables; can use activities. Positive controls for admin.
  perform pg_temp.kt9_check('P01 parent reads no settings', 'parent',      $q$ select count(*)::text from public.settings $q$, 'ok:0');
  perform pg_temp.kt9_check('P02 parent reads no breaks', 'parent',        $q$ select count(*)::text from public.breaks where year = 1900 $q$, 'ok:0');
  perform pg_temp.kt9_check('P03 parent reads no swaps', 'parent',         $q$ select count(*)::text from public.swaps where day = date '1900-01-01' $q$, 'ok:0');
  perform pg_temp.kt9_check('P04 parent reads no swap_details', 'parent',  $q$ select count(*)::text from public.swap_details where day = date '1900-01-01' $q$, 'ok:0');
  perform pg_temp.kt9_check('P05 parent reads no share_links', 'parent',   $q$ select count(*)::text from public.share_links where label = 'dryrun9' $q$, 'ok:0');
  perform pg_temp.kt9_check('P06 parent denied on app_users', 'parent',    $q$ select count(*)::text from public.app_users $q$, 'err:42501');
  perform pg_temp.kt9_check('P07 parent cannot add a swap', 'parent',
    $q$ insert into public.swaps (day, had) values (date '1900-01-02', 'co') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P08 parent cannot add a family link', 'parent',
    $q$ insert into public.share_links (token, label) values ('dryrun9', 'x') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P09 parent cannot change settings', 'parent',
    $q$ with x as (update public.settings set my_name = my_name returning 1) select count(*)::text from x $q$, 'ok:0');
  perform pg_temp.kt9_check('P10 parent cannot delete the 1900 swap', 'parent',
    $q$ with x as (delete from public.swaps where day = date '1900-01-01' returning 1) select count(*)::text from x $q$, 'ok:0');
  perform pg_temp.kt9_check('P11 parent denied on app_users insert', 'parent',
    $q$ insert into public.app_users (email, role) values ('dryrun9-x@example.test', 'admin') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P31 admin sees the made-up breaks row', 'admin',      $q$ select count(*)::text from public.breaks where year = 1900 $q$, 'ok:1');
  perform pg_temp.kt9_check('P32 admin sees the made-up swap_details row', 'admin', $q$ select count(*)::text from public.swap_details where day = date '1900-01-01' $q$, 'ok:1');
  perform pg_temp.kt9_check('P33 admin sees the made-up share_links row', 'admin',  $q$ select count(*)::text from public.share_links where label = 'dryrun9' $q$, 'ok:1');
  perform pg_temp.kt9_check('P34 parent cannot add a breaks row', 'parent',
    $q$ insert into public.breaks (year, data) values (1901, '{}'::jsonb) returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P35 parent cannot add a swap_details row', 'parent',
    $q$ insert into public.swap_details (day, note) values (date '1900-01-01', 'x') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P12 admin reads settings', 'admin',    $q$ select (count(*) > 0)::text from public.settings $q$, 'ok:true');
  perform pg_temp.kt9_check('P13 admin sees the 1900 swap', 'admin', $q$ select count(*)::text from public.swaps where day = date '1900-01-01' $q$, 'ok:1');
  perform pg_temp.kt9_check('P14 admin can add a swap', 'admin',
    $q$ with x as (insert into public.swaps (day, had) values (date '1900-01-03', 'co') returning 1) select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt9_check('P15 admin denied on app_users (deny-all)', 'admin', $q$ select count(*)::text from public.app_users $q$, 'err:42501');
  perform pg_temp.kt9_check('P16 unconfirmed admin row reads no settings', 'unconf', $q$ select count(*)::text from public.settings $q$, 'ok:0');
  perform pg_temp.kt9_check('P17 attack token reads no settings', 'attack',         $q$ select count(*)::text from public.settings $q$, 'ok:0');
  perform pg_temp.kt9_check('P18 attack token reads no share_links', 'attack',      $q$ select count(*)::text from public.share_links $q$, 'ok:0');
  perform pg_temp.kt9_check('P19 banned parent cannot add a kid', 'banned',
    $q$ insert into public.kids (name, color) values ('Dryrun9 Kid X', 'orange') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P20 parent can add a kid', 'parent',
    $q$ with x as (insert into public.kids (name, color, sort, active) values ('Dryrun9 Kid A', 'orange', 1, true) returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt9_check('P21 parent can read kids', 'parent',
    $q$ select (count(*) >= 1)::text from public.kids $q$, 'ok:true');
  perform pg_temp.kt9_check('P22 parent can add an activity', 'parent',
    $q$ with x as (insert into public.events (kid_ids, kind, title, day, start_time)
                   values (array[(select id from public.kids where name = 'Dryrun9 Kid A')], 'other', 'Dryrun9 event', current_date, time '16:00')
                   returning 1)
        select count(*)::text from x $q$, 'ok:1');
  perform pg_temp.kt9_check('P23 parent can read activities', 'parent',
    $q$ select (count(*) >= 1)::text from public.events where title = 'Dryrun9 event' $q$, 'ok:true');
  perform pg_temp.kt9_check('P24 unlisted cannot add a kid', 'unlisted',
    $q$ insert into public.kids (name, color) values ('Dryrun9 Kid Y', 'orange') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P25 attack token cannot add a kid', 'attack',
    $q$ insert into public.kids (name, color) values ('Dryrun9 Kid Z', 'orange') returning 'x' $q$, 'err:42501');
  perform pg_temp.kt9_check('P26 parent gets the editor schedule', 'parent',
    $q$ select (public.get_editor_schedule() is not null)::text $q$, 'ok:true');
  perform pg_temp.kt9_check('P27 admin gets the editor schedule', 'admin',
    $q$ select (public.get_editor_schedule() is not null)::text $q$, 'ok:true');
  perform pg_temp.kt9_check('P28 unconfirmed gets no editor schedule', 'unconf',
    $q$ select (public.get_editor_schedule() is not null)::text $q$, 'ok:false');
  perform pg_temp.kt9_check('P29 attack token gets no editor schedule', 'attack',
    $q$ select (public.get_editor_schedule() is not null)::text $q$, 'ok:false');
  perform pg_temp.kt9_check('P30 editor schedule never carries private fields', 'admin',
    $q$ select (public.get_editor_schedule()::text !~ '"(pnote|track_from|ical_url)"')::text $q$, 'ok:true');

  -- U. Unchanged by 09, nothing loosened
  perform pg_temp.kt9_same('U01 get_schedule definition unchanged', 'fn_get_schedule',
    $s$ md5(pg_get_functiondef('public.get_schedule(text)'::regprocedure)) $s$);
  perform pg_temp.kt9_same('U02 get_editor_schedule definition unchanged', 'fn_get_editor_schedule',
    $s$ md5(pg_get_functiondef('public.get_editor_schedule(date, date)'::regprocedure)) $s$);
  perform pg_temp.kt9_same('U03 kt_schedule_core definition unchanged', 'fn_kt_schedule_core',
    $s$ md5(pg_get_functiondef('public.kt_schedule_core()'::regprocedure)) $s$);
  perform pg_temp.kt9_same('U04 kt_activities definition unchanged', 'fn_kt_activities',
    $s$ md5(pg_get_functiondef('public.kt_activities(date, date, boolean)'::regprocedure)) $s$);
  perform pg_temp.kt9_same('U05 is_editor definition unchanged', 'fn_is_editor',
    $s$ md5(pg_get_functiondef('public.is_editor()'::regprocedure)) $s$);
  perform pg_temp.kt9_same('U06 my_who definition unchanged', 'fn_my_who',
    $s$ md5(pg_get_functiondef('public.my_who()'::regprocedure)) $s$);
  perform pg_temp.kt9_same('U07 table count unchanged', 'n_tables',
    $s$ (select count(*)::text from pg_tables where schemaname = 'public') $s$);
  perform pg_temp.kt9_same('U08 tables with row level security unchanged', 'n_rls_on',
    $s$ (select count(*)::text from pg_tables where schemaname = 'public' and rowsecurity) $s$);
  perform pg_temp.kt9_same('U09 policy count unchanged', 'n_policies',
    $s$ (select count(*)::text from pg_policies where schemaname = 'public') $s$);
  perform pg_temp.kt9_same('U10 trigger count unchanged', 'n_triggers',
    $s$ (select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
         where c.relnamespace = 'public'::regnamespace and not g.tgisinternal) $s$);
  perform pg_temp.kt9_same('U11 function count unchanged', 'n_functions',
    $s$ (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace) $s$);
  perform pg_temp.kt9_same('U12 policy text unchanged', 'policies_md5',
    $s$ (select coalesce(md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|'
                                        || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n'
                                        order by tablename, policyname)), '')
         from pg_policies where schemaname = 'public') $s$);
  perform pg_temp.kt9_same('U13 table rights unchanged (maintain aside)', 'table_acl_md5',
    $s$ (select coalesce(md5(string_agg(c.relname || '|' || a.grantee::text || '|' || a.privilege_type, E'\n'
                                        order by c.relname, a.grantee::text, a.privilege_type)), '')
         from pg_class c, lateral aclexplode(c.relacl) a
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.privilege_type <> 'MAINTAIN') $s$);
  perform pg_temp.kt9_same('U14 function rights unchanged', 'function_acl_md5',
    $s$ (select coalesce(md5(string_agg(proname || '|' || oid::regprocedure::text || '|' || coalesce(proacl::text, ''), E'\n'
                                        order by oid::regprocedure::text)), '')
         from pg_proc where pronamespace = 'public'::regnamespace) $s$);
  perform pg_temp.kt9_check('U15 nobody but the owner holds maintain on our tables', 'postgres',
    $q$ select count(*)::text
        from pg_class c, lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.privilege_type = 'MAINTAIN'
          and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))) $q$, 'ok:0');
  perform pg_temp.kt9_check('U16 anon holds no right on any table of ours', 'postgres',
    $q$ select count(*)::text
        from pg_class c, lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and (a.grantee = 0 or a.grantee = (select oid from pg_roles where rolname = 'anon')) $q$, 'ok:0');
  perform pg_temp.kt9_check('U17 signed-in users hold only select, insert, update, delete', 'postgres',
    $q$ select count(*)::text
        from pg_class c, lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and a.grantee = (select oid from pg_roles where rolname = 'authenticated')
          and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE') $q$, 'ok:0');
  perform pg_temp.kt9_check('U18 anon still denied on the custody tables', 'anon',
    $q$ select count(*)::text from public.settings $q$, 'err:42501');
  perform pg_temp.kt9_check('U19 anon with a made-up link token gets null', 'anon',
    $q$ select (public.get_schedule('dryrun9-not-a-token') is null)::text $q$, 'ok:true');
  perform pg_temp.kt9_check('U20 anon cannot run get_editor_schedule', 'anon',
    $q$ select (public.get_editor_schedule() is not null)::text $q$, 'err:42501');
  perform pg_temp.kt9_check('U21 my_role now reads auth.users', 'postgres',
    $q$ select (pg_get_functiondef('public.my_role()'::regprocedure) like '%auth.users%')::text $q$, 'ok:true');
  insert into pg_temp.kt9_dry (name, ok, detail)
  select 'U22 server version recorded (maintain step runs on 17 and later)', true,
         'server_version_num=' || (select v from pg_temp.kt9_before where k = 'server_version_num');
end
$main$;

-- ---------------------------------------------------------------
-- Report. Always ends the transaction with an error, so everything above is rolled back.
-- ---------------------------------------------------------------
do $report$
declare
  v_expected constant int := 109;  -- 104 kt9_check or kt9_same calls plus 5 direct checks (G01, G02, G03, B01, U22)
  v_note   constant text := 'Dry run only. Confirm from a separate call (DRYRUN-99-aftercheck-09.sql) that nothing persisted.';
  v_msg    text;
  v_total  int;
  v_pass   int;
  v_fail   int;
  v_failed text;
  v_passed text;
begin
  v_msg := 'KT DRYRUN09 txid=' || txid_current() || ': the report could not be built. ' || v_note;
  begin
    select count(*), count(*) filter (where d.ok), count(*) filter (where not d.ok)
      into v_total, v_pass, v_fail from pg_temp.kt9_dry d;
    select coalesce(string_agg('FAIL ' || d.name || ' -> ' || d.detail, E'\n' order by d.n), '(none)')
      into v_failed from pg_temp.kt9_dry d where not d.ok;
    select coalesce(string_agg(g.ids, E'\n' order by g.first_n), '(none)')
      into v_passed
      from (select min(d.n) as first_n, string_agg(split_part(d.name, ' ', 1), ' ' order by d.n) as ids
            from pg_temp.kt9_dry d where d.ok group by left(d.name, 1)) g;
    v_msg := left('KT DRYRUN09 txid=' || txid_current() || ' total=' || v_total || ' passed=' || v_pass || ' failed=' || v_fail
      || ' expected=' || v_expected || E'\n' || v_note
      || E'\nFAILED:\n' || v_failed || E'\nPASSED (ids):\n' || v_passed, 9000);
  exception when others then
    v_msg := 'KT DRYRUN09 txid=' || txid_current() || ': the report could not be built (' || sqlstate || '). ' || v_note;
  end;
  raise exception '%', v_msg using errcode = 'KT000';
end
$report$;
