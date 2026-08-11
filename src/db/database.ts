import * as SQLite from 'expo-sqlite';
import type { Task, Category, GroceryItem, ItemShopLink, MealPlanEntry, MealSlot, Recipe, Shop, TaskGroup, Project, ProjectCategory, TaskTemplate, TemplateCategory, TemplateContainer, TemplateItem, TemplateItemGroup, TimeOfDay } from '../types';
import { DEFAULT_NUDGE_CADENCE_DAYS, MEAL_SLOTS } from '../types';
import { generateId } from '../utils/id';
import { parseChainItems } from '../utils/chain';
import { parseRecipeIngredients, parsePrepTasks } from '../utils/recipeUtils';
import { normalizeTemplateItem } from '../utils/templateUtils';
import { projectRow, REDACTED_SETTING_KEYS, type BackupRow } from '../utils/backup';

function parseTimeSegments(raw: unknown): TimeOfDay[] {
  if (!raw) return [];
  const s = raw as string;
  if (s.startsWith('[')) {
    try { return JSON.parse(s) as TimeOfDay[]; } catch { return []; }
  }
  return [s as TimeOfDay];
}

// Deliberately more forgiving than series_defaults' bare JSON.parse one row
// below: a suggestion nobody has approved yet is recoverable (the reminder is
// gone, but the title still says what the user asked for), whereas a throw in
// here takes the whole task row — and every row after it — down with it. Drop
// the chip, keep the task.
function parsePendingImport(raw: unknown): Partial<Task> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw as string) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Partial<Task>;
  } catch {
    return null;
  }
}

const REAL_DB_NAME = 'todo.db';
const DEMO_DB_NAME = 'demo.db';

const realDb = SQLite.openDatabaseSync(REAL_DB_NAME);

// Every db* function below reads this binding at call time rather than
// capturing a handle, which is what lets demo mode swap the whole data
// source out from under the stores (see useDemoStore): point `db` at a
// throwaway file, re-run initDatabase() + each store's initialize(), and
// the entire app is reading demo data with no other code involved. The real
// handle is never closed, so switching back is just a reassignment.
let db = realDb;

// Opens a blank demo database, deleting any file left behind by a previous
// session that was killed mid-demo (the active-demo flag lives in memory
// only, so a crash always lands back on real data — at worst with a stale
// file that this call clears). Caller is responsible for running
// initDatabase() afterwards to create the tables.
export function switchToDemoDatabase(): void {
  if (db !== realDb) return;
  try {
    SQLite.deleteDatabaseSync(DEMO_DB_NAME);
  } catch {
    // No such file — the normal case.
  }

  const demo = SQLite.openDatabaseSync(DEMO_DB_NAME);
  // Wipe whatever the file still holds, rather than trusting the delete
  // above to have emptied it: deleteDatabaseSync removes only the main file
  // and leaves any -wal/-shm sidecar behind, and it throws outright if the
  // database is still open — both of which fail silently here and would
  // otherwise show up as one demo's leftovers appearing in the next. Written
  // against `demo` and not `db` so it can't reach real data even by mistake.
  const tables = demo.getAllSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  for (const { name } of tables) {
    demo.execSync(`DROP TABLE IF EXISTS "${name}"`);
  }

  db = demo;
}

// Points every db* function back at the user's real data and destroys the
// demo file, so nothing written during a demo survives it.
export function switchToRealDatabase(): void {
  if (db === realDb) return;
  const demo = db;
  db = realDb;
  try {
    demo.closeSync();
  } catch {
    // Already closed — nothing to do, the swap above is what matters.
  }
  try {
    SQLite.deleteDatabaseSync(DEMO_DB_NAME);
  } catch {
    // Best effort: a file we failed to delete is inert (it's only ever read
    // while demo mode is on, and entering demo mode deletes it first).
  }
}

export function isUsingDemoDatabase(): boolean {
  return db !== realDb;
}

