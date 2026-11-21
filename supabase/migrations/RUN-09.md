# How to run migration 09 (hardened sign-in) and add the second sign-in

Plan on about twenty minutes. File 09 is small. Most of this page is the Supabase checklist that has to be done before the second person is added.

**Order: 09 first, then the checklist, then Brett's account, then his `parent` row.**

## What 09 does, in plain words

- **Today** the database decides who you are by reading the email written on your sign-in "ticket" and looking it up on the list of allowed people (`app_users`). That is fine while only you can ever get a ticket. It is not safe once a second person exists.
- **After 09** each person on the list is pinned to their Supabase account id. The database looks you up in Supabase's own list of accounts using the id Supabase stamped on the ticket. You count only if your row on the list is pinned to that same account, the email matches, and the account has a confirmed email, is not deleted, not banned, not an anonymous sign-in and not a single sign-on (SSO) account. A row with no pinned id gives no access at all. If an account is deleted and someone creates a new one with the same email, the old pin no longer matches and the new account gets nothing.
- 09 pins your existing admin rows for you, only when exactly one usable account has that email. It never pins a `parent` row.
- It also takes away a minor database right called "maintain" (PostgreSQL 17 and later) from the public key and signed-in users on our tables. It cannot read or change a row. This is housekeeping.
- **Before it replaces anything, 09 checks that you would still be able to sign in.** If none of the admin rows is pinned to a usable account, it stops with an error that starts `KT009 STOPPED` and changes nothing.

What does not change: your schedule, switches, notes, the family link, what the family page shows, what the Activities page shows, and every other rule. The live site keeps working before and after.

## Read this first

- **The `parent` row comes only after 09 has run and the checklist below is done.** Not before. Do not add Brett to the list yet.
- Safe to run twice. No schedule data is added, changed or removed. The only change to the sign-in list is the new pin on your admin rows.
- If you are already signed in on the admin page, you stay signed in. After the run, sign out and back in once to prove the new check lets you in.
- **Steps 1 and 2 are done.** 09 was run in your Supabase project on 2026-11-21 and checked (2 of 2 admin rows pinned and passing). What is left for you starts at Step 3. Steps 1 and 2 stay here for a rebuild.
- **Before step 1, count the accounts.** **Authentication**, then **Users**. There should be exactly the accounts you expect (2, both yours). 09 pins your admin rows to whichever account holds each admin email, so an account you do not recognise must be dealt with first. If there is one, stop and tell the developer.
- **After 09, changing your own sign-in email locks you out of the admin page** until the matching row on the list is updated in the SQL Editor. Ask the developer before changing it.

## Step 1: run file 09

1. Open https://supabase.com/dashboard and choose the project **Kids' Tracker**.
2. In the left sidebar click **SQL Editor**, then **New query**.
3. Open `supabase/migrations/09_harden_sign_in.sql`, select everything, copy, paste into the box.
4. Click **Run** (or Cmd + Enter). Supabase may warn that the query has a "destructive operation". The file only adds a column, pins your admin rows, replaces one function and contains `revoke` statements. Nothing is dropped or deleted. Confirm and run.

**What you should see:** `Success. No rows returned`. The results area may also show a notice reading `KT009 guard ok: 2 of 2 admin rows are pinned and pass the new check` (where notices appear may differ).

**If the notice says `1 of 2` (or the Step 2 check shows fewer pinned rows than admin rows):** one of your two admin emails could not be pinned and will not get in. Do not sign out of the admin page. Tell the developer first.

**If you see `KT009 STOPPED`:** nothing was changed. It means no admin row could be pinned to a confirmed, active account. Tell the developer before doing anything else.

## Step 2: check it

New query, paste, Run. It reads the catalog and counts only. It shows no email.

```sql
select
  (select pg_get_functiondef('public.my_role()'::regprocedure) like '%user_id%')            as my_role_is_new,
  (select count(*) from public.app_users where role = 'admin')                              as admin_rows,
  (select count(*) from public.app_users a
    join auth.users u on u.id = a.user_id and lower(u.email) = a.email
    where a.role = 'admin' and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.is_anonymous, false) = false and coalesce(u.is_sso_user, false) = false) as admin_rows_pinned_and_passing,
  (select count(*) from public.app_users where role = 'parent')                             as parent_rows,
  (select count(*) from auth.users)                                                         as accounts,
  (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.privilege_type = 'MAINTAIN'
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))) as maintain_rights_left;
```

**What you should see, one row:** `my_role_is_new` = true, `admin_rows` = 2, `admin_rows_pinned_and_passing` = 2, `parent_rows` = 0, `accounts` = the number of accounts you expect (2 before Brett), `maintain_rights_left` = 0.

Then open the admin page, sign out, sign in again. Your schedule should load as usual.

