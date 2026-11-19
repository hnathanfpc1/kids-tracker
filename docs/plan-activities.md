# Plan: Activities (sports, practices, lessons)

Status: Phase 0 is built on branch `feature/activities` and in review. It is not merged and not live. Phases 1 to 4 are not started.
Branch: `feature/activities`. `main` (the live site) is untouched.
Mockup: `docs/mockups/activities-mockup.html`, version 3 (sample kids and sample activities only).
Review round 1 with Heather on 2026-11-19 is folded in. Section 16 lists what changed.

## 1. Recommendation in one paragraph

Add activities as a second layer on top of the custody schedule, not a separate tool. The custody view stays exactly as it is and stays the first thing anyone sees. Activities show up as kid-colored markers on the calendar and as an "Activities" list you can switch between Off, This week and Next 30 days. Every activity shows which adult has the kids that day, when to arrive, when to leave from that adult's house, and what gear is needed. Each handoff shows a pack list of the gear that has to move. Heather and Brett both edit through a new signed-in Activities page. Getting data in is "paste or link, then review and approve": the tracker reads the source, shows proposed entries, and nothing is saved until you tap Add.

Everything in this plan runs on the free plans already in use (GitHub Pages and Supabase free). Decided 2026-11-19: keep it free, so built-in AI reading of photos and PDFs is parked. See section 7.

Build it in four phases so the live custody site is never at risk and each phase is useful on its own.

## 2. What you asked for, mapped to the plan

| You asked for | Where it is in the plan |
|---|---|
| A section or tab for activities, by kid | New Activities page (section 5) plus activity layers on both existing pages (section 4) |
| Location, time, arrive by, leave by depending on where you leave from | Section 6: saved places with drive minutes from each house; leave-by is calculated |
| Super simple way to get data in, easy to change | Section 7: calendar link, calendar file, paste from Excel or a typed list, or add by hand. Always a review step |
| Color code by kid | Section 3: kid colors as a second channel that never replaces the parent colors |
| Feed the master summary: who has the kid for which event | Section 4: every event shows the responsible adult, using your handoff-day rule |
| Right shoes, cleats, uniforms at the right house | Section 6: gear list per activity, pack list at every handoff |
| Brett and I both edit | Section 8: Brett gets his own sign-in that can edit activities only |
| Separate change log for activities | Section 8: automatic log written by the database, shows who changed what |
| Notification when something is added or changed | Section 9: text sheet and "what's new" first, automatic push later |
| Keep the big summary view, toggle activities on and off | Section 4: Off / This week / Next 30 days switch, remembered per phone |
| Read a text, screenshot, picture, PDF or iCal link and propose entries | Section 7. Calendar links and pasted lists are built in and free. Photos, PDFs and messy texts use a free helper step for now. Built-in reading is parked because it costs money |

## 3. Kid colors

Known: day background color means who has the kids (Heather green, Brett teal, Grandma purple, someone else gold). That stays.

Plan: kids get their own colors, shown only as dots, left bars and chips, so the two meanings never mix. Kid names and colors live in the database, entered on the Activities page. They are never written into the repo, because the repo is public.

Decided 2026-11-19: no pink and blue pair. Options that stay clearly different from green, teal, purple, gold and red (pick one per kid on the Activities page):

| Name | Light mode | Tint | Dark mode | Dark tint | Status |
|---|---|---|---|---|---|
| Orange | `#D4580A` | `#FCE4D2` | `#F7A34B` | `#3E2714` | PICKED 2026-11-19 for kid 1 in the mockup |
| Berry | `#9C1F55` | `#F6DCE7` | `#F472B6` | `#3F1B30` | PICKED 2026-11-19 for kid 2 in the mockup |
| Navy | `#27408B` | `#DDE3F5` | `#9DB0F0` | `#1C2547` | Not picked |
| Charcoal | `#3B4650` | `#E3E7EA` | `#C3CDD4` | `#2A3238` | Not picked |

Orange and berry are both warm colors. In dark mode they are pushed apart (orange toward yellow, berry toward pink) so they stay distinct, and the initial on every marker backs that up.

Known limit: with four holder colors and red already in use, these are the only hue families left that do not sit next to an existing one. To take the pressure off color, the calendar marker is the kid's initial in a small colored square, so nobody has to tell kids apart by color alone.

