-- Kids Tracker: after the dry run. Send this as its OWN call, after the dry-run call has ended.
--
-- Exact call order
--   ONE call: DRYRUN-00-preamble.sql, 06, 07, 08, 06, 07, 08, DRYRUN-06-08.sql
--   Then, as a SEPARATE call: DRYRUN-99-aftercheck.sql   (this file)
--
-- It is one read-only query. It changes nothing. It returns labels, counts and true or false only:
-- no email, no link, no schedule row.
--
-- If the dry run left nothing behind, every line matches its "expected" column. For the family link
-- count there is nothing to compare inside this file: compare it with the count taken before the dry run.
-- If any line does not match, the dry run was NOT undone and 06 to 08 (or parts of them) are in the
-- database. Stop and tell the developer.
--
-- Do not run this after the real migrations expecting it to match: then the activities tables are
-- supposed to exist.

select *
from (
  select 1 as n, 'public tables' as item,
         (select count(*)::text from pg_tables where schemaname = 'public') as found,
         '6' as expected
  union all
  select 2, 'activities table public.kids exists',
         (to_regclass('public.kids') is not null)::text,
         'false'
  union all
  select 3, 'rule on app_users.role',
         coalesce((select string_agg(pg_get_constraintdef(c.oid), ' ; ' order by c.conname::text)
                   from pg_constraint c
                   where c.conrelid = 'public.app_users'::regclass and c.contype = 'c'), '(none)'),
         'admin only, no parent'
  union all
  select 4, 'app_users rows with an example.test email',
         (select count(*)::text from public.app_users where email like '%example.test'),
         '0'
  union all
  select 5, 'share_links rows',
         (select count(*)::text from public.share_links),
         'same as before the dry run'
  union all
  select 6, 'swaps dated in the year 1900',
         (select count(*)::text from public.swaps where day < date '1901-01-01'),
         '0'
  union all
  select 7, 'functions from 06 to 08 (kt_..., is_editor, my_who, get_editor_schedule)',
         coalesce((select string_agg(p.proname::text, ', ' order by p.proname::text)
                   from pg_proc p
                   where p.pronamespace = 'public'::regnamespace
                     and (p.proname like 'kt\_%' or p.proname in ('is_editor', 'my_who', 'get_editor_schedule',
                          'events_stamp', 'events_log', 'teams_stamp', 'teams_log', 'comments_stamp'))), '(none)'),
         '(none)'
  union all
  select 8, 'public policies',
         (select count(*)::text from pg_policies where schemaname = 'public'),
         '5'
  union all
  select 9, 'public triggers',
         (select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
          where c.relnamespace = 'public'::regnamespace and not g.tgisinternal),
         '3'
) r
order by r.n;
