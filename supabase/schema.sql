-- Kids Tracker: full database structure (no personal data)
-- This is the combined result of migrations 01, 03, 04, 05, 06, 07, 08 and 09.
-- 01 to 08 are live. 09 (hardened sign-in check) is in supabase/migrations; the README there says which have been run.
-- Use it as the reference for how the database works, or to rebuild a fresh Supabase project.
-- Everything here is safe to re-run: it creates what is missing and replaces functions and policies.
-- It never deletes or loads schedule data.
--
-- Not created here: the live project also has a Supabase-managed function, public.rls_auto_enable(),
-- attached to an event trigger named ensure_rls. It comes from the "automatically enable RLS on new tables"
-- option chosen when the project was made. Our migrations do not create, change or remove it, and they do
-- not rely on it: every table below turns row level security on explicitly.

-- ---------------------------------------------------------------
-- Who can sign in and edit
--   admin  = Heather. Everything.
--   parent = the other parent. Activities only. No access to the custody tables.
-- ---------------------------------------------------------------
create table if not exists public.app_users (
  email text primary key,                       -- always lowercase
  role  text not null,
  user_id uuid,                                 -- the person's Supabase account id; pinned when added (migration 09)
  constraint app_users_role_check check (role in ('admin', 'parent'))
);
-- On a project that still has the old admin-only rule, replace it. Existing rows are not touched.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.app_users'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.app_users drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.app_users
  add constraint app_users_role_check check (role in ('admin', 'parent'));

-- Pin each person to their account id. Nullable; unique when set. A row with no user_id grants nothing.
-- On a fresh rebuild there are no rows to backfill. (On the live project 09 pins the admin rows.)
alter table public.app_users add column if not exists user_id uuid;
create unique index if not exists app_users_user_id_key on public.app_users (user_id) where user_id is not null;

alter table public.app_users enable row level security;
-- No policy and no grant on app_users on purpose: that is deny-all. Only my_role() (security definer) reads it.
revoke all on public.app_users from public, anon, authenticated;

-- Who is signed in, found by user id in Supabase's own user list (never from the token's email claim).
-- The person counts only if their app_users row is pinned to that same id (user_id), the email matches,
-- and the account is usable: confirmed email, not deleted, not banned, not anonymous, not SSO.
-- A row with no user_id grants nothing. Anyone else, and no token, gives null. (Migration 09.)
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

-- True for admin or parent. Used in the rules on the activities tables.
create or replace function public.is_editor()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'parent'), false)
$$;
revoke execute on function public.is_editor() from public, anon, authenticated;
grant  execute on function public.is_editor() to authenticated;

-- Who the signed-in person is, as a holder key: admin = 'me', parent = 'co'. Null for anyone else.
-- Always worked out here from the sign-in, never taken from a value the page sends.
create or replace function public.my_who()
returns text language sql stable set search_path = public as $$
  select case public.my_role() when 'admin' then 'me' when 'parent' then 'co' end
$$;
revoke execute on function public.my_who() from public, anon, authenticated;
grant  execute on function public.my_who() to authenticated;

-- ---------------------------------------------------------------
-- Schedule data (custody tables: admin-only)
-- ---------------------------------------------------------------
create table if not exists public.settings (
  id         int primary key default 1 check (id = 1),
  my_name    text not null default 'Heather',
  co_name    text not null default 'Brett',
  anchor     date not null,                     -- any Friday that starts one of Heather's weeks
  track_from date not null,                     -- totals count from this date
  changed_at timestamptz not null default now() -- bumped by triggers; drives "what's new"
);
alter table public.settings add column if not exists changed_at timestamptz not null default now();

create table if not exists public.breaks (
  year int primary key,                         -- calendar year
  data jsonb not null default '{}'              -- school calendar and break dates, see CLAUDE.md
);

create table if not exists public.swaps (
  day        date primary key,
  had        text not null,                     -- me = Heather, co = Brett, grandma, other
  caregiver  text,                              -- name when had = 'other'
  updated_at timestamptz not null default now()
);
alter table public.swaps drop constraint if exists swaps_had_check;
alter table public.swaps add constraint swaps_had_check check (had in ('me', 'co', 'grandma', 'other'));

create table if not exists public.swap_details (
  day    date primary key references public.swaps(day) on delete cascade,
  reason text,                                  -- work, travel, coverage, other
  note   text,                                  -- shared note: shown on the family page
  pnote  text                                   -- private note: Heather only, never shared
);
alter table public.swap_details add column if not exists pnote text;

