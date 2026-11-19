-- Kids Tracker migration 07: what a signed-in parent needs to see the schedule
--
-- What this does
--   1. Moves the family-safe schedule payload into one internal function, kt_schedule_core(), so it is
--      written in exactly one place.
--   2. get_schedule(p_token) now calls it. What it returns is identical to before: the same four keys
--      (settings, changed_at, breaks, swaps) with the same shape, and still only for an active link.
--   3. Adds get_editor_schedule() for the new Activities page. A signed-in admin or parent gets the same
--      family-safe payload without a link token. Anyone else gets null.
--
-- Why
--   The other parent's sign-in must be able to show who has the kids on each day, but must never read
--   settings, breaks, swaps or swap_details directly. Those tables stay admin-only. This function is the
--   only way in, and it hands over exactly what the family link already shows.
--
-- Safe to run twice. Creates functions only. No table, row, rule or trigger is changed. No personal data.
-- Run order: 06, then 07, then 08.

-- ---------------------------------------------------------------
-- The family-safe schedule payload, in one place.
-- Internal: nobody can call it through the API. It runs only inside the two functions below.
-- It must never return the private note, the totals start date or anything used for totals.
-- ---------------------------------------------------------------
create or replace function public.kt_schedule_core()
returns jsonb language sql stable set search_path = public as $$
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
$$;
revoke execute on function public.kt_schedule_core() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Family page: the only way the public reads data. Same output as before.
-- ---------------------------------------------------------------
create or replace function public.get_schedule(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (
      select 1 from public.share_links where token = p_token and active
    ) then public.kt_schedule_core() end
$$;
revoke execute on function public.get_schedule(text) from public;
grant  execute on function public.get_schedule(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Signed-in editors (admin or parent): the same family-safe payload, no token needed.
-- The caller's role is checked inside the function. Returns null for anyone who is not an editor.
-- p_from and p_to choose the range of activities returned once migration 08 has run.
-- They are accepted but not used yet, so the function keeps one name and one shape.
-- ---------------------------------------------------------------
create or replace function public.get_editor_schedule(p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_editor() then public.kt_schedule_core() end
$$;
revoke execute on function public.get_editor_schedule(date, date) from public, anon, authenticated;
grant  execute on function public.get_editor_schedule(date, date) to authenticated;
