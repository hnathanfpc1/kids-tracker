-- Kids Tracker: dry-run middle step for migration 09. Goes BETWEEN the first and second run of 09.
--
-- NOT a migration. Everything it writes is made up (example.test) and is rolled back by the final error
-- of DRYRUN-09.sql.
--
-- Exact call order
--   ONE call, sent as one multi-statement request so it is one transaction, run as postgres:
--     1. DRYRUN-09-pre.sql
--     2. 09_harden_sign_in.sql
--     3. DRYRUN-09-mid.sql          (this file)
--     4. 09_harden_sign_in.sql      (second run: pins the made-up admin rows below, changes nothing live)
--     5. DRYRUN-09.sql              (the checks; ends in an error on purpose)
--   Then, as a SEPARATE call: DRYRUN-99-aftercheck-09.sql  (run it once before as well, and compare)
--
-- What it does
--   a. Refuses to start unless the preamble ran earlier in this same transaction.
--   b. Takes a second snapshot (hashes and counts only) of the live rows and rights after the first run of
--      09, so DRYRUN-09.sql can prove the second run changed nothing.
--   c. Creates made-up accounts in auth.users and made-up rows in app_users. Four admin or parent rows are
--      left with no user_id on purpose, so the second run of 09 shows what it pins and what it must not.
--      Every write block calls pg_temp.kt9_require() first, outside its error handler, so it cannot be
--      swallowed and cannot save anything if this is run statement by statement.

do $guard$
begin
  if to_regclass('pg_temp.kt9_guard') is null or to_regclass('pg_temp.kt9_before') is null then
    raise exception 'KT DRYRUN09 REFUSED: the preamble DRYRUN-09-pre.sql did not run earlier in this transaction. Nothing was written. Run DRYRUN-99-aftercheck-09.sql to see what is in the database.'
      using errcode = 'KT001';
  end if;
  if (select g.txid from pg_temp.kt9_guard g limit 1) is distinct from txid_current() then
    raise exception 'KT DRYRUN09 REFUSED: the guard belongs to a different transaction. Nothing was written.'
      using errcode = 'KT002';
  end if;
end
$guard$;

-- Raises (and so ends the transaction) unless the preamble ran in this same transaction.
create or replace function pg_temp.kt9_require()
returns void language plpgsql as $f$
declare v_txid bigint;
begin
  if to_regclass('pg_temp.kt9_guard') is null then
    raise exception 'KT DRYRUN09 REFUSED: preamble not run in this transaction. Nothing was written.' using errcode = 'KT001';
  end if;
  execute 'select g.txid from pg_temp.kt9_guard g limit 1' into v_txid;
  if v_txid is distinct from txid_current() then
    raise exception 'KT DRYRUN09 REFUSED: guard from a different transaction. Nothing was written.' using errcode = 'KT002';
  end if;
end
$f$;

-- label, user id, email of each made-up account
create temp table kt9_u (label text primary key, id uuid, email text) on commit drop;

-- Snapshot after the first run of 09. Live rows only (made-up rows are not in yet).
do $snap$
begin
  perform pg_temp.kt9_require();
  insert into pg_temp.kt9_before (k, v)
  select 'mid_live_app_users',
         (select coalesce(md5(string_agg(a.email || '|' || a.role || '|' || coalesce(to_jsonb(a) ->> 'user_id', ''), E'\n'
                                         order by a.email)), '') from public.app_users a)
  union all select 'mid_my_role', md5(pg_get_functiondef('public.my_role()'::regprocedure))
  union all select 'mid_table_acl_all',
         (select coalesce(md5(string_agg(c.relname || '|' || x.grantee::text || '|' || x.privilege_type, E'\n'
                                         order by c.relname, x.grantee::text, x.privilege_type)), '')
          from pg_class c, lateral aclexplode(c.relacl) x
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r')
  union all select 'mid_function_acl',
         (select coalesce(md5(string_agg(proname || '|' || oid::regprocedure::text || '|' || coalesce(proacl::text, ''), E'\n'
                                         order by oid::regprocedure::text)), '')
          from pg_proc where pronamespace = 'public'::regnamespace);
end
$snap$;

-- Made-up accounts. Not in this step: 'nopin' (added after the second run, by DRYRUN-09.sql).
do $setup$
begin
  perform pg_temp.kt9_require();
  begin
    insert into pg_temp.kt9_u (label, id, email)
    select l, gen_random_uuid(), 'dryrun9-' || l || '@example.test'
    from unnest(array['admin', 'parent', 'unconf', 'banned', 'expban', 'deleted', 'anonuser', 'unlisted',
                      'sso', 'stale', 'bf', 'bfp', 'bfu', 'bfs']) l;

    insert into auth.users (id, aud, role, email, email_confirmed_at, banned_until, deleted_at, is_anonymous, is_sso_user)
    select u.id, 'authenticated', 'authenticated', u.email,
           case when u.label in ('unconf', 'bfu') then null else now() end,
           case u.label when 'banned' then now() + interval '1 day' when 'expban' then now() - interval '1 hour' end,
           case when u.label = 'deleted' then now() end,
           (u.label = 'anonuser'),
           (u.label in ('sso', 'bfs'))
    from pg_temp.kt9_u u;

    -- Everyone except 'unlisted' is on the list. Unusable accounts are listed as admins on purpose, so a
    -- failure would show up as a real hole. user_id: pinned to the account, except:
    --   stale = pinned to a different id (the account was recreated)
    --   bf, bfp, bfu, bfs = left empty, for the second run of 09 to deal with
    insert into public.app_users (email, role, user_id)
    select u.email,
           case when u.label in ('parent', 'banned', 'expban', 'bfp') then 'parent' else 'admin' end,
           case when u.label in ('bf', 'bfp', 'bfu', 'bfs') then null
                when u.label = 'stale' then gen_random_uuid()
                else u.id end
    from pg_temp.kt9_u u where u.label <> 'unlisted';
  exception when others then
    insert into pg_temp.kt9_before (k, v) values ('setup_failed', sqlstate || ' ' || left(sqlerrm, 120))
    on conflict (k) do nothing;
  end;
end
$setup$;