create table if not exists public.share_links (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  label      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Row level security: the custody tables are admin-only. The parent role gets nothing here.
-- ---------------------------------------------------------------
alter table public.settings     enable row level security;
alter table public.breaks       enable row level security;
alter table public.swaps        enable row level security;
alter table public.swap_details enable row level security;
alter table public.share_links  enable row level security;

-- The public (anon) key holds no rights on these tables at all.
-- Signed-in users hold select, insert, update and delete only, and the rules below limit those to admin.
-- Nobody but the owner holds truncate, references or trigger: row level security does not cover those.
revoke all on public.settings, public.breaks, public.swaps, public.swap_details, public.share_links
  from public, anon;
revoke truncate, references, trigger
  on public.settings, public.breaks, public.swaps, public.swap_details, public.share_links
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.settings, public.breaks, public.swaps, public.swap_details, public.share_links
  to authenticated;

drop policy if exists admin_settings on public.settings;
drop policy if exists admin_breaks   on public.breaks;
drop policy if exists admin_swaps    on public.swaps;
drop policy if exists admin_details  on public.swap_details;
drop policy if exists admin_links    on public.share_links;
create policy admin_settings on public.settings     for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy admin_breaks   on public.breaks       for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy admin_swaps    on public.swaps        for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy admin_details  on public.swap_details for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy admin_links    on public.share_links  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------------------------------------------------------------
-- "What's new": record when anything on the schedule last changed
-- ---------------------------------------------------------------
create or replace function public.touch_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.settings set changed_at = now() where id = 1;
  return null;
end
$$;
-- A trigger function: triggers run it without the caller holding execute, so nobody needs the right to run it.
revoke execute on function public.touch_changed() from public, anon, authenticated;

drop trigger if exists touch_swaps   on public.swaps;
drop trigger if exists touch_details on public.swap_details;
drop trigger if exists touch_breaks  on public.breaks;
create trigger touch_swaps   after insert or update or delete on public.swaps        for each statement execute function public.touch_changed();
create trigger touch_details after insert or update or delete on public.swap_details for each statement execute function public.touch_changed();
create trigger touch_breaks  after insert or update or delete on public.breaks       for each statement execute function public.touch_changed();

-- ---------------------------------------------------------------
-- Activities (migration 06): admin and parent edit these
-- ---------------------------------------------------------------
-- Free text has length limits, and one-line fields (names, titles, labels, gear items) refuse control
-- characters: the pattern '[[:cntrl:]\u2028\u2029]' covers tabs, line breaks and the Unicode line separators.
-- Notes, addresses and comment bodies may have line breaks.

-- Kids: names and colors are entered in the app, never in this repo.
create table if not exists public.kids (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  color  text not null,                         -- a color key; the page owns the actual color values
  sort   int  not null default 0,               -- display order, lowest first
  active boolean not null default true,         -- kids are turned off, not removed
  constraint kids_name_check  check (btrim(name) <> '' and length(name) <= 60 and name !~ '[[:cntrl:]\u2028\u2029]'),
  constraint kids_color_check check (color in ('orange', 'berry', 'navy', 'charcoal'))
);

-- Homes: one row per house, keyed by who lives there. Signed-in only. Never sent to the family link.
create table if not exists public.homes (
  who     text primary key,                     -- me, co, grandma
  address text,
  lat     double precision,
  lng     double precision,
  constraint homes_who_check check (who in ('me', 'co', 'grandma')),
  constraint homes_address_check check (address is null or length(address) <= 300),
  constraint homes_lat_check check (lat is null or lat between -90 and 90),
  constraint homes_lng_check check (lng is null or lng between -180 and 180)
);

-- Places: fields, gyms, studios. Only the name is required.
create table if not exists public.places (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text,
  lat           double precision,
  lng           double precision,
  drive_me      int,                            -- drive minutes from each house; null = not known yet
  drive_co      int,
  drive_grandma int,
  note          text,
  constraint places_name_check  check (btrim(name) <> '' and length(name) <= 120 and name !~ '[[:cntrl:]\u2028\u2029]'),
  constraint places_text_check  check ((address is null or length(address) <= 300) and (note is null or length(note) <= 2000)),
  constraint places_lat_check   check (lat is null or lat between -90 and 90),
  constraint places_lng_check   check (lng is null or lng between -180 and 180),
  constraint places_drive_check check (
    (drive_me      is null or drive_me      between 0 and 600) and
    (drive_co      is null or drive_co      between 0 and 600) and
    (drive_grandma is null or drive_grandma between 0 and 600))
);

-- Teams: an activity series such as a team or a weekly lesson.
create table if not exists public.teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kid_ids        uuid[] not null,               -- one kid or several; checked against kids by trigger
  place_id       uuid references public.places(id),   -- default place
  early_practice int not null default 0,        -- minutes to arrive early for practices and lessons
  early_game     int not null default 0,        -- minutes to arrive early for games
  gear           text[] not null default '{}',  -- plain list of items (up to 50, each up to 80 characters)
  note           text,
  ical_url       text,                          -- private calendar link: signed-in only, never sent to the family link
  active         boolean not null default true,
  constraint teams_name_check  check (btrim(name) <> '' and length(name) <= 120 and name !~ '[[:cntrl:]\u2028\u2029]'),
  constraint teams_text_check  check ((note is null or length(note) <= 2000) and (ical_url is null or length(ical_url) <= 2000)),
  constraint teams_kids_check  check (cardinality(kid_ids) between 1 and 20),
  constraint teams_early_check check (early_practice between 0 and 240 and early_game between 0 and 240)
);