An activity can be for one kid or for both (for example the same basketball team). A shared activity shows both name chips and a two-color bar, and counts once.

## 4. What changes on the pages people already use

### Family page (Mom, Brett, Heather)

Order stays the same, with two additions:

1. "Updated since you last looked" box - now also lists activity changes.
2. "Right now" card - adds one line for today's activities, for example "Today: soccer practice 5:30 p.m. Leave by 5:05."
3. **New: Activities panel** with a three-way switch: Off, This week, Next 30 days. Grouped by day. Each day shows who has the kids. Each activity shows the kid, what, time, place, arrive by, leave by and gear. Each handoff shows a pack list.
4. Month calendar - when activities are on, each day shows one small initial marker per kid who has something that day. Tapping a day lists that day's activities under the custody details.
5. "Coming up" (next 6 weeks) - unchanged.
6. **New: Recent changes panel** with a filter: All, Where the kids are, Activities. Read-only. "Where the kids are" lists switches with the reason and shared note only, never private notes.

Decided 2026-11-19: Grandma (Angie) and anyone else with the family link sees activities, activity notes and the change log.

The switch setting is remembered on each phone. Default: This week.

### Admin page (Heather)

- Same calendar dots and the same Activities panel.
- A link to the new Activities page.
- Everything else (totals, family link, custody change log, holidays, rotation settings) is unchanged.

### Who is responsible for an activity

Rule already in CLAUDE.md: on a handoff day, the whole day belongs to the receiving parent. So the adult responsible for an activity on a given day is whoever has the kids that night. The existing schedule logic already answers that (logged switch, then holiday, then rotation), so activities reuse it and stay correct when you log a switch.

When an activity falls on a handoff day, the row is flagged "Handoff day" so both parents know the gear is moving that day.

## 5. New Activities page (signed in: Heather and Brett)

One page, phone first, four parts:

1. **Add activities** - the big button. Choices: Calendar link, Calendar file, Paste a list, Photo or PDF helper, Add one by hand.
2. **Upcoming** - every activity, newest first, filter by kid. Tap to edit, cancel or remove. "Repeat weekly until" for hand entry.
3. **Teams and gear** - one card per activity series (for example a soccer team): one kid or both, default place, how early to arrive, gear list, a note, calendar link if there is one. Gear is a plain list: type a word and press return to add, tap the x to remove.
4. **Places** - a short list. Adding one needs only a name. Address, drive minutes and a note are optional and can be filled in later. A new place can also be added from inside any activity without leaving it.
5. **Kids and change log** - kid names and colors, and the change log with the same All / Where the kids are / Activities filter.

Every activity, team and place has a notes box. Every activity has a comments thread (section 8).

## 6. Times, places and gear

### Arrive by and leave by

- **Arrive by** = start time minus "arrive early" minutes. Arrive early is set once per team (for example 10 minutes for practice, 30 for games) and can be overridden on any single event.
- **Leave by** = arrive by minus drive minutes from the house of whoever has the kids that day.
- Decided 2026-11-19: drive minutes come from addresses. Heather's, Brett's and Angie's home addresses are entered once in the tracker's settings. When a place with an address is saved, the tracker looks up the drive time from each house and fills in the minutes. The numbers can be overwritten by hand.
- The lookup is a typical drive time. It does not know about live traffic.
- Which house is used follows where the kids are that day: Heather's, Brett's or Angie's.
- If a place has no address or the lookup fails, the row shows arrive by only and a prompt to type the minutes.

Example: practice starts 5:30 p.m., arrive 10 minutes early = arrive by 5:20. The field is 15 minutes from Heather's = leave by 5:05 on Heather's days, and 25 minutes from Brett's = leave by 4:55 on Brett's days.

How the lookup stays free (uncertain until tested in the build): free OpenStreetMap-based services can turn an address into a map point and return a driving time with no account or a free key. They have fair-use limits that a family app will not come near, since a lookup only runs when a place is added or changed. Usage rules and accuracy for your area get checked in Phase 1 before this is relied on. Typed minutes remain the fallback, so nothing breaks if a service goes away.

Privacy: home addresses are stored in the database, readable only when signed in. They are never in the repo and never sent to the family page. The family page only receives the resulting minutes. The addresses are sent to the map service to do the lookup.

### Gear

