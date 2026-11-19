-- Kids Tracker: full database structure (no personal data)
-- This is the combined result of migrations 01, 03, 04 and 05 as they exist in the live project.
-- Use it as the reference for how the database works, or to rebuild a fresh Supabase project.
-- Everything here is safe to re-run: it creates what is missing and replaces functions and policies.
-- It never deletes or loads schedule data.

-- ---------------------------------------------------------------
-- Who can edit
-- ---------------------------------------------------------------
create table if not exists public.app_users (
  email text primary key,                       -- always lowercase
  role  text not null check (role = 'admin')
);
alter table public.app_users enable row level security;
-- No policy and no grant on app_users on purpose: that is deny-all. Only my_role() (security definer) reads it.

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users
  where email = lower(auth.jwt() ->> 'email')
$$;
grant execute on function public.my_role() to authenticated;

-- ---------------------------------------------------------------
-- Schedule data
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
-- Row level security: tables are admin-only
-- ---------------------------------------------------------------
alter table public.settings     enable row level security;
alter table public.breaks       enable row level security;
alter table public.swaps        enable row level security;
alter table public.swap_details enable row level security;
alter table public.share_links  enable row level security;

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

drop trigger if exists touch_swaps   on public.swaps;
drop trigger if exists touch_details on public.swap_details;
drop trigger if exists touch_breaks  on public.breaks;
create trigger touch_swaps   after insert or update or delete on public.swaps        for each statement execute function public.touch_changed();
create trigger touch_details after insert or update or delete on public.swap_details for each statement execute function public.touch_changed();
create trigger touch_breaks  after insert or update or delete on public.breaks       for each statement execute function public.touch_changed();

-- ---------------------------------------------------------------
-- Family page: the only way the public reads data.
-- Returns the schedule only for an active share token.
-- Must never return pnote, track_from or anything used for totals.
-- ---------------------------------------------------------------
create or replace function public.get_schedule(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (
      select 1 from public.share_links where token = p_token and active
    ) then jsonb_build_object(
      'settings',   (select jsonb_build_object('my_name', my_name, 'co_name', co_name, 'anchor', anchor)
                     from public.settings where id = 1),
      'changed_at', (select changed_at from public.settings where id = 1),
      'breaks',     (select coalesce(jsonb_agg(jsonb_build_object('year', year, 'data', data)), '[]'::jsonb)
                     from public.breaks),
      'swaps',      (select coalesce(jsonb_agg(jsonb_build_object(
                         'day', s.day, 'had', s.had, 'caregiver', s.caregiver,
                         'reason', d.reason, 'note', d.note, 'updated_at', s.updated_at) order by s.day), '[]'::jsonb)
                     from public.swaps s left join public.swap_details d on d.day = s.day)
    ) end
$$;
revoke execute on function public.get_schedule(text) from public;
grant execute on function public.get_schedule(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Only when rebuilding a brand-new project (not needed for the live one):
--   insert into public.app_users (email, role) values ('<admin email, lowercase>', 'admin');
--   insert into public.settings (anchor, track_from) values ('<a Friday that starts one of Heather''s weeks>', '<date to count totals from>');
--   then make the family link from the admin page.
-- ---------------------------------------------------------------