-- Events: one activity on one day.
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid references public.teams(id),  -- optional
  kid_ids    uuid[] not null,                   -- one kid or several; checked against kids by trigger
  kind       text not null default 'other',     -- practice, game, lesson, other
  title      text,                              -- optional when there is a team
  day        date not null,
  start_time time not null,
  end_time   time,
  place_id   uuid references public.places(id), -- a saved place, or
  place_text text,                              -- free text when it is not a saved place
  arrive_by  time,                              -- override; null = start time minus the team's arrive-early minutes
  gear       text[],                            -- override; null = use the team's gear list
  note       text,                              -- shared note: everyone with the family link sees it
  status     text not null default 'on',        -- on, canceled
  source     text not null default 'hand',      -- hand, paste, file, link
  source_uid text,                              -- the id from an imported calendar; stops double imports
  created_at timestamptz not null default now(),
  created_by text,                              -- me, co, or null when not changed by a signed-in person
  updated_at timestamptz not null default now(),-- moves only when something real changed
  updated_by text,
  constraint events_kind_check   check (kind in ('practice', 'game', 'lesson', 'other')),
  constraint events_status_check check (status in ('on', 'canceled')),
  constraint events_source_check check (source in ('hand', 'paste', 'file', 'link')),
  constraint events_kids_check   check (cardinality(kid_ids) between 1 and 20),
  constraint events_name_check   check (team_id is not null or btrim(coalesce(title, '')) <> ''),
  constraint events_title_check  check (title is null or (length(title) <= 120 and title !~ '[[:cntrl:]\u2028\u2029]')),
  constraint events_place_check  check (place_text is null or (length(place_text) <= 200 and place_text !~ '[[:cntrl:]\u2028\u2029]')),
  constraint events_note_check   check (note is null or length(note) <= 2000),
  constraint events_day_check    check (day between date '2000-01-01' and date '2100-12-31'),
  constraint events_uid_check    check (source_uid is null or (btrim(source_uid) <> '' and length(source_uid) <= 500)),
  constraint events_who_check    check (created_by in ('me', 'co') and updated_by in ('me', 'co'))
);

-- Import de-duplication: one row per imported calendar id. Rows added by hand have no id and never clash.
-- This is a plain (not partial) unique index so the page can upsert on source_uid.
create unique index if not exists events_source_uid_key on public.events (source_uid);
create index if not exists events_day_idx  on public.events (day, start_time);
create index if not exists events_team_idx on public.events (team_id);

-- Comments on an event. share_family is true exactly when grandma is tagged (set by trigger, enforced by the rule below).
create table if not exists public.event_comments (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  at           timestamptz not null default now(),
  author       text not null,                   -- me or co, set from the sign-in
  body         text not null,
  tagged       text[] not null default '{}',    -- any of me, co, grandma
  share_family boolean not null default false,
  constraint event_comments_author_check check (author in ('me', 'co')),
  constraint event_comments_body_check   check (btrim(body) <> '' and length(body) <= 2000),
  constraint event_comments_tagged_check check (tagged <@ array['me', 'co', 'grandma']::text[] and cardinality(tagged) <= 3),
  constraint event_comments_share_check  check (share_family = ('grandma' = any (tagged)))
);
create index if not exists event_comments_event_idx on public.event_comments (event_id, at);

-- Contacts for the "Text an update" sheet. Signed-in only. Never sent to the family link.
create table if not exists public.contacts (
  who   text primary key,                       -- me, co, grandma
  label text,                                   -- the name shown on the text sheet
  phone text,
  constraint contacts_who_check  check (who in ('me', 'co', 'grandma')),
  constraint contacts_text_check check ((label is null or (length(label) <= 60 and label !~ '[[:cntrl:]\u2028\u2029]'))
                                    and (phone is null or (length(phone) <= 40 and phone !~ '[[:cntrl:]\u2028\u2029]')))
);