- Each team has a plain gear list (decided 2026-11-19: keep it simple, no per-item settings). A single activity can add or drop an item.
- **Pack list at handoff:** for every handoff, the tracker looks at the incoming adult's stretch of days and lists the gear needed for the activities in that stretch. Example: "Friday handoff to Brett. Pack: cleats, shin guards, game uniform (soccer Sat, Tue, Thu). Basketball shoes, jersey (basketball Sat, Mon, Wed)."
- The pack list also appears in the "Text an update" message so it can be sent in one tap.

Assumed, to confirm: a pack list at each handoff is the right level. The tracker will not try to track where each item physically is right now. That would need someone to check items in and out, which nobody will keep up.

## 7. Getting activities in

Every path ends at the same review screen. Nothing is saved until you approve it.

| Source | How it works | Cost | Phase |
|---|---|---|---|
| Add one by hand | Short form, with "repeat weekly until" | Free | 1 |
| Paste a list | Paste rows from Excel or a typed list (date, time, what, kid, place). The page reads the columns | Free | 1 |
| Calendar file (.ics) | Download the file from the sports app and choose it | Free | 1 |
| Photo, PDF or a messy text | Helper step, see below. Ends in "Paste a list" | Free | 1 |
| Calendar link (iCal) | Paste the link once per team. The tracker fetches it and proposes entries. "Check for changes" re-reads it and shows only what is new, moved or canceled | Free. Needs one small Supabase Edge Function, because browsers are not allowed to fetch most calendar links directly | 2 |

Known: Supabase's free plan includes 500,000 Edge Function calls a month across the organization. A calendar check is one call, so even a daily check on ten teams is about 300 a month. Source: https://supabase.com/docs/guides/functions/pricing

### Photos, PDFs and messy texts: free helper (for now)

The tracker cannot read a picture by itself without a paid AI service. The free route uses the AI chat you already have:

1. On the Activities page, tap "Photo or PDF helper". It copies a ready-made request to your clipboard.
2. Open Claude (or any AI chat), paste the request and attach the photo, screenshot or PDF.
3. It answers with clean rows. Copy them.
4. Back in the tracker, tap "Paste a list" and paste. You land on the same review screen as every other source.

The copied request tells the AI exactly which columns to produce and to flag anything it is unsure of, so the review screen can highlight it. It is two extra taps compared with built-in reading, and Brett can do it with any free AI chat.

### The review screen

- Headline with the count: "I found 8 practices and 2 games."
- One row per proposed entry: checkbox, kid, what, date, time, place. Every field is editable in place.
- Anything the reader was unsure about is highlighted with the reason ("No year on the flyer, I assumed 2026").
- Entries that already exist are marked "Already on the tracker" and unchecked. Entries that changed show old and new ("Time moved 5:30 to 6:00").
- "Apply to all" for kid, team and place so you set them once.
- One button: "Add 10 to the tracker". Then the usual "Text an update?" sheet.

### Parked: built-in photo and PDF reading

Not in scope. Decided 2026-11-19 to keep the tracker free.

- What it would take if you ever want it: a second Edge Function that calls the Claude API, an Anthropic API account with a payment method (separate from a Claude subscription), and the key stored as a Supabase function secret.
- Cost estimate, uncertain until measured: roughly $0.002 to $0.07 per import depending on the model, so cents per month at family volume. Small, but not free.
- Nothing in phases 1 to 4 depends on it, and the helper above feeds the same review screen, so it can be added later without rework.

## 8. Who can edit, and the activity change log

### Brett's access (recommended)

- Brett gets his own email and password sign-in with a new role, `parent`, that can read and edit activities, places, gear and kids, and nothing else.
- All custody tables stay admin-only: swaps, private notes, totals, holidays, rotation settings, the family link. Brett's sign-in cannot read or change them. This is enforced by the database rules, not just hidden in the page.
- Heather creates his account in Supabase (Authentication, Add user) so no sign-up emails are needed. He signs in once per device and stays signed in.
- Mom stays view-only through the family link.

Alternative, not recommended: let anyone with the family link edit activities. It is one less sign-in, but the log could not tell who made a change, and anyone who gets the link could change the schedule.

### Change log