## Step 3: Supabase checklist (you do these, in the dashboard)

Menu names can change. Where I could not confirm the current wording, it says "wording may differ". Look for the closest match.

1. **Public sign-ups off.** Left sidebar **Authentication**, then **Sign In / Providers** (may be called Providers or Sign In Methods). Find **Allow new users to sign up** and turn it **off**. Save.
2. **Confirm email on.** Same page, open the **Email** provider. Make sure **Confirm email** is **on**. Save.
3. **Secure email change on.** In the Email provider settings, find **Secure email change** (wording may differ) and turn it **on**. This makes an email change need confirmation, so an account's email cannot be swapped quietly.
4. **Only the Email provider on.** Every other provider (Google, Apple, GitHub, Phone, SAML and the rest) should show disabled. Turn off anything else that is on.
5. **Anonymous sign-ins off.** Look for **Allow anonymous sign-ins** (wording may differ) and make sure it is **off**.
6. **Manual linking off.** Look for **Allow manual linking** (usually under Authentication, then Sign In / Providers, in the settings near the top or in an advanced section; wording and location may differ) and make sure it is **off**.
7. **Count the accounts.** **Authentication**, then **Users**. The number of accounts should be exactly what you expect: **2 before Brett, 3 after**. If there is any account you do not recognise, stop and tell the developer.

## Step 4: create Brett's account

First check no account with his email exists yet. New query, replace `brett@example.test` with his real email (keep the quotes), Run. It returns a number only.

```sql
select count(*) as accounts_with_this_email
from auth.users
where lower(email) = lower('brett@example.test');
```

**What you should see:** `0`.

**If it is not 0: stop and ask.** Do not confirm, reuse or edit that account. It may have been made by someone else.

If it is 0:

1. **Authentication**, then **Users**, then **Add user**, then **Create new user** (wording may differ).
2. Type his email and a password. Tick **Auto Confirm User** so the account counts as confirmed (wording may differ). Click **Create user**.
3. Share the password with him yourself. Do not put it in the repo or in a text that also names this site's address.
4. The account count under Users should now be 3.

## Step 5: add Brett's `parent` row (only after steps 1 to 4 are done)

New query. Replace `brett@example.test` in **both** places with his real email, inside the quotes. Do not save the edited statement into the repo. This one statement looks up his account and saves its id on the row, so the row is pinned from the start.

```sql
insert into public.app_users (email, role, user_id)
select lower(u.email), 'parent', u.id
from auth.users u
where lower(u.email) = lower('brett@example.test')
  and u.email_confirmed_at is not null
  and u.deleted_at is null
  and (u.banned_until is null or u.banned_until <= now())
  and coalesce(u.is_anonymous, false) = false
  and coalesce(u.is_sso_user, false) = false;
```

**What you should see:** `Success. No rows returned` (Supabase does not show how many rows were added, so run the check next).

Check, count only:

```sql
select count(*) as pinned_parent_rows
from public.app_users
where role = 'parent' and user_id is not null;
```

**What you should see:** `1`.

**If it shows 0:** the statement inserted nothing, which means it found no usable account for that email. Either the email was typed differently, or the account is not confirmed, or it is deleted, banned, anonymous or an SSO account. Nothing was added to the list, so nothing is exposed. Check the email and the account under Authentication, then Users, and run it again. Do not confirm an account you did not create yourself.

**If you get a "duplicate key" error:** a row for that email or account is already on the list. Stop and ask.

Then run the Step 2 check again: `parent_rows` should be 1 and `admin_rows_pinned_and_passing` still 2.

## Emergency way back

If after 09 you cannot sign in to the admin page and the developer cannot be reached, the SQL Editor still works for you because it runs as the database owner. The old check trusts the email on the ticket, so **if a `parent` row exists, first take Brett's access away: either ban his account (Authentication, Users, his row, ban user), or remove his row with the statement below. Then** paste the old check back and tell the developer.

Remove his row (replace the placeholder):

```sql
delete from public.app_users where role = 'parent' and lower(email) = lower('brett@example.test');
```

Put the old check back (the `user_id` column can stay; the old check ignores it):

```sql
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users
  where email = lower(auth.jwt() ->> 'email')
$$;
revoke execute on function public.my_role() from public, anon;
grant  execute on function public.my_role() to authenticated;
```

Do not add a `parent` row while the old check is in place.

## What 09 does not do

- A banned or deleted person's old sign-in ticket still exists until it expires (up to about an hour), but it gets nothing: the new `my_role()` reads the account row on every request, so a ban or delete takes effect in the database on the very next request.
- It does not add logging of changes to kids, places and homes, pin imported calendar ids, or tighten function search paths. Those are listed in `README.md` and are due before Phase 2.