-- Change log. Written only by triggers. Rows are kept when an event or team is removed (no foreign key on purpose).
create table if not exists public.event_log (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  who      text,                                -- me, co, or null when not changed by a signed-in person
  action   text not null,                       -- added, changed, canceled, restored, removed
  event_id uuid,                                -- set on event lines
  team_id  uuid,                                -- set on team lines
  summary  text not null,                       -- one line, safe to show the family, reads after the person's name
  before   jsonb,                               -- the full row before the change (signed-in only)
  after    jsonb,                               -- the full row after the change (signed-in only)
  batch_id uuid not null,                       -- same for every line written by one save or one import
  constraint event_log_who_check     check (who in ('me', 'co')),
  constraint event_log_action_check  check (action in ('added', 'changed', 'canceled', 'restored', 'removed')),
  constraint event_log_subject_check check ((event_id is null) <> (team_id is null))
);
create index if not exists event_log_at_idx    on public.event_log (at desc);
create index if not exists event_log_event_idx on public.event_log (event_id);

-- ---------------------------------------------------------------
-- Row level security for the activities tables: on for every table, with explicit rules
-- ---------------------------------------------------------------
alter table public.kids           enable row level security;
alter table public.homes          enable row level security;
alter table public.places         enable row level security;
alter table public.teams          enable row level security;
alter table public.events         enable row level security;
alter table public.event_comments enable row level security;
alter table public.contacts       enable row level security;
alter table public.event_log      enable row level security;

-- Start from nothing, then grant only what each table needs. The public (anon) key gets nothing.
-- Nobody is granted truncate, references or trigger: row level security does not cover those.
revoke all on public.kids, public.homes, public.places, public.teams, public.events,
              public.event_comments, public.contacts, public.event_log
  from public, anon, authenticated;

grant select, insert, update         on public.kids, public.homes                 to authenticated;
grant select, insert, update, delete on public.places, public.teams, public.events to authenticated;
grant select, insert, delete         on public.event_comments                     to authenticated;
grant select, insert, update, delete on public.contacts                           to authenticated;
grant select                         on public.event_log                          to authenticated;

-- kids: admin and parent read, add and change. Nobody removes (turn a kid off instead).
drop policy if exists kids_read   on public.kids;
drop policy if exists kids_add    on public.kids;
drop policy if exists kids_change on public.kids;
create policy kids_read   on public.kids for select to authenticated using (public.is_editor());
create policy kids_add    on public.kids for insert to authenticated with check (public.is_editor());
create policy kids_change on public.kids for update to authenticated using (public.is_editor()) with check (public.is_editor());

-- homes: admin and parent read, add and change.
drop policy if exists homes_read   on public.homes;
drop policy if exists homes_add    on public.homes;
drop policy if exists homes_change on public.homes;
create policy homes_read   on public.homes for select to authenticated using (public.is_editor());
create policy homes_add    on public.homes for insert to authenticated with check (public.is_editor());
create policy homes_change on public.homes for update to authenticated using (public.is_editor()) with check (public.is_editor());

-- places, teams, events: admin and parent read, add, change and remove.
drop policy if exists editors_places on public.places;
drop policy if exists editors_teams  on public.teams;
drop policy if exists editors_events on public.events;
create policy editors_places on public.places for all to authenticated using (public.is_editor()) with check (public.is_editor());
create policy editors_teams  on public.teams  for all to authenticated using (public.is_editor()) with check (public.is_editor());
create policy editors_events on public.events for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- event_comments: admin and parent read all and add their own. Only the author can remove one. Nobody edits.
drop policy if exists comments_read       on public.event_comments;
drop policy if exists comments_add        on public.event_comments;
drop policy if exists comments_remove_own on public.event_comments;
create policy comments_read       on public.event_comments for select to authenticated using (public.is_editor());
create policy comments_add        on public.event_comments for insert to authenticated with check (public.is_editor() and author = public.my_who());
create policy comments_remove_own on public.event_comments for delete to authenticated using (public.is_editor() and author = public.my_who());

-- contacts: admin and parent read. Only admin adds, changes or removes.
drop policy if exists contacts_read         on public.contacts;
drop policy if exists contacts_admin_add    on public.contacts;
drop policy if exists contacts_admin_change on public.contacts;
drop policy if exists contacts_admin_remove on public.contacts;
create policy contacts_read         on public.contacts for select to authenticated using (public.is_editor());
create policy contacts_admin_add    on public.contacts for insert to authenticated with check (public.my_role() = 'admin');
create policy contacts_admin_change on public.contacts for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy contacts_admin_remove on public.contacts for delete to authenticated using (public.my_role() = 'admin');

-- event_log: admin and parent read. No insert, update or delete rule and no grant: only the triggers write.
drop policy if exists log_read on public.event_log;
create policy log_read on public.event_log for select to authenticated using (public.is_editor());