- Written automatically by a database trigger on every add, change, cancel and remove, so it cannot be skipped or edited.
- Each line: when, who (Heather or Brett), what changed, old value and new value. Example: "Tue Dec 1, 8:14 p.m. - Brett moved soccer practice from 5:30 to 6:00 p.m."
- Imports are grouped: "Heather added 10 activities from a pasted list."
- Shown on the Activities page, the admin page and the family page, with a filter: All, Where the kids are, Activities.
- "Where the kids are" entries come from the existing switch records (date, who, reason, shared note). Private notes never appear in any log the family page can read.

### Comments and tagging

- Any activity has a comments thread. Heather and Brett can post when signed in.
- A comment can tag Heather, Brett or Angie. Tagging does two things: it marks the comment for that person, and after posting it opens the "Text" sheet prefilled with the comment and a link that opens that exact activity.
- The link: for a parent it opens the Activities page on that activity so they can reply. For Angie it opens the family page on that activity.
- Recommended, to confirm: comments are visible to Heather and Brett always, and show on the family page only when Angie is tagged. That keeps parent-to-parent logistics off the shared link unless you choose to share them.
- Angie cannot reply in the tracker (the family link has no sign-in). She replies by text.
- New comments show in "Updated since you last looked" and, in Phase 4, in push notifications.

## 9. Notifications

Known constraint: you turned down a shared calendar feed because update notifications are annoying. So the design goal is few, useful notifications.

| Step | What | Cost and setup | Phase |
|---|---|---|---|
| A | "Text an update?" sheet after any save or comment, prefilled, with a link straight to the activity. Send-to list in this order: Brett, Heather, Angie (Grandma). The person sending is left unchecked | None | 1 |
| B | "Updated since you last looked" box and New markers on the family page now include activities | None | 1 |
| C | Automatic push notification to phones that saved the family page to the home screen. One combined notice per batch of changes, only for activities in the next 14 days, only for new, moved or canceled | Free. Needs a service worker, keys and an Edge Function. Each person taps "Turn on notifications" once | 4 |

Step C matters most once calendar links refresh on their own, because then a coach's change arrives with nobody tapping Save. Until then, A and B cover it.

Not recommended: automatic text messages. They need a paid texting service and carrier registration.

## 10. Database changes (for the back-end department)

All new tables get row level security. Draft shapes, to be finalized in the build:

| Table | Columns (draft) | Who can read and write |
|---|---|---|
| `kids` | `id`, `name`, `color`, `sort`, `active` | admin and parent |
| `places` | `id`, `name`, `address`, `lat`, `lng`, `drive_me`, `drive_co`, `drive_grandma` (minutes), `note` | admin and parent |
| `homes` | `who` (me, co, grandma), `address`, `lat`, `lng` | admin and parent. Never sent to the family page |
| `teams` | `id`, `kid_ids`, `name`, `place_id`, `early_practice`, `early_game`, `gear` (plain list of words), `note`, `ical_url`, `active` | admin and parent. `ical_url` is never sent to the family page |
| `events` | `id`, `team_id`, `kid_ids`, `kind` (practice, game, lesson, other), `title`, `day`, `start_time`, `end_time`, `place_id`, `place_text`, `arrive_by` (override), `note`, `status` (on, canceled), `source`, `source_uid`, `updated_at`, `updated_by` | admin and parent |
| `event_log` | `id`, `at`, `who`, `action`, `event_id`, `summary`, `before`, `after`, `batch_id` | admin and parent read. Only the trigger writes |
| `event_comments` | `id`, `event_id`, `at`, `author`, `body`, `tagged` (list of people), `share_family` (true when Angie is tagged) | admin and parent read and add. Authors can delete their own |
| `contacts` | `id`, `name`, `label`, `phone`, `sort` | admin and parent read. Admin writes. Never sent to the family page |

Other changes:

- `app_users.role` allows `'parent'` as well as `'admin'`.
- `get_schedule(p_token)` also returns kids (name, color), and events, teams' gear and places for a limited window (7 days back, 60 days ahead). It also returns the last 30 days of change log summaries (who, when, one-line summary) and comments where `share_family` is true. It still never returns `pnote`, `track_from`, totals, `ical_url`, phone numbers, home addresses, untagged comments, or the before and after detail of the log.
- Triggers on the new tables bump `settings.changed_at` so "what's new" keeps working.
- Migrations: `06_activities_tables.sql`, `07_parent_role.sql`, `08_get_schedule_activities.sql`. Each safe to re-run, no personal data, and shipped before the code that needs it. The live site keeps working between steps because the changes only add things.

