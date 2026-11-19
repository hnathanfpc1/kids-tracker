-- Kids Tracker: security self-check for migrations 06 to 08
--
-- Paste the whole file into the Supabase SQL Editor and press Run. It is one query and it returns one table.
-- It reads only the database's own catalog (which tables, rules, grants and functions exist).
-- It does not read a single row of schedule, activity or personal data, and it changes nothing.
--
-- How to read the result: every line should say OK, KNOWN or INFO in the status column.
--   OK       as intended
--   KNOWN    something Supabase manages that we leave alone on purpose
--   INFO     a list for a person to read (the fields the family link can return, the triggers on each table)
--   PROBLEM  stop and send the line to the developer
--
-- It can be run after 06, after 07 or after 08. Sections 8, 9 and 12 fill in as 07 and 08 are run.

with
t as (
  select c.oid,
         c.relname::text as name,
         c.relrowsecurity as rls,
         pg_get_userbyid(c.relowner)::text as owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
pol as (
  select p.tablename::text as name,
         count(*) as n,
         string_agg(p.policyname::text || ' (' || p.cmd || ')', ', ' order by p.policyname::text) as list
  from pg_policies p
  where p.schemaname = 'public'
  group by p.tablename
),
f as (
  select p.oid,
         p.proname::text as name,
         p.oid::regprocedure::text as signature,
         p.prosecdef as definer,
         coalesce(array_to_string(p.proconfig, ','), '') as config,
         pg_get_userbyid(p.proowner)::text as owner,
         p.prosrc as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
main_owner as (
  select f.owner from f where f.name = 'get_schedule' limit 1
),
report as (

  -- 1. Row level security is on for every table
  select 1 as section,
         '1. Row level security is on for every table'::text as check_name,
         t.name as item,
         case when t.rls then 'OK' else 'PROBLEM' end as status,
         case when t.rls then 'on' else 'OFF' end as detail
  from t

  union all
  -- 2. Every table has rules, or is closed to everyone on purpose
  select 2,
         '2. Every table has rules, or is closed on purpose',
         t.name,
         case when coalesce(pol.n, 0) > 0 then 'OK'
              when t.name = 'app_users' then 'OK'
              else 'PROBLEM' end,
         case when coalesce(pol.n, 0) > 0 then pol.list
              when t.name = 'app_users' then 'no rule on purpose: nobody reads it directly'
              else 'no rule at all' end
  from t
  left join pol on pol.name = t.name

  union all
  -- 3. The public (anon) key has no rights on any table
  select 3,
         '3. The public key cannot touch any table',
         t.name,
         case when has_table_privilege('anon'::name, t.oid, 'select, insert, update, delete, truncate, references, trigger')
                or has_any_column_privilege('anon'::name, t.oid, 'select, insert, update, references')
              then 'PROBLEM' else 'OK' end,
         case when has_table_privilege('anon'::name, t.oid, 'select, insert, update, delete, truncate, references, trigger')
                or has_any_column_privilege('anon'::name, t.oid, 'select, insert, update, references')
              then 'the public key has a right on this table' else 'no rights' end
  from t

  union all
  -- 4. The only function the public (anon) key can run is get_schedule
  select 4,
         '4. Functions the public key can run',
         f.signature,
         case when f.name = 'get_schedule' then 'OK'
              when f.name = 'rls_auto_enable' then 'KNOWN'
              else 'PROBLEM' end,
         case when f.name = 'get_schedule' then 'expected: the family page, and it checks the link token'
              when f.name = 'rls_auto_enable' then 'managed by Supabase, left alone on purpose'
              else 'the public key should not be able to run this' end
  from f
  where has_function_privilege('anon'::name, f.oid, 'execute')

  union all
  select 4,
         '4. Functions the public key can run',
         'family page can still load',
         case when exists (select 1 from f where f.name = 'get_schedule'
                           and has_function_privilege('anon'::name, f.oid, 'execute'))
              then 'OK' else 'PROBLEM' end,
         'get_schedule must stay runnable with the public key'

  union all
  -- 5. Custody tables: every rule is admin-only, and app_users has no direct access
  select 5,
         '5. Custody tables are admin-only',
         p.tablename::text || ': ' || p.policyname::text,
         case when coalesce(p.qual, '') ~ 'my_role\(\) = ''admin'''
               and coalesce(p.with_check, p.qual, '') ~ 'my_role\(\) = ''admin'''
               and coalesce(p.qual, '') !~ 'parent|is_editor'
               and coalesce(p.with_check, '') !~ 'parent|is_editor'
              then 'OK' else 'PROBLEM' end,
         p.cmd || ' when ' || coalesce(p.qual, p.with_check, '(nothing)')
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('settings', 'breaks', 'swaps', 'swap_details', 'share_links', 'app_users')

  union all
  select 5,
         '5. Custody tables are admin-only',
         'app_users: direct access',
         case when has_table_privilege('authenticated'::name, t.oid, 'select, insert, update, delete, truncate')
                or has_table_privilege('anon'::name, t.oid, 'select, insert, update, delete, truncate')
              then 'PROBLEM' else 'OK' end,
         'signed-in users and the public key must have no rights on app_users'
  from t
  where t.name = 'app_users'

  union all
  -- 6. Nobody can write the change log directly
  select 6,
         '6. The change log is written by triggers only',
         t.name,
         case when has_table_privilege('authenticated'::name, t.oid, 'insert, update, delete, truncate')
              then 'PROBLEM' else 'OK' end,
         'signed-in users may read it and must not be able to add, change or remove lines'
  from t
  where t.name = 'event_log'

  union all
  -- 7. Every security definer function pins its search path
  select 7,
         '7. Security definer functions pin search_path',
         f.signature,
         case when f.config like '%search_path=public%' then 'OK'
              when f.name = 'rls_auto_enable' then 'KNOWN'
              else 'PROBLEM' end,
         case when f.name = 'rls_auto_enable' and f.config not like '%search_path=public%'
              then 'managed by Supabase, left alone on purpose'
              else f.config end
  from f
  where f.definer

  union all
  -- 8. The functions behind the family link never mention a private field
  select 8,
         '8. Family link functions never mention private fields',
         f.signature,
         case when f.src ~* '\m(pnote|track_from|ical_url|phone|homes|contacts|lat|lng|source_uid)\M'
              then 'PROBLEM' else 'OK' end,
         'looked for: pnote, track_from, ical_url, phone, homes, contacts, lat, lng, source_uid'
  from f
  where f.name in ('get_schedule', 'kt_schedule_core', 'kt_activities')

  union all
  -- 9. Every field name the family link can return (read from the function text, not from data)
  select 9,
         '9. Field names the family link can return',
         f.signature,
         'INFO',
         coalesce((select string_agg(distinct r.m[1], ', ' order by r.m[1])
                   from regexp_matches(f.src, '''([a-z_]+)''\s*,', 'g') as r(m)), '(none)')
  from f
  where f.name in ('kt_schedule_core', 'kt_activities')

  union all
  -- 10. Tables and functions all belong to the same owner as get_schedule
  select 10,
         '10. One owner for our tables and functions',
         x.item,
         case when x.owner = (select mo.owner from main_owner mo) then 'OK'
              when x.item like '%rls_auto_enable%' then 'KNOWN'
              else 'PROBLEM' end,
         'owner: ' || x.owner
  from (
    select 'table ' || t.name as item, t.owner from t
    union all
    select 'function ' || f.signature, f.owner from f
  ) x

  union all
  -- 11. Triggers on each table (for a person to read)
  select 11,
         '11. Triggers on each table',
         c.relname::text,
         'INFO',
         string_agg(g.tgname::text, ', ' order by g.tgname::text)
  from pg_trigger g
  join pg_class c on c.oid = g.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not g.tgisinternal
  group by c.relname

  union all
  -- 12. Exactly which functions each kind of caller can run through the API
  select 12,
         '12. Functions callers can run (exact list)',
         'public key (anon): expect get_schedule only',
         case when coalesce((select string_agg(f.name, ',' order by f.name collate "C") from f
                             where f.name <> 'rls_auto_enable'
                               and has_function_privilege('anon'::name, f.oid, 'execute')), '') = 'get_schedule'
              then 'OK' else 'PROBLEM' end,
         coalesce((select string_agg(f.name, ', ' order by f.name collate "C") from f
                   where f.name <> 'rls_auto_enable'
                     and has_function_privilege('anon'::name, f.oid, 'execute')), '(none)')

  union all
  select 12,
         '12. Functions callers can run (exact list)',
         'signed-in (authenticated): expect five once 07 has run',
         case when not exists (select 1 from f
                               where f.name <> 'rls_auto_enable'
                                 and has_function_privilege('authenticated'::name, f.oid, 'execute')
                                 and f.name not in ('get_editor_schedule', 'get_schedule', 'is_editor', 'my_role', 'my_who'))
               and (select count(*) from f
                    where has_function_privilege('authenticated'::name, f.oid, 'execute')
                      and f.name in ('get_schedule', 'is_editor', 'my_role', 'my_who')) = 4
              then 'OK' else 'PROBLEM' end,
         coalesce((select string_agg(f.name, ', ' order by f.name collate "C") from f
                   where f.name <> 'rls_auto_enable'
                     and has_function_privilege('authenticated'::name, f.oid, 'execute')), '(none)')

  union all
  -- 13. What signed-in users may do to each table, before the row rules narrow it further
  select 13,
         '13. Signed-in table rights (exact)',
         r.name,
         case when r.rights = r.want then 'OK' else 'PROBLEM' end,
         'has: ' || case when r.rights = '' then '(nothing)' else r.rights end
           || '   expected: ' || case when r.want = '' then '(nothing)' else r.want end
  from (
    select t.name,
           concat_ws(', ',
             case when has_table_privilege('authenticated'::name, t.oid, 'select') then 'select' end,
             case when has_table_privilege('authenticated'::name, t.oid, 'insert') then 'insert' end,
             case when has_table_privilege('authenticated'::name, t.oid, 'update') then 'update' end,
             case when has_table_privilege('authenticated'::name, t.oid, 'delete') then 'delete' end) as rights,
           case
             when t.name = 'app_users' then ''
             when t.name in ('settings', 'breaks', 'swaps', 'swap_details', 'share_links',
                             'places', 'teams', 'events', 'contacts') then 'select, insert, update, delete'
             when t.name in ('kids', 'homes') then 'select, insert, update'
             when t.name = 'event_comments' then 'select, insert, delete'
             when t.name = 'event_log' then 'select'
             else '(a table this check does not know)'
           end as want
    from t
  ) r

  union all
  -- 14. Row level security does not cover truncate, so the right itself must be absent
  select 14,
         '14. Nobody can truncate, reference or add triggers',
         t.name,
         case when has_table_privilege('anon'::name, t.oid, 'truncate, references, trigger')
                or has_table_privilege('authenticated'::name, t.oid, 'truncate, references, trigger')
              then 'PROBLEM' else 'OK' end,
         concat_ws(', ',
           case when has_table_privilege('anon'::name, t.oid, 'truncate') then 'public key can truncate' end,
           case when has_table_privilege('anon'::name, t.oid, 'references, trigger') then 'public key has references or trigger' end,
           case when has_table_privilege('authenticated'::name, t.oid, 'truncate') then 'signed-in can truncate' end,
           case when has_table_privilege('authenticated'::name, t.oid, 'references, trigger') then 'signed-in has references or trigger' end,
           case when not (has_table_privilege('anon'::name, t.oid, 'truncate, references, trigger')
                       or has_table_privilege('authenticated'::name, t.oid, 'truncate, references, trigger')) then 'none of the three' end)
  from t
)
select check_name as "check", item, status, detail
from report
order by section, item;