-- ---------------------------------------------------------------
-- Helpers used only by the triggers (nobody can call these through the API)
-- ---------------------------------------------------------------
-- Tidy a list of kid ids (no blanks, no repeats, fixed order) and refuse ids that are not in kids.
create or replace function public.kt_clean_kid_ids(p_ids uuid[])
returns uuid[] language plpgsql set search_path = public as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(distinct u.k order by u.k), '{}'::uuid[])
    into v_ids
    from unnest(p_ids) as u(k)
   where u.k is not null;
  if exists (
    select 1
    from unnest(v_ids) as u(k)
    where not exists (select 1 from public.kids kd where kd.id = u.k)
  ) then
    raise exception 'kid_ids has an id that is not in the kids table' using errcode = '23503';
  end if;
  return v_ids;
end
$$;

-- Tidy a gear list (trim each item, drop blanks) and refuse lists that are too long or have odd characters.
-- A null list stays null (on an event that means "use the team's list").
create or replace function public.kt_clean_gear(p_gear text[])
returns text[] language plpgsql set search_path = public as $$
declare
  v_gear text[];
begin
  if p_gear is null then
    return null;
  end if;
  select coalesce(array_agg(btrim(u.item) order by u.pos), '{}'::text[])
    into v_gear
    from unnest(p_gear) with ordinality as u(item, pos)
   where btrim(coalesce(u.item, '')) <> '';
  if cardinality(v_gear) > 50 then
    raise exception 'a gear list can have at most 50 items' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(v_gear) as u(item) where length(u.item) > 80 or u.item ~ '[[:cntrl:]\u2028\u2029]') then
    raise exception 'a gear item can be at most 80 characters, with no line breaks' using errcode = '23514';
  end if;
  return v_gear;
end
$$;

