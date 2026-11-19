# Database migrations

Every database change goes here as a new numbered file. The next free number is `09`.

## Already run in the live project

These are not stored here because 02 and 03 contained schedule data.

| # | What it did |
|---|---|
| 01 | Tables, row level security, `my_role()`, first family link |
| 02 | Initial data load |
| 03 | Private note column, `get_schedule` returns reason and shared note, data sync |
| 04 | `settings.changed_at`, change triggers, `get_schedule` returns `changed_at` and `updated_at` |
| 05 | `grandma` allowed as a holder, existing Grandma days moved over |

## Activities (Phase 1)

Run in this order: 06, then 07, then 08. Steps and checks are in `RUN-06-08.md`. Update the last column when each one has been run.

| # | File | What it does | Run in the live project? |
|---|---|---|---|
| 06 | `06_activities_tables.sql` | Second sign-in role `parent`. Eight new tables: `kids`, `homes`, `places`, `teams`, `events`, `event_comments`, `contacts`, `event_log`. Row level security and rules on all of them. Length limits on free text. Triggers that stamp who changed an activity, write the change log, keep ids fixed and bump "what's new". `my_role()` and `touch_changed()` can no longer be run with the public key, and nobody but the owner can truncate a table | Not yet |
| 07 | `07_editor_schedule.sql` | `get_editor_schedule()`: a signed-in admin or parent gets the same family-safe schedule the family link shows, without reading the custody tables. `get_schedule` output is unchanged | Not yet |
| 08 | `08_get_schedule_activities.sql` | `get_schedule` and `get_editor_schedule()` also return kids, places, teams, activities, shared comments and change log summaries. Everything `get_schedule` returned before is unchanged | Not yet |

After all three: 14 tables (all with row level security on), 22 policies, 26 triggers, and 21 functions of ours in `public` (22 counting Supabase's `rls_auto_enable`).

Other files:

| File | What it is |
|---|---|
| `RUN-06-08.md` | Plain steps for running 06 to 08, what to expect and how to check each one |
| `CHECK-06-08.sql` | One read-only query that checks the security rules after the migrations. Reads the database catalog only, never data |
| `DRYRUN-00-preamble.sql`, `DRYRUN-06-08.sql`, `DRYRUN-99-aftercheck.sql` | A rehearsal of 06 to 08 that leaves nothing behind. Not migrations. See below |

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

### Known follow-ups (not in 06 to 08, on purpose)

| What | Why it waits | When it must be done |
|---|---|---|
| Harden `my_role()`: require a confirmed email, or key the sign-in list by user id instead of email | Changes how the live admin sign-in is checked, so it needs its own careful migration | **Before any `parent` row is added to `app_users`** |
| Log changes to kids, places and homes, and pin `source_uid` once an activity is imported | More trigger code; the tables are useful without it | Before calendar link import (Phase 2) |
| Stricter `search_path` on the functions (for example empty, with every name schema-qualified) | Touches every function, including the live ones | Any time, as its own migration |
| The older `touch_*` triggers on `swaps`, `swap_details` and `breaks` fire even when a signed-in non-admin's update changes no row, which bumps "what's new" | Live behavior from migration 04. No data is exposed | With the next change to the custody tables |
| Revoke the `maintain` right (PostgreSQL 17 and later) on the custody tables from `anon` and `authenticated` | It cannot read or change a row and is not reachable through the API. Needs a version guard so `schema.sql` still works for a rebuild | Migration 09 |

## Rules for new files

- Safe to re-run (`if not exists`, `create or replace`, `drop ... if exists`).
- No personal data. This repo is public.
- No deletes of schedule data unless Heather explicitly asks.
- Each file must be able to run as one unit inside a single transaction (for example, no `create index concurrently`).
- Also update `../schema.sql` so it always shows the full current structure.
- Heather runs each file in Supabase: SQL Editor, New query, paste, Run.
- The live project also has a Supabase-managed function, `rls_auto_enable()`, with an event trigger named `ensure_rls`. Leave it alone. Still turn row level security on explicitly for every new table.
