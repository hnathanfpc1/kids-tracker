-- Kids Tracker migration 08: get_schedule returns activities to the family link
--
-- What this does
--   1. Adds one internal function, kt_activities(), that builds the activities part of the payload.
--   2. get_schedule(p_token) returns everything it returned before, unchanged, plus seven new keys:
--      window, kids, places, teams, events, comments, log.
--   3. get_editor_schedule() returns the same seven keys for signed-in editors, with a wider view.
--
-- What the family link gets (only for an active link)
--   window    the date range of activities returned: 7 days back to 60 days ahead, US Eastern time
--   kids      active kids, plus any kid on a returned activity: id, name, color, sort, active
--   events    activities inside the window, canceled ones included with their status
--   teams     only teams used by a returned activity: name, kids, place, arrive-early minutes, gear, note
--   places    only places used by a returned activity or its team: name, address, drive minutes, note
--   comments  only comments shared with the family (grandma tagged), only for returned activities
--   log       change log lines from the last 30 days, only for activities that are (or were) inside
--             the window and teams that are returned: when, who, action and the one-line summary
--
-- What the family link never gets
--   The private note, the totals start date, anything used for totals, the private calendar links on teams,
--   phone numbers, home addresses, map coordinates, comments that are not shared with the family,
--   the before and after detail of the change log, or import ids.
--   Every column is named one by one below. Nothing is copied as a whole row, so a column added to a table
--   later cannot leak by accident.
--
-- What signed-in editors get from get_editor_schedule()
--   The same keys and shapes. All kids, teams and places. Activities in the range asked for (no limit when
--   p_from and p_to are left out). Every comment on those activities. The last 90 days of the change log.
--   Still no calendar links: the Activities page reads those from the teams table directly.
--
-- Safe to run twice. Creates functions only. No table, row, rule or trigger is changed. No personal data.
-- Run order: 06, then 07, then 08.

