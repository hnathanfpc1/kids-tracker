-- Kids Tracker: after the dry run of migration 09. Send this as its OWN call, after the dry-run call has ended.
--
-- Run it TWICE: once BEFORE the dry run and once AFTER. Lines marked "same as before" must match between the two runs.
-- It is one read-only query. It returns labels, counts and true or false only: no email, no link, no schedule row.
--
-- If the dry run left nothing behind, every "expected" is met and the two runs agree.
-- If any line does not match, the dry run was NOT undone. Stop and tell the developer.
--
-- Do not run it after the real 09 expecting line 9 to match the "before" run: 09 changes my_role() on purpose.

select *
from (
  select 1 as n, 'public tables' as item,
         (select count(*)::text from pg_tables where schemaname = 'public') as found, '14' as expected
  union all
  select 2, 'public policies',
         (select count(*)::text from pg_policies where schemaname = 'public'), '22'
  union all
  select 3, 'public triggers',
         (select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
          where c.relnamespace = 'public'::regnamespace and not g.tgisinternal), '26'
  union all
  select 4, 'functions in public',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace), 'same as before'
  union all
  select 5, 'app_users rows (all)',
         (select count(*)::text from public.app_users), 'same as before'
  union all
  select 6, 'app_users rows with an example.test email',
         (select count(*)::text from public.app_users where email like '%example.test'), '0'
  union all
  select 7, 'sign-in accounts (auth.users) with an example.test email',
         (select count(*)::text from auth.users where email like '%example.test'), '0'
  union all
  select 8, 'sign-in accounts (auth.users) total',
         (select count(*)::text from auth.users), 'same as before'
  union all
  select 9, 'my_role() reads auth.users',
         (select (pg_get_functiondef('public.my_role()'::regprocedure) like '%auth.users%')::text),
         'same as before (false until 09 is run for real)'
  union all
  select 14, 'app_users rows pinned to an account id',
         (select count(*)::text from public.app_users where to_jsonb(app_users) ->> 'user_id' is not null),
         'same as before (the dry run pins nothing for good)'
  union all
  select 15, 'breaks, swap_details or share_links rows from the dry run',
         ((select count(*) from public.breaks where year = 1900) + (select count(*) from public.swap_details where day < date '1901-01-01')
          + (select count(*) from public.share_links where label = 'dryrun9'))::text, '0'
  union all
  select 10, 'swaps dated in the year 1900',
         (select count(*)::text from public.swaps where day < date '1901-01-01'), '0'
  union all
  select 11, 'kids named Dryrun9',
         (select count(*)::text from public.kids where name like 'Dryrun9%'), '0'
  union all
  select 12, 'share_links rows',
         (select count(*)::text from public.share_links), 'same as before'
  union all
  select 13, 'settings changed_at (as a hash)',
         (select md5(changed_at::text) from public.settings where id = 1), 'same as before'
) r
order by r.n;
