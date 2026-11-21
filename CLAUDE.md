# Kids Tracker

Heather's personal custody schedule site. Two pages that read from one Supabase database:

- **Admin page** (Heather only, signed in): log schedule changes, keep running totals of overnights, manage holidays, school dates and the family link.
- **Family page** (Heather's mom and Brett, the kids' dad): read-only schedule opened from a secret link. No sign-in.

Heather is the owner and the only editor. She is technical and lives in Excel. Explain database and deploy steps in plain words and say exactly where to click.

## Live addresses

| What | Where |
|---|---|
| Admin page | https://hnathanfpc1.github.io/kids-tracker/admin.html |
| Family page | https://hnathanfpc1.github.io/kids-tracker/#k=TOKEN (copy the real link from the admin page, never commit a token) |
| Repo (public) | https://github.com/hnathanfpc1/kids-tracker |
| Supabase project | ref `ycckqkbtwncidyejtvil`, URL https://ycckqkbtwncidyejtvil.supabase.co (both already public in `config.js`) |

Deploy = push to `main`. GitHub Pages serves the repo root (branch `main`, folder `/`) and updates in about a minute.

## Files

| File | Purpose |
|---|---|
| `index.html` | Family page markup (`<body data-page="family">`) |
| `admin.html` | Admin page markup (`<body data-page="admin">`), loads supabase-js 2.117.3 UMD from jsDelivr |
| `core.js` | Shared schedule logic with no page code: whole-day dates, rotation, holidays, school calendar, who has the kids, handoff times. Exposed as `window.KTCore`; each page calls `KTCore.schedule(st)` with its own state. Loaded before `app.js` |
| `app.js` | Page logic for both pages: rendering, loading, saving, events. One IIFE; `PAGE` switches family vs admin. Uses `core.js` for the schedule |
| `acts.js` | Shared read-only activities drawing, exposed as `window.KTActs`: reads the activities part of the payload (kids, places, teams, events, comments, log), arrive-by and leave-by times, calendar markers, the Activities panel, pack lists, Recent changes and "what's new" lines. Loaded after `core.js` on all three pages. Saves nothing |
| `editor.js` | Shared by the two signed-in pages, exposed as `window.KTEditor`: the email and password sign-in card and the "Text an update?" sheet (send-to list from the `contacts` table, falling back to `config.js`). Loaded on `admin.html` and `activities.html` only |
| `activities.html` | Activities page markup (`<body data-page="activities">`), signed in as `admin` or `parent`. Loads the same pinned supabase-js script tag as `admin.html` |
| `import.js` | Pure reading code for "Paste a list" and "Calendar file" on the Activities page, exposed as `window.KTImport`: list and .ics parsing, duplicate and moved matching, headline wording, the photo helper request. No page access, no database, takes today as an argument. Loaded on `activities.html` only, before `activities.js` |
| `activities.js` | Activities page logic: add by hand (with "Repeat weekly until"), Paste a list, Calendar file and the Photo or PDF helper with their review screen (reading done by `import.js`), upcoming list, edit sheet with comments, teams and gear, places, kids, contacts, change log. Reads through `get_editor_schedule()` plus `contacts`; never reads the custody tables |
| `style.css` | Shared styles. Color tokens on `:root` with dark mode blocks |
| `config.js` | Public config: Supabase URL and publishable key only. The phone numbers for the "Text an update" button moved to the `contacts` table and were removed from this file on 2026-11-20 (they remain in the repo's git history) |
| `supabase/schema.sql` | Full database structure, no personal data. Reference and disaster recovery |
| `supabase/migrations/` | Put every future database change here as a new numbered file (see Database changes) |
| `_config.yml` | Tells GitHub Pages which project files to leave off the public site. Nothing else goes in it |
| `tests/` | QA's headless browser checks and golden snapshots (`cd tests && npm test`). Test tooling only, never part of the site |
| `docs/` | Plans and mockups. Not part of the site |

No build step, no framework, no npm. Plain HTML, CSS and JS.

**Cache busting is required.** Every HTML file loads its shared files with `?v=N`: `index.html` loads `style.css`, `config.js`, `core.js`, `acts.js`, `app.js`; `admin.html` loads `style.css`, `config.js`, `core.js`, `acts.js`, `editor.js`, `app.js`; `activities.html` loads `style.css`, `config.js`, `core.js`, `acts.js`, `editor.js`, `import.js`, `activities.js`. GitHub Pages caches for 10 minutes, and a phone once got stuck on an old `app.js`. Whenever you change any of those files, bump `N` everywhere in all three HTML files. Current value: `v=14`.

## How the schedule works

All dates are handled as whole-day numbers (`toNum`, `toStr` in core.js) to avoid time zone drift. A "day" means the overnight that starts that evening.

### Who has the kids on a given night (in priority order)

1. **A logged switch** (row in `swaps`) wins.
2. **A holiday period** from the custody agreement.
3. **The week on, week off rotation.** Anchor `2026-10-02` (a Friday) starts one of Heather's weeks. Weeks run Friday through Thursday and alternate Heather, Brett.

Holders: `me` (Heather), `co` (Brett), `grandma` (Grandma, Heather's mom), `other` (someone else, name stored in `caregiver`).

### Holidays (from the custody agreement; "me" = Mother/Wife, "co" = Father/Husband)

| Holiday | Rule | Nights |
|---|---|---|
| Spring break | Brett in even years, Heather in odd years | Last school day through the night two days before school resumes (ends 6 p.m. the evening before school, so that night returns to the rotation). Starts after school in both parents' years |
| Thanksgiving | Brett in odd years, Heather in even years | School dismissal through the night before school resumes |
| Christmas | Odd years: Heather first part, Brett second. Even years reverse | First part: dismissal through Dec 25 (handoff 2 p.m. Dec 26). Second part: Dec 26 through the night before school resumes |
| Mother's Day weekend | Heather | Fri, Sat, Sun nights of the 2nd Sunday in May |
| Father's Day weekend | Brett | Fri, Sat, Sun nights of the 3rd Sunday in June |
| Summer weeks | Each parent picks two one-week periods (7 nights from the start date) | Odd years Heather picks first and notifies by March 1, Brett by March 15. Even years reverse |

Other holidays override summer weeks. Holiday break dates come from the school calendar stored in `breaks`.

### Handoffs

- Regular Friday switch: after school, or 5 p.m. if there is no school that Friday.
- Holiday starts and ends use the agreement times above. One-off switches have no set time.
- **On a handoff day, the whole day is the receiving parent's responsibility** (Heather's rule). For "am I free that day" questions, a handoff day belongs entirely to the incoming parent.

### Totals (admin only)

Counts actual overnights from `track_from` through today, for: month shown, this year, or since start. Grandma and "someone else" nights are their own buckets. "Covered" counts nights where Heather or Brett had the kids on the other parent's scheduled night.

## Database (Supabase)

Full structure is in `supabase/schema.sql`. Summary:

| Table | Columns | Notes |
|---|---|---|
| `app_users` | `email` (pk, lowercase), `role` ('admin' or 'parent') | Who can edit. Two admin emails, both Heather's, listed only in the database |
| `settings` | single row `id=1`: `my_name` ('Heather'), `co_name` ('Brett'), `anchor`, `track_from`, `changed_at` | `changed_at` is bumped by triggers on any change to swaps, swap_details or breaks |
| `breaks` | `year` (pk), `data` jsonb | School calendar and holiday break dates per calendar year (shape below) |
| `swaps` | `day` (pk), `had` ('me','co','grandma','other'), `caregiver`, `updated_at` | Days that differ from the schedule |
| `swap_details` | `day` (pk, fk to swaps, cascade), `reason`, `note`, `pnote` | `reason`: 'work','travel','coverage','other'. `note` is the **shared** note (family sees it). `pnote` is the **private** note (Heather only, never sent to the family page) |
| `share_links` | `token` (pk), `label`, `active`, `created_at` | The secret family link. Making a new link deactivates the old one |
| `kids`, `homes`, `places`, `teams`, `events`, `event_comments`, `contacts`, `event_log` | See `supabase/schema.sql` | Activities tables, added by migrations 06 to 08 on 2026-11-20. Empty until the Activities pages ship. Editable by `admin` and `parent`; `event_log` is written only by triggers |

`breaks.data` shape:

```jsonc
{
  "firstDay": "YYYY-MM-DD", "lastDay": "",
  "spL": "", "spR": "",          // spring: last school day, first day back
  "tgL": "2026-11-20", "tgR": "2026-11-30",   // Thanksgiving
  "xmL": "2026-12-18", "xmR": "2027-01-05",   // Christmas
  "summer": [{ "start": "2027-06-04", "who": "me" }],
  "school": [{ "s": "2026-11-23", "e": "2026-11-27", "t": "off", "l": "Thanksgiving break" }]
}
```

`school[].t` is `off` or `half`. A school year runs from `firstDay` (stored in the fall year's row) to `lastDay` (stored in the spring year's row). Weekdays inside it that are not listed are school days. 2026-27 school district dates are entered. **The 2027-28 calendar still needs entering when the district publishes it.**

### Security model (do not weaken)

- Row level security is on for every table. All direct table access is admin-only via `public.my_role()`, which matches the signed-in email against `app_users`.
- The family page never reads tables. It calls `public.get_schedule(p_token)`, a `security definer` function granted to `anon`, which returns data only if the token is active. It returns settings (names, anchor), `changed_at`, breaks, and swaps with `caregiver`, `reason`, shared `note` and `updated_at`, plus activities for a rolling window (7 days back, 60 ahead): `window`, `kids`, `places`, `teams`, `events`, shared `comments` and `log` summaries. **It must never return `pnote`, `track_from`, totals, `ical_url`, phone numbers, home addresses, `lat`/`lng`, unshared comments or the log's before and after detail.**
- A second role, `parent` (Brett's sign-in, not yet added), may edit activities only. It must never be able to read or change `settings`, `breaks`, `swaps`, `swap_details`, `share_links` or `app_users`. Signed-in editors read the schedule through `public.get_editor_schedule()`, which returns the same family-safe custody data. **No `parent` row may be added until `my_role()` is hardened (see the follow-ups in `supabase/migrations/README.md`) and public sign-ups are confirmed off.**
- The publishable key in `config.js` is meant to be public. **Never commit the secret (service_role) key, a share token, or any SQL that contains Heather's data.** The repo is public.
- Verified: anon requests to tables get "permission denied"; a fake token gets `null`.

### Database changes

Heather connected the Supabase connector on 2026-11-19, so database changes can be run for her. The access is broad (it can read and change everything), so these rules apply:

- Every change is a numbered file first, reviewed by back-end and security, and Heather approves each run.
- Check structure, counts and checksums. Do not read schedule rows, private notes or emails unless a specific problem needs it and she agrees.
- Before a real run: back up to the private `kt_backup` schema (not exposed to the API), then dry-run the files in one transaction that ends in a forced error so it rolls back, then confirm from a separate call that nothing persisted. `supabase/migrations/DRYRUN-*.sql` is the pattern.
- Text sent through the connector can be altered in transit (a backslash-u sequence was). Load files into `kt_backup.staged_sql` in checksummed pieces and execute from there.
- Never create projects or anything that costs money.

For any change:

1. Write a new numbered file in `supabase/migrations/` (next is `09_...sql`). Make it safe to re-run (`if not exists`, `create or replace`, `drop ... if exists`). No personal data, no destructive deletes unless Heather explicitly asks.
2. Update `supabase/schema.sql` so it stays the full current picture.
3. Tell Heather in plain steps: Supabase, then SQL Editor, then New query, paste, Run, and what result she should see.
4. Ship database changes **before** the code that depends on them, and say so.

History (already run in her project; do not rerun 03): 01 tables and security, 02 initial data load, 03 private note column and data sync, 04 what's new (`changed_at`, triggers), 05 Grandma as a holder, 06 activities tables and the `parent` role, 07 editor schedule function, 08 family link returns activities (06 to 08 run on 2026-11-20 after a rolled-back dry run passed 214 of 214 checks).

### Sign-in

- Email and password (`signInWithPassword`). Magic link (`signInWithOtp`) is a fallback only.
- Setup details (email limits, redirect settings, accounts) are kept out of this public file. On Heather's Mac they are in `private/sign-in-notes.md`, which is gitignored.

## Product decisions (keep these unless Heather changes them)

**Colors** (light mode values; dark mode values are in style.css):

| Who | Color | Tint |
|---|---|---|
| Heather | green `#3F6F14` | `#E2F0CB` |
| Brett | teal blue `#2A7383` | `#D3E8EC` |
| Grandma | purple `#6B3FA0` | `#ECE2F7` |
| Someone else | gold `#9A6210` | `#F7E6C6` |
| Danger buttons | red `#B3261E` | |

**Calendar markers:** background color = who has the kids that night. ⇄ badge plus outline = switched from the schedule. ★ = holiday schedule. Gray band at the bottom = no school ("No school" on wide screens, "Off" on phones). ½ = half day. On phones, names collapse to initials.

**Family page:** title "Kids Tracker" with no subheader. Order: "Updated since you last looked" box (only when there are changes; lists new switches, activity change log lines and comments that tag Angie), "Right now" card (who has them, through when, next pickup with time, switch reason, holiday, today's activities, school today), Activities panel (Off / This week / Next 30 days, remembered per device in localStorage key `kt-acts`, default This week; hidden when there are no kids; each day shows who has the kids, each activity shows kids, place and tappable address, arrive by, leave by from the house of whoever has the kids, gear, shared note and shared comments; canceled ones crossed out; handoff days get a pack list), month calendar (one kid-initial marker per kid with an activity that day, hidden when the switch is Off) with a "this month" list of switches, holidays and no-school days, "Coming up" for the next 6 weeks, then Recent changes (last 30 days, filter All / Where the kids are / Activities). Shows reasons and shared notes for switches. Never shows totals, percentages or private notes. Tapping a day shows its details and that day's activities. A link ending in `&e=<activity id>` opens that activity's day.

**What's new:** the phone stores the last `changed_at` it acknowledged in localStorage key `kt-seen`. First visit marks everything as seen. Switches with `updated_at` after that get a "New" dot and chip until "Got it".

**Admin page:** totals card, calendar (with the same kid markers), the same Activities panel read only under the calendar, family link panel (copy, see what they see, make a new link, turn off), change log (Edit and Text per entry, shows private notes labeled "Private"), holidays and school calendar by year with an editor, rotation settings. An "Activities" button in the header opens `activities.html`, where activities are added and changed.

**Logging a change:** pick Heather, Brett, Grandma or Someone else (name required). Reason is one of Work, Travel, Coverage requested, Trade or other. Shared note and private note boxes. "Through" date for multi-day changes. Picking the scheduled parent on an unchanged day logs nothing.

**Text an update:** after saving or removing a change on the admin page, or saving, canceling, removing or commenting with a tag on the Activities page, a sheet opens with a prefilled message and checkboxes in the order Brett, Heather, Angie (Grandma). The person signed in is shown but unchecked and cannot be picked. Numbers come from the `contacts` table only (all three are entered as of 2026-11-20); `config.js` no longer holds any. Activity texts end with a link to that activity: the family link with `&e=<id>` when Angie is ticked and Heather is the one signed in (her sign-in reads the active family link; a parent's never does), otherwise `activities.html#e=<id>`. "Open Messages" uses `sms://open?addresses=...&body=...` on Apple devices and `sms:...?body=...` elsewhere. Nothing is sent automatically.

**Rejected:** a shared or subscribed calendar feed (Heather finds calendar update notifications annoying). Push notifications were discussed as a future option and not built.

## Working with Heather

- **Show, don't describe.** She is visual. Before building any UI change, mock it up so she can see it (a screenshot or a preview page), and get her feedback in one round.
- **Plans go in a markdown doc** in the repo (for example `docs/plan-<feature>.md`) unless she asks otherwise.
- **Writing rule:** never use em dashes or en dashes in anything she will read, including UI copy. Use a hyphen with spaces or rewrite the sentence.
- Be direct and lead with the recommendation. Separate what is known from what is assumed.
- Ask before anything destructive (deleting data, turning off the family link, rewriting history).

### Agent departments

The five departments are set up as subagents in `.claude/agents/` (`frontend-dev`, `backend-dev`, `qa`, `security`, `exec-review`).

**Models (Heather's decision, 2026-11-20, to keep usage within her plan):** front-end, back-end, QA and executive review run on Sonnet 5.5 at medium effort; security runs on Opus 5.5; purely mechanical jobs (copying files, loading staged SQL) go to a general-purpose agent on Haiku 5.5. The model and effort are set in each agent's file in `.claude/agents/`.

**Scale the review to the change (Heather's decision, 2026-11-20):**

- **Database changes, and anything about to go live:** all five departments, as below.
- **New feature slices on a branch:** front-end (and back-end if needed), then QA, then security. Executive review once, when the slice is ready to go live.
- **Small fixes** (wording, styling, a bug fix found in review): make the fix directly, then one combined check by a single reviewer. Do not re-run every department.
- Give reviewers the diff and a short brief, not "read everything". Collect all findings from one review round and fix them together before asking for one re-check.
- Keep reports short (the agent files cap them). Avoid reading full-page screenshots into the main conversation; look at crops.
- When the main conversation gets long (roughly a third of the context window), write a handoff note in `private/` and continue in a fresh session.

Run work through these roles, as subagents where possible, and do not hand anything to Heather until the reviews required above sign off:

1. **Front-end dev:** HTML, CSS, JS. Phone first (her mom and Brett use iPhones; the family page is saved to a home screen). Both light and dark mode. No horizontal scroll at 375px.
2. **Back-end dev:** Supabase schema, RLS, functions, migrations per the rules above.
3. **QA:** test both pages in a headless browser with a mocked Supabase (stub `window.supabase` for admin, route `rest/v1/rpc/get_schedule` for family). Check the rotation, holidays, handoff times, totals and the "what's new" flow against known dates. Example truths: 2026-11-09 is Brett's; Thanksgiving 2026 is Heather's, Nov 20 to 29; Christmas 2026 first part is Brett's, Dec 18 to 25.
4. **Security:** confirm no secret keys, tokens or personal data in the repo, RLS unchanged or tightened, `get_schedule` still never returns `pnote`, and anon access to tables still denied.
5. **CFO/CEO executive review:** a demanding final check. Tie out every number (totals, night counts, percentages) by hand against the rules, confirm the change does what Heather asked and nothing she didn't, and reject anything sloppy. Only then present it to her.

## Backlog and open items

- **Activities feature:** plan and Heather's decisions are in `docs/plan-activities.md`, mockup in `docs/mockups/`. Phase 0 (tests, shared `core.js`, bug fixes) is live as of 2026-11-19. Phase 1's database changes (migrations 06 to 08) are in the live database as of 2026-11-20. Slice 1A (the Activities page, and activities on the family and admin pages) went live on 2026-11-20; the Activities panel stays hidden until a kid is entered. Slice 1B (Paste a list, Calendar file, the Photo or PDF helper and the review screen on the Activities page; no database change) went live on 2026-11-21. Two small items from its executive review were fixed on 2026-11-21 (`v=14`): a line listed twice in one paste or file now shows "Same as a row above" and starts unticked, and a file holding only canceled events that were never on the tracker says "Nothing to add or change". Slices 1C and 1D and Phases 2 to 4 are not built. Work happens on a feature branch; merge to `main` only with Heather's approval.
- **Keep the tracker free.** Heather decided on 2026-11-19 not to add paid services. Check cost before proposing anything that needs a paid account.
- **Kids' names, home addresses, activity locations and calendar links live in the database only.** Never in the repo, mockups, tests or commit messages. Mockups use made-up names; a gitignored `docs/mockups/names.local.js` can show the real ones locally.
- Enter the 2027-28 school calendar (first and last day, Thanksgiving and Christmas 2027 break dates, no-school days) when published.
- Summer 2027 weeks: Heather picks first by March 1, 2027.
- Possible: optional handoff time on one-off switches.
- Possible: real push notifications for the family page (needs a service worker, VAPID keys and a Supabase Edge Function).
- Done 2026-11-20: the phone numbers moved out of public `config.js` into the `contacts` table. They are still visible in the repo's git history.