export function initDatabase(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      seen_at TEXT,
      due_date TEXT,
      defer_until TEXT,
      time_of_day TEXT,
      window_start TEXT,
      window_end TEXT,
      recurrence_type TEXT NOT NULL DEFAULT 'none',
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      recurrence_days TEXT NOT NULL DEFAULT '[]',
      recurrence_end_date TEXT,
      recurrence_count INTEGER,
      recurrence_from_completion INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order REAL NOT NULL DEFAULT 0,
      focused INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      effort INTEGER NOT NULL DEFAULT 0,
      estimated_minutes INTEGER,
      streak_count INTEGER NOT NULL DEFAULT 0,
      streak_date TEXT,
      parent_id TEXT,
      reminder_time TEXT,
      reminder_kind TEXT,
      cycle_enabled INTEGER NOT NULL DEFAULT 0,
      cycle_index INTEGER NOT NULL DEFAULT 0,
      cycle_items TEXT NOT NULL DEFAULT '[]',
      timer_started_at TEXT,
      actual_minutes INTEGER,
      previous_occurrence_id TEXT,
      group_id TEXT
    );

    CREATE TABLE IF NOT EXISTS task_groups (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      target_start_date TEXT,
      target_end_date TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      schedule_days TEXT,
      schedule_start TEXT,
      schedule_end TEXT,
      sort_order REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      sort_order REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS template_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      sort_order REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      sort_order REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS grocery_items (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      aisle TEXT NOT NULL DEFAULT 'Other',
      quantity TEXT,
      note TEXT NOT NULL DEFAULT '',
      on_list INTEGER NOT NULL DEFAULT 1,
      checked INTEGER NOT NULL DEFAULT 0,
      sort_order REAL NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      purchase_count INTEGER NOT NULL DEFAULT 0,
      last_added_at TEXT,
      last_purchased_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grocery_shops (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Which stores an item has been bought at, as counters rather than a row
    -- per trip. See ItemShopLink in types for why, and for the invariant that
    -- these counts are partial while grocery_items.purchase_count is the total.
    CREATE TABLE IF NOT EXISTS grocery_item_shops (
      item_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      purchase_count INTEGER NOT NULL DEFAULT 0,
      last_purchased_at TEXT,
      PRIMARY KEY (item_id, shop_id)
    );

    -- A dish, and what it takes to shop for it. The ingredients column is a
    -- JSON array rather than its own table for the reason templates.items is
    -- one: nothing outside this row holds an ingredient's id. See Recipe in
    -- types for the rest of the reasoning.
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      servings INTEGER,
      ingredients TEXT NOT NULL DEFAULT '[]',
      favorite INTEGER NOT NULL DEFAULT 0,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- One thing planned for one meal of one day. The date column holds a
    -- YYYY-MM-DD local day key, not an ISO instant like every other date in this
    -- schema — see MealPlanEntry in types for why, and for why recipe_id has no
    -- cascade when a recipe is deleted.
    -- No UNIQUE(date, slot): two things on one dinner is real.
    CREATE TABLE IF NOT EXISTS meal_plan_entries (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      slot TEXT NOT NULL,
      recipe_id TEXT,
      title TEXT NOT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Migrations for existing installs (safe to run multiple times — fails silently if column exists)
  const migrations = [
    'ALTER TABLE tasks ADD COLUMN focused INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN effort INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN streak_date TEXT',
    'ALTER TABLE tasks ADD COLUMN recurrence_from_completion INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN parent_id TEXT',
    'ALTER TABLE tasks ADD COLUMN reminder_time TEXT',
    'ALTER TABLE tasks ADD COLUMN cycle_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN cycle_index INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE tasks ADD COLUMN cycle_items TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE tasks ADD COLUMN time_of_day TEXT',
    'ALTER TABLE tasks ADD COLUMN category TEXT',
    'ALTER TABLE tasks ADD COLUMN vacation_pause INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER',
    'ALTER TABLE categories ADD COLUMN hide_on_vacation INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN recurrence_count INTEGER',
    'ALTER TABLE tasks ADD COLUMN timer_started_at TEXT',
    'ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER',
    'ALTER TABLE tasks ADD COLUMN window_start TEXT',
    'ALTER TABLE tasks ADD COLUMN window_end TEXT',
    'ALTER TABLE tasks ADD COLUMN previous_occurrence_id TEXT',
    'ALTER TABLE tasks ADD COLUMN seen_at TEXT',
    'ALTER TABLE tasks ADD COLUMN deadline TEXT',
    'ALTER TABLE categories ADD COLUMN sort_order REAL NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN previous_streak_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN previous_streak_date TEXT',
    'ALTER TABLE tasks ADD COLUMN series_defaults TEXT',
    'ALTER TABLE tasks ADD COLUMN deadline_offset_days INTEGER',
    'ALTER TABLE tasks ADD COLUMN group_id TEXT',
    'ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN archived_at TEXT',
    'ALTER TABLE categories ADD COLUMN emoji TEXT',
    'ALTER TABLE tasks ADD COLUMN project_id TEXT',
    'ALTER TABLE projects ADD COLUMN category TEXT',
    'ALTER TABLE tasks ADD COLUMN recurrence_month_day INTEGER',
    "ALTER TABLE templates ADD COLUMN item_groups TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN deadline_month_day INTEGER',
    'ALTER TABLE tasks ADD COLUMN recurrence_week_ordinal INTEGER',
    'ALTER TABLE tasks ADD COLUMN link_url TEXT',
    'ALTER TABLE templates ADD COLUMN category TEXT',
    'ALTER TABLE task_groups ADD COLUMN completed_at TEXT',
    'ALTER TABLE categories ADD COLUMN exclude_from_pin_suggestions INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN target_count INTEGER',
    'ALTER TABLE tasks ADD COLUMN progress_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN series_id TEXT',
    "ALTER TABLE tasks ADD COLUMN series_month_days TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE tasks ADD COLUMN series_repeat_months INTEGER NOT NULL DEFAULT 1',
    'CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id)',
    'ALTER TABLE tasks ADD COLUMN timed_minutes INTEGER',
    'ALTER TABLE tasks ADD COLUMN timer_elapsed_seconds INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN show_streak INTEGER NOT NULL DEFAULT 0',
    // Existing templates default to 'stack' rather than 'none': the setting is
    // inert until the user names a run in the apply sheet, so this changes
    // nothing for anyone until they opt in, and 'stack' is the right answer
    // for most templates when they do.
    "ALTER TABLE templates ADD COLUMN apply_container TEXT NOT NULL DEFAULT 'stack'",
    // 0 = never, matching DEFAULT_NUDGE_CADENCE_DAYS: a project that predates
    // the nudge feature has never been asked whether it wants chasing, and
    // answering yes on its behalf is how the feature starts by nagging about
    // projects nobody opted in. It shipped as DEFAULT 14 and rows written by
    // that version keep their 14 — this only decides what a device that hasn't
    // run the migration yet backfills.
    'ALTER TABLE projects ADD COLUMN nudge_cadence_days INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE projects ADD COLUMN auto_schedule INTEGER NOT NULL DEFAULT 0',
    // Nullable rather than defaulted: null *is* the meaningful value here
    // ("waiting on nothing"), and every existing row wants it.
    'ALTER TABLE tasks ADD COLUMN blocked_by_id TEXT',
    // Nullable for the same reason, and read through parseTimeSegments so it
    // shares the tasks column's tolerance for the legacy plain-string format.
    'ALTER TABLE categories ADD COLUMN default_time_segments TEXT',
    'ALTER TABLE tasks ADD COLUMN reminder_kind TEXT',
    // Named chain_* rather than cycle_* like its three siblings: those keep the
    // pre-rename name only because renaming them needs a data migration for
    // existing installs (see rowToTask). A new column has no such cost, so it
    // gets the name the feature actually has. Defaults to 0 = "right away",
    // which is how every chain has always behaved.
    'ALTER TABLE tasks ADD COLUMN chain_step_on_schedule INTEGER NOT NULL DEFAULT 0',
    // The grocery catalog's no-duplicates guarantee, and it lives here rather
    // than in a store method a future call site could bypass. The index is a
    // migration while the table itself is in the CREATE block above — same
    // split as idx_tasks_parent_id, and it means a device that got the table
    // from an earlier build still picks the index up.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_items_name_key ON grocery_items(name_key)',
    'CREATE INDEX IF NOT EXISTS idx_grocery_items_on_list ON grocery_items(on_list)',
    // Same reasoning as idx_grocery_items_name_key: the no-two-spellings-of-one
    // -store guarantee belongs in SQLite, not in a store method a future call
    // site could go around.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_shops_name_key ON grocery_shops(name_key)',
    // The store → items read (the Buy again filter). item → shops needs no
    // index: it's the leading column of the primary key.
    'CREATE INDEX IF NOT EXISTS idx_grocery_item_shops_shop ON grocery_item_shops(shop_id)',
    // Nullable, and null is the value every existing row wants: a task nobody
    // imported from Reminders has no suggestion pending. JSON, like
    // series_defaults, because it holds a Partial<Task> rather than a scalar.
    'ALTER TABLE tasks ADD COLUMN pending_import TEXT',
    // Null for every existing row, which is exactly right: nothing completed
    // before this shipped was a miss. See Task.missedAt for why a missed row
    // is stored as a completed one.
    'ALTER TABLE tasks ADD COLUMN missed_at TEXT',
    // Null for every existing row, and that reads correctly: a date already on
    // a task when this shipped is one the user is presumed to have set, so no
    // row starts out narrating itself. See Task.autoScheduledAt.
    'ALTER TABLE tasks ADD COLUMN auto_scheduled_at TEXT',
    // 0 for every existing project, and that's the only safe backfill: turning
    // it on hides every member but the first, and no existing project's order
    // was ever entered as a sequence.
    'ALTER TABLE projects ADD COLUMN sequential INTEGER NOT NULL DEFAULT 0',
    // Defaults to 1, and that's the only safe value for an existing install:
    // every row already on a device predates the provisional idea, so all of
    // them are catalog members and none may be deleted out from under a
    // "Remove from list". New rows pass the flag explicitly (see
    // dbInsertGroceryItem), so the default only ever applies to history.
    'ALTER TABLE grocery_items ADD COLUMN in_catalog INTEGER NOT NULL DEFAULT 1',
    // Null for every existing target, which is exactly the old behaviour: no
    // unit means the meter keeps reading as the bare "5/12" it always has.
    'ALTER TABLE tasks ADD COLUMN target_unit TEXT',
    // Where the no-duplicate-recipes guarantee actually lives, same as
    // idx_grocery_items_name_key does for the catalog.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_name_key ON recipes(name_key)',
    // Nullable like link_url, and null is what every existing row wants: no
    // task written before this shipped has a number to call.
    'ALTER TABLE tasks ADD COLUMN phone_number TEXT',
    // Null for every existing recipe — no recipe written before this shipped
    // had a place to say who it's from. See Recipe.sourceName.
    'ALTER TABLE recipes ADD COLUMN source_name TEXT',
    // Every read of this table is "give me the entries between two day keys" —
    // the week on screen, and the purge horizon. Nothing ever asks for an entry
    // by recipe, so there's no second index here.
    'CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_date ON meal_plan_entries(date)',
    // Null for every existing row is exactly right: nothing predating this has
    // been asserted as on hand. See GroceryItem.onHandUntil.
    'ALTER TABLE grocery_items ADD COLUMN on_hand_until TEXT',
    // Empty array for every existing recipe — no recipe written before this
    // shipped had prep steps to carry. See Recipe.prepTasks.
    "ALTER TABLE recipes ADD COLUMN prep_tasks TEXT NOT NULL DEFAULT '[]'",
    // Zero/null for every existing recipe and entry — nothing predating this
    // has ever been marked cooked. See Recipe.cookCount/lastCookedAt and
    // MealPlanEntry.cookedAt.
    'ALTER TABLE recipes ADD COLUMN cook_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE recipes ADD COLUMN last_cooked_at TEXT',
    'ALTER TABLE meal_plan_entries ADD COLUMN cooked_at TEXT',
    // Nullable like phone_number, and null is what every existing row wants:
    // no task written before this shipped has an address to email.
    'ALTER TABLE tasks ADD COLUMN email_address TEXT',
    // See GroceryItem.sourceRecipeId/sourceRecipeTitle — both null on every
    // existing row, same as an item typed by hand always will be.
    'ALTER TABLE grocery_items ADD COLUMN source_recipe_id TEXT',
    'ALTER TABLE grocery_items ADD COLUMN source_recipe_title TEXT',
    // 0 for every existing store — nothing predating this feature was ever
    // meant to drop out of suggestions. Same naming convention as
    // categories' exclude_from_pin_suggestions.
    'ALTER TABLE grocery_shops ADD COLUMN exclude_from_suggestions INTEGER NOT NULL DEFAULT 0',
    // Null for every existing recipe — splits the old single sourceName
    // attribution into author/source (#1266). Not backfilled from
    // source_name: an old value can't be reliably assigned to one or the
    // other, so old recipes just keep reading their legacy column until
    // edited. See Recipe.author/Recipe.source.
    'ALTER TABLE recipes ADD COLUMN author TEXT',
    'ALTER TABLE recipes ADD COLUMN source TEXT',
    // Cook timer + actual-time logging (#1091). Null/zero for every existing
    // recipe — nothing predating this shipped has a duration or a timed
    // session. estimated_minutes doubles as the cook timer's countdown
    // target; timer_started_at/timer_elapsed_seconds are the banked-segment
    // pair Task.timerStartedAt/timerElapsedSeconds already use. The logged
    // actual time is an aggregate, not a per-session table — see
    // Recipe.lastCookMinutes/cookTimeCount/totalCookMinutes for why.
    'ALTER TABLE recipes ADD COLUMN estimated_minutes INTEGER',
    'ALTER TABLE recipes ADD COLUMN timer_started_at TEXT',
    'ALTER TABLE recipes ADD COLUMN timer_elapsed_seconds INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE recipes ADD COLUMN last_cook_minutes INTEGER',
    'ALTER TABLE recipes ADD COLUMN cook_time_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE recipes ADD COLUMN total_cook_minutes INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { db.runSync(sql); } catch (_) { /* column already exists */ }
  }

  // Backfill seen_at for tasks that predate the "new" dot feature so they
  // don't all light up as new the moment this ships — treat them as already
  // seen as of their creation. New rows always insert with seen_at set, so
  // this only ever touches legacy rows and is a no-op after the first run.
  try { db.runSync('UPDATE tasks SET seen_at = created_at WHERE seen_at IS NULL'); } catch (_) {}

  // One-time migration: populate categories table from legacy category_registry setting
  const catCount = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM categories')?.n ?? 0;
  if (catCount === 0) {
    const registry = dbGetCategoryRegistry();
    for (const name of registry) {
      try {
        db.runSync('INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)', [generateId(), name]);
      } catch (_) {}
    }
  }

  // One-time migration: projects previously stored a category name drawn from
  // the shared task-category pool (see `categories` table). Now that projects
  // have their own separate category pool, seed project_categories with
  // whatever names existing projects were already using so they don't lose
  // their assignment.
  const projCatCount = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM project_categories')?.n ?? 0;
  if (projCatCount === 0) {
    const rows = db.getAllSync<{ category: string }>(
      "SELECT DISTINCT category FROM projects WHERE category IS NOT NULL AND category != ''"
    );
    rows.forEach((row, i) => {
      try { db.runSync('INSERT OR IGNORE INTO project_categories (id, name, sort_order) VALUES (?, ?, ?)', [generateId(), row.category, i + 1]); } catch (_) {}
    });
  }

  // One-time migration: give existing categories a stable sort_order (their
  // prior alphabetical position) so introducing manual reordering doesn't
  // reshuffle everyone's existing category list.
  if (dbGetSetting('category_sort_order_migration_done') !== '1') {
    const rows = db.getAllSync<{ id: string }>('SELECT id FROM categories ORDER BY name ASC');
    rows.forEach((row, i) => {
      try { db.runSync('UPDATE categories SET sort_order = ? WHERE id = ?', [i + 1, row.id]); } catch (_) {}
    });
    dbSetSetting('category_sort_order_migration_done', '1');
  }

  // One-time migration: collapse all existing task groups by default.
  if (dbGetSetting('task_groups_collapsed_default_done') !== '1') {
    try { db.runSync('UPDATE task_groups SET collapsed = 1'); } catch (_) {}
    dbSetSetting('task_groups_collapsed_default_done', '1');
  }

  // One-time migration: introducing the XXS bucket at effort=1 shifts every
  // existing preset (previously XS=1..XL=5) up by one, so XS=2..XL=6. Bump
  // stored values so old tasks/templates keep their original size.
  if (dbGetSetting('effort_xxs_migration_done') !== '1') {
    try { db.runSync('UPDATE tasks SET effort = effort + 1 WHERE effort >= 1'); } catch (_) {}
    const templateRows = db.getAllSync<{ id: string; items: string }>('SELECT id, items FROM templates');
    for (const row of templateRows) {
      try {
        const items = JSON.parse(row.items ?? '[]') as Array<Record<string, unknown>>;
        let changed = false;
        const shifted = items.map(item => {
          const e = item.effort as number | undefined;
          if (typeof e === 'number' && e >= 1) { changed = true; return { ...item, effort: e + 1 }; }
          return item;
        });
        if (changed) db.runSync('UPDATE templates SET items = ? WHERE id = ?', [JSON.stringify(shifted), row.id]);
      } catch (_) {}
    }
    dbSetSetting('effort_xxs_migration_done', '1');
  }

  // One-time migration: the "focus" feature was renamed to "pin" — carry
  // over any tasks that were focused into the new pinned column. The old
  // focused column is left in place, unused, rather than dropped.
  if (dbGetSetting('pinned_backfill_from_focused_done') !== '1') {
    try { db.runSync('UPDATE tasks SET pinned = focused WHERE focused = 1'); } catch (_) {}
    dbSetSetting('pinned_backfill_from_focused_done', '1');
  }

  // One-time migration: a stack now owns its members' category (see
  // applyGroupCategory in useTaskStore), but until this shipped only tasks
  // created *inside* a stack inherited it — anything dragged or bulk-grouped
  // in kept whatever it had. Bring existing members in line so the rule holds
  // for the stacks that already exist, not just the ones made from here on.
  //
  // Live rows only. A completed occurrence is history: it was finished under
  // the category it had at the time, and the Logbook and the by-category
  // stats should keep saying so. That matches every other stack cascade,
  // which is roster-scoped for the same reason.
  if (dbGetSetting('stack_category_ownership_backfill_done') !== '1') {
    try {
      db.runSync(`
        UPDATE tasks SET category = (
          SELECT category FROM task_groups WHERE task_groups.id = tasks.group_id
        )
        WHERE group_id IS NOT NULL
          AND completed = 0
          AND EXISTS (SELECT 1 FROM task_groups WHERE task_groups.id = tasks.group_id)
      `);
    } catch (_) {}
    dbSetSetting('stack_category_ownership_backfill_done', '1');
  }
}

// ─── Backup / restore ────────────────────────────────────────────────────────

/**
 * Every table a backup carries, and the only tables restore touches.
 *
 * Spelled out rather than discovered from sqlite_master so that the SQL below
 * never interpolates a name that didn't come from this file, and so a table
 * added later is an explicit decision to include — a new table quietly missing
 * from backups is a much worse failure than one quietly missing from this list,
 * because it only shows up when someone restores.
 *
 * Order matters on the way in: nothing here declares a foreign key, but rows
 * are inserted parents-first anyway so a future constraint doesn't turn this
 * into a debugging session.
 */
export const BACKUP_TABLES = [
  'categories',
  'project_categories',
  'template_categories',
  'projects',
  'task_groups',
  'grocery_shops',
  'grocery_items',
  'grocery_item_shops',
  'recipes',
  'meal_plan_entries',
  'templates',
  'tasks',
  'settings',
] as const;

/** The live column names of a table, straight from the schema. */
export function dbTableColumns(table: string): string[] {
  return db.getAllSync<{ name: string }>(`PRAGMA table_info("${table}")`).map(r => r.name);
}

/** Every row of every backed-up table, exactly as stored. */
export function dbExportTables(): Record<string, BackupRow[]> {
  const out: Record<string, BackupRow[]> = {};
  for (const table of BACKUP_TABLES) {
    out[table] = db.getAllSync<BackupRow>(`SELECT * FROM "${table}"`);
  }
  return out;
}

/**
 * Replaces the contents of every backed-up table with the given rows.
 *
 * One transaction on purpose: a restore that half-applied would leave tasks
 * pointing at categories and projects that no longer exist, which is a worse
 * state than either the old data or the new. Either the whole file lands or
 * nothing does and the user still has what they had.
 *
 * Columns are intersected with the live schema by projectRow before they reach
 * any SQL — see the note there; that intersection is what makes it safe to
 * build these statements from names that came out of a file.
 */
export function dbReplaceAllData(tables: Record<string, BackupRow[]>): void {
  // The settings a backup deliberately doesn't carry are device-local, not
  // part of what a backup describes — so a restore has no business deleting
  // them either. Without this the API key is wiped by restoring, and because
  // it was redacted on the way out there is nothing in the file to put back:
  // the user silently loses a credential they never exported.
  const preserved = db.getAllSync<BackupRow>(
    `SELECT * FROM settings WHERE key IN (${REDACTED_SETTING_KEYS.map(() => '?').join(', ')})`,
    [...REDACTED_SETTING_KEYS]
  );

  db.withTransactionSync(() => {
    // Cleared in reverse, children first, for the same reason rows go back in
    // parents-first.
    for (const table of [...BACKUP_TABLES].reverse()) {
      db.runSync(`DELETE FROM "${table}"`);
    }

    for (const table of BACKUP_TABLES) {
      const rows = tables[table];
      if (!rows || rows.length === 0) continue;
      const allowed = dbTableColumns(table);

      for (const raw of rows) {
        const row = projectRow(raw, allowed);
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const quoted = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        db.runSync(
          `INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${placeholders})`,
          columns.map(c => row[c])
        );
      }
    }

    // Put the device-local settings back. After the inserts, so a backup that
    // somehow does carry one of these keys still loses to what's on the device.
    for (const row of preserved) {
      db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [row.key, row.value]);
    }
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function dbGetSetting(key: string): string | null {
  return db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}

export function dbSetSetting(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Removes a setting outright, rather than blanking it the way the nullable
 * settings do. Only one caller wants this: moving the API key to the keychain
 * has to leave *no* row behind, and an empty string is still a row holding the
 * name of a credential this app used to keep in plaintext.
 */
export function dbDeleteSetting(key: string): void {
  db.runSync('DELETE FROM settings WHERE key = ?', [key]);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: row.notes as string,
    completed: Boolean(row.completed),
    completedAt: (row.completed_at as string) ?? null,
    missedAt: (row.missed_at as string) ?? null,
    autoScheduledAt: (row.auto_scheduled_at as string) ?? null,
    createdAt: row.created_at as string,
    seenAt: (row.seen_at as string) ?? null,
    dueDate: (row.due_date as string) ?? null,
    deadline: (row.deadline as string) ?? null,
    deadlineOffsetDays: (row.deadline_offset_days as number | null) ?? null,
    deadlineMonthDay: (row.deadline_month_day as number | null) ?? null,
    deferUntil: (row.defer_until as string) ?? null,
    timeSegments: parseTimeSegments(row.time_of_day),
    windowStart: (row.window_start as string) ?? null,
    windowEnd: (row.window_end as string) ?? null,
    recurrenceType: (row.recurrence_type as Task['recurrenceType']) ?? 'none',
    recurrenceInterval: (row.recurrence_interval as number) ?? 1,
    recurrenceDays: JSON.parse((row.recurrence_days as string) ?? '[]') as number[],
    recurrenceMonthDay: (row.recurrence_month_day as number | null) ?? null,
    recurrenceWeekOrdinal: (row.recurrence_week_ordinal as number | null) ?? null,
    recurrenceEndDate: (row.recurrence_end_date as string) ?? null,
    recurrenceCount: (row.recurrence_count as number | null) ?? null,
    recurrenceFromCompletion: Boolean(row.recurrence_from_completion),
    targetCount: (row.target_count as number | null) ?? null,
    progressCount: (row.progress_count as number) ?? 0,
    targetUnit: (row.target_unit as string | null) ?? null,
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    pinned: Boolean(row.pinned),
    priority: ((row.priority as number) ?? 0) as Task['priority'],
    effort: ((row.effort as number) ?? 0) as Task['effort'],
    estimatedMinutes: (row.estimated_minutes as number | null) ?? null,
    streakCount: (row.streak_count as number) ?? 0,
    streakDate: (row.streak_date as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    groupId: (row.group_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    reminderTime: (row.reminder_time as string) ?? null,
    reminderKind: ((row.reminder_kind as Task['reminderKind']) ?? 'notification'),
    // Column names stay cycle_* — this is the pre-rename "Cycle" feature
    // (now "Chain") and renaming the columns would need a data migration
    // for existing installs. The JS-facing field names are the new ones.
    chainEnabled: Boolean(row.cycle_enabled),
    chainIndex: (row.cycle_index as number) ?? 0,
    chainItems: parseChainItems(JSON.parse((row.cycle_items as string) ?? '[]')),
    chainStepOnSchedule: Boolean(row.chain_step_on_schedule),
    vacationPause: Boolean(row.vacation_pause),
    timerStartedAt: (row.timer_started_at as string | null) ?? null,
    actualMinutes: (row.actual_minutes as number | null) ?? null,
    timedMinutes: (row.timed_minutes as number | null) ?? null,
    timerElapsedSeconds: (row.timer_elapsed_seconds as number | null) ?? 0,
    previousOccurrenceId: (row.previous_occurrence_id as string | null) ?? null,
    seriesId: (row.series_id as string | null) ?? null,
    seriesMonthDays: JSON.parse((row.series_month_days as string) ?? '[]') as number[],
    seriesRepeatMonths: (row.series_repeat_months as number) ?? 1,
    previousStreakCount: (row.previous_streak_count as number) ?? 0,
    previousStreakDate: (row.previous_streak_date as string) ?? null,
    showStreak: Boolean(row.show_streak),
    seriesDefaults: row.series_defaults ? (JSON.parse(row.series_defaults as string) as Partial<Task>) : null,
    archived: Boolean(row.archived),
    archivedAt: (row.archived_at as string) ?? null,
    linkUrl: (row.link_url as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    emailAddress: (row.email_address as string) ?? null,
    blockedById: (row.blocked_by_id as string | null) ?? null,
    pendingImport: parsePendingImport(row.pending_import),
  };
}

export function dbGetAllTasks(): Task[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM tasks ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToTask);
}

export function dbInsertTask(task: Task): void {
  db.runSync(
    `INSERT INTO tasks (
      id, title, notes, completed, completed_at, created_at, seen_at,
      due_date, deadline, deadline_offset_days, deadline_month_day, defer_until, time_of_day, window_start, window_end,
      recurrence_type, recurrence_interval, recurrence_days, recurrence_month_day, recurrence_week_ordinal, recurrence_end_date, recurrence_count, recurrence_from_completion,
      tags, category, sort_order, pinned, priority, effort, estimated_minutes, streak_count, streak_date, parent_id, reminder_time,
      cycle_enabled, cycle_index, cycle_items, vacation_pause, timer_started_at, actual_minutes, previous_occurrence_id,
      previous_streak_count, previous_streak_date, series_defaults, group_id, archived, archived_at, project_id, link_url,
      timed_minutes, timer_elapsed_seconds, target_count, progress_count, series_id, series_month_days, series_repeat_months,
      show_streak, blocked_by_id, reminder_kind, chain_step_on_schedule, pending_import, missed_at, auto_scheduled_at,
      target_unit, phone_number, email_address
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.id, task.title, task.notes, task.completed ? 1 : 0,
      task.completedAt, task.createdAt, task.seenAt, task.dueDate, task.deadline, task.deadlineOffsetDays ?? null, task.deadlineMonthDay ?? null, task.deferUntil,
      task.timeSegments.length ? JSON.stringify(task.timeSegments) : null, task.windowStart, task.windowEnd,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceMonthDay ?? null, task.recurrenceWeekOrdinal ?? null, task.recurrenceEndDate, task.recurrenceCount,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.category ?? null, task.sortOrder,
      task.pinned ? 1 : 0, task.priority, task.effort, task.estimatedMinutes ?? null,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.chainEnabled ? 1 : 0, task.chainIndex, JSON.stringify(task.chainItems),
      task.vacationPause ? 1 : 0, task.timerStartedAt ?? null, task.actualMinutes ?? null,
      task.previousOccurrenceId ?? null,
      task.previousStreakCount, task.previousStreakDate,
      task.seriesDefaults ? JSON.stringify(task.seriesDefaults) : null,
      task.groupId ?? null,
      task.archived ? 1 : 0, task.archivedAt ?? null,
      task.projectId ?? null,
      task.linkUrl ?? null,
      task.timedMinutes ?? null, task.timerElapsedSeconds ?? 0,
      task.targetCount ?? null, task.progressCount,
      task.seriesId ?? null, JSON.stringify(task.seriesMonthDays), task.seriesRepeatMonths,
      task.showStreak ? 1 : 0,
      task.blockedById ?? null,
      task.reminderKind,
      task.chainStepOnSchedule ? 1 : 0,
      task.pendingImport ? JSON.stringify(task.pendingImport) : null,
      task.missedAt ?? null,
      task.autoScheduledAt ?? null,
      task.targetUnit ?? null,
      task.phoneNumber ?? null,
      task.emailAddress ?? null,
    ]
  );
}

export function dbUpdateTask(task: Task): void {
  db.runSync(
    `UPDATE tasks SET
      title=?, notes=?, completed=?, completed_at=?, seen_at=?,
      due_date=?, deadline=?, deadline_offset_days=?, deadline_month_day=?, defer_until=?, time_of_day=?, window_start=?, window_end=?,
      recurrence_type=?, recurrence_interval=?, recurrence_days=?, recurrence_month_day=?, recurrence_week_ordinal=?, recurrence_end_date=?, recurrence_count=?, recurrence_from_completion=?,
      tags=?, category=?, sort_order=?, pinned=?, priority=?, effort=?, estimated_minutes=?,
      streak_count=?, streak_date=?, parent_id=?, reminder_time=?,
      cycle_enabled=?, cycle_index=?, cycle_items=?, vacation_pause=?, timer_started_at=?, actual_minutes=?,
      previous_occurrence_id=?, previous_streak_count=?, previous_streak_date=?, series_defaults=?, group_id=?,
      archived=?, archived_at=?, project_id=?, link_url=?,
      timed_minutes=?, timer_elapsed_seconds=?, target_count=?, progress_count=?, series_id=?, series_month_days=?, series_repeat_months=?,
      show_streak=?, blocked_by_id=?, reminder_kind=?, chain_step_on_schedule=?, pending_import=?, missed_at=?, auto_scheduled_at=?,
      target_unit=?, phone_number=?, email_address=?
    WHERE id=?`,
    [
      task.title, task.notes, task.completed ? 1 : 0, task.completedAt, task.seenAt,
      task.dueDate, task.deadline, task.deadlineOffsetDays ?? null, task.deadlineMonthDay ?? null, task.deferUntil, task.timeSegments.length ? JSON.stringify(task.timeSegments) : null,
      task.windowStart, task.windowEnd,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceMonthDay ?? null, task.recurrenceWeekOrdinal ?? null, task.recurrenceEndDate, task.recurrenceCount,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.category ?? null, task.sortOrder,
      task.pinned ? 1 : 0, task.priority, task.effort, task.estimatedMinutes ?? null,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.chainEnabled ? 1 : 0, task.chainIndex, JSON.stringify(task.chainItems),
      task.vacationPause ? 1 : 0, task.timerStartedAt ?? null, task.actualMinutes ?? null,
      task.previousOccurrenceId ?? null,
      task.previousStreakCount, task.previousStreakDate,
      task.seriesDefaults ? JSON.stringify(task.seriesDefaults) : null,
      task.groupId ?? null,
      task.archived ? 1 : 0, task.archivedAt ?? null,
      task.projectId ?? null,
      task.linkUrl ?? null,
      task.timedMinutes ?? null, task.timerElapsedSeconds ?? 0,
      task.targetCount ?? null, task.progressCount,
      task.seriesId ?? null, JSON.stringify(task.seriesMonthDays), task.seriesRepeatMonths,
      task.showStreak ? 1 : 0,
      task.blockedById ?? null,
      task.reminderKind,
      task.chainStepOnSchedule ? 1 : 0,
      task.pendingImport ? JSON.stringify(task.pendingImport) : null,
      task.missedAt ?? null,
      task.autoScheduledAt ?? null,
      task.targetUnit ?? null,
      task.phoneNumber ?? null,
      task.emailAddress ?? null,
      task.id,
    ]
  );
}

export function dbMarkTaskSeen(id: string, seenAt: string): void {
  db.runSync('UPDATE tasks SET seen_at = ? WHERE id = ?', [seenAt, id]);
}

export function dbBatchUpdateSortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE tasks SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

export function dbDeleteTask(id: string): void {
  db.runSync('DELETE FROM tasks WHERE id = ?', [id]);
}

export function dbDeleteSubtasks(parentId: string): void {
  db.runSync('DELETE FROM tasks WHERE parent_id = ?', [parentId]);
}

export function dbClearAllPins(): void {
  db.runSync('UPDATE tasks SET pinned = 0 WHERE pinned = 1');
}

// Lets a store-level cascade (looping a single-task action like completeTask
// or deleteTask over many ids) commit as one WAL transaction instead of one
// per iteration. Safe to wrap around any of dbInsertTask/dbUpdateTask/
// dbDeleteTask/dbDeleteSubtasks — all plain runSync — but never around a
// dbBulk* function below, which already opens its own transaction and would
// nest.
export function dbTransaction(fn: () => void): void {
  db.withTransactionSync(fn);
}

const BULK_DELETE_CHUNK_SIZE = 500;

export function dbBulkDeleteTasks(ids: string[]): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (let i = 0; i < ids.length; i += BULK_DELETE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + BULK_DELETE_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      db.runSync(`DELETE FROM tasks WHERE parent_id IN (${placeholders})`, chunk);
      db.runSync(`DELETE FROM tasks WHERE id IN (${placeholders})`, chunk);
    }
  });
}

export function dbBulkSetPriority(ids: string[], priority: number): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET priority = ? WHERE id = ?', [priority, id]);
    }
  });
}

export function dbBulkSetDefer(ids: string[], deferUntil: string): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET defer_until = ? WHERE id = ?', [deferUntil, id]);
    }
  });
}

export function dbBulkSetWhen(ids: string[], dueDate: string | null, timeSegments: TimeOfDay[]): void {
  if (ids.length === 0) return;
  const timeOfDay = timeSegments.length ? JSON.stringify(timeSegments) : null;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET due_date = ?, time_of_day = ? WHERE id = ?', [dueDate, timeOfDay, id]);
    }
  });
}

// Deliberately not dbBulkSetWhen with a null date: that one writes due_date
// too, so reusing it to change a time-of-day would unschedule every task it
// touched. The whole point of this one is that it moves the segment and
// nothing else.
export function dbBulkSetTimeSegments(ids: string[], timeSegments: TimeOfDay[]): void {
  if (ids.length === 0) return;
  const timeOfDay = timeSegments.length ? JSON.stringify(timeSegments) : null;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET time_of_day = ? WHERE id = ?', [timeOfDay, id]);
    }
  });
}

export function dbBulkSetCategory(ids: string[], category: string | null): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET category = ? WHERE id = ?', [category, id]);
    }
  });
}

export function dbBulkSetPinned(ids: string[], pinned: boolean): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id]);
    }
  });
}

export function dbGetTagRegistry(): string[] {
  const val = dbGetSetting('tag_registry');
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

export function dbAddToTagRegistry(tag: string): void {
  const current = dbGetTagRegistry();
  if (!current.includes(tag)) {
    dbSetSetting('tag_registry', JSON.stringify([...current, tag]));
  }
}

export function dbRemoveFromTagRegistry(tag: string): void {
  const current = dbGetTagRegistry();
  dbSetSetting('tag_registry', JSON.stringify(current.filter(t => t !== tag)));
}

export function dbRemoveTagFromAllTasks(tag: string): void {
  const rows = db.getAllSync<{ id: string; tags: string }>(
    "SELECT id, tags FROM tasks WHERE tags != '[]'"
  );
  db.withTransactionSync(() => {
    for (const row of rows) {
      const existing: string[] = JSON.parse(row.tags ?? '[]');
      if (!existing.includes(tag)) continue;
      const updated = existing.filter(t => t !== tag);
      db.runSync('UPDATE tasks SET tags = ? WHERE id = ?', [JSON.stringify(updated), row.id]);
    }
  });
}

export function dbBulkAddTags(ids: string[], tagsToAdd: string[]): void {
  if (ids.length === 0 || tagsToAdd.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      const row = db.getFirstSync<{ tags: string }>('SELECT tags FROM tasks WHERE id = ?', [id]);
      if (!row) continue;
      const existing: string[] = JSON.parse(row.tags ?? '[]');
      const merged = Array.from(new Set([...existing, ...tagsToAdd]));
      db.runSync('UPDATE tasks SET tags = ? WHERE id = ?', [JSON.stringify(merged), id]);
    }
  });
}

export function dbGetCategoryRegistry(): string[] {
  const val = dbGetSetting('category_registry');
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

// ─── Categories ───────────────────────────────────────────────────────────────

function rowToCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    name: row.name as string,
    scheduleDays: row.schedule_days ? JSON.parse(row.schedule_days as string) as number[] : null,
    scheduleStart: (row.schedule_start as string) ?? null,
    scheduleEnd: (row.schedule_end as string) ?? null,
    hideOnVacation: Boolean(row.hide_on_vacation),
    excludeFromPinSuggestions: Boolean(row.exclude_from_pin_suggestions),
    defaultTimeSegments: parseTimeSegments(row.default_time_segments),
    sortOrder: row.sort_order as number,
    emoji: (row.emoji as string | null) ?? null,
  };
}

export function dbGetAllCategories(): Category[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
  return rows.map(rowToCategory);
}

export function dbInsertCategory(name: string): Category {
  const id = generateId();
  const maxOrder = db.getFirstSync<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')?.m ?? 0;
  const sortOrder = maxOrder + 1;
  db.runSync('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)', [id, name, sortOrder]);
  return { id, name, scheduleDays: null, scheduleStart: null, scheduleEnd: null, hideOnVacation: false, excludeFromPinSuggestions: false, defaultTimeSegments: [], sortOrder, emoji: null };
}

export function dbBatchUpdateCategorySortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE categories SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

export function dbSetCategoryHideOnVacation(id: string, hide: boolean): void {
  db.runSync('UPDATE categories SET hide_on_vacation = ? WHERE id = ?', [hide ? 1 : 0, id]);
}

export function dbSetCategoryExcludeFromPinSuggestions(id: string, exclude: boolean): void {
  db.runSync('UPDATE categories SET exclude_from_pin_suggestions = ? WHERE id = ?', [exclude ? 1 : 0, id]);
}

export function dbSetCategoryEmoji(id: string, emoji: string | null): void {
  db.runSync('UPDATE categories SET emoji = ? WHERE id = ?', [emoji, id]);
}

// Stored as null rather than '[]' when empty, matching how tasks.time_of_day
// spells "no segment" — so parseTimeSegments reads both columns the same way.
export function dbSetCategoryDefaultTimeSegments(id: string, segments: TimeOfDay[]): void {
  db.runSync(
    'UPDATE categories SET default_time_segments = ? WHERE id = ?',
    [segments.length ? JSON.stringify(segments) : null, id]
  );
}

export function dbUpdateCategory(id: string, updates: Partial<Pick<Category, 'scheduleDays' | 'scheduleStart' | 'scheduleEnd'>>): void {
  db.runSync(
    'UPDATE categories SET schedule_days = ?, schedule_start = ?, schedule_end = ? WHERE id = ?',
    [
      updates.scheduleDays ? JSON.stringify(updates.scheduleDays) : null,
      updates.scheduleStart ?? null,
      updates.scheduleEnd ?? null,
      id,
    ]
  );
}

export function dbDeleteCategory(name: string): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM categories WHERE name = ?', [name]);
    db.runSync('UPDATE tasks SET category = NULL WHERE category = ?', [name]);
    db.runSync('UPDATE task_groups SET category = NULL WHERE category = ?', [name]);
  });
}

// Full-row insert used only to restore a category snapshot on undo —
// dbInsertCategory(name) mints a fresh id/sortOrder and can't bring back
// the schedule/vacation fields a deleted category carried.
export function dbInsertCategoryRow(category: Category): void {
  db.runSync(
    'INSERT INTO categories (id, name, schedule_days, schedule_start, schedule_end, hide_on_vacation, exclude_from_pin_suggestions, default_time_segments, sort_order, emoji) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      category.id,
      category.name,
      category.scheduleDays ? JSON.stringify(category.scheduleDays) : null,
      category.scheduleStart,
      category.scheduleEnd,
      category.hideOnVacation ? 1 : 0,
      category.excludeFromPinSuggestions ? 1 : 0,
      category.defaultTimeSegments.length ? JSON.stringify(category.defaultTimeSegments) : null,
      category.sortOrder,
      category.emoji,
    ]
  );
}

export function dbRenameCategory(id: string, oldName: string, newName: string): void {
  db.withTransactionSync(() => {
    db.runSync('UPDATE categories SET name = ? WHERE id = ?', [newName, id]);
    db.runSync('UPDATE tasks SET category = ? WHERE category = ?', [newName, oldName]);
    db.runSync('UPDATE task_groups SET category = ? WHERE category = ?', [newName, oldName]);
  });
}

// ─── Project Categories ─────────────────────────────────────────────────────

function rowToProjectCategory(row: Record<string, unknown>): ProjectCategory {
  return {
    id: row.id as string,
    name: row.name as string,
    sortOrder: row.sort_order as number,
  };
}

export function dbGetAllProjectCategories(): ProjectCategory[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM project_categories ORDER BY sort_order ASC, name ASC');
  return rows.map(rowToProjectCategory);
}

export function dbInsertProjectCategory(name: string): ProjectCategory {
  const id = generateId();
  const maxOrder = db.getFirstSync<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM project_categories')?.m ?? 0;
  const sortOrder = maxOrder + 1;
  db.runSync('INSERT INTO project_categories (id, name, sort_order) VALUES (?, ?, ?)', [id, name, sortOrder]);
  return { id, name, sortOrder };
}

// ─── Task Groups ────────────────────────────────────────────────────────────

function rowToTaskGroup(row: Record<string, unknown>): TaskGroup {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: row.notes as string,
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    collapsed: Boolean(row.collapsed),
  };
}

export function dbGetAllTaskGroups(): TaskGroup[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM task_groups ORDER BY sort_order ASC');
  return rows.map(rowToTaskGroup);
}

export function dbInsertTaskGroup(group: TaskGroup): void {
  db.runSync(
    // completed_at is deliberately absent: it held the old "stack dismissed
    // for today" stamp, which no longer exists (see TaskGroup). The column
    // stays on the table for installs that already have it, and stays null.
    'INSERT INTO task_groups (id, title, notes, tags, category, sort_order, collapsed) VALUES (?,?,?,?,?,?,?)',
    [
      group.id, group.title, group.notes, JSON.stringify(group.tags),
      group.category ?? null, group.sortOrder, group.collapsed ? 1 : 0,
    ]
  );
}

export function dbUpdateTaskGroup(group: TaskGroup): void {
  db.runSync(
    'UPDATE task_groups SET title=?, notes=?, tags=?, category=?, sort_order=?, collapsed=? WHERE id=?',
    [
      group.title, group.notes, JSON.stringify(group.tags),
      group.category ?? null, group.sortOrder, group.collapsed ? 1 : 0, group.id,
    ]
  );
}

export function dbDeleteTaskGroup(id: string): void {
  db.runSync('DELETE FROM task_groups WHERE id = ?', [id]);
}

// ─── Groceries ──────────────────────────────────────────────────────────────

function rowToGroceryItem(row: Record<string, unknown>): GroceryItem {
  return {
    id: row.id as string,
    name: row.name as string,
    nameKey: row.name_key as string,
    aisle: (row.aisle as string) ?? 'Other',
    quantity: (row.quantity as string) ?? null,
    note: (row.note as string) ?? '',
    onList: Boolean(row.on_list),
    checked: Boolean(row.checked),
    // Absent only on a row read before the migration landed, and a row that
    // already exists is a catalog member — same reading as the column default.
    inCatalog: row.in_catalog === undefined ? true : Boolean(row.in_catalog),
    sortOrder: (row.sort_order as number) ?? 0,
    favorite: Boolean(row.favorite),
    purchaseCount: (row.purchase_count as number) ?? 0,
    lastAddedAt: (row.last_added_at as string) ?? null,
    lastPurchasedAt: (row.last_purchased_at as string) ?? null,
    createdAt: row.created_at as string,
    onHandUntil: (row.on_hand_until as string) ?? null,
    sourceRecipeId: (row.source_recipe_id as string) ?? null,
    sourceRecipeTitle: (row.source_recipe_title as string) ?? null,
  };
}

export function dbGetAllGroceryItems(): GroceryItem[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM grocery_items ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToGroceryItem);
}

export function dbInsertGroceryItem(item: GroceryItem): void {
  db.runSync(
    `INSERT INTO grocery_items
      (id, name, name_key, aisle, quantity, note, on_list, checked, in_catalog, sort_order,
       favorite, purchase_count, last_added_at, last_purchased_at, created_at, on_hand_until,
       source_recipe_id, source_recipe_title)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.name, item.nameKey, item.aisle, item.quantity ?? null, item.note,
      item.onList ? 1 : 0, item.checked ? 1 : 0, item.inCatalog ? 1 : 0, item.sortOrder,
      item.favorite ? 1 : 0, item.purchaseCount,
      item.lastAddedAt ?? null, item.lastPurchasedAt ?? null, item.createdAt,
      item.onHandUntil ?? null,
      item.sourceRecipeId ?? null, item.sourceRecipeTitle ?? null,
    ]
  );
}

export function dbUpdateGroceryItem(item: GroceryItem): void {
  db.runSync(
    `UPDATE grocery_items SET
       name=?, name_key=?, aisle=?, quantity=?, note=?, on_list=?, checked=?, in_catalog=?,
       sort_order=?, favorite=?, purchase_count=?, last_added_at=?, last_purchased_at=?,
       on_hand_until=?, source_recipe_id=?, source_recipe_title=?
     WHERE id=?`,
    [
      item.name, item.nameKey, item.aisle, item.quantity ?? null, item.note,
      item.onList ? 1 : 0, item.checked ? 1 : 0, item.inCatalog ? 1 : 0, item.sortOrder,
      item.favorite ? 1 : 0, item.purchaseCount,
      item.lastAddedAt ?? null, item.lastPurchasedAt ?? null,
      item.onHandUntil ?? null,
      item.sourceRecipeId ?? null, item.sourceRecipeTitle ?? null, item.id,
    ]
  );
}

export function dbDeleteGroceryItem(id: string): void {
  // Written out rather than left to a foreign key: expo-sqlite has FK
  // enforcement off, so ON DELETE CASCADE would silently do nothing and leave
  // links pointing at an item that no longer exists. Same reason
  // dbBulkDeleteTasks handles its parent_id children by hand.
  db.runSync('DELETE FROM grocery_item_shops WHERE item_id = ?', [id]);
  db.runSync('DELETE FROM grocery_items WHERE id = ?', [id]);
}

/**
 * Ends a shopping trip: everything in the trolley comes off the list and is
 * recorded as bought. Returns the ids it touched so the store can patch its
 * own array without a re-read.
 *
 * This is an UPDATE and never a DELETE, and the reason isn't only that the
 * catalog is the feature. purchase_count/last_purchased_at *are* the ranking
 * signal behind autocomplete and Buy again — delete the row and the eleventh
 * milk ranks like the typo you made once.
 *
 * `shopId` is optional and null is a real answer, not a missing one: a trip
 * finished without naming a store bumps the item exactly as it always has and
 * writes no link. That's what keeps this additive — picking a store never
 * became a step you have to complete mid-supermarket.
 */
export function dbFinishGroceryShopping(
  purchasedAt: string,
  onHandUntilById: Readonly<Record<string, string>> = {},
  shopId: string | null = null
): string[] {
  const rows = db.getAllSync<{ id: string }>(
    'SELECT id FROM grocery_items WHERE checked = 1 AND on_list = 1'
  );
  if (rows.length === 0) return [];
  db.runSync(
    `UPDATE grocery_items
        SET on_list = 0, checked = 0, in_catalog = 1,
            purchase_count = purchase_count + 1,
            last_purchased_at = ?
      WHERE checked = 1 AND on_list = 1`,
    [purchasedAt]
  );
  // Unlike every field above, on_hand_until is a per-item cadence guess (see
  // grocerySuggest.defaultOnHandUntil) — never the same value twice across a
  // trip — so it can't ride the single bulk UPDATE and gets its own pass, the
  // same shape as the shop-link loop just below.
  for (const row of rows) {
    const until = onHandUntilById[row.id];
    if (until) db.runSync('UPDATE grocery_items SET on_hand_until = ? WHERE id = ?', [until, row.id]);
  }
  if (shopId) {
    for (const row of rows) {
      db.runSync(
        `INSERT INTO grocery_item_shops (item_id, shop_id, purchase_count, last_purchased_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(item_id, shop_id)
         DO UPDATE SET purchase_count = purchase_count + 1,
                       last_purchased_at = excluded.last_purchased_at`,
        [row.id, shopId, purchasedAt]
      );
    }
  }
  return rows.map(r => r.id);
}

/**
 * Clears the list without buying anything — "I'm not doing this trip after
 * all". Deliberately does not touch purchase_count: nothing was bought, so
 * inflating the ranking signal would teach autocomplete a lie.
 */
export function dbClearGroceryList(): string[] {
  const rows = db.getAllSync<{ id: string }>('SELECT id FROM grocery_items WHERE on_list = 1');
  if (rows.length === 0) return [];
  // in_catalog = 1 for the same reason the alert says nothing is deleted: a
  // cleared trip parks its rows rather than forgetting them, so a name typed
  // this week survives as catalog even though it was never bought. It also
  // keeps the !onList ⇒ inCatalog invariant, without which a provisional row
  // could sit off the list and then be deleted by a later Remove from list.
  db.runSync('UPDATE grocery_items SET on_list = 0, checked = 0, in_catalog = 1 WHERE on_list = 1');
  return rows.map(r => r.id);
}

// The aisle order is a JSON string list in `settings`, not a table — the
// inverse of the categories decision, and for the reason that decision gives:
// categories earned a table because they carry schedule fields a string list
// can't hold, whereas an aisle carries a name and a position. Same shape as
// dbGetTagRegistry, including its tolerance for a corrupt value.
export function dbGetGroceryAisleOrder(): string[] | null {
  const val = dbGetSetting('grocery_aisle_order');
  if (!val) return null;
  try {
    const parsed = JSON.parse(val) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function dbSetGroceryAisleOrder(order: string[]): void {
  dbSetSetting('grocery_aisle_order', JSON.stringify(order));
}

// The built-in aisles the user has deleted or renamed away. A tombstone list is
// needed because the walk order is repaired against DEFAULT_AISLES at read
// time (see normalizeAisleOrder) — without this, a deleted 'Snacks' is back on
// the next launch and the delete reads as a bug. Same shape and same tolerance
// for a corrupt value as the order itself.
export function dbGetGroceryHiddenAisles(): string[] {
  const val = dbGetSetting('grocery_aisle_hidden');
  if (!val) return [];
  try {
    const parsed = JSON.parse(val) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function dbSetGroceryHiddenAisles(hidden: string[]): void {
  dbSetSetting('grocery_aisle_hidden', JSON.stringify(hidden));
}

// name_key → the aisle the user filed that item under, which is why it lives
// here and not on the row: a provisional grocery row is deleted when it comes
// off the list, and the filing has to outlive it. Same tolerance for a corrupt
// value as the walk order above — a bad blob costs the memory, not the launch.
export function dbGetGroceryAisleOverrides(): Record<string, string> {
  const val = dbGetSetting('grocery_aisle_overrides');
  if (!val) return {};
  try {
    const parsed = JSON.parse(val) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, aisle] of Object.entries(parsed as Record<string, unknown>)) {
      if (key && typeof aisle === 'string' && aisle) out[key] = aisle;
    }
    return out;
  } catch {
    return {};
  }
}

export function dbSetGroceryAisleOverrides(overrides: Record<string, string>): void {
  dbSetSetting('grocery_aisle_overrides', JSON.stringify(overrides));
}

// ─── Grocery stores ─────────────────────────────────────────────────────────
//
// A table rather than a JSON list in `settings` — the opposite call to the
// aisle order, and for the reason that decision gives. An aisle is a name and a
// position, so a string list holds it. A store is referenced by every link row
// it owns, so it needs an id that survives a rename; storing the name in the
// links instead would break every record the moment someone fixed a typo.

function rowToShop(row: Record<string, unknown>): Shop {
  return {
    id: row.id as string,
    name: row.name as string,
    nameKey: row.name_key as string,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    excludeFromSuggestions: Boolean(row.exclude_from_suggestions),
  };
}

export function dbGetAllGroceryShops(): Shop[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM grocery_shops ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToShop);
}

export function dbInsertGroceryShop(shop: Shop): void {
  db.runSync(
    'INSERT INTO grocery_shops (id, name, name_key, sort_order, created_at) VALUES (?,?,?,?,?)',
    [shop.id, shop.name, shop.nameKey, shop.sortOrder, shop.createdAt]
  );
}

export function dbUpdateGroceryShop(shop: Shop): void {
  db.runSync(
    'UPDATE grocery_shops SET name=?, name_key=?, sort_order=? WHERE id=?',
    [shop.name, shop.nameKey, shop.sortOrder, shop.id]
  );
}

export function dbSetShopExcludeFromSuggestions(id: string, exclude: boolean): void {
  db.runSync('UPDATE grocery_shops SET exclude_from_suggestions = ? WHERE id = ?', [exclude ? 1 : 0, id]);
}

/**
 * Deleting a store takes its purchase records with it — a link to a store that
 * doesn't exist is unreadable, not merely orphaned. Same hand-written cascade
 * as dbDeleteGroceryItem, and for the same reason (FKs are off).
 */
export function dbDeleteGroceryShop(id: string): void {
  db.runSync('DELETE FROM grocery_item_shops WHERE shop_id = ?', [id]);
  db.runSync('DELETE FROM grocery_shops WHERE id = ?', [id]);
}

function rowToItemShopLink(row: Record<string, unknown>): ItemShopLink {
  return {
    itemId: row.item_id as string,
    shopId: row.shop_id as string,
    purchaseCount: (row.purchase_count as number) ?? 0,
    lastPurchasedAt: (row.last_purchased_at as string) ?? null,
  };
}

export function dbGetAllItemShopLinks(): ItemShopLink[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM grocery_item_shops');
  return rows.map(rowToItemShopLink);
}

/** Upsert, so the manual "I get this here" and a finished trip share one path. */
export function dbSetItemShopLink(link: ItemShopLink): void {
  db.runSync(
    `INSERT INTO grocery_item_shops (item_id, shop_id, purchase_count, last_purchased_at)
     VALUES (?,?,?,?)
     ON CONFLICT(item_id, shop_id)
     DO UPDATE SET purchase_count = excluded.purchase_count,
                   last_purchased_at = excluded.last_purchased_at`,
    [link.itemId, link.shopId, link.purchaseCount, link.lastPurchasedAt ?? null]
  );
}

export function dbDeleteItemShopLink(itemId: string, shopId: string): void {
  db.runSync('DELETE FROM grocery_item_shops WHERE item_id = ? AND shop_id = ?', [itemId, shopId]);
}

// ─── Recipes ────────────────────────────────────────────────────────────────

function rowToRecipe(row: Record<string, unknown>): Recipe {
  return {
    id: row.id as string,
    name: row.name as string,
    nameKey: row.name_key as string,
    notes: (row.notes as string) ?? '',
    sourceUrl: (row.source_url as string) ?? null,
    sourceName: (row.source_name as string) ?? null,
    author: (row.author as string) ?? null,
    source: (row.source as string) ?? null,
    servings: (row.servings as number) ?? null,
    ingredients: parseRecipeIngredients(row.ingredients),
    prepTasks: parsePrepTasks(row.prep_tasks),
    favorite: Boolean(row.favorite),
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    cookCount: (row.cook_count as number) ?? 0,
    lastCookedAt: (row.last_cooked_at as string) ?? null,
    estimatedMinutes: (row.estimated_minutes as number) ?? null,
    timerStartedAt: (row.timer_started_at as string) ?? null,
    timerElapsedSeconds: (row.timer_elapsed_seconds as number) ?? 0,
    lastCookMinutes: (row.last_cook_minutes as number) ?? null,
    cookTimeCount: (row.cook_time_count as number) ?? 0,
    totalCookMinutes: (row.total_cook_minutes as number) ?? 0,
  };
}

export function dbGetAllRecipes(): Recipe[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM recipes ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToRecipe);
}

export function dbInsertRecipe(recipe: Recipe): void {
  db.runSync(
    `INSERT INTO recipes
      (id, name, name_key, notes, source_url, source_name, author, source, servings, ingredients, prep_tasks, favorite, sort_order, created_at, cook_count, last_cooked_at,
       estimated_minutes, timer_started_at, timer_elapsed_seconds, last_cook_minutes, cook_time_count, total_cook_minutes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      recipe.id, recipe.name, recipe.nameKey, recipe.notes, recipe.sourceUrl ?? null,
      recipe.sourceName ?? null, recipe.author ?? null, recipe.source ?? null,
      recipe.servings ?? null, JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.prepTasks), recipe.favorite ? 1 : 0, recipe.sortOrder, recipe.createdAt,
      recipe.cookCount, recipe.lastCookedAt ?? null,
      recipe.estimatedMinutes ?? null, recipe.timerStartedAt ?? null, recipe.timerElapsedSeconds,
      recipe.lastCookMinutes ?? null, recipe.cookTimeCount, recipe.totalCookMinutes,
    ]
  );
}

export function dbUpdateRecipe(recipe: Recipe): void {
  db.runSync(
    `UPDATE recipes SET
       name=?, name_key=?, notes=?, source_url=?, source_name=?, author=?, source=?, servings=?, ingredients=?, prep_tasks=?,
       favorite=?, sort_order=?, cook_count=?, last_cooked_at=?,
       estimated_minutes=?, timer_started_at=?, timer_elapsed_seconds=?, last_cook_minutes=?, cook_time_count=?, total_cook_minutes=?
     WHERE id=?`,
    [
      recipe.name, recipe.nameKey, recipe.notes, recipe.sourceUrl ?? null,
      recipe.sourceName ?? null, recipe.author ?? null, recipe.source ?? null,
      recipe.servings ?? null, JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.prepTasks), recipe.favorite ? 1 : 0, recipe.sortOrder,
      recipe.cookCount, recipe.lastCookedAt ?? null,
      recipe.estimatedMinutes ?? null, recipe.timerStartedAt ?? null, recipe.timerElapsedSeconds,
      recipe.lastCookMinutes ?? null, recipe.cookTimeCount, recipe.totalCookMinutes,
      recipe.id,
    ]
  );
}

export function dbDeleteRecipe(id: string): void {
  db.runSync('DELETE FROM recipes WHERE id = ?', [id]);
}

// ─── Meal plan ──────────────────────────────────────────────────────────────

function rowToMealPlanEntry(row: Record<string, unknown>): MealPlanEntry {
  return {
    id: row.id as string,
    date: row.date as string,
    // Anything unrecognised reads as dinner rather than being dropped: the
    // column is a bare string, a restored backup can carry anything, and an
    // entry that renders in the wrong slot is recoverable while one that
    // vanishes from the week is not.
    slot: (MEAL_SLOTS as readonly string[]).includes(row.slot as string)
      ? (row.slot as MealSlot)
      : 'dinner',
    recipeId: (row.recipe_id as string) ?? null,
    title: (row.title as string) ?? '',
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    cookedAt: (row.cooked_at as string) ?? null,
  };
}

/**
 * The entries between two `YYYY-MM-DD` day keys, both ends inclusive.
 *
 * Range-scoped rather than a wholesale read on purpose — the screen only ever
 * shows a week, and `enableScreens(false)` means a blurred MealPlanScreen stays
 * mounted and re-renders on every store change (see the note in CLAUDE.md), so
 * the smaller the thing it holds the better. The keys sort lexically, which is
 * the whole reason the day key is stored zero-padded.
 */
export function dbGetMealPlanEntries(startKey: string, endKey: string): MealPlanEntry[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM meal_plan_entries WHERE date >= ? AND date <= ?
     ORDER BY date ASC, sort_order ASC, created_at ASC`,
    [startKey, endKey]
  );
  return rows.map(rowToMealPlanEntry);
}

export function dbInsertMealPlanEntry(entry: MealPlanEntry): void {
  db.runSync(
    `INSERT INTO meal_plan_entries (id, date, slot, recipe_id, title, sort_order, created_at, cooked_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      entry.id, entry.date, entry.slot, entry.recipeId ?? null,
      entry.title, entry.sortOrder, entry.createdAt, entry.cookedAt ?? null,
    ]
  );
}

export function dbUpdateMealPlanEntry(entry: MealPlanEntry): void {
  db.runSync(
    `UPDATE meal_plan_entries SET date=?, slot=?, recipe_id=?, title=?, sort_order=?, cooked_at=? WHERE id=?`,
    [entry.date, entry.slot, entry.recipeId ?? null, entry.title, entry.sortOrder, entry.cookedAt ?? null, entry.id]
  );
}

export function dbDeleteMealPlanEntry(id: string): void {
  db.runSync('DELETE FROM meal_plan_entries WHERE id = ?', [id]);
}

/**
 * Drops every entry before `beforeKey`, returning how many went.
 *
 * The horizon is not optional and not the user's to turn off (see
 * MEAL_PLAN_RETENTION_DAYS): planned meals are per-event rows, the one growth
 * pattern the whole grocery model was designed around, and nothing else in this
 * feature ever deletes one.
 */
export function dbPurgeOldMealPlanEntries(beforeKey: string): number {
  return db.runSync('DELETE FROM meal_plan_entries WHERE date < ?', [beforeKey]).changes ?? 0;
}

// When "Add week to list" was last used, keyed by the week's start day key —
// a stamp, not a lock, so the week header can say "Added to list on Sunday"
// without that ever blocking a second, deliberate add (someone remembering the
// mushrooms after the fact is a real action, not a mistake to guard against).
// A settings-JSON map like grocery_aisle_order rather than a column on
// anything, since it names a week rather than a row. Bounded the same way
// entries are: useMealPlanStore.purgeOldEntries drops keys past the same
// horizon, so this can't grow forever the way the map that inspired the
// pattern (grocery_aisle_order) doesn't need to.
export function dbGetMealPlanAddedToList(): Record<string, string> {
  const val = dbGetSetting('meal_plan_added_to_list');
  if (!val) return {};
  try {
    const parsed = JSON.parse(val) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function dbSetMealPlanAddedToList(map: Record<string, string>): void {
  dbSetSetting('meal_plan_added_to_list', JSON.stringify(map));
}

// The store the last trip was finished at, used to preselect the next one. A
// scalar, so it's a settings key like grocery_aisle_order rather than a column
// on anything. Validated against live shops at read time by the store, because
// the shop it names can have been deleted since.
export function dbGetLastShopId(): string | null {
  // `|| null`, not `?? null`: clearing it writes an empty string (dbSetSetting
  // takes a string), and "" is not a shop id.
  return dbGetSetting('grocery_last_shop_id') || null;
}

export function dbSetLastShopId(id: string | null): void {
  dbSetSetting('grocery_last_shop_id', id ?? '');
}

// ─── Projects ───────────────────────────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: row.notes as string,
    targetStartDate: (row.target_start_date as string) ?? null,
    targetEndDate: (row.target_end_date as string) ?? null,
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    archived: Boolean(row.archived),
    archivedAt: (row.archived_at as string) ?? null,
    createdAt: row.created_at as string,
    nudgeCadenceDays: (row.nudge_cadence_days as number | null) ?? DEFAULT_NUDGE_CADENCE_DAYS,
    autoSchedule: Boolean(row.auto_schedule),
    sequential: Boolean(row.sequential),
  };
}

export function dbGetAllProjects(): Project[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM projects ORDER BY sort_order ASC');
  return rows.map(rowToProject);
}

export function dbInsertProject(project: Project): void {
  db.runSync(
    'INSERT INTO projects (id, title, notes, target_start_date, target_end_date, category, sort_order, archived, archived_at, created_at, nudge_cadence_days, auto_schedule, sequential) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      project.id, project.title, project.notes, project.targetStartDate, project.targetEndDate,
      project.category, project.sortOrder, project.archived ? 1 : 0, project.archivedAt, project.createdAt,
      project.nudgeCadenceDays, project.autoSchedule ? 1 : 0, project.sequential ? 1 : 0,
    ]
  );
}

export function dbUpdateProject(project: Project): void {
  db.runSync(
    'UPDATE projects SET title=?, notes=?, target_start_date=?, target_end_date=?, category=?, sort_order=?, archived=?, archived_at=?, nudge_cadence_days=?, auto_schedule=?, sequential=? WHERE id=?',
    [
      project.title, project.notes, project.targetStartDate, project.targetEndDate,
      project.category, project.sortOrder, project.archived ? 1 : 0, project.archivedAt,
      project.nudgeCadenceDays, project.autoSchedule ? 1 : 0, project.sequential ? 1 : 0, project.id,
    ]
  );
}

export function dbDeleteProject(id: string): void {
  db.runSync('DELETE FROM projects WHERE id = ?', [id]);
}

export function dbBatchUpdateProjectSortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE projects SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────

function parseTemplateItems(raw: unknown): TemplateItem[] {
  try {
    const parsed = JSON.parse((raw as string) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTemplateItem);
  } catch {
    return [];
  }
}

function parseItemGroups(raw: unknown): TemplateItemGroup[] {
  try {
    const parsed = JSON.parse((raw as string) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((g: Partial<TemplateItemGroup>) => ({
      id: g.id ?? '',
      title: g.title ?? '',
      sortOrder: g.sortOrder ?? 0,
    }));
  } catch {
    return [];
  }
}

function rowToTemplate(row: Record<string, unknown>): TaskTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    items: parseTemplateItems(row.items),
    itemGroups: parseItemGroups(row.item_groups),
    createdAt: row.created_at as string,
    sortOrder: row.sort_order as number,
    category: (row.category as string) ?? null,
    applyContainer: parseApplyContainer(row.apply_container),
  };
}

/** Tolerates a null (pre-migration row) or an unknown value from a newer app version, same as parseTimeSegments. */
function parseApplyContainer(raw: unknown): TemplateContainer {
  return raw === 'none' || raw === 'project' ? raw : 'stack';
}

export function dbGetAllTemplates(): TaskTemplate[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM templates ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToTemplate);
}

export function dbInsertTemplate(template: TaskTemplate): void {
  db.runSync(
    'INSERT INTO templates (id, name, items, item_groups, created_at, sort_order, category, apply_container) VALUES (?,?,?,?,?,?,?,?)',
    [template.id, template.name, JSON.stringify(template.items), JSON.stringify(template.itemGroups), template.createdAt, template.sortOrder, template.category, template.applyContainer]
  );
}

export function dbUpdateTemplate(template: TaskTemplate): void {
  db.runSync(
    'UPDATE templates SET name = ?, items = ?, item_groups = ?, sort_order = ?, category = ?, apply_container = ? WHERE id = ?',
    [template.name, JSON.stringify(template.items), JSON.stringify(template.itemGroups), template.sortOrder, template.category, template.applyContainer, template.id]
  );
}

export function dbDeleteTemplate(id: string): void {
  db.runSync('DELETE FROM templates WHERE id = ?', [id]);
}

// ─── Template Categories ────────────────────────────────────────────────────

function rowToTemplateCategory(row: Record<string, unknown>): TemplateCategory {
  return {
    id: row.id as string,
    name: row.name as string,
    sortOrder: row.sort_order as number,
  };
}

export function dbGetAllTemplateCategories(): TemplateCategory[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM template_categories ORDER BY sort_order ASC, name ASC');
  return rows.map(rowToTemplateCategory);
}

export function dbInsertTemplateCategory(name: string): TemplateCategory {
  const id = generateId();
  const maxOrder = db.getFirstSync<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM template_categories')?.m ?? 0;
  const sortOrder = maxOrder + 1;
  db.runSync('INSERT INTO template_categories (id, name, sort_order) VALUES (?, ?, ?)', [id, name, sortOrder]);
  return { id, name, sortOrder };
}
