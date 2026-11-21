# Database migrations

Every database change goes here as a new numbered file. The next free number is `10`.

## Already run in the live project

These are not stored here because 02 and 03 contained schedule data.

| # | What it did |
|---|---|
| 01 | Tables, row level security, `my_role()`, first family link |
| 02 | Initial data load |
| 03 | Private note column, `get_schedule` returns reason and shared note, data sync |
| 04 | `settings.changed_at`, change triggers, `get_schedule` returns `changed_at` and `updated_at` |
| 05 | `grandma` allowed as a holder, existing Grandma days moved over |

## Sign-in hardening (slice 1C)

Run after 06 to 08, and before any `parent` row is added. Steps, the Supabase checklist and checks are in `RUN-09.md`.

| # | File | What it does | Run in the live project? |
|---|---|---|---|
| 09 | `09_harden_sign_in.sql` | Adds `app_users.user_id` (nullable, unique when set; no foreign key into `auth`) and pins the existing admin rows to their accounts (admin rows only, never parent rows). `my_role()` finds the signed-in person by user id in `auth.users` and counts them only if their row is pinned to that id, the email matches, and the account is confirmed, not deleted, not banned, not anonymous and not SSO. A row with no `user_id` grants nothing. Same signature and grants. Revokes the PostgreSQL 17 `maintain` right on our tables (skipped on older versions). Stops without changing anything if no admin row would pass. `get_schedule` and `get_editor_schedule` are untouched | Yes, 2026-11-21 |

## Activities (Phase 1)

Run in this order: 06, then 07, then 08. Steps and checks are in `RUN-06-08.md`. Update the last column when each one has been run.

| # | File | What it does | Run in the live project? |
|---|---|---|---|
| 06 | `06_activities_tables.sql` | Second sign-in role `parent`. Eight new tables: `kids`, `homes`, `places`, `teams`, `events`, `event_comments`, `contacts`, `event_log`. Row level security and rules on all of them. Length limits on free text. Triggers that stamp who changed an activity, write the change log, keep ids fixed and bump "what's new". `my_role()` and `touch_changed()` can no longer be run with the public key, and nobody but the owner can truncate a table | Yes, 2026-11-20 |
| 07 | `07_editor_schedule.sql` | `get_editor_schedule()`: a signed-in admin or parent gets the same family-safe schedule the family link shows, without reading the custody tables. `get_schedule` output is unchanged | Yes, 2026-11-20 |
| 08 | `08_get_schedule_activities.sql` | `get_schedule` and `get_editor_schedule()` also return kids, places, teams, activities, shared comments and change log summaries. Everything `get_schedule` returned before is unchanged | Yes, 2026-11-20 |