-- An event row without its bookkeeping columns. Two rows with the same core are "nothing really changed".
create or replace function public.kt_event_core(p_row jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select p_row - '{created_at,created_by,updated_at,updated_by,source,source_uid}'::text[]
$$;

-- "Tue Dec 1"
create or replace function public.kt_day_text(p_day date)
returns text language sql stable set search_path = public as $$
  select to_char(p_day::timestamp, 'Dy Mon FMDD')
$$;

-- "5:30 p.m."
create or replace function public.kt_time_text(p_time time)
returns text language sql stable set search_path = public as $$
  select to_char(date '2000-01-01' + p_time, 'FMHH12:MI a.m.')
$$;

-- What to call an event in a log line: "Soccer practice", "Soccer: team party", or the title.
create or replace function public.kt_event_label(p_team_id uuid, p_kind text, p_title text)
returns text language sql stable set search_path = public as $$
  select case
    when t.name is not null and p_kind in ('practice', 'game', 'lesson') then t.name || ' ' || p_kind
    when t.name is not null and nullif(btrim(p_title), '') is not null then t.name || ': ' || btrim(p_title)
    when t.name is not null then t.name
    else coalesce(nullif(btrim(p_title), ''), 'an activity')
  end
  from (select 1) as one
  left join public.teams t on t.id = p_team_id
$$;

-- One id per database transaction, so every line written by one save or one import shares it.
create or replace function public.kt_log_batch()
returns uuid language sql volatile set search_path = public as $$
  select md5(txid_current()::text || ':' || extract(epoch from now())::text)::uuid
$$;

revoke execute on function
  public.kt_clean_kid_ids(uuid[]),
  public.kt_clean_gear(text[]),
  public.kt_event_core(jsonb),
  public.kt_day_text(date),
  public.kt_time_text(time),
  public.kt_event_label(uuid, text, text),
  public.kt_log_batch()
  from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Trigger functions for activities
-- ---------------------------------------------------------------
-- Events, before save: tidy the row and stamp who and when. The page cannot set these itself.
create or replace function public.events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who text := public.my_who();
begin
  new.kid_ids    := public.kt_clean_kid_ids(new.kid_ids);
  new.gear       := public.kt_clean_gear(new.gear);
  new.title      := nullif(btrim(new.title), '');
  new.place_text := nullif(btrim(new.place_text), '');
  new.source_uid := nullif(btrim(new.source_uid), '');
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := v_who;
    new.updated_at := now();
    new.updated_by := v_who;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if public.kt_event_core(to_jsonb(new)) is distinct from public.kt_event_core(to_jsonb(old)) then
      new.updated_at := now();
      new.updated_by := v_who;
    else
      -- Nothing real changed (for example a re-import of the same calendar): leave the stamp alone.
      new.updated_at := old.updated_at;
      new.updated_by := old.updated_by;
    end if;
  end if;
  return new;
end
$$;

-- Events: write one change log line. Runs after an add or a change, and just before a removal.
-- It runs before a removal because removing an event also removes its comments, and the "removed" line
-- keeps a copy of them in its before detail. That detail is for signed-in editors only.
create or replace function public.events_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who    text := public.my_who();
  v_label  text;
  v_action text;
  v_sum    text;
  v_parts  text[] := '{}'::text[];
begin
  if tg_op = 'INSERT' then
    v_label := public.kt_event_label(new.team_id, new.kind, new.title);
    v_sum   := 'added ' || v_label || ' on ' || public.kt_day_text(new.day)
               || ' at ' || public.kt_time_text(new.start_time);
    insert into public.event_log (who, action, event_id, summary, before, after, batch_id)
    values (v_who, 'added', new.id, coalesce(v_sum, 'added an activity'), null, to_jsonb(new), public.kt_log_batch());
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_label := public.kt_event_label(old.team_id, old.kind, old.title);
    v_sum   := 'removed ' || v_label || ' on ' || public.kt_day_text(old.day)
               || ' at ' || public.kt_time_text(old.start_time);
    insert into public.event_log (who, action, event_id, summary, before, after, batch_id)
    values (v_who, 'removed', old.id, coalesce(v_sum, 'removed an activity'),
            to_jsonb(old) || jsonb_build_object('comments', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'author', c.author, 'at', c.at, 'body', c.body,
                       'tagged', c.tagged, 'share_family', c.share_family) order by c.at, c.id), '[]'::jsonb)
              from public.event_comments c
              where c.event_id = old.id)),
            null, public.kt_log_batch());
    return old;
  end if;

  -- UPDATE: nothing real changed, nothing to log.
  if public.kt_event_core(to_jsonb(new)) is not distinct from public.kt_event_core(to_jsonb(old)) then
    return null;
  end if;

  v_label := public.kt_event_label(new.team_id, new.kind, new.title);

  if old.status = 'on' and new.status = 'canceled' then
    v_action := 'canceled';
    v_sum    := 'canceled ' || v_label || ' on ' || public.kt_day_text(new.day)
                || ' at ' || public.kt_time_text(new.start_time);
  elsif old.status = 'canceled' and new.status = 'on' then
    v_action := 'restored';
    v_sum    := 'put ' || v_label || ' back on for ' || public.kt_day_text(new.day)
                || ' at ' || public.kt_time_text(new.start_time);
  else
    v_action := 'changed';
    if new.day is distinct from old.day and new.start_time is distinct from old.start_time then
      v_sum := 'moved ' || v_label
               || ' from ' || public.kt_day_text(old.day) || ' at ' || public.kt_time_text(old.start_time)
               || ' to '   || public.kt_day_text(new.day) || ' at ' || public.kt_time_text(new.start_time);
    elsif new.day is distinct from old.day then
      v_sum := 'moved ' || v_label
               || ' from ' || public.kt_day_text(old.day) || ' to ' || public.kt_day_text(new.day);
    elsif new.start_time is distinct from old.start_time then
      v_sum := 'moved ' || v_label || ' on ' || public.kt_day_text(new.day)
               || ' from ' || public.kt_time_text(old.start_time) || ' to ' || public.kt_time_text(new.start_time);
    end if;

    if new.team_id   is distinct from old.team_id   then v_parts := array_append(v_parts, 'team');             end if;
    if new.kid_ids   is distinct from old.kid_ids   then v_parts := array_append(v_parts, 'who it is for');    end if;
    if new.kind      is distinct from old.kind      then v_parts := array_append(v_parts, 'type');             end if;
    if new.title     is distinct from old.title     then v_parts := array_append(v_parts, 'title');            end if;
    if new.end_time  is distinct from old.end_time  then v_parts := array_append(v_parts, 'end time');         end if;
    if new.place_id  is distinct from old.place_id
       or new.place_text is distinct from old.place_text then v_parts := array_append(v_parts, 'place');       end if;
    if new.arrive_by is distinct from old.arrive_by then v_parts := array_append(v_parts, 'arrive-by time');   end if;
    if new.gear      is distinct from old.gear      then v_parts := array_append(v_parts, 'gear');             end if;
    if new.note      is distinct from old.note      then v_parts := array_append(v_parts, 'note');             end if;

    if v_sum is null then
      if cardinality(v_parts) = 0 then
        v_parts := array['details']::text[];
      end if;
      v_sum := 'updated ' || v_label || ' on ' || public.kt_day_text(new.day) || ': ' || array_to_string(v_parts, ', ');
    elsif cardinality(v_parts) > 0 then
      v_sum := v_sum || '. Also changed: ' || array_to_string(v_parts, ', ');
    end if;
  end if;

  insert into public.event_log (who, action, event_id, summary, before, after, batch_id)
  values (v_who, v_action, new.id, coalesce(v_sum, v_action || ' an activity'), to_jsonb(old), to_jsonb(new), public.kt_log_batch());
  return null;
end
$$;

-- Teams, before save: tidy the row.
create or replace function public.teams_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.kid_ids  := public.kt_clean_kid_ids(new.kid_ids);
  new.name     := btrim(new.name);
  new.gear     := coalesce(public.kt_clean_gear(new.gear), '{}'::text[]);
  new.ical_url := nullif(btrim(new.ical_url), '');
  return new;
