---
paths:
  - "src/db/**"
  - "src/types/**"
  - "mcp/src/serialize.ts"
  - "mcp/src/taskFields.ts"
  - "src/utils/templateUtils.ts"
---

# The database, migrations, and what a new field owes

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).

## Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

**An ALTER whose column already exists is skipped rather than thrown.** `initDatabase` reads each table's real columns once (`PRAGMA table_info`) and passes over any `ADD COLUMN` naming one that is already there, because by the second launch every one of them is a duplicate, and re-parsing and re-throwing hundreds of them across the bridge cost real launch time. Only the statement's own text is consulted, so anything that isn't a plain `ADD COLUMN` is run and allowed to fail exactly as it did before. Adding a column still needs nothing but appending to the array.

A schema version in `PRAGMA user_version` was the other way to do this and is deliberately not what shipped: it skips the loop entirely but has to be kept in step with the schema by hand, and anything that resets the tables without resetting the header (dropping every table to wipe the demo database, say) leaves it stamped and skips every migration on a schema that no longer has those columns. Reading the columns cannot desync from them.

**Every one-time backfill is behind a `dbGetSetting('…_done')` flag.** An unguarded one is a no-op in what it writes but never in what it costs: a full table scan on every launch, on columns that aren't indexed.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`). Tags are additionally tracked in a `tag_registry` key in the `settings` table, so a tag that exists but is currently unused doesn't disappear. Categories used to work the same way, but now live in their own `categories` table (they carry schedule/vacation fields a string list can't hold) — the `category_registry` setting is legacy, read only by the one-time migration in `initDatabase()` that backfills that table.

**A new `Task` field is not finished until you've decided whether `TemplateItem` needs it too.**
`src/__tests__/templateItemParity.test.ts` fails until you do: seed it (the field on `TemplateItem`,
its default in `normalizeTemplateItem`, its copy in `buildDraftsFromTemplate`, a control in
`TemplateItemEditor.tsx`) or name it in the test's list with the reason it isn't seeded.

**Nor is a user-facing capability or `Task` field finished until you've decided whether the MCP
server needs it.** `mcp/` redeploys on every merge that touches what it runs, so a changed util or
store reaches it for free, but a new field, tool or rule does not: `serialize.ts` shows Claude only
what it lists, `taskFields.ts` and the tool inputs write only what they name, and
`mcp/src/instructions.ts` is where a changed cross-cutting rule (what the lenses mean, how a day or
a reschedule works) has to be restated. For a `Task` field, `mcp/src/__tests__/taskFieldCoverage.test.ts`
fails until the field is exposed or added to its `NOT_EXPOSED` list. For anything else (a feature,
a rule, a new area) nothing checks, so ask: does Claude need to read it, write it, or know the rule?
Update `docs/arch/mcp-server.md` and `mcp/README.md`'s tool table when a tool is added.
A new feature worth recommending also gets an `ADOPTION_CHECKS` entry in `mcp/src/adoptionTools.ts`
with `since` set to the ship date, so `unused_features` can say it is new and not yet tried; skip it
when adoption leaves no trace in the person's data or settings.

## Sync stamps

**A bulk or unattended write that changes only device-local columns puts the row's sync stamp
back.** Every UPDATE on a synced table restamps the row as a local change (the stamp trigger in
`syncTracking.ts`), including one that only touches a column `SYNC_DEVICE_LOCAL_COLUMNS` keeps
off the wire, and the stamp is what decides which copy wins against a peer's. The launch pass
that fills in calendar server ids (#2950) would otherwise have made every row holding an event
read as edited just now, at launch, which is exactly when a peer's edits made while the app was
closed haven't arrived yet: the next sync would have put this device's stale copy over each of
them. `dbFillTaskCalendarExternalIds` reads `updated_at` first and writes it back after, which
the trigger lets through. A one-row write that follows a real local edit (a reconcile writing
back the event id it just got) doesn't need this, since that row genuinely changed here.
