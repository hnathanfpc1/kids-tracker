# Database migrations

Every database change goes here as a new numbered file, starting with `06_<short-name>.sql`.

Already run in the live project (not stored here because 02 and 03 contained schedule data):

| # | What it did |
|---|---|
| 01 | Tables, row level security, `my_role()`, first family link |
| 02 | Initial data load |
| 03 | Private note column, `get_schedule` returns reason and shared note, data sync |
| 04 | `settings.changed_at`, change triggers, `get_schedule` returns `changed_at` and `updated_at` |
| 05 | `grandma` allowed as a holder, existing Grandma days moved over |

Rules for new files:

- Safe to re-run (`if not exists`, `create or replace`, `drop ... if exists`).
- No personal data. This repo is public.
- No deletes of schedule data unless Heather explicitly asks.
- Also update `../schema.sql` so it always shows the full current structure.
- Heather runs each file in Supabase: SQL Editor, New query, paste, Run.