## 11. Code changes (for the front-end department)

- Today all logic is one file, `app.js`, that only knows two pages. Activities need the same "who has the kids on this day" answer on three pages.
- Phase 0 moves the pure schedule logic (dates, rotation, holidays, school calendar, handoff times) into a shared `core.js` with no behavior change, protected by before-and-after tests on known dates.
- New files: `activities.html`, `activities.js`. Additions to `style.css` (kid color tokens with dark mode values, dots, agenda rows, review rows).
- Cache-bust number bumps in all HTML files on every release.
- Still no build step, no framework, no npm in the shipped site.

## 12. Phases

| Phase | What ships | Depends on Heather |
|---|---|---|
| 0. Foundations | Test harness with known custody dates. Shared `core.js`. Fix the stray CSS block (section 14). No visible feature change | Approve this plan |
| 1. Activities core | Kids, places, teams and gear. Add by hand, paste a list, calendar file, photo or PDF helper. Calendar dots, Activities panel with the Off / This week / Next 30 days switch, pack lists, Brett's sign-in, activity change log, text sheet and what's new | Run migrations 06 to 08. Create Brett's account. Enter kids, home addresses and places |
| 2. Calendar link import | Paste a team's iCal link once, review, add. "Check for changes" on demand | Deploy one Edge Function in the Supabase website (free, click-by-click steps provided) |
| 3. Auto refresh | Calendar links re-checked daily on their own, changes logged | Nothing new |
| 4. Push notifications | Combined push notices for changes | Each person turns notifications on once |

Each phase goes through all five departments (front-end, back-end, QA, security, executive review), gets a mockup or preview first, and merges to `main` only with your approval.

## 13. Privacy and security impact

This feature raises the stakes of the family link. Today the link shows which parent has the kids. With activities it would also show the kids' names and where they will be at exact times.

- The link stays secret, random and replaceable in one tap, as today.
- The family link returns only a rolling window of activities (7 days back, 60 ahead), never the full history.
- Kid names, addresses, calendar links and real schedules never go in the public repo. Mockups and tests use made-up names and places.
- Calendar links from sports apps are private links. They are stored in the database, readable only when signed in, and never sent to the family page.
- No paid services and no secret keys are added by this plan.
- Decision for Heather: whether the family link shows full street addresses or place names only.

## 14. Things found while reading the code (not part of this feature)

| # | Finding | Impact | Proposed |
|---|---|---|---|
| 1 | `style.css` line 32 is a leftover block of padding rules with no selector. It makes the browser throw away the next rule, the base `.wrap` rule. Verified in a browser: `.wrap` has no max width, no centering and no 18px gap on the live pages | Admin page stretches full width on a desktop and the header sits tight against the first panel. Phone layout mostly unaffected | Done on branch `feature/activities`, not merged. The sign-in and loading cards also got `width: 100%` so they keep their size once the rule is back |
| 2 | The repo on GitHub only had the five site files. `CLAUDE.md`, `supabase/` and git history from this Mac were not there. This folder was not connected to the repo | Deploys were manual uploads. Now connected, so deploy is a push | Done locally. Nothing pushed yet |
| 3 | `CLAUDE.md` is not committed. It includes a personal email address and details of how sign-in was set up. The repo is public | Would become public if pushed as is | Done 2026-11-19: email and sign-in setup detail removed, then committed |
| 4 | In `app.js`, spring break handoff time at the start of the break is "at 6 p.m." in Heather's years and "after school" in Brett's years. `CLAUDE.md` only documents the 6 p.m. end | Wrong. Heather confirmed 2026-11-19 that spring break starts after school in both parents' years | Done on branch `feature/activities`, not merged. Covered by a test |
| 5 | The admin page loads the Supabase library from a CDN pinned to a version but without an integrity check | Low. A tampered CDN file could act as the signed-in admin | Done on branch `feature/activities`, not merged. Checked against the real library |
| 6 | The "code from the email" sign-in step in `admin.html` is never shown by any code | Dead markup, harmless | Done on branch `feature/activities`, not merged |
| 7 | Saving a change writes `swaps` then `swap_details` as two separate requests | If the second fails, the day saves without its reason and notes | Wrap in one database function later |
| 8 | Sign-up settings in Supabase should be confirmed before a second role is added | The database rules protect the data either way. This is a belt-and-braces check | Heather confirms in Supabase: Authentication, Sign In / Providers, "Allow new users to sign up" is off |
| 9 | GitHub Pages serves the whole repo. Once merged to `main`, `docs/`, `supabase/` and `CLAUDE.md` would be reachable from the site address, not just on GitHub | No secrets in them, but the plan and schema would be one click from the live site | Done on branch `feature/activities`, not merged. Can only be confirmed after the first real GitHub Pages build |