-- ---------------------------------------------------------------
-- The activities part of the payload, in one place.
-- Internal: nobody can call it through the API. It runs only inside the two functions below.
-- p_family = true gives the family-link view (the stricter one). Null is treated as true.
-- ---------------------------------------------------------------
create or replace function public.kt_activities(p_from date, p_to date, p_family boolean)
returns jsonb language sql stable set search_path = public as $$
  with ev as (
    select e.id, e.team_id, e.kid_ids, e.kind, e.title, e.day, e.start_time, e.end_time,
           e.place_id, e.place_text, e.arrive_by, e.gear, e.note, e.status,
           e.created_at, e.updated_at, e.updated_by
    from public.events e
    where (p_from is null or e.day >= p_from)
      and (p_to   is null or e.day <= p_to)
  ),
  tm as (
    select t.id, t.name, t.kid_ids, t.place_id, t.early_practice, t.early_game, t.gear, t.note, t.active
    from public.teams t
    where not coalesce(p_family, true)
       or exists (select 1 from ev where ev.team_id = t.id)
  ),
  pl as (
    select p.id, p.name, p.address, p.drive_me, p.drive_co, p.drive_grandma, p.note
    from public.places p
    where not coalesce(p_family, true)
       or exists (select 1 from ev where ev.place_id = p.id)
       or exists (select 1 from tm where tm.place_id = p.id)
  ),
  kd as (
    select k.id, k.name, k.color, k.sort, k.active
    from public.kids k
    where not coalesce(p_family, true)
       or k.active
       or exists (select 1 from ev where k.id = any (ev.kid_ids))
  ),
  cm as (
    select c.id, c.event_id, c.at, c.author, c.body, c.tagged, c.share_family
    from public.event_comments c
    where exists (select 1 from ev where ev.id = c.event_id)
      and (c.share_family or not coalesce(p_family, true))
  ),
  lg as (
    select x.id, x.at, x.who, x.action, x.event_id, x.team_id, x.summary, x.batch_id,
           coalesce(x.after ->> 'source', x.before ->> 'source') as source,
           (x.after  ->> 'day')::date as day_after,
           (x.before ->> 'day')::date as day_before,
           count(*) over (partition by x.batch_id, x.action) as batch_count
    from public.event_log x
    where x.at >= now() - (case when coalesce(p_family, true) then interval '30 days' else interval '90 days' end)
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'kids', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', kd.id, 'name', kd.name, 'color', kd.color, 'sort', kd.sort, 'active', kd.active)
             order by kd.sort, kd.name), '[]'::jsonb)
      from kd),
    'places', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', pl.id, 'name', pl.name, 'address', pl.address,
               'drive_me', pl.drive_me, 'drive_co', pl.drive_co, 'drive_grandma', pl.drive_grandma,
               'note', pl.note)
             order by pl.name), '[]'::jsonb)
      from pl),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', tm.id, 'name', tm.name, 'kid_ids', tm.kid_ids, 'place_id', tm.place_id,
               'early_practice', tm.early_practice, 'early_game', tm.early_game,
               'gear', tm.gear, 'note', tm.note, 'active', tm.active)
             order by tm.name), '[]'::jsonb)
      from tm),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ev.id, 'team_id', ev.team_id, 'kid_ids', ev.kid_ids, 'kind', ev.kind, 'title', ev.title,
               'day', ev.day, 'start_time', ev.start_time, 'end_time', ev.end_time,
               'place_id', ev.place_id, 'place_text', ev.place_text, 'arrive_by', ev.arrive_by,
               'gear', ev.gear, 'note', ev.note, 'status', ev.status,
               'created_at', ev.created_at, 'updated_at', ev.updated_at, 'updated_by', ev.updated_by)
             order by ev.day, ev.start_time, ev.id), '[]'::jsonb)
      from ev),
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', cm.id, 'event_id', cm.event_id, 'at', cm.at, 'author', cm.author,
               'body', cm.body, 'tagged', cm.tagged, 'share_family', cm.share_family)
             order by cm.at, cm.id), '[]'::jsonb)
      from cm),
    'log', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', lg.id, 'at', lg.at, 'who', lg.who, 'action', lg.action,
               'event_id', lg.event_id, 'team_id', lg.team_id, 'summary', lg.summary,
               'source', lg.source, 'batch_id', lg.batch_id, 'batch_count', lg.batch_count)
             order by lg.at desc, lg.summary, lg.id), '[]'::jsonb)
      from lg
      where not coalesce(p_family, true)
         or exists (select 1 from tm where tm.id = lg.team_id)
         or lg.day_after  between p_from and p_to
         or lg.day_before between p_from and p_to)
  )
$$;
revoke execute on function public.kt_activities(date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Family page: the only way the public reads data.
-- Returns data only for an active share token, otherwise null.
-- The four schedule keys are unchanged. The activities window is worked out in US Eastern time,
-- named explicitly, so "today" does not flip early in the evening and does not depend on a server setting.
-- ---------------------------------------------------------------
create or replace function public.get_schedule(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (
      select 1 from public.share_links where token = p_token and active
    ) then public.kt_schedule_core()
        || public.kt_activities(
             (now() at time zone 'America/New_York')::date - 7,
             (now() at time zone 'America/New_York')::date + 60,
             true)
  end
$$;
revoke execute on function public.get_schedule(text) from public;
grant  execute on function public.get_schedule(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Signed-in editors (admin or parent): the same payload, no token needed, wider view.
-- The caller's role is checked inside the function. Returns null for anyone who is not an editor.
-- p_from and p_to are optional day limits for the activities returned. Leave them out for everything.
-- ---------------------------------------------------------------
create or replace function public.get_editor_schedule(p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_editor()
    then public.kt_schedule_core() || public.kt_activities(p_from, p_to, false)
  end
$$;
revoke execute on function public.get_editor_schedule(date, date) from public, anon, authenticated;
grant  execute on function public.get_editor_schedule(date, date) to authenticated;