After all three: 14 tables (all with row level security on), 22 policies, 26 triggers, and 21 functions of ours in `public` (22 counting Supabase's `rls_auto_enable`).

Other files:

| File | What it is |
|---|---|
| `RUN-06-08.md` | Plain steps for running 06 to 08, what to expect and how to check each one |
| `CHECK-06-08.sql` | One read-only query that checks the security rules after the migrations. Reads the database catalog only, never data |
| `DRYRUN-00-preamble.sql`, `DRYRUN-06-08.sql`, `DRYRUN-99-aftercheck.sql` | A rehearsal of 06 to 08 that leaves nothing behind. Not migrations. See below |
| `RUN-09.md` | Plain steps for 09, the Supabase sign-in checklist, and how to add the `parent` row |
| `DRYRUN-09-pre.sql`, `DRYRUN-09-mid.sql`, `DRYRUN-09.sql`, `DRYRUN-99-aftercheck-09.sql` | A rehearsal of 09 that leaves nothing behind. Not migrations. See "Dry run of 09" below |

### Dry run (a rehearsal that leaves nothing behind)

The dry run applies 06 to 08 twice and runs 214 checks as each kind of user, all inside one transaction that ends in an error on purpose, so the database is left as it was. Exact order:

1. **One call**, sent as a single multi-statement request so it is one transaction, run as `postgres`:
   `DRYRUN-00-preamble.sql`, `06`, `07`, `08`, `06`, `07`, `08`, `DRYRUN-06-08.sql`
2. **A separate call** afterwards: `DRYRUN-99-aftercheck.sql`

Rules:

- Do not wrap the call in `begin` and `rollback`. The error raised at the end of `DRYRUN-06-08.sql` is what ends the transaction.
- `DRYRUN-06-08.sql` refuses to start (error codes `KT001` to `KT003`) unless the preamble ran earlier in the same transaction and the activities tables did not exist before it. It cannot run on its own, statement by statement, or against migrations that were applied for real.
- The report arrives as an error with code `KT000`. It starts `KT DRYRUN txid=... total=214 passed=... failed=... expected=214`.
- The dry run never claims that anything was undone. Only the aftercheck, run as its own call, shows that nothing stayed behind: 6 tables, no `kids` table, the admin-only rule on `app_users`, no `example.test` rows, the same number of family links as before, and none of the new functions.
- It can only be pasted into the Supabase SQL Editor if the editor sends the whole paste as one transaction. If in doubt, do not use the editor for it.

### Dry run of 09

One call, one transaction, run as `postgres`: `DRYRUN-09-pre.sql`, `09`, `DRYRUN-09-mid.sql`, `09`, `DRYRUN-09.sql`. It makes up accounts inside the transaction (example.test emails), runs 109 checks including a count-only lock-out guard on the live admin rows, then ends in an error with code `KT000` so everything rolls back. Run `DRYRUN-99-aftercheck-09.sql` once before and once after as separate calls and compare. Do not wrap the call in `begin` and `rollback`. It needs 06 to 08 to be live already.

09 was run in the live project on 2026-11-21 as one transaction, after this dry run passed 109 of 109 checks on the live database and the before and after check matched on every line. The text that ran was checked against `09_harden_sign_in.sql` by checksum. After the run: 2 of 2 admin rows pinned and passing, 0 parent rows, no `maintain` right left for the public key or signed-in users. A copy of `app_users` and of the old `my_role()` from before the run is in the private `kt_backup` schema.

### Run record

06, 07 and 08 were run in the live project on 2026-11-20, in that order, each as one transaction, after a rolled-back dry run on the live database passed 214 of 214 checks and a separate after-check showed nothing persisted. The text that ran was checked against these files by checksum. A copy of the six custody tables from before the run is in the private `kt_backup` schema, which is not exposed to the API.

### Known follow-ups (not in 06 to 08, on purpose)

| What | Why it waits | When it must be done |
|---|---|---|
| ~~Harden `my_role()`~~ Done in 09 (run in the live project on 2026-11-21): pinned to the account id, confirmed email required. Still to do by Heather: the Supabase checklist in `RUN-09.md` (sign-ups off, confirm email on, secure email change on, manual linking off, only Email provider, anonymous off, account count as expected), then create Brett's account, then add his `parent` row with the pinning statement in `RUN-09.md` | Changes how the live admin sign-in is checked | **Before any `parent` row is added to `app_users`** |
| Log changes to kids, places and homes, and pin `source_uid` once an activity is imported | More trigger code; the tables are useful without it | Before calendar link import (Phase 2) |
| Stricter `search_path` on the functions (for example empty, with every name schema-qualified) | Touches every function, including the live ones | Any time, as its own migration |
| The older `touch_*` triggers on `swaps`, `swap_details` and `breaks` fire even when a signed-in non-admin's update changes no row, which bumps "what's new" | Live behavior from migration 04. No data is exposed | With the next change to the custody tables |
| ~~Revoke the `maintain` right~~ Done in 09, behind a version check | | |

## Rules for new files

- Safe to re-run (`if not exists`, `create or replace`, `drop ... if exists`).
- No personal data. This repo is public.
- No deletes of schedule data unless Heather explicitly asks.
- Each file must be able to run as one unit inside a single transaction (for example, no `create index concurrently`).
- Also update `../schema.sql` so it always shows the full current structure.
- Heather runs each file in Supabase: SQL Editor, New query, paste, Run.
- The live project also has a Supabase-managed function, `rls_auto_enable()`, with an event trigger named `ensure_rls`. Leave it alone. Still turn row level security on explicitly for every new table.