end
$$;

-- Teams, after save: write one change log line. The private calendar link is never copied into the log.
create or replace function public.teams_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who   text := public.my_who();
  v_sum   text;
  v_parts text[] := '{}'::text[];
begin
  if tg_op = 'INSERT' then
    insert into public.event_log (who, action, team_id, summary, before, after, batch_id)
    values (v_who, 'added', new.id, 'added the team "' || new.name || '"',
            null, to_jsonb(new) - 'ical_url'::text, public.kt_log_batch());
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.event_log (who, action, team_id, summary, before, after, batch_id)
    values (v_who, 'removed', old.id, 'removed the team "' || old.name || '"',
            to_jsonb(old) - 'ical_url'::text, null, public.kt_log_batch());
    return null;
  end if;

  -- UPDATE: nothing changed, nothing to log.
  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return null;
  end if;

  if new.name     is distinct from old.name     then v_parts := array_append(v_parts, 'name');          end if;
  if new.kid_ids  is distinct from old.kid_ids  then v_parts := array_append(v_parts, 'who it is for'); end if;
  if new.place_id is distinct from old.place_id then v_parts := array_append(v_parts, 'place');         end if;
  if new.early_practice is distinct from old.early_practice
     or new.early_game  is distinct from old.early_game then v_parts := array_append(v_parts, 'arrive early minutes'); end if;
  if new.gear     is distinct from old.gear     then v_parts := array_append(v_parts, 'gear');          end if;
  if new.note     is distinct from old.note     then v_parts := array_append(v_parts, 'note');          end if;
  if new.ical_url is distinct from old.ical_url then v_parts := array_append(v_parts, 'calendar link'); end if;

  if new.active is distinct from old.active then
    if cardinality(v_parts) = 0 then
      if new.active then
        v_sum := 'turned the team "' || new.name || '" back on';
      else
        v_sum := 'turned off the team "' || new.name || '"';
      end if;
    elsif new.active then
      v_parts := array_append(v_parts, 'turned back on');
    else
      v_parts := array_append(v_parts, 'turned off');
    end if;
  end if;

  if v_sum is null then
    if cardinality(v_parts) = 0 then
      v_parts := array['details']::text[];
    end if;
    v_sum := 'changed the team "' || new.name || '": ' || array_to_string(v_parts, ', ');
  end if;

  insert into public.event_log (who, action, team_id, summary, before, after, batch_id)
  values (v_who, 'changed', new.id, coalesce(v_sum, 'changed a team'),
          to_jsonb(old) - 'ical_url'::text, to_jsonb(new) - 'ical_url'::text, public.kt_log_batch());
  return null;
end
$$;

-- Comments, before save: the author comes from the sign-in, and share_family follows the grandma tag.
create or replace function public.comments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.tagged := array(select distinct u.tag from unnest(coalesce(new.tagged, '{}'::text[])) as u(tag) order by u.tag);
  new.body   := btrim(new.body);
  if tg_op = 'INSERT' then
    new.author := coalesce(public.my_who(), new.author);
    new.at     := now();
  else
    new.author   := old.author;
    new.at       := old.at;
    new.event_id := old.event_id;
  end if;
  new.share_family := coalesce('grandma' = any (new.tagged), false);
  return new;
end
$$;

-- Ids and keys never change once a row exists. Saving a row with its own id (an upsert) is fine.
-- This is a trigger and not a column-level grant on purpose: the API writes "id = the same id" on every
-- upsert, and a column-level grant would refuse that.
create or replace function public.kt_keep_key()
returns trigger language plpgsql set search_path = public as $$
declare
  v_col text := tg_argv[0];
begin
  if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
    raise exception 'the % of a row in % cannot be changed', v_col, tg_table_name using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function
  public.events_stamp(),
  public.events_log(),
  public.teams_stamp(),
  public.teams_log(),
  public.comments_stamp(),
  public.kt_keep_key()
  from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Triggers for activities
-- ---------------------------------------------------------------
drop trigger if exists events_stamp       on public.events;
drop trigger if exists events_log         on public.events;
drop trigger if exists events_log_removed on public.events;
create trigger events_stamp       before insert or update on public.events for each row execute function public.events_stamp();
create trigger events_log         after insert or update  on public.events for each row execute function public.events_log();
create trigger events_log_removed before delete           on public.events for each row execute function public.events_log();

drop trigger if exists teams_stamp on public.teams;
drop trigger if exists teams_log   on public.teams;
create trigger teams_stamp before insert or update        on public.teams for each row execute function public.teams_stamp();
create trigger teams_log   after insert or update or delete on public.teams for each row execute function public.teams_log();

