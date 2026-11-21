-- Kids Tracker migration 09: harden the sign-in check before a second person is added
--
-- What this does
--   1. Adds app_users.user_id (nullable uuid, unique when set). Each person on the sign-in list is
--      pinned to their Supabase account id.
--   2. Pins the existing admin rows: for each admin row with no user_id, if exactly one account in
--      Supabase's user list (auth.users) has that email and is usable (confirmed email, not deleted, not
--      banned, not anonymous, not SSO), its id is saved on the row. Parent rows are never pinned here;
--      a parent is pinned by the statement that adds the row (see RUN-09.md).
--   3. Stops, before replacing anything, if admin rows exist and none is pinned to a usable account.
--      That would lock the owner out, so the whole file is undone instead.
--   4. my_role() no longer trusts the email written inside the sign-in token. It finds the account by the
--      user id Supabase signed into the token, and the person counts only if their list row is pinned to
--      that same id, the email matches, and the account is usable. A row with no user_id grants nothing.
--   5. Takes away the PostgreSQL 17 "maintain" right (vacuum, analyze, reindex, lock the table) from the
--      public key and from signed-in users on every table of ours. Skipped on older PostgreSQL. It cannot
--      read or change a row; this is housekeeping.
--
-- Why the list is keyed by email and also pinned to the account id
--   The list stays keyed by email so the owner can add a person with one line of SQL and the list reads
--   as plain English. It is pinned to the account id for safety: if an account is deleted and someone
--   makes a new account with the same email, the old pin no longer matches and the new account gets
--   nothing until the owner pins it on purpose.
--
-- user_id has no foreign key into auth. A foreign key into another schema can block Supabase's own
-- account deletion or change, and a pin to a deleted account is harmless: it matches nothing.
--
-- What does not change
--   No table, rule or trigger. get_schedule(p_token) and get_editor_schedule() are not touched and return
--   exactly what they did. is_editor() and my_who() are not touched. Nothing is loosened.
--
-- Safe to run twice. No personal data. No deletes. Runs as one unit in one transaction.
-- Run order: after 06, 07 and 08. Do this BEFORE the first 'parent' row is added to app_users.

-- ---------------------------------------------------------------
-- 1. The pin column. Same deny-all as the rest of app_users: no new grant or policy.
-- ---------------------------------------------------------------
alter table public.app_users add column if not exists user_id uuid;
create unique index if not exists app_users_user_id_key on public.app_users (user_id) where user_id is not null;

-- ---------------------------------------------------------------
-- 2. Pin admin rows only, and only when exactly one usable account has that email.
-- ---------------------------------------------------------------
update public.app_users a
set user_id = u.id
from auth.users u
where a.role = 'admin'
  and a.user_id is null
  and lower(u.email) = a.email
  and u.email_confirmed_at is not null
  and u.deleted_at is null
  and (u.banned_until is null or u.banned_until <= now())
  and coalesce(u.is_anonymous, false) = false
  and coalesce(u.is_sso_user, false) = false
  and (select count(*) from auth.users u2 where lower(u2.email) = a.email) = 1;

-- ---------------------------------------------------------------
-- 3. Lock-out guard. Counts only; never reads or shows an email.
--    (On a brand-new project with no admin row yet there is nobody to lock out, so it carries on.)
-- ---------------------------------------------------------------
do $guard$
declare
  v_admins int;
  v_pass   int;
begin
  select count(*) into v_admins from public.app_users where role = 'admin';
  select count(*) into v_pass
  from public.app_users a
  join auth.users u on u.id = a.user_id and lower(u.email) = a.email
  where a.role = 'admin'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and coalesce(u.is_anonymous, false) = false
    and coalesce(u.is_sso_user, false) = false;
  if v_admins > 0 and v_pass = 0 then
    raise exception 'KT009 STOPPED: % admin row(s) on the sign-in list, but none is pinned to a confirmed, active account in Supabase Authentication. Nothing was changed. Check the admin email under Authentication, then Users, and run this file again.', v_admins
      using errcode = 'KT009';
  end if;
  raise notice 'KT009 guard ok: % of % admin rows are pinned and pass the new check', v_pass, v_admins;
end
$guard$;

-- ---------------------------------------------------------------
-- 4. my_role(): who is signed in, from the account row and the pinned id, not from the token's email.
--    auth.uid() is the user id Supabase signed into the token. At most one row can match.
--    Anyone else, a row with no user_id, and no token, give null.
-- ---------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select a.role
  from auth.users u
  join public.app_users a on a.user_id = u.id and a.email = lower(u.email)
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and coalesce(u.is_anonymous, false) = false
    and coalesce(u.is_sso_user, false) = false
$$;
revoke execute on function public.my_role() from public, anon;
grant  execute on function public.my_role() to authenticated;

-- ---------------------------------------------------------------
-- 5. Take away "maintain" (PostgreSQL 17 and later only) on every table of ours.
--    Dynamic SQL behind a version check: older PostgreSQL does not know the word.
-- ---------------------------------------------------------------
do $maintain$
declare
  t text;
begin
  if current_setting('server_version_num')::int >= 170000 then
    foreach t in array array['settings', 'breaks', 'swaps', 'swap_details', 'share_links', 'app_users',
                             'kids', 'homes', 'places', 'teams', 'events', 'event_comments', 'contacts', 'event_log']
    loop
      if to_regclass('public.' || t) is not null then
        execute format('revoke maintain on public.%I from public, anon, authenticated', t);
      end if;
    end loop;
  end if;
end
$maintain$;