## 15. Decisions

Decided by Heather on 2026-11-19:

| # | Decision | Answer |
|---|---|---|
| 1 | How Brett edits | His own sign-in, activities only |
| 2 | Who sees activities | Everyone with the family link sees activities, notes and the change log |
| 3 | Location detail on the family link | Place name plus a tappable address |
| 4 | Cost | Keep it free. No built-in AI reading of photos and PDFs. Free helper step instead |
| 5 | Leave-by times | Look up drive minutes from home addresses, overwrite by hand when needed |
| 6 | Houses | Heather's, Brett's and Angie's. The one used depends on where the kids are that day |
| 7 | Gear | Plain list per team, pack list at each handoff |
| 8 | Kid colors | Orange and berry. Which kid gets which is set in the app |
| 9 | Comments on the family link | Only when Angie is tagged |
| 10 | Phone numbers | Move all three out of the public `config.js` into the database |
| 11 | Label for Heather's mom on text sheets | "Angie (Grandma)" everywhere |
| 12 | Build order | Core first (Phase 1), calendar link second (Phase 2) |
| 13 | `CLAUDE.md` | Personal email and sign-in setup detail removed, then committed |
| 14 | Spring break start time | After school in both parents' years. The 6 p.m. start in the code is a bug |
| 15 | Go-ahead for Phase 0 | Given 2026-11-19 |
| 16 | Real rotation start date and real 2026-27 Thanksgiving and Christmas break dates in the public repo | Accepted as public |
| 17 | Totals start date and first day of school | Not public. Tests and docs use made-up values |
| 18 | Commit address | GitHub's private no-reply address for this repo |
| 19 | Local history | Rebuild the unpushed commits so earlier wording of the notes file is never published |

Still open:

- Which sports apps the teams use. Not known yet. Calendar link import will be built against the standard calendar format and tested on a real link when there is one.
- Approval to merge Phase 0 to `main`, after Heather has seen the before and after screenshots.
- Seven smaller things QA found in the existing site, none changed in Phase 0: a double period on the "Right now" card when the pickup has a clock time, the switched badge cut off on phones on holiday days, date fields cut off in the dates editor on phones, no handoff time shown when a holiday starts on a no-school day, a stale error on the sign-in card, a summer week listed in full when another holiday overrides part of it, and small tap targets on phones. Also the password box is not styled like the email box.
- Whether to push the `feature/activities` branch to GitHub as a backup. It would not change the live site, but the plan and mockup would be visible in the public repo.

## 16. Review round 1 with Heather (2026-11-19)

| Feedback | What changed |
|---|---|
| Keep it free | Built-in photo and PDF reading parked. Free helper step instead (section 7) |
| Both kids can be on the same activity | "Who it's for" is one kid or Both, on teams, single activities and the import review screen |
| Gear list simple and easy to add to | Plain list, type to add, x to remove. No per-item settings |
| Text sheet: Brett, Heather, and an option for Angie (Grandma) | Send-to order is Brett, Heather, Angie (Grandma). Sender left unchecked |
| Easy to add locations | Name only to add, from the Places list or from inside an activity |
| Notes everywhere | Notes box on activities, teams and places |
| Comment on a practice, tag the other person, text links back to it | Comments thread with tagging and a direct link (section 8) |
| Grandma and anyone with the link sees activities and the change log | Yes, plus a Recent changes panel on the family page |
| Filter the change log | All / Where the kids are / Activities |
| No pink and blue | Orange and berry picked. Initials on calendar markers |
| Kids' names | Entered in the app and stored in the database only. The public repo and the committed mockup use made-up names. A gitignored local file shows the real names in the mockup on Heather's computer |