drop trigger if exists comments_stamp on public.event_comments;
create trigger comments_stamp before insert or update on public.event_comments for each row execute function public.comments_stamp();

-- Ids and keys cannot be changed.
drop trigger if exists keep_key on public.kids;
drop trigger if exists keep_key on public.places;
drop trigger if exists keep_key on public.teams;
drop trigger if exists keep_key on public.events;
drop trigger if exists keep_key on public.homes;
drop trigger if exists keep_key on public.contacts;
create trigger keep_key before update on public.kids     for each row execute function public.kt_keep_key('id');
create trigger keep_key before update on public.places   for each row execute function public.kt_keep_key('id');
create trigger keep_key before update on public.teams    for each row execute function public.kt_keep_key('id');
create trigger keep_key before update on public.events   for each row execute function public.kt_keep_key('id');
create trigger keep_key before update on public.homes    for each row execute function public.kt_keep_key('who');
create trigger keep_key before update on public.contacts for each row execute function public.kt_keep_key('who');

-- "What's new": bump settings.changed_at when something the family can see really changed.
-- An update that changes nothing (for example re-importing the same calendar) does not count.
drop trigger if exists touch_kids       on public.kids;
drop trigger if exists touch_kids_upd   on public.kids;
drop trigger if exists touch_places     on public.places;
drop trigger if exists touch_places_upd on public.places;
drop trigger if exists touch_teams      on public.teams;
drop trigger if exists touch_teams_upd  on public.teams;
drop trigger if exists touch_events     on public.events;
drop trigger if exists touch_events_upd on public.events;
create trigger touch_kids       after insert or delete on public.kids   for each row execute function public.touch_changed();
create trigger touch_kids_upd   after update           on public.kids   for each row when (old.* is distinct from new.*) execute function public.touch_changed();
create trigger touch_places     after insert or delete on public.places for each row execute function public.touch_changed();
create trigger touch_places_upd after update           on public.places for each row when (old.* is distinct from new.*) execute function public.touch_changed();
create trigger touch_teams      after insert or delete on public.teams  for each row execute function public.touch_changed();
create trigger touch_teams_upd  after update           on public.teams  for each row when (old.* is distinct from new.*) execute function public.touch_changed();
create trigger touch_events     after insert or delete on public.events for each row execute function public.touch_changed();
create trigger touch_events_upd after update           on public.events for each row when (old.* is distinct from new.*) execute function public.touch_changed();

-- Comments count only when they are shared with the family (grandma tagged).
drop trigger if exists touch_comments_ins on public.event_comments;
drop trigger if exists touch_comments_upd on public.event_comments;
drop trigger if exists touch_comments_del on public.event_comments;
create trigger touch_comments_ins after insert on public.event_comments for each row when (new.share_family) execute function public.touch_changed();
create trigger touch_comments_upd after update on public.event_comments for each row when (old.share_family or new.share_family) execute function public.touch_changed();
create trigger touch_comments_del after delete on public.event_comments for each row when (old.share_family) execute function public.touch_changed();

-- ---------------------------------------------------------------
-- The family-safe schedule payload, in one place (migration 07).
-- Internal: nobody can call it through the API. It runs only inside get_schedule and get_editor_schedule.
-- It must never return pnote, track_from or anything used for totals.
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
-- The activities part of the payload, in one place (migration 08).
-- Internal: nobody can call it through the API. It runs only inside get_schedule and get_editor_schedule.
-- p_family = true gives the family-link view (the stricter one). Null is treated as true.
-- Every column is named one by one. It must never return ical_url, phone numbers, home addresses,
-- map coordinates, comments that are not shared with the family, the before and after detail of the
-- change log, or import ids.
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
-- Returns the schedule and activities only for an active share token, otherwise null.
-- Activities are limited to 7 days back and 60 days ahead, worked out in US Eastern time (named explicitly).
-- Must never return pnote, track_from or anything used for totals, or anything in the list above.
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

-- ---------------------------------------------------------------
-- No "maintain" right (PostgreSQL 17 and later) on any table of ours for the public key or signed-in users.
-- Guarded by version so this file still runs on older PostgreSQL. (Migration 09.)
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

-- ---------------------------------------------------------------
-- Only when rebuilding a brand-new project (not needed for the live one):
--   (create the admin account in Supabase Authentication first, with its email confirmed, then:)
--   insert into public.app_users (email, role, user_id)
--     select lower(email), 'admin', id from auth.users where lower(email) = '<admin email, lowercase>';
--   insert into public.settings (anchor, track_from) values ('<a Friday that starts one of Heather''s weeks>', '<date to count totals from>');
--   then make the family link from the admin page.
-- The other parent's sign-in is added the same way with role 'parent' (see supabase/migrations/RUN-09.md), after the account exists in Supabase Authentication.
-- ---------------------------------------------------------------
