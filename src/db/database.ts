import * as SQLite from 'expo-sqlite';
import type { DeliverableKind, GeneratedKind, Task, Category, GroceryItem, GtinLookup, ItemProduct, ItemShopLink, ItemSubLink, Leftover, MealPlanEntry, MealSlot, Recipe, RecipeMealType, RecipeSourceType, RecipeVote, ReceiptStyle, Shop, StoreAlias, TaskGroup, FocusSession, FocusStep, Project, ProjectCategory, TaskTemplate, TemplateCategory, TemplateContainer, TemplateItem, TemplateItemGroup, TemplateQuestion, TemplateSchedule, TimeOfDay } from '../types';
import { DEFAULT_NUDGE_CADENCE_DAYS, MEAL_SLOTS, RECIPE_MEAL_TYPES, RECIPE_SOURCE_TYPES, isReceiptStyle } from '../types';
import { generateId } from '../utils/id';
import { appendPriceObservation, parsePriceHistory } from '../utils/priceHistory';
import { parseUnavailableProductIds, productKeyFor } from '../utils/groceryProduct';
import { parseChainItems } from '../utils/chain';
import { parseExtraTaskDraft } from '../utils/extraTask';
import { parseRecipeIngredients, parsePrepTasks, parseSteps } from '../utils/recipeUtils';
import { parseRecipeTags } from '../utils/recipeTags';
import { parseRecipeChoices, parseRecipeComponents } from '../utils/recipeComponents';
import { parseEmptySections } from '../utils/recipeSections';
import { normalizeScale } from '../utils/recipeScale';
import { normalizeTemplateItem, normalizeTemplateQuestion } from '../utils/templateUtils';
import { projectRow, REDACTED_SETTING_KEYS, type BackupRow } from '../utils/backup';
import {
  SYNC_DELETIONS_TABLE,
  SYNC_TRACKED_TABLES,
  TOMBSTONE_RETENTION_DAYS,
  KEY_SEPARATOR,
  NOW_EXPR,
  isSyncedSettingKey,
  backfillStatements,
  installStatements,
  updatedAtMigrations,
  type SyncTable,
} from './syncTracking';
import {
  emptyApplyReport,
  remoteDeletionWins,
  remoteRowWins,
  type ApplyReport,
  type SyncChangeSet,
  type SyncDeletion,
  type SyncPayload,
} from '../utils/syncMerge';

export type { SyncChangeSet, SyncDeletion } from '../utils/syncMerge';

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

    -- At most one row ever: starting a focus session replaces whatever was
    -- here, ending one deletes it. A table rather than a settings key because
    -- the plan is structured data the app reads on every tick, not a
    -- preference (see FocusSession in types).
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      started_at TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      step_index INTEGER NOT NULL DEFAULT 0,
      step_started_at TEXT,
      step_elapsed_seconds REAL NOT NULL DEFAULT 0,
      completed_task_ids TEXT NOT NULL DEFAULT '[]'
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
      unavailable_at TEXT,
      PRIMARY KEY (item_id, shop_id)
    );

    -- "If there's no butter, use margarine." Directional: symmetry is two
    -- rows, not a flag. See ItemSubLink in types for why this is item-level
    -- rather than a second choiceGroup on the recipe.
    CREATE TABLE IF NOT EXISTS grocery_item_subs (
      item_id TEXT NOT NULL,
      sub_item_id TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (item_id, sub_item_id)
    );

    -- One box on the shelf, hanging off the item it's a product of: Arnold's
    -- wheat under Bread. product_key is normalised and unique *within the
    -- item*, not across the catalog — two items may both have a "store brand".
    -- See ItemProduct in types for why this isn't a JSON column on the item and
    -- isn't a second grocery_items row.
    CREATE TABLE IF NOT EXISTS grocery_item_products (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      brand TEXT,
      variant TEXT,
      product_key TEXT NOT NULL,
      rating TEXT,
      note TEXT NOT NULL DEFAULT '',
      purchase_count INTEGER NOT NULL DEFAULT 0,
      last_purchased_at TEXT,
      gtin TEXT,
      -- The four per-box pantry columns. One item can hold two packets at
      -- once, so these are what make "the Beyond one is frozen, the Impossible
      -- one isn't" sayable. See ItemProduct.onHandUntil.
      on_hand_until TEXT,
      expires_at TEXT,
      frozen_at TEXT,
      opened_at TEXT,
      created_at TEXT NOT NULL
    );

    -- What a barcode turned out to be. A cache of a shared, unchanging fact
    -- (what a GTIN denotes), keyed by the code rather than by an item, and the
    -- one grocery table that records nothing about the user. Misses are stored
    -- too — a barcode nobody has heard of is exactly the one that would
    -- otherwise hit the network on every unpack — and they expire, where hits
    -- don't. See GtinLookup in types, and gtin.ts for why the key is GTIN-14.
    -- "At this store, GV MLK 2% GAL means milk." Written only from a
    -- confirmation in a review sheet, never from the app's own guess. Keyed by
    -- id rather than the (shop_id, raw_key) pair it is unique on, because
    -- sync's row_key joins composite keys with '|' and this one is receipt
    -- text. shop_id is '' (never NULL) for a text that isn't store-specific:
    -- SQLite treats NULLs as distinct in a UNIQUE index. See StoreAlias.
    CREATE TABLE IF NOT EXISTS grocery_store_aliases (
      id TEXT PRIMARY KEY NOT NULL,
      shop_id TEXT NOT NULL DEFAULT '',
      raw_key TEXT NOT NULL,
      item_id TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gtin_lookups (
      gtin TEXT PRIMARY KEY NOT NULL,
      found INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      brand TEXT,
      quantity TEXT,
      source TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL
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

    -- Something cooked that's now in the fridge with a clock on it. stored_at is
    -- an ISO instant; keep_until is a YYYY-MM-DD local day key, the same split
    -- meal_plan_entries makes and for the same reason — see Leftover in types.
    -- No name_key and no uniqueness: two batches of the same dish are two
    -- containers with two different clocks.
    CREATE TABLE IF NOT EXISTS leftovers (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      recipe_id TEXT,
      source_entry_id TEXT,
      stored_at TEXT NOT NULL,
      keep_until TEXT NOT NULL,
      finished_at TEXT,
      outcome TEXT,
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
    // The store → items read (the catalog's store filter). item → shops needs no
    // index: it's the leading column of the primary key.
    'CREATE INDEX IF NOT EXISTS idx_grocery_item_shops_shop ON grocery_item_shops(shop_id)',
    // The reverse read — "what is this item a substitute *for*" — which the
    // both-ways tick and dbDeleteGroceryItem's second cascade both need.
    // item → substitutes needs no index: it's the leading column of the key.
    'CREATE INDEX IF NOT EXISTS idx_grocery_item_subs_sub ON grocery_item_subs(sub_item_id)',
    // The pair a lookup keys on, and the guarantee that one phrase at one store
    // can only ever mean one thing.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_store_aliases_key ON grocery_store_aliases(shop_id, raw_key)',
    'CREATE INDEX IF NOT EXISTS idx_grocery_store_aliases_item ON grocery_store_aliases(item_id)',
    // "1 clove" → "1/4 tsp" (#1573). Both null or both set — see
    // ItemSubLink.ratioFrom — so no default and no backfill: an existing link
    // simply has no ratio, which is the row it already was.
    'ALTER TABLE grocery_item_subs ADD COLUMN ratio_from TEXT',
    'ALTER TABLE grocery_item_subs ADD COLUMN ratio_to TEXT',
    // "Always use oat milk for milk" (#1571). 0 for every existing row, which
    // is exactly the link they already were: a substitute that informs and
    // never buys. No backfill could ever be right here — a rule that rewrites
    // what lands in the trolley has to be ticked by the person it rewrites for.
    'ALTER TABLE grocery_item_subs ADD COLUMN standing INTEGER NOT NULL DEFAULT 0',
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
    'ALTER TABLE grocery_items ADD COLUMN choice_group TEXT',
    // 0 for every existing store — nothing predating this feature was ever
    // meant to drop out of suggestions. Same naming convention as
    // categories' exclude_from_pin_suggestions.
    'ALTER TABLE grocery_shops ADD COLUMN exclude_from_suggestions INTEGER NOT NULL DEFAULT 0',
    // See ReceiptStyle. Text rather than an integer flag because it is three
    // states and will read back as itself in a sqlite browser; 'itemized' for
    // every existing row, which is what they have all been treated as.
    "ALTER TABLE grocery_shops ADD COLUMN receipt_style TEXT NOT NULL DEFAULT 'itemized'",
    // Null for every existing recipe — splits the old single sourceName
    // attribution into author/source (#1266). Not backfilled from
    // source_name: an old value can't be reliably assigned to one or the
    // other, so old recipes just keep reading their legacy column until
    // edited. See Recipe.author/Recipe.source.
    'ALTER TABLE recipes ADD COLUMN author TEXT',
    'ALTER TABLE recipes ADD COLUMN source TEXT',
    // Null for every existing recipe — an old `servings` number stays exactly
    // what it was (the low end / whole count), and none of them were ever a
    // range. See Recipe.servingsMax.
    'ALTER TABLE recipes ADD COLUMN servings_max INTEGER',
    // Null for every existing recipe — no recipe written before this shipped
    // had a photo attached. See Recipe.imagePath / src/utils/recipePhoto.ts.
    'ALTER TABLE recipes ADD COLUMN image_path TEXT',
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
    // Null for every existing recipe — nothing predating this shipped had a
    // meal type to carry. See Recipe.mealType / RecipeMealType (#1104).
    'ALTER TABLE recipes ADD COLUMN meal_type TEXT',
    // Empty array for every existing recipe — nothing predating this was
    // composed of another recipe. A JSON blob for the reason `ingredients` is
    // one, and a link table would buy nothing here: the only question anyone
    // asks of it is "what are this recipe's parts", which is a read of this
    // row. See Recipe.components.
    "ALTER TABLE recipes ADD COLUMN components TEXT NOT NULL DEFAULT '[]'",
    // Null for every existing entry — nothing planned before leftovers were
    // trackable can be eating one. See MealPlanEntry.leftoverId. (The leftovers
    // table itself needs no migration: its CREATE TABLE IF NOT EXISTS above runs
    // on every launch, so an existing install gets it on the next open.)
    'ALTER TABLE meal_plan_entries ADD COLUMN leftover_id TEXT',
    // Empty for every existing entry — a meal planned before a recipe could
    // offer alternatives has nothing to have chosen, and an empty list is
    // exactly "use the defaults". JSON in one column rather than a link table
    // for the reason `components` is: the only question asked of it is "what
    // did this meal pick", which is a read of this row. See
    // MealPlanEntry.recipeChoices.
    "ALTER TABLE meal_plan_entries ADD COLUMN recipe_choices TEXT NOT NULL DEFAULT '[]'",
    // The list read is "what's still in the fridge", which scans the whole table
    // rather than a range the way the meal plan does — small, but it's also the
    // index the retention purge sweeps on.
    'CREATE INDEX IF NOT EXISTS idx_leftovers_finished ON leftovers(finished_at)',
    // Null for every existing recipe, same as servings_max — nothing predating
    // this had a yield beyond a serving count. See Recipe.recipeYield.
    'ALTER TABLE recipes ADD COLUMN recipe_yield TEXT',
    // 0/false for every existing quota task, which is exactly today's
    // behaviour: reaching target_count still completes it immediately. See
    // Task.allowOvershoot (#1257).
    'ALTER TABLE tasks ADD COLUMN allow_overshoot INTEGER NOT NULL DEFAULT 0',
    // Empty array for every existing recipe — nothing predating this could be
    // tagged. A JSON blob rather than a join table for the reason `ingredients`
    // is one: nothing outside this row holds a tag's identity (there's no
    // registry — see Recipe.tags), so it needs no id, and it's read as part of
    // the row it belongs to every single time.
    "ALTER TABLE recipes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
    // Null for every existing recipe — prep time is new and independent of
    // estimated_minutes (cook time). See Recipe.prepMinutes.
    'ALTER TABLE recipes ADD COLUMN prep_minutes INTEGER',
    // The prep timer's own banked-segment pair, mirroring timer_started_at/
    // timer_elapsed_seconds above but for prep instead of cook.
    'ALTER TABLE recipes ADD COLUMN prep_timer_started_at TEXT',
    'ALTER TABLE recipes ADD COLUMN prep_timer_elapsed_seconds INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE recipes ADD COLUMN last_prep_minutes INTEGER',
    'ALTER TABLE recipes ADD COLUMN prep_time_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE recipes ADD COLUMN total_prep_minutes INTEGER NOT NULL DEFAULT 0',
    // Null for every existing recipe — nothing predating this classified its
    // source. See Recipe.sourceType/sourcePage.
    'ALTER TABLE recipes ADD COLUMN source_type TEXT',
    'ALTER TABLE recipes ADD COLUMN source_page TEXT',
    // 1 — as written — for every meal planned before a recipe could be halved
    // or doubled. REAL rather than INTEGER because half is the point of the
    // feature. See MealPlanEntry.recipeScale.
    'ALTER TABLE meal_plan_entries ADD COLUMN recipe_scale REAL NOT NULL DEFAULT 1',
    // 0 for every existing row, and that needs no backfill to be correct: the
    // Pinned section sorted by sort_order until now, and pinnedTasks() still
    // falls back to it for ties. So an install upgrading into this sees its
    // pins in exactly the order it left them, and only a drag (or a fresh pin,
    // which stamps max+1) ever writes a non-zero rank. See Task.pinnedOrder.
    'ALTER TABLE tasks ADD COLUMN pinned_order INTEGER NOT NULL DEFAULT 0',
    // Superseded by generated_kind/generated_source_id at the end of this
    // array, which is backfilled from it below. Kept declared because the
    // migrations array only appends and a legacy install still has rows here;
    // nothing writes it any more.
    'ALTER TABLE tasks ADD COLUMN meal_entry_id TEXT',
    // Deliberately nullable with NO default, unlike every other boolean in this
    // schema (INTEGER NOT NULL DEFAULT 0). NULL is a third state meaning "the
    // user hasn't said, so the setting decides", and a DEFAULT 0 would instead
    // record every meal ever planned as an explicit "no cook task" — which is
    // the one value that suppresses the feature for ever after. See
    // MealPlanEntry.cookTask.
    'ALTER TABLE meal_plan_entries ADD COLUMN cook_task INTEGER',
    // 0 for every existing row, and there is no honest alternative: nothing
    // before this shipped recorded a reschedule, so no task can arrive already
    // accused of being ducked. It also means the picker stays silent on an
    // upgraded install until the user actually pushes something. See
    // Task.postponeCount and utils/postpone.ts.
    'ALTER TABLE tasks ADD COLUMN postpone_count INTEGER NOT NULL DEFAULT 0',
    // 0 for every existing row — nobody has asked to be left alone about a task
    // whose prompt didn't exist yet. See Task.postponeMuted.
    'ALTER TABLE tasks ADD COLUMN postpone_muted INTEGER NOT NULL DEFAULT 0',
    // NULL on every existing link, which is the only correct backfill: a store
    // the app has a purchase record for has never been said to lack the item.
    // See ItemShopLink.unavailableAt for why this is a date rather than a flag
    // and why it can sit on a row that also has purchases.
    'ALTER TABLE grocery_item_shops ADD COLUMN unavailable_at TEXT',
    // 0 for every existing project, deliberately — unlike every other nudge
    // column here, this one is NOT a "changes nothing on upgrade" backfill.
    // It gates every nudge surface (see Project.nudgeOptIn), including the
    // ones nudge_cadence_days already opted a project into, so an install
    // upgrading into this stops seeing the gone-quiet banner and the pull
    // sheet for any project until it's re-opted-in by hand. That reversal is
    // the point of the feature (#1427): the previous "0 = never ask" default
    // still surfaced a stalled project the moment the Pull sheet was opened
    // by hand, which is exactly what a reference list never wants.
    'ALTER TABLE projects ADD COLUMN nudge_opt_in INTEGER NOT NULL DEFAULT 0',
    // NULL on every existing row, and nothing backfills it: an item bought
    // before this shipped has no purchase date the app can trust to be the
    // *last* one, and inventing a use-by day for a catalog of hundreds is how
    // this feature would announce itself with a screenful of tasks. The next
    // trip stamps the rows it buys. See GroceryItem.expiresAt.
    'ALTER TABLE grocery_items ADD COLUMN expires_at TEXT',
    // Nullable with no default, for exactly the reason meal_plan_entries.
    // cook_task is: NULL is the third state ("the setting decides"), and a
    // DEFAULT 0 would record every item in the catalog as an explicit refusal.
    'ALTER TABLE grocery_items ADD COLUMN use_up_task INTEGER',
    // NULL on every existing row — nobody has corrected a shelf life for a
    // feature that didn't exist, so every item keeps deferring to the lexicon
    // guess exactly as before. See GroceryItem.shelfLifeDays.
    'ALTER TABLE grocery_items ADD COLUMN shelf_life_days INTEGER',
    // NULL on every existing row — nothing was in the freezer before there was
    // a freezer, so every item keeps counting down exactly as it did. See
    // GroceryItem.frozenAt.
    'ALTER TABLE grocery_items ADD COLUMN frozen_at TEXT',
    // NULL on every existing row — nothing has been opened before there was an
    // opened, so every item keeps counting from its purchase exactly as it did.
    // See GroceryItem.openedAt.
    'ALTER TABLE grocery_items ADD COLUMN opened_at TEXT',
    // NULL on every existing row: nobody has said they're nearly out of
    // anything, and null is what "no answer" already means for this column's
    // two neighbours. See GroceryItem.runningLowAt.
    'ALTER TABLE grocery_items ADD COLUMN running_low_at TEXT',
    // Superseded by generated_kind/generated_source_id, same as meal_entry_id.
    'ALTER TABLE tasks ADD COLUMN grocery_item_id TEXT',
    // NULL on every existing row — nobody has a rule for a feature that didn't
    // exist, and NULL is what "off" already means for this field.
    'ALTER TABLE tasks ADD COLUMN extra_task_every_n INTEGER',
    'ALTER TABLE tasks ADD COLUMN extra_task_title TEXT',
    // 0, which is the only honest backfill: past completions were never
    // counted, so no upgraded task can start part-way toward its first extra
    // task. See Task.extraTaskTally.
    'ALTER TABLE tasks ADD COLUMN extra_task_tally INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN previous_extra_task_tally INTEGER NOT NULL DEFAULT 0',
    // NULL on every existing row, which is exactly "an ordinary task that
    // completes by being ticked" — no task written before this shipped asks a
    // question. See Task.deliverableKind.
    'ALTER TABLE tasks ADD COLUMN deliverable_kind TEXT',
    'ALTER TABLE tasks ADD COLUMN deliverable_value TEXT',
    // 0 for every existing row — nothing predating this feature was ever
    // marked a standing staple. See GroceryItem.isStaple.
    'ALTER TABLE grocery_items ADD COLUMN is_staple INTEGER NOT NULL DEFAULT 0',
    // NULL on every existing row, for the same reason postpone_count is 0: a
    // task whose pushes were never counted has no first push to date, and
    // inventing one from created_at would put a fabricated "drifting since" on
    // every task in the database. See Task.driftingSince.
    'ALTER TABLE tasks ADD COLUMN drifting_since TEXT',
    // Nullable on every one of the six: null is "no price known", which is the
    // honest state for every row that predates this and for most rows after it.
    // Prices are additive — nothing reads a missing one as zero. See
    // GroceryItem.lastPriceMinor.
    'ALTER TABLE grocery_items ADD COLUMN last_price_minor INTEGER',
    'ALTER TABLE grocery_items ADD COLUMN last_priced_at TEXT',
    'ALTER TABLE grocery_items ADD COLUMN last_price_quantity TEXT',
    'ALTER TABLE grocery_item_shops ADD COLUMN last_price_minor INTEGER',
    'ALTER TABLE grocery_item_shops ADD COLUMN last_priced_at TEXT',
    'ALTER TABLE grocery_item_shops ADD COLUMN last_price_quantity TEXT',
    // 0 for every existing row — nothing predating this feature had ever
    // asked to mirror its deadline. See Task.deadlineOnCalendar.
    'ALTER TABLE tasks ADD COLUMN deadline_on_calendar INTEGER NOT NULL DEFAULT 0',
    // NULL until the first successful device write. See Task.calendarEventId.
    'ALTER TABLE tasks ADD COLUMN calendar_event_id TEXT',
    // Its own column rather than a second use of calendar_event_id: a deadline
    // event and a time block are two events on two days, and a task can have
    // both. NULL until the user puts one on the calendar by hand — nothing
    // backfills it. See Task.timeBlockEventId.
    'ALTER TABLE tasks ADD COLUMN time_block_event_id TEXT',
    // Superseded by generated_kind/generated_source_id, same as the two above.
    'ALTER TABLE tasks ADD COLUMN leftover_id TEXT',
    // Nullable with no default, for exactly the reason grocery_items.
    // use_up_task is: NULL is the third state ("the setting decides"), and a
    // DEFAULT 0 would record every leftover already in the fridge as an
    // explicit refusal. See Leftover.useUpTask.
    'ALTER TABLE leftovers ADD COLUMN use_up_task INTEGER',
    // The fridge half of the same column, added in the same change for the
    // reason freshness.ts exists: one of the two having a freezer and the
    // other not is how the kitchen's halves drift. See Leftover.frozenAt.
    'ALTER TABLE leftovers ADD COLUMN frozen_at TEXT',
    // NULL on every meal already planned, which is what makes the rollout
    // silent: picking a calendar mirrors the meals planned from then on
    // rather than back-filling a shared calendar with a fortnight of dinners
    // nobody asked for. See MealPlanEntry.calendarEventId.
    'ALTER TABLE meal_plan_entries ADD COLUMN calendar_event_id TEXT',
    // The one pair that replaced meal_entry_id / grocery_item_id / leftover_id
    // above, once a fourth generator would have meant a fourth column (#1524).
    // NULL on every task a person typed. See Task.generatedKind.
    //
    // The three old columns stay declared and readable but are no longer
    // written — the same disposition task_groups.completed_at has, and for the
    // same reason: the migrations array only appends, so there is no dropping
    // them, and a backfilled row is the only thing that ever needed to be read.
    'ALTER TABLE tasks ADD COLUMN generated_kind TEXT',
    'ALTER TABLE tasks ADD COLUMN generated_source_id TEXT',
    // NULL on every row that predates this and on most rows after it — "no
    // opinion about which one" is the honest default, and nothing backfills a
    // brand out of a name (see GroceryItem.brand for why that parse is unsafe).
    // Deliberately not part of name_key, so no key is stranded by this landing.
    //
    // LEGACY, unread since products landed — see the note on
    // grocery_item_shops.brand below. The backfill in initDatabase turns
    // whatever is in here into a real ItemProduct row once.
    'ALTER TABLE grocery_items ADD COLUMN brand TEXT',
    // 0 for every existing row: a brand recorded before this column existed is
    // a preference, not a filter over stores. Still live, and still this
    // column: it's `GroceryItem.productStrict` now. See its note for why one
    // flag covers both the brand-level and the product-level rule.
    'ALTER TABLE grocery_items ADD COLUMN brand_strict INTEGER NOT NULL DEFAULT 0',
    // NULL like brand above, and for the same reasons — nothing infers a
    // product line out of a name, and it's out of name_key, so no key moves.
    // LEGACY alongside brand above, and back-filled with it.
    'ALTER TABLE grocery_items ADD COLUMN variant TEXT',
    // NULL on every link that predates this — "which one this store had" was
    // never asked, and NULL reads as unknown rather than as a conflict, so no
    // existing store loses its coverage.
    //
    // LEGACY, unread since products landed — kept declared for the reason
    // task_groups.completed_at is: the migration list is append-only and a
    // column can't be dropped, so the honest thing is to say so here. The
    // product_id column added further down replaced it. The backfill in
    // initDatabase reads both of these once and then never again.
    'ALTER TABLE grocery_item_shops ADD COLUMN brand TEXT',
    // LEGACY, same as the column above: replaced by unavailable_product_ids,
    // which keys the claim to the product it was made about.
    'ALTER TABLE grocery_item_shops ADD COLUMN brand_unavailable_at TEXT',
    // NULL for every existing recipe, which is what "use the standard three
    // days" already meant before a recipe could say otherwise — so nothing is
    // backfilled and no leftover already in the fridge moves. See
    // Recipe.leftoverKeepDays.
    'ALTER TABLE recipes ADD COLUMN leftover_keep_days INTEGER',
    // The change-tracking column every synced table carries. Generated from
    // SYNC_TRACKED_TABLES rather than written out thirteen times, so a table
    // added to that list can't be left without one. See db/syncTracking.ts.
    ...updatedAtMigrations(),
    // 0 for every existing category — nothing predating this feature was ever
    // meant to drop out of the new-todos banner (or its per-row dot). Same
    // naming convention as exclude_from_pin_suggestions above.
    'ALTER TABLE categories ADD COLUMN exclude_from_new_tasks_banner INTEGER NOT NULL DEFAULT 0',
    // 0 for every existing row — a quantity already on a row before this
    // column existed has always behaved as the user's own, so nothing
    // pre-existing starts getting cleared on the next finish. See
    // GroceryItem.quantityFromRecipe.
    'ALTER TABLE grocery_items ADD COLUMN quantity_from_recipe INTEGER NOT NULL DEFAULT 0',
    // '[]' for every existing recipe — a heading declared with nothing under it
    // is new state, not something any prior row could have had an opinion
    // about. See Recipe.emptySections.
    "ALTER TABLE recipes ADD COLUMN empty_sections TEXT NOT NULL DEFAULT '[]'",
    // '[]' for every existing recipe — no recipe written before this shipped
    // had its method as discrete steps rather than one blob in `notes`. See
    // Recipe.steps.
    "ALTER TABLE recipes ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'",
    // '[]' for every existing template — a template that predates this asks
    // nothing beyond its anchor dates, which is exactly how it behaved. Items'
    // own `conditions` need no migration: `items` is a JSON blob, and
    // normalizeTemplateItem defaults the field for anything written before it.
    // See TaskTemplate.questions.
    "ALTER TABLE templates ADD COLUMN questions TEXT NOT NULL DEFAULT '[]'",
    // 0/NULL for every existing project — nothing before this shipped
    // recorded finishing a project as anything but archiving it. Independent
    // of `archived`: see Project.completed.
    'ALTER TABLE projects ADD COLUMN completed INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE projects ADD COLUMN completed_at TEXT',
    // NULL on every existing row, which is exactly what "just the title"
    // means — a rule written before this shipped says nothing else about the
    // task it adds, and the spawn still reads it that way. See
    // Task.extraTaskDraft.
    'ALTER TABLE tasks ADD COLUMN extra_task_draft TEXT',
    // 0 for every existing row — a habit tracked before this shipped always
    // continued its streak on any same-day-or-cadence completion regardless
    // of time, which is exactly what 0 preserves. See Task.streakRequiresWindow.
    'ALTER TABLE tasks ADD COLUMN streak_requires_window INTEGER NOT NULL DEFAULT 0',
    // NULL for every existing template, which parseTemplateSchedule reads as
    // "never fires by itself" — so an install that upgrades into these columns
    // has exactly the templates it had, all of them tap-to-apply.
    // See TaskTemplate.schedule.
    'ALTER TABLE templates ADD COLUMN schedule TEXT',
    'ALTER TABLE templates ADD COLUMN schedule_last_fired_key TEXT',
    // '[]' at both levels — a price recorded before this shipped left no
    // observation behind it, and back-filling one from `last_price_minor`
    // would invent a history of exactly one that reads as a baseline. An
    // install that upgrades into these columns starts collecting on its next
    // trip and falls back to `last_price_minor` until it has any, which is
    // what it already did. See GroceryItem.priceHistory.
    "ALTER TABLE grocery_items ADD COLUMN price_history TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE grocery_item_shops ADD COLUMN price_history TEXT NOT NULL DEFAULT '[]'",
    // NULL on every existing row, and nothing backfills it: nobody has declined
    // a review task for a generator that didn't exist. It reads as "never
    // declined", which is the state that lets the first one appear. See
    // Project.reviewDeclinedAt for why this is a date rather than a boolean.
    'ALTER TABLE projects ADD COLUMN review_declined_at TEXT',
    // Which of the item's products the user wants. NULL on every existing row;
    // the one-time backfill below turns a legacy brand/variant pair into a
    // product and points this at it, so an install that upgrades into these
    // columns reads exactly as it did. See GroceryItem.preferredProductId.
    'ALTER TABLE grocery_items ADD COLUMN preferred_product_id TEXT',
    // The product you last got at this store, replacing the bare brand string
    // in the column beside it. NULL on every existing link, and nothing
    // backfills it: the old column recorded a brand *name*, and which of the
    // item's products that named is exactly what the app can't work out for a
    // row whose brand has since been edited. It reads as "we've never seen
    // which one came home here", which is the honest answer and the state
    // every link starts in anyway. See ItemShopLink.productId.
    'ALTER TABLE grocery_item_shops ADD COLUMN product_id TEXT',
    // The per-product negative claims, as a JSON map of product id → stamp.
    // '{}' on every existing link; the backfill below migrates a legacy
    // brand_unavailable_at onto the product it was actually about, which is
    // the whole point of keying them. See ItemShopLink.unavailableProductIds.
    "ALTER TABLE grocery_item_shops ADD COLUMN unavailable_product_ids TEXT NOT NULL DEFAULT '{}'",
    // One row per box, unique within the item — see the CREATE above and
    // ItemProduct in types. A migration rather than part of the CREATE for the
    // same reason idx_grocery_items_name_key is: a device that got the table
    // from an earlier build still picks the index up.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_item_products_key ON grocery_item_products(item_id, product_key)',
    // How the barcode source files the product, for aisleForProductCategory.
    // Null on every row cached before this shipped and deliberately never
    // backfilled — see GtinLookup.category.
    'ALTER TABLE gtin_lookups ADD COLUMN category TEXT',
    // NULL for every existing recipe — no opinion is exactly what a recipe
    // written before this shipped has. See Recipe.vote.
    'ALTER TABLE recipes ADD COLUMN vote TEXT',
    // NULL on every existing row — nobody has turned down a pantry check for a
    // generator that didn't exist, and NULL is what "never asked" means for
    // this column. See GroceryItem.pantryCheckDeclinedAt.
    'ALTER TABLE grocery_items ADD COLUMN pantry_check_declined_at TEXT',
    // The barcode on a box, NULL for every product named by hand. See
    // ItemProduct.gtin.
    'ALTER TABLE grocery_item_products ADD COLUMN gtin TEXT',
    // Partial, because a GTIN is globally unique where a product key is unique
    // only within its item — and because the overwhelming majority of rows
    // have no barcode, which a plain UNIQUE index would index anyway. SQLite
    // treats NULLs as distinct, so the WHERE clause is about size and intent
    // rather than correctness.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_item_products_gtin ON grocery_item_products(gtin) WHERE gtin IS NOT NULL',
    // Nobody has answered a question that didn't exist, so every existing row
    // starts at zero and reads as "never said" rather than as "never happens" —
    // see describeDisposalHistory, which renders nothing until something has
    // been answered. See GroceryItem.usedUpCount.
    'ALTER TABLE grocery_items ADD COLUMN used_up_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE grocery_items ADD COLUMN spoiled_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE grocery_items ADD COLUMN last_spoiled_at TEXT',
    // The pantry, per box rather than per item. NULL on every existing row is
    // exactly right and needs no backfill: a box nobody has said anything about
    // defers to its item, which is what every box did before these existed, so
    // an install upgrading into them reads precisely as it did yesterday. See
    // ItemProduct.onHandUntil for why there are four of these and not five.
    'ALTER TABLE grocery_item_products ADD COLUMN on_hand_until TEXT',
    'ALTER TABLE grocery_item_products ADD COLUMN expires_at TEXT',
    'ALTER TABLE grocery_item_products ADD COLUMN frozen_at TEXT',
    'ALTER TABLE grocery_item_products ADD COLUMN opened_at TEXT',
    // NULL on every existing row, and the backfill lives in useTaskStore's
    // initialize() rather than here: the value is the *local* day-of-month of
    // an ISO due date, and SQLite's strftime would read a stored 'Z' offset
    // as UTC and hand back the wrong day either side of midnight. NULL reads
    // as "no anchor captured", which getNextDueDate treats exactly as it
    // behaved before this column existed. See Task.recurrenceAnchorDay.
    'ALTER TABLE tasks ADD COLUMN recurrence_anchor_day INTEGER',
    // Which fields the Backfill screen (src/screens/BackfillScreen.tsx) has
    // been told not to ask about again, for this task specifically — "this
    // one genuinely doesn't need a time estimate" rather than "not right now"
    // (the latter is skippedIds, session-only, never persisted). '[]' on
    // every existing row reads as "hasn't been asked", which is correct: the
    // screen didn't exist before this.
    "ALTER TABLE tasks ADD COLUMN backfill_dismissed_fields TEXT NOT NULL DEFAULT '[]'",
  ];
  for (const sql of migrations) {
    try { db.runSync(sql); } catch (_) { /* column already exists */ }
  }

  // Change tracking for multi-device sync. Ordered deliberately: the columns
  // exist by now (above), the backfill runs while there are still no triggers
  // to fire, and only then are the triggers installed — so stamping every
  // pre-existing row costs one UPDATE per table rather than one per row.
  for (const sql of backfillStatements()) {
    try { db.runSync(sql); } catch (_) { /* table predates this install */ }
  }
  for (const sql of installStatements()) {
    try { db.runSync(sql); } catch (_) { /* trigger or index already current */ }
  }
  try { dbPruneSyncDeletions(); } catch (_) { /* nothing to prune */ }

  // Backfill seen_at for tasks that predate the "new" dot feature so they
  // don't all light up as new the moment this ships — treat them as already
  // seen as of their creation. New rows always insert with seen_at set, so
  // this only ever touches legacy rows and is a no-op after the first run.
  try { db.runSync('UPDATE tasks SET seen_at = created_at WHERE seen_at IS NULL'); } catch (_) {}

  // Backfill generated_kind/generated_source_id from the three per-generator
  // columns they replaced, same shape as the seen_at backfill above: guarded on
  // the new column being NULL, so it touches only legacy rows and is a no-op
  // from the second launch onwards. Nothing writes the old columns any more, so
  // a row that misses this pass would read as a task nobody generated — the
  // meal would spawn a second cook task, and the first would stop being
  // rewritten when the meal moved.
  for (const [kind, column] of [
    ['mealCook', 'meal_entry_id'],
    ['groceryUseUp', 'grocery_item_id'],
    ['leftoverUseUp', 'leftover_id'],
  ] as const) {
    try {
      db.runSync(
        `UPDATE tasks SET generated_kind = ?, generated_source_id = ${column}
         WHERE generated_kind IS NULL AND ${column} IS NOT NULL`,
        [kind]
      );
    } catch (_) { /* column never existed on this install */ }
  }
  // The nudge had no back-pointer at all: it was recognised by its link, which
  // is what `hasLiveMealPlanNudgeTask` used to match on. Anything carrying that
  // link is what the old check would have counted, so this preserves the
  // dedupe rule exactly — including for a task the user happened to write with
  // the same link, which the old rule also counted.
  try {
    db.runSync(
      `UPDATE tasks SET generated_kind = 'mealPlanNudge'
       WHERE generated_kind IS NULL AND link_url = 'dundundun://mealplan'`
    );
  } catch (_) {}

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

  // One-time migration: an item's brand/variant pair becomes a real product
  // row, and the item points at it.
  //
  // Every install that had ever set either field arrives here with exactly one
  // box named, which is precisely what the old two-string model could hold —
  // so this changes nothing on screen. It just gives that box an identity, so
  // the next one you try is a second row rather than an overwrite.
  //
  // Guarded on a settings flag rather than on the table being empty: a user who
  // adds products, deletes them all and relaunches must not have their old
  // brand resurrected. (The flag is deliberately absent from SYNCED_SETTING_KEYS
  // — sending it to a device that hasn't run this would skip the migration
  // there permanently.)
  if (dbGetSetting('grocery_products_migration_done') !== '1') {
    const legacy = db.getAllSync<{ id: string; brand: string | null; variant: string | null }>(
      `SELECT id, brand, variant FROM grocery_items
        WHERE (brand IS NOT NULL AND brand != '') OR (variant IS NOT NULL AND variant != '')`
    );
    for (const row of legacy) {
      try {
        const productKey = productKeyFor(row.brand, row.variant);
        if (!productKey) continue;
        const productId = generateId();
        db.runSync(
          `INSERT OR IGNORE INTO grocery_item_products
             (id, item_id, brand, variant, product_key, rating, note, purchase_count, last_purchased_at, created_at)
           VALUES (?,?,?,?,?,NULL,'',0,NULL,?)`,
          [productId, row.id, row.brand ?? null, row.variant ?? null, productKey, new Date().toISOString()]
        );
        db.runSync('UPDATE grocery_items SET preferred_product_id = ? WHERE id = ?', [productId, row.id]);
        // The store-side evidence follows the same box. A link's legacy brand
        // string is only safe to read as "this product" when it still matches
        // what the item asks for — an item whose brand was edited since left
        // that column naming something that is no longer any product of this
        // item, and the honest reading of it is then "we don't know which one".
        if (row.brand) {
          db.runSync(
            'UPDATE grocery_item_shops SET product_id = ? WHERE item_id = ? AND brand = ?',
            [productId, row.id, row.brand]
          );
        }
        // The negative claims, keyed to the product they were actually about —
        // the whole reason unavailable_product_ids is a map. Per link because
        // each carries its own stamp, which is the part that makes a claim
        // weighable rather than permanent.
        const claims = db.getAllSync<{ shop_id: string; brand_unavailable_at: string }>(
          `SELECT shop_id, brand_unavailable_at FROM grocery_item_shops
            WHERE item_id = ? AND brand_unavailable_at IS NOT NULL`,
          [row.id]
        );
        for (const claim of claims) {
          db.runSync(
            'UPDATE grocery_item_shops SET unavailable_product_ids = ? WHERE item_id = ? AND shop_id = ?',
            [JSON.stringify({ [productId]: claim.brand_unavailable_at }), row.id, claim.shop_id]
          );
        }
      } catch (_) { /* a column this install never had */ }
    }
    dbSetSetting('grocery_products_migration_done', '1');
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
 * That "explicit decision" used to be enforced by nothing but habit.
 * `database.test.ts`'s "every real table is accounted for" check now reads
 * the live schema and fails if a table is in neither this list nor
 * BACKUP_EXCLUDED_TABLES below — so forgetting one is a red test at the PR
 * that added the table, not a support conversation after someone's restore
 * came back missing a feature's worth of data.
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
  'grocery_item_subs',
  'grocery_item_products',
  'grocery_store_aliases',
  'recipes',
  // Before meal_plan_entries: an entry can point at a leftover.
  'leftovers',
  'meal_plan_entries',
  'templates',
  'tasks',
  'settings',
] as const;

/**
 * Real tables deliberately outside BACKUP_TABLES, with the reason attached —
 * an exception has to be argued for here, not just missing from the list
 * above, or the completeness check this exists for would have nothing to
 * catch a genuine omission with.
 */
export const BACKUP_EXCLUDED_TABLES = [
  // Tombstones for change tracking (#1550) — bookkeeping about the sync
  // mechanism, not app data. Restoring already deletes and reinserts every
  // backed-up table, which writes fresh tombstones through the ordinary
  // triggers; carrying the old ones forward would restore stale deletion
  // history rather than the task list the user actually asked for back.
  'sync_deletions',
  // The barcode cache. Every row is reconstructible from the barcode alone,
  // and reconstructing one costs a single free request the next time that item
  // is scanned — so putting it in a backup would inflate the file with data
  // that is not the user's and that a restore does not need to recover. What a
  // GTIN means is also not something a restore could get *wrong*, which is the
  // risk BACKUP_TABLES exists to manage.
  'gtin_lookups',
  // The focus session in flight. It describes what the user is doing *right
  // now* on this device — a countdown mid-step, against tasks whose ids the
  // restore is about to replace wholesale. Restoring it would resume a session
  // from another day (or another phone) over a task list that has since moved
  // on; there is nothing here a user would miss having back.
  'focus_sessions',
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
      // updated_at is deliberately dropped, so every restored row is stamped
      // as a change made here and now.
      //
      // A backup written since change tracking shipped carries the timestamps
      // the rows had when it was taken, and keeping them would mean a peer
      // holding newer copies wins — the restore would be silently undone a
      // minute later, with nothing on screen explaining why. Restoring is an
      // explicit choice about which data you want, so it has to travel.
      //
      // It is also the only coherent option: the DELETE above writes a
      // tombstone per row, and those are stamped now regardless. Preserving
      // the inserts' stamps would give a restore where the removals propagate
      // and the restorations don't.
      const allowed = dbTableColumns(table).filter(c => c !== 'updated_at');

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

// ─── Sync change tracking ────────────────────────────────────────────────────

/**
 * Whether the live handle is one whose changes may be synced.
 *
 * Demo mode swaps the whole database for a throwaway (see
 * switchToDemoDatabase), and its contents are seeded fiction — uploading them
 * would put fake groceries on the user's real phone. The transport must gate
 * on this rather than assuming, because the swap is invisible from outside:
 * every db* function keeps working and quietly answers about demo data.
 */
export function isSyncableDatabase(): boolean {
  return db === realDb;
}

/**
 * Everything that changed after `since`, or everything there is when null.
 *
 * Read inside a transaction against a single `until` taken from the database's
 * own clock, and bounded by it at both ends. Both halves matter: taking the
 * cursor from SQLite rather than JS keeps it on the same clock the triggers
 * stamp with (a device whose JS clock runs a few milliseconds ahead would
 * otherwise skip its own writes), and the upper bound means a row written
 * while this is being read is left for the next window instead of being
 * reported under a cursor that has already moved past it.
 *
 * **The lower bound is inclusive, and that is deliberate.** Stamps have
 * millisecond resolution, so several changes can share one — and an exclusive
 * `> since` silently drops any row written in the same millisecond as the
 * previous read's `until`. Re-sending a row costs a duplicate that the apply
 * side discards (last-writer-wins is idempotent by construction); dropping one
 * costs an edit that never arrives and that nothing will ever retry. This is
 * also what makes the stamp trigger's same-millisecond no-op safe — see the
 * note on it in syncTracking.ts.
 *
 * Deliberately returns raw rows rather than model objects, exactly as
 * backup.ts does — see the note in its header. A column added to the schema
 * and not yet threaded into rowToTask still syncs.
 */
export function dbSyncChangesSince(since: string | null): SyncChangeSet {
  let result: SyncChangeSet | null = null;

  db.withTransactionSync(() => {
    const until =
      db.getFirstSync<{ now: string }>(`SELECT ${NOW_EXPR} AS now`)?.now ??
      new Date().toISOString();

    const tables: Record<string, BackupRow[]> = {};
    for (const { name } of SYNC_TRACKED_TABLES) {
      const rows = since === null
        ? db.getAllSync<BackupRow>(
            `SELECT * FROM "${name}" WHERE updated_at <= ?`,
            [until]
          )
        : db.getAllSync<BackupRow>(
            `SELECT * FROM "${name}" WHERE updated_at >= ? AND updated_at <= ?`,
            [since, until]
          );
      // Only some settings rows travel; every other table sends all of them.
      // Filtered here rather than in the trigger so the policy lives in one
      // readable list — see SYNCED_SETTING_KEYS.
      tables[name] = name === 'settings'
        ? rows.filter(r => typeof r.key === 'string' && isSyncedSettingKey(r.key))
        : rows;
    }

    // A first read needs no deletions: a peer that has never heard of a row
    // has nothing to delete, and the tombstones only reach back as far as
    // whenever tracking was installed anyway.
    const deletionRows = since === null
      ? []
      : db.getAllSync<{ table_name: string; row_key: string; deleted_at: string }>(
          `SELECT table_name, row_key, deleted_at FROM ${SYNC_DELETIONS_TABLE}
            WHERE deleted_at >= ? AND deleted_at <= ?
            ORDER BY deleted_at ASC`,
          [since, until]
        );

    result = {
      since,
      until,
      tables,
      deletions: deletionRows
        .filter(r => r.table_name !== 'settings' || isSyncedSettingKey(r.row_key))
        .map(r => ({
          table: r.table_name,
          rowKey: r.row_key,
          deletedAt: r.deleted_at,
        })),
    };
  });

  // withTransactionSync runs the callback synchronously, so this is always set.
  return result as unknown as SyncChangeSet;
}

const DEVICE_ID_KEY = 'syncDeviceId';
const CURSOR_KEY_PREFIX = 'syncCursor:';

/**
 * This device's stable id, minted on first use.
 *
 * Lives in `settings`, which is the one table sync deliberately doesn't carry
 * (see SYNC_TRACKED_TABLES) — so it cannot travel to the other device and make
 * two devices claim the same identity. That the storage happens to guarantee
 * this is luck worth naming: if settings ever start syncing by allowlist, this
 * key and the cursors below must stay off it.
 */
export function dbGetDeviceId(): string {
  const existing = dbGetSetting(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = generateId();
  dbSetSetting(DEVICE_ID_KEY, id);
  return id;
}

/**
 * How far this device has caught up with a given source.
 *
 * Keyed by source rather than global because a device may eventually read from
 * more than one place (a relay, another device's file), and one shared cursor
 * would have whichever synced first hide the others' changes.
 */
export function dbGetSyncCursor(source: string): string | null {
  return dbGetSetting(`${CURSOR_KEY_PREFIX}${source}`);
}

export function dbSetSyncCursor(source: string, cursor: string): void {
  dbSetSetting(`${CURSOR_KEY_PREFIX}${source}`, cursor);
}

/** The tracked-table definition for a name off the wire, or null if unknown. */
function trackedTable(name: string): SyncTable | null {
  return SYNC_TRACKED_TABLES.find(t => t.name === name) ?? null;
}

/** `WHERE id = ?`, and-ed across a composite key, with its bound values. */
function keyClause(table: SyncTable, rowKey: string): { sql: string; values: string[] } {
  const values = rowKey.split(KEY_SEPARATOR);
  return {
    sql: table.key.map(col => `"${col}" = ?`).join(' AND '),
    values,
  };
}

/** The row key of a row off the wire, or null if it doesn't carry its own key. */
function rowKeyOf(table: SyncTable, row: BackupRow): string | null {
  const parts: string[] = [];
  for (const col of table.key) {
    const v = row[col];
    if (typeof v !== 'string' || v === '') return null;
    parts.push(v);
  }
  return parts.join(KEY_SEPARATOR);
}

/**
 * Applies a peer's changes to the local database.
 *
 * One transaction: a half-applied payload is the state nothing can recover
 * from, since the cursor would advance past changes that never landed. Same
 * reasoning as dbReplaceAllData.
 *
 * Three properties this leans on, all of them from the tracking layer:
 *
 * - **Rows are written with the peer's `updated_at`**, so the stamp triggers
 *   leave them alone (that guard is exactly what it exists for). Restamping
 *   them as locally-modified would have the two devices trade the same row
 *   back and forth forever, each reading the other's echo as news.
 * - **An insert clears the row's tombstone**, so a peer's re-creation of a row
 *   this device deleted resolves without special handling here.
 * - **A delete performed here writes a local tombstone**, which is correct:
 *   this device now genuinely holds that deletion and should pass it on to any
 *   third device.
 *
 * Unknown tables and unknown columns are dropped rather than rejected —
 * `projectRow` intersects against the live schema, the same way a restore
 * does. A peer on a newer build sending a column this one has never heard of
 * must not fail the whole sync.
 */
export function dbApplySyncChanges(payload: SyncPayload): ApplyReport {
  const report = emptyApplyReport();

  db.withTransactionSync(() => {
    for (const [name, rows] of Object.entries(payload.tables)) {
      const table = trackedTable(name);
      if (!table) continue;
      const allowed = dbTableColumns(name);

      for (const raw of rows) {
        const rowKey = rowKeyOf(table, raw);
        const remoteStamp = raw.updated_at;
        if (rowKey === null || typeof remoteStamp !== 'string') {
          report.skipped++;
          continue;
        }
        // Checked again on the way in, not just on the way out. A peer on an
        // older or newer build decides its own allowlist, and a migration flag
        // arriving here would make this device skip that migration for good —
        // so this side refuses rather than trusting the sender's policy.
        if (name === 'settings' && !isSyncedSettingKey(rowKey)) {
          report.skipped++;
          continue;
        }

        const where = keyClause(table, rowKey);
        const local = db.getFirstSync<{ updated_at: string | null }>(
          `SELECT updated_at FROM "${name}" WHERE ${where.sql}`,
          where.values
        );

        if (local && !remoteRowWins(local.updated_at, remoteStamp)) {
          report.skipped++;
          continue;
        }

        const row = projectRow(raw, allowed);
        const columns = Object.keys(row);
        if (columns.length === 0) {
          report.skipped++;
          continue;
        }
        const quoted = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        db.runSync(
          `INSERT OR REPLACE INTO "${name}" (${quoted}) VALUES (${placeholders})`,
          columns.map(c => row[c])
        );
        if (local) report.updated++;
        else report.inserted++;
      }
    }

    for (const deletion of payload.deletions) {
      const table = trackedTable(deletion.table);
      if (!table) continue;
      if (deletion.table === 'settings' && !isSyncedSettingKey(deletion.rowKey)) continue;

      const where = keyClause(table, deletion.rowKey);
      const local = db.getFirstSync<{ updated_at: string | null }>(
        `SELECT updated_at FROM "${deletion.table}" WHERE ${where.sql}`,
        where.values
      );
      if (!local) continue; // Already gone, or never seen. Nothing to do.

      if (!remoteDeletionWins(local.updated_at, deletion.deletedAt)) {
        report.deletionsRefused++;
        continue;
      }

      db.runSync(`DELETE FROM "${deletion.table}" WHERE ${where.sql}`, where.values);
      report.deleted++;
    }
  });

  return report;
}

/**
 * Drops tombstones older than the retention window.
 *
 * Runs at startup from initDatabase. Kept exported so the transport can call
 * it after a successful round trip, but note that it must never be given a
 * shorter window than TOMBSTONE_RETENTION_DAYS on the reasoning there — a
 * tombstone dropped before every device has seen it resurrects the row.
 */
export function dbPruneSyncDeletions(olderThanDays = TOMBSTONE_RETENTION_DAYS): number {
  const res = db.runSync(
    `DELETE FROM ${SYNC_DELETIONS_TABLE}
      WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
    [`-${olderThanDays} days`]
  );
  return res.changes ?? 0;
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
    deadlineOnCalendar: Boolean(row.deadline_on_calendar),
    deferUntil: (row.defer_until as string) ?? null,
    timeSegments: parseTimeSegments(row.time_of_day),
    windowStart: (row.window_start as string) ?? null,
    windowEnd: (row.window_end as string) ?? null,
    recurrenceType: (row.recurrence_type as Task['recurrenceType']) ?? 'none',
    recurrenceInterval: (row.recurrence_interval as number) ?? 1,
    recurrenceDays: JSON.parse((row.recurrence_days as string) ?? '[]') as number[],
    recurrenceMonthDay: (row.recurrence_month_day as number | null) ?? null,
    recurrenceWeekOrdinal: (row.recurrence_week_ordinal as number | null) ?? null,
    recurrenceAnchorDay: (row.recurrence_anchor_day as number | null) ?? null,
    recurrenceEndDate: (row.recurrence_end_date as string) ?? null,
    recurrenceCount: (row.recurrence_count as number | null) ?? null,
    recurrenceFromCompletion: Boolean(row.recurrence_from_completion),
    targetCount: (row.target_count as number | null) ?? null,
    progressCount: (row.progress_count as number) ?? 0,
    targetUnit: (row.target_unit as string | null) ?? null,
    allowOvershoot: Boolean(row.allow_overshoot),
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    pinned: Boolean(row.pinned),
    pinnedOrder: (row.pinned_order as number) ?? 0,
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
    extraTaskEveryN: (row.extra_task_every_n as number | null) ?? null,
    extraTaskTitle: (row.extra_task_title as string | null) ?? null,
    extraTaskDraft: parseExtraTaskDraft(row.extra_task_draft as string | null),
    extraTaskTally: (row.extra_task_tally as number) ?? 0,
    previousExtraTaskTally: (row.previous_extra_task_tally as number) ?? 0,
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
    streakRequiresWindow: Boolean(row.streak_requires_window),
    seriesDefaults: row.series_defaults ? (JSON.parse(row.series_defaults as string) as Partial<Task>) : null,
    archived: Boolean(row.archived),
    archivedAt: (row.archived_at as string) ?? null,
    linkUrl: (row.link_url as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    emailAddress: (row.email_address as string) ?? null,
    blockedById: (row.blocked_by_id as string | null) ?? null,
    deliverableKind: (row.deliverable_kind as DeliverableKind | null) ?? null,
    deliverableValue: (row.deliverable_value as string | null) ?? null,
    generatedKind: (row.generated_kind as GeneratedKind | null) ?? null,
    generatedSourceId: (row.generated_source_id as string | null) ?? null,
    pendingImport: parsePendingImport(row.pending_import),
    postponeCount: (row.postpone_count as number) ?? 0,
    postponeMuted: Boolean(row.postpone_muted),
    driftingSince: (row.drifting_since as string | null) ?? null,
    calendarEventId: (row.calendar_event_id as string | null) ?? null,
    timeBlockEventId: (row.time_block_event_id as string | null) ?? null,
    backfillDismissedFields: JSON.parse((row.backfill_dismissed_fields as string) ?? '[]') as string[],
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
      recurrence_type, recurrence_interval, recurrence_days, recurrence_month_day, recurrence_week_ordinal, recurrence_anchor_day, recurrence_end_date, recurrence_count, recurrence_from_completion,
      tags, category, sort_order, pinned, priority, effort, estimated_minutes, streak_count, streak_date, parent_id, reminder_time,
      cycle_enabled, cycle_index, cycle_items, vacation_pause, timer_started_at, actual_minutes, previous_occurrence_id,
      previous_streak_count, previous_streak_date, series_defaults, group_id, archived, archived_at, project_id, link_url,
      timed_minutes, timer_elapsed_seconds, target_count, progress_count, series_id, series_month_days, series_repeat_months,
      show_streak, blocked_by_id, reminder_kind, chain_step_on_schedule, pending_import, missed_at, auto_scheduled_at,
      target_unit, phone_number, email_address, allow_overshoot, pinned_order, generated_kind,
      generated_source_id, postpone_count, postpone_muted, drifting_since,
      extra_task_every_n, extra_task_title, extra_task_draft, extra_task_tally, previous_extra_task_tally,
      deliverable_kind, deliverable_value, deadline_on_calendar, calendar_event_id, time_block_event_id,
      streak_requires_window, backfill_dismissed_fields
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.id, task.title, task.notes, task.completed ? 1 : 0,
      task.completedAt, task.createdAt, task.seenAt, task.dueDate, task.deadline, task.deadlineOffsetDays ?? null, task.deadlineMonthDay ?? null, task.deferUntil,
      task.timeSegments.length ? JSON.stringify(task.timeSegments) : null, task.windowStart, task.windowEnd,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceMonthDay ?? null, task.recurrenceWeekOrdinal ?? null, task.recurrenceAnchorDay ?? null, task.recurrenceEndDate, task.recurrenceCount,
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
      task.allowOvershoot ? 1 : 0,
      task.pinnedOrder,
      task.generatedKind ?? null,
      task.generatedSourceId ?? null,
      task.postponeCount,
      task.postponeMuted ? 1 : 0,
      task.driftingSince ?? null,
      task.extraTaskEveryN ?? null,
      task.extraTaskTitle ?? null,
      task.extraTaskDraft ? JSON.stringify(task.extraTaskDraft) : null,
      task.extraTaskTally,
      task.previousExtraTaskTally,
      task.deliverableKind ?? null,
      task.deliverableValue ?? null,
      task.deadlineOnCalendar ? 1 : 0,
      task.calendarEventId ?? null,
      task.timeBlockEventId ?? null,
      task.streakRequiresWindow ? 1 : 0,
      JSON.stringify(task.backfillDismissedFields),
    ]
  );
}

export function dbUpdateTask(task: Task): void {
  db.runSync(
    `UPDATE tasks SET
      title=?, notes=?, completed=?, completed_at=?, seen_at=?,
      due_date=?, deadline=?, deadline_offset_days=?, deadline_month_day=?, defer_until=?, time_of_day=?, window_start=?, window_end=?,
      recurrence_type=?, recurrence_interval=?, recurrence_days=?, recurrence_month_day=?, recurrence_week_ordinal=?, recurrence_anchor_day=?, recurrence_end_date=?, recurrence_count=?, recurrence_from_completion=?,
      tags=?, category=?, sort_order=?, pinned=?, priority=?, effort=?, estimated_minutes=?,
      streak_count=?, streak_date=?, parent_id=?, reminder_time=?,
      cycle_enabled=?, cycle_index=?, cycle_items=?, vacation_pause=?, timer_started_at=?, actual_minutes=?,
      previous_occurrence_id=?, previous_streak_count=?, previous_streak_date=?, series_defaults=?, group_id=?,
      archived=?, archived_at=?, project_id=?, link_url=?,
      timed_minutes=?, timer_elapsed_seconds=?, target_count=?, progress_count=?, series_id=?, series_month_days=?, series_repeat_months=?,
      show_streak=?, blocked_by_id=?, reminder_kind=?, chain_step_on_schedule=?, pending_import=?, missed_at=?, auto_scheduled_at=?,
      target_unit=?, phone_number=?, email_address=?, allow_overshoot=?, pinned_order=?, generated_kind=?,
      generated_source_id=?, postpone_count=?, postpone_muted=?, drifting_since=?,
      extra_task_every_n=?, extra_task_title=?, extra_task_draft=?, extra_task_tally=?, previous_extra_task_tally=?,
      deliverable_kind=?, deliverable_value=?, deadline_on_calendar=?, calendar_event_id=?, time_block_event_id=?,
      streak_requires_window=?, backfill_dismissed_fields=?
    WHERE id=?`,
    [
      task.title, task.notes, task.completed ? 1 : 0, task.completedAt, task.seenAt,
      task.dueDate, task.deadline, task.deadlineOffsetDays ?? null, task.deadlineMonthDay ?? null, task.deferUntil, task.timeSegments.length ? JSON.stringify(task.timeSegments) : null,
      task.windowStart, task.windowEnd,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceMonthDay ?? null, task.recurrenceWeekOrdinal ?? null, task.recurrenceAnchorDay ?? null, task.recurrenceEndDate, task.recurrenceCount,
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
      task.allowOvershoot ? 1 : 0,
      task.pinnedOrder,
      task.generatedKind ?? null,
      task.generatedSourceId ?? null,
      task.postponeCount,
      task.postponeMuted ? 1 : 0,
      task.driftingSince ?? null,
      task.extraTaskEveryN ?? null,
      task.extraTaskTitle ?? null,
      task.extraTaskDraft ? JSON.stringify(task.extraTaskDraft) : null,
      task.extraTaskTally,
      task.previousExtraTaskTally,
      task.deliverableKind ?? null,
      task.deliverableValue ?? null,
      task.deadlineOnCalendar ? 1 : 0,
      task.calendarEventId ?? null,
      task.timeBlockEventId ?? null,
      task.streakRequiresWindow ? 1 : 0,
      JSON.stringify(task.backfillDismissedFields),
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

export function dbBatchUpdatePinnedOrders(updates: { id: string; pinnedOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, pinnedOrder } of updates) {
      db.runSync('UPDATE tasks SET pinned_order = ? WHERE id = ?', [pinnedOrder, id]);
    }
  });
}

/**
 * The per-id companion to dbBulkSetWhen / dbBulkSetDefer, which stay
 * single-purpose deliberately (see the note on dbBulkSetDefer). A bulk
 * reschedule sets one date on every task but lands a *different* postpone count
 * on each, since the rule depends on where each task was before — so it can't
 * ride along on those setters. Same split dbBatchUpdatePinnedOrders makes
 * beside bulkTogglePin.
 */
export function dbBatchUpdatePostponeCounts(
  updates: { id: string; postponeCount: number; driftingSince: string | null }[],
): void {
  db.withTransactionSync(() => {
    for (const { id, postponeCount, driftingSince } of updates) {
      // Written together, never separately: the count and the day it started
      // from describe one run of pushes, and a batch that set one without the
      // other would leave a row claiming pushes with no start (or a start with
      // no pushes) until the next single-task write happened to repair it.
      db.runSync('UPDATE tasks SET postpone_count = ?, drifting_since = ? WHERE id = ?', [
        postponeCount,
        driftingSince,
        id,
      ]);
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
    excludeFromSuggestions: Boolean(row.exclude_from_pin_suggestions),
    excludeFromNewTasksBanner: Boolean(row.exclude_from_new_tasks_banner),
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
  return { id, name, scheduleDays: null, scheduleStart: null, scheduleEnd: null, hideOnVacation: false, excludeFromSuggestions: false, excludeFromNewTasksBanner: false, defaultTimeSegments: [], sortOrder, emoji: null };
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

// Column stays exclude_from_pin_suggestions — this predates the rename to
// "excludeFromSuggestions" (see Category.excludeFromSuggestions) and renaming
// it would need a data migration for existing installs, the same trade the
// cycle_*/chain* columns already make.
export function dbSetCategoryExcludeFromSuggestions(id: string, exclude: boolean): void {
  db.runSync('UPDATE categories SET exclude_from_pin_suggestions = ? WHERE id = ?', [exclude ? 1 : 0, id]);
}

export function dbSetCategoryExcludeFromNewTasksBanner(id: string, exclude: boolean): void {
  db.runSync('UPDATE categories SET exclude_from_new_tasks_banner = ? WHERE id = ?', [exclude ? 1 : 0, id]);
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
    'INSERT INTO categories (id, name, schedule_days, schedule_start, schedule_end, hide_on_vacation, exclude_from_pin_suggestions, exclude_from_new_tasks_banner, default_time_segments, sort_order, emoji) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [
      category.id,
      category.name,
      category.scheduleDays ? JSON.stringify(category.scheduleDays) : null,
      category.scheduleStart,
      category.scheduleEnd,
      category.hideOnVacation ? 1 : 0,
      category.excludeFromSuggestions ? 1 : 0,
      category.excludeFromNewTasksBanner ? 1 : 0,
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

// ─── Focus sessions ─────────────────────────────────────────────────────────

function rowToFocusSession(row: Record<string, unknown>): FocusSession {
  return {
    id: row.id as string,
    startedAt: row.started_at as string,
    steps: JSON.parse((row.steps as string) ?? '[]') as FocusStep[],
    stepIndex: row.step_index as number,
    stepStartedAt: (row.step_started_at as string) ?? null,
    stepElapsedSeconds: row.step_elapsed_seconds as number,
    completedTaskIds: JSON.parse((row.completed_task_ids as string) ?? '[]') as string[],
  };
}

/** The session in flight, or null. Never more than one row to choose between. */
export function dbGetFocusSession(): FocusSession | null {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM focus_sessions LIMIT 1');
  return rows.length === 0 ? null : rowToFocusSession(rows[0]);
}

/**
 * Write the session, replacing whatever was there.
 *
 * Deletes first rather than upserting on the id: the table's invariant is one
 * row, not one row per id, and a start that reused an id would otherwise be
 * the only thing keeping a stale session out.
 */
export function dbSaveFocusSession(session: FocusSession): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM focus_sessions');
    db.runSync(
      `INSERT INTO focus_sessions
         (id, started_at, steps, step_index, step_started_at, step_elapsed_seconds, completed_task_ids)
       VALUES (?,?,?,?,?,?,?)`,
      [
        session.id, session.startedAt, JSON.stringify(session.steps), session.stepIndex,
        session.stepStartedAt, session.stepElapsedSeconds, JSON.stringify(session.completedTaskIds),
      ]
    );
  });
}

export function dbClearFocusSession(): void {
  db.runSync('DELETE FROM focus_sessions');
}

// ─── Groceries ──────────────────────────────────────────────────────────────

function rowToGroceryItem(row: Record<string, unknown>): GroceryItem {
  return {
    id: row.id as string,
    name: row.name as string,
    nameKey: row.name_key as string,
    preferredProductId: (row.preferred_product_id as string) ?? null,
    // The column is still called brand_strict: it predates products, and the
    // migration list here is append-only. Same column/field split as
    // cycle_enabled → chainEnabled on tasks.
    productStrict: Boolean(row.brand_strict),
    aisle: (row.aisle as string) ?? 'Other',
    quantity: (row.quantity as string) ?? null,
    quantityFromRecipe: Boolean(row.quantity_from_recipe),
    note: (row.note as string) ?? '',
    onList: Boolean(row.on_list),
    checked: Boolean(row.checked),
    sortOrder: (row.sort_order as number) ?? 0,
    purchaseCount: (row.purchase_count as number) ?? 0,
    lastAddedAt: (row.last_added_at as string) ?? null,
    lastPurchasedAt: (row.last_purchased_at as string) ?? null,
    createdAt: row.created_at as string,
    onHandUntil: (row.on_hand_until as string) ?? null,
    sourceRecipeId: (row.source_recipe_id as string) ?? null,
    sourceRecipeTitle: (row.source_recipe_title as string) ?? null,
    choiceGroup: (row.choice_group as string) ?? null,
    isStaple: Boolean(row.is_staple),
    expiresAt: (row.expires_at as string) ?? null,
    frozenAt: (row.frozen_at as string) ?? null,
    openedAt: (row.opened_at as string) ?? null,
    runningLowAt: (row.running_low_at as string) ?? null,
    shelfLifeDays: (row.shelf_life_days as number) ?? null,
    lastPriceMinor: (row.last_price_minor as number) ?? null,
    lastPricedAt: (row.last_priced_at as string) ?? null,
    lastPriceQuantity: (row.last_price_quantity as string) ?? null,
    // Nullable on purpose — see the column's migration note. `?? null` rather
    // than Boolean(), which would flatten the unanswered state into a refusal.
    useUpTask: row.use_up_task === null || row.use_up_task === undefined
      ? null
      : Boolean(row.use_up_task),
    pantryCheckDeclinedAt: (row.pantry_check_declined_at as string) ?? null,
    // `?? 0` covers a row read before the migration landed, which is the same
    // reading as the column default: nobody has answered for it yet.
    usedUpCount: (row.used_up_count as number) ?? 0,
    spoiledCount: (row.spoiled_count as number) ?? 0,
    lastSpoiledAt: (row.last_spoiled_at as string) ?? null,
    priceHistory: parsePriceHistory(row.price_history as string | null),
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
      (id, name, name_key, aisle, quantity, quantity_from_recipe, note, on_list, checked, in_catalog, sort_order,
       purchase_count, last_added_at, last_purchased_at, created_at, on_hand_until,
       source_recipe_id, source_recipe_title, choice_group, is_staple, expires_at, frozen_at, opened_at, running_low_at, shelf_life_days, use_up_task,
       pantry_check_declined_at, used_up_count, spoiled_count, last_spoiled_at,
       last_price_minor, last_priced_at, last_price_quantity, preferred_product_id, brand_strict)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.name, item.nameKey, item.aisle, item.quantity ?? null, item.quantityFromRecipe ? 1 : 0, item.note,
      item.onList ? 1 : 0, item.checked ? 1 : 0, 1, item.sortOrder,
      item.purchaseCount,
      item.lastAddedAt ?? null, item.lastPurchasedAt ?? null, item.createdAt,
      item.onHandUntil ?? null,
      item.sourceRecipeId ?? null, item.sourceRecipeTitle ?? null,
      item.choiceGroup ?? null, item.isStaple ? 1 : 0,
      item.expiresAt ?? null, item.frozenAt ?? null, item.openedAt ?? null, item.runningLowAt ?? null, item.shelfLifeDays ?? null,
      item.useUpTask === null || item.useUpTask === undefined ? null : item.useUpTask ? 1 : 0,
      item.pantryCheckDeclinedAt ?? null,
      item.usedUpCount, item.spoiledCount, item.lastSpoiledAt ?? null,
      item.lastPriceMinor ?? null, item.lastPricedAt ?? null, item.lastPriceQuantity ?? null,
      item.preferredProductId ?? null, item.productStrict ? 1 : 0,
    ]
  );
}

export function dbUpdateGroceryItem(item: GroceryItem): void {
  db.runSync(
    `UPDATE grocery_items SET
       name=?, name_key=?, aisle=?, quantity=?, quantity_from_recipe=?, note=?, on_list=?, checked=?, in_catalog=?,
       sort_order=?, purchase_count=?, last_added_at=?, last_purchased_at=?,
       on_hand_until=?, source_recipe_id=?, source_recipe_title=?, choice_group=?, is_staple=?,
       expires_at=?, frozen_at=?, opened_at=?, running_low_at=?, shelf_life_days=?, use_up_task=?,
       pantry_check_declined_at=?, used_up_count=?, spoiled_count=?, last_spoiled_at=?,
       last_price_minor=?, last_priced_at=?, last_price_quantity=?,
       preferred_product_id=?, brand_strict=?
     WHERE id=?`,
    [
      item.name, item.nameKey, item.aisle, item.quantity ?? null, item.quantityFromRecipe ? 1 : 0, item.note,
      item.onList ? 1 : 0, item.checked ? 1 : 0, 1, item.sortOrder,
      item.purchaseCount,
      item.lastAddedAt ?? null, item.lastPurchasedAt ?? null,
      item.onHandUntil ?? null,
      item.sourceRecipeId ?? null, item.sourceRecipeTitle ?? null,
      item.choiceGroup ?? null, item.isStaple ? 1 : 0,
      item.expiresAt ?? null, item.frozenAt ?? null, item.openedAt ?? null, item.runningLowAt ?? null, item.shelfLifeDays ?? null,
      item.useUpTask === null || item.useUpTask === undefined ? null : item.useUpTask ? 1 : 0,
      item.pantryCheckDeclinedAt ?? null,
      item.usedUpCount, item.spoiledCount, item.lastSpoiledAt ?? null,
      item.lastPriceMinor ?? null, item.lastPricedAt ?? null, item.lastPriceQuantity ?? null,
      item.preferredProductId ?? null, item.productStrict ? 1 : 0,
      item.id,
    ]
  );
}

export function dbDeleteGroceryItem(id: string): void {
  // Written out rather than left to a foreign key: expo-sqlite has FK
  // enforcement off, so ON DELETE CASCADE would silently do nothing and leave
  // links pointing at an item that no longer exists. Same reason
  // dbBulkDeleteTasks handles its parent_id children by hand.
  db.runSync('DELETE FROM grocery_item_shops WHERE item_id = ?', [id]);
  // Both directions, because the link is directional: the deleted row can be
  // either half of a pair, and a substitution naming an item that no longer
  // exists is unreadable rather than merely orphaned. The reads shrug such a
  // row off anyway (see substitutesFor), but leaving them would have a name
  // reused later silently inherit a swap nobody made for it.
  db.runSync('DELETE FROM grocery_item_subs WHERE item_id = ? OR sub_item_id = ?', [id, id]);
  // The item's products go with it — a box that isn't a box *of* anything is
  // unreadable, not merely orphaned. The per-store claims those products carry
  // ride along inside grocery_item_shops.unavailable_product_ids, which the
  // first statement above already deleted for this item.
  db.runSync('DELETE FROM grocery_item_products WHERE item_id = ?', [id]);
  // An alias whose meaning is gone means nothing. Unlike the pointers that are
  // left to dangle elsewhere here, this one can't be shrugged off at read time
  // and left in place: the phrase would keep claiming a line, resolve to
  // nothing, and so silently suppress the name match that would have found the
  // right row — a remembered alias outranks every similarity tier.
  db.runSync('DELETE FROM grocery_store_aliases WHERE item_id = ?', [id]);
  db.runSync('DELETE FROM grocery_items WHERE id = ?', [id]);
}

/**
 * Ends a shopping trip: everything in the trolley comes off the list and is
 * recorded as bought. Returns the ids it touched so the store can patch its
 * own array without a re-read.
 *
 * This is an UPDATE and never a DELETE, and the reason isn't only that the
 * catalog is the feature. purchase_count/last_purchased_at *are* the ranking
 * signal behind autocomplete and the catalog ranking — delete the row and the eleventh
 * milk ranks like the typo you made once.
 *
 * `shopId` is optional and null is a real answer, not a missing one: a trip
 * finished without naming a store bumps the item exactly as it always has and
 * writes no link. That's what keeps this additive — picking a store never
 * became a step you have to complete mid-supermarket.
 *
 * `priceById` is the same kind of optional: whatever prices the user bothered
 * to type, in minor units, keyed by item id. An item that isn't in it keeps
 * whatever price it already had — a trip you didn't price is not a trip that
 * says the price has changed.
 */
export function dbFinishGroceryShopping(
  purchasedAt: string,
  shopId: string | null = null,
  expiresAtById: Readonly<Record<string, string>> = {},
  priceById: Readonly<Record<string, number>> = {},
  // The rows this trip is putting straight in the freezer — the scan sheet's
  // own toggle, made about the bag being carried home right now. It overrides
  // the blanket `frozen_at = NULL` below, which is about the *previous* bag.
  // Without it the store's matching in-memory patch was the only record of the
  // freeze, so it survived until the next load and no further (see
  // finishShopping, whose comment has always said this wins).
  frozenIds: ReadonlySet<string> = new Set()
): string[] {
  // quantity comes back with the id because a price is only meaningful
  // alongside what it bought (see GroceryItem.lastPriceQuantity), and the
  // trolley's quantities are still on the rows at this point — the bulk UPDATE
  // below doesn't touch that column.
  // preferred_product_id/brand_strict come back for the same reason quantity
  // does: the link written below can only record which one this store had if it
  // knows what the row was asking for. See ItemShopLink.productId.
  const rows = db.getAllSync<{
    id: string;
    quantity: string | null;
    preferred_product_id: string | null;
    brand_strict: number | null;
    price_history: string | null;
  }>(
    `SELECT id, quantity, preferred_product_id, brand_strict, price_history
       FROM grocery_items WHERE checked = 1 AND on_list = 1`
  );
  if (rows.length === 0) return [];
  db.runSync(
    `UPDATE grocery_items
        SET on_list = 0, checked = 0, in_catalog = 1,
            purchase_count = purchase_count + 1,
            last_purchased_at = ?,
            on_hand_until = NULL,
            frozen_at = NULL,
            opened_at = NULL,
            running_low_at = NULL,
            quantity = CASE WHEN quantity_from_recipe = 1 THEN NULL ELSE quantity END,
            quantity_from_recipe = 0
      WHERE checked = 1 AND on_list = 1`,
    [purchasedAt]
  );
  // on_hand_until is *cleared* by a purchase rather than written, and it rides
  // the bulk UPDATE above because null is the same value for every row.
  // frozen_at rides along for the same reason and a related one: the freezer
  // claim was about the bag you had, and a fresh expires_at is stamped per-row
  // below — leaving the claim would suspend the new day the moment it landed. A
  // purchase is evidence probablyHaveReason reads directly (#1770); the only
  // thing it has to say about the column is that buying something refutes an
  // "Out of it" left on it — the same correction a purchase already makes to a
  // shop link's unavailableAt, and the same reason: nobody should have to take
  // that claim back by hand once they've come home with the thing.
  for (const row of rows) {
    // The preferred product's own counter, which is what makes "bought 3
    // times" sayable under one box on an item bought forty times. Only the
    // preferred one: a trip that bought an item with no preference says
    // nothing about which box came home, and inventing an answer here is the
    // same unfalsifiable move ItemShopLink.productId refuses to make.
    //
    // It is not conditional on the item being strict, unlike the shop link
    // below. Naming a product you want is already the statement that you
    // bought that one; being *strict* is an extra claim about stores, and a
    // purchase count has nothing to do with stores.
    if (row.preferred_product_id) {
      // The box's own pantry claims are cleared in the same breath, for the
      // reason the item's are above: the packet you froze, opened or declared
      // yourself out of is not the packet you have just carried home. Its
      // expires_at is cleared rather than re-stamped — a box has no shelf life
      // of its own to stamp from (shelfLifeDays is an item fact), so it falls
      // back to the item's fresh day until something is said about this packet
      // specifically.
      db.runSync(
        `UPDATE grocery_item_products
            SET purchase_count = purchase_count + 1,
                last_purchased_at = ?,
                on_hand_until = NULL,
                expires_at = NULL,
                frozen_at = NULL,
                opened_at = NULL
          WHERE id = ?`,
        [purchasedAt, row.preferred_product_id]
      );
    }
    // A use-by day, unlike the clear above, is per item: it comes off the shelf
    // life of *this* row (see groceryShelfLife.ts), so it can't ride the bulk
    // UPDATE. Only the rows the lexicon recognises get one — a bag of rice is
    // in this trip too and has no day worth naming.
    const expires = expiresAtById[row.id];
    if (expires) db.runSync('UPDATE grocery_items SET expires_at = ? WHERE id = ?', [expires, row.id]);
    // Re-stamped after the blanket clear above, not exempted from it: the claim
    // being written is about this trip's bag, so it wants this trip's instant.
    if (frozenIds.has(row.id)) {
      db.runSync('UPDATE grocery_items SET frozen_at = ? WHERE id = ?', [purchasedAt, row.id]);
    }
    // Only the rows the user actually priced. An absent price leaves the last
    // one standing, stamp and all, rather than clearing it — silence on this
    // trip is not a claim that the old price is wrong.
    const price = priceById[row.id];
    if (price !== undefined) {
      // The rolling window rides the same statement as the price it is a
      // record of, so the two can never disagree about what this trip paid.
      // Read off the row selected above rather than re-queried — the UPDATE
      // that ran before this loop touches neither column.
      const history = appendPriceObservation(
        parsePriceHistory(row.price_history),
        // Stamped with the box the row was asking for, so the run can later
        // answer "what does the one I buy cost" rather than "what does bread
        // cost". Null when the item has no preference, which is the honest
        // record of not knowing which one came home — see PriceObservation.
        {
          minor: price,
          quantity: row.quantity ?? null,
          at: purchasedAt,
          productId: row.preferred_product_id ?? null,
        }
      );
      db.runSync(
        `UPDATE grocery_items
            SET last_price_minor = ?, last_priced_at = ?, last_price_quantity = ?,
                price_history = ?
          WHERE id = ?`,
        [price, purchasedAt, row.quantity ?? null, JSON.stringify(history), row.id]
      );
    }
  }
  if (shopId) {
    for (const row of rows) {
      // Buying it here clears any "they don't have it" on the same row: a
      // purchase refutes the claim outright, and it's the one correction the
      // user should never have to make by hand. The count is left alone — the
      // store did stock it, then didn't, and now does.
      db.runSync(
        `INSERT INTO grocery_item_shops (item_id, shop_id, purchase_count, last_purchased_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(item_id, shop_id)
         DO UPDATE SET purchase_count = purchase_count + 1,
                       last_purchased_at = excluded.last_purchased_at,
                       unavailable_at = NULL,
                       unavailable_product_ids = '{}'`,
        [row.id, shopId, purchasedAt]
      );
      // Which one they had, and only when the row insisted on one. A strict
      // item is a row the user would not have substituted, so a purchase here
      // is real evidence this store carries the box they want; on a row with no
      // rule the same purchase says nothing about which one came home, so
      // nothing is written and the link's product stays whatever it was.
      // Mirrored in useGroceryStore.finishShopping's in-memory patch.
      //
      // Its own statement for the same reason the price below is: "leave the
      // old value alone" and "write this one" can't share an upsert column.
      if (row.brand_strict && row.preferred_product_id) {
        db.runSync(
          'UPDATE grocery_item_shops SET product_id = ? WHERE item_id = ? AND shop_id = ?',
          [row.preferred_product_id, row.id, shopId]
        );
      }
      // A second statement rather than more columns on the upsert above,
      // because "leave the old price alone" and "write this one" can't share a
      // COALESCE: an item with no quantity would pair its new price with the
      // previous trip's quantity string, which is the one pairing this field
      // exists to prevent.
      const price = priceById[row.id];
      if (price !== undefined) {
        // Read back rather than carried down from the SELECT above, because
        // the upsert may have only just minted this link — there was no row to
        // have read a history off when the trip started.
        const existing = db.getFirstSync<{ price_history: string | null }>(
          'SELECT price_history FROM grocery_item_shops WHERE item_id = ? AND shop_id = ?',
          [row.id, shopId]
        );
        const history = appendPriceObservation(
          parsePriceHistory(existing?.price_history ?? null),
          // Same stamp as the item-level run above, and it has to be the same
          // value: the two runs record one purchase, so a caller comparing a
          // store's baseline against the item's must be comparing like boxes.
          {
            minor: price,
            quantity: row.quantity ?? null,
            at: purchasedAt,
            productId: row.preferred_product_id ?? null,
          }
        );
        db.runSync(
          `UPDATE grocery_item_shops
              SET last_price_minor = ?, last_priced_at = ?, last_price_quantity = ?,
                  price_history = ?
            WHERE item_id = ? AND shop_id = ?`,
          [price, purchasedAt, row.quantity ?? null, JSON.stringify(history), row.id, shopId]
        );
      }
    }
  }
  return rows.map(r => r.id);
}

/**
 * Clears the list without buying anything — "I'm not doing this trip after
 * all". Deliberately does not touch purchase_count: nothing was bought, so
 * inflating the ranking signal would teach autocomplete a lie.
 *
 * **Unlists only.** It used to also delete the rows that had never been in the
 * catalog, but the decision of which rows an abandoned trip leaves behind now
 * needs an item's products, subs, shop links and aliases to answer — see
 * `hasUserFacts` — and those live above this layer. `clearList` does the
 * sweep, this returns everything it unlisted.
 */
export function dbClearGroceryList(): string[] {
  const rows = db.getAllSync<{ id: string }>('SELECT id FROM grocery_items WHERE on_list = 1');
  if (rows.length === 0) return [];
  db.runSync('UPDATE grocery_items SET on_list = 0, checked = 0 WHERE on_list = 1');
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
// here and not on the row: `clearList` sweeps a row carrying nothing and
// `deleteItem` takes any row at all, and the filing has to outlive either. Same tolerance for a corrupt
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

// The list's two ways of grouping unchecked items — see
// buildGroceryRecipeSections. A scalar, so it's a settings key like
// grocery_aisle_order rather than a column; anything but 'recipe' reads back
// as 'aisle', which is also what an install that predates this setting gets.
export function dbGetGroceryGroupBy(): 'aisle' | 'recipe' {
  return dbGetSetting('grocery_group_by') === 'recipe' ? 'recipe' : 'aisle';
}

export function dbSetGroceryGroupBy(groupBy: 'aisle' | 'recipe'): void {
  dbSetSetting('grocery_group_by', groupBy);
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
    // Anything unrecognised reads as 'itemized', which is also what a row that
    // predates the column gets: an ordinary receipt is the overwhelming default
    // and the only value that costs nothing to be wrong about (you scan, and it
    // works or it doesn't).
    receiptStyle: isReceiptStyle(row.receipt_style) ? row.receipt_style : 'itemized',
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

export function dbSetShopReceiptStyle(id: string, style: ReceiptStyle): void {
  db.runSync('UPDATE grocery_shops SET receipt_style = ? WHERE id = ?', [style, id]);
}

/**
 * Deleting a store takes its purchase records with it — a link to a store that
 * doesn't exist is unreadable, not merely orphaned. Same hand-written cascade
 * as dbDeleteGroceryItem, and for the same reason (FKs are off).
 */
export function dbDeleteGroceryShop(id: string): void {
  db.runSync('DELETE FROM grocery_item_shops WHERE shop_id = ?', [id]);
  // The store's remembered phrases go with it. They are claims about how *this
  // printer* abbreviates, so they mean nothing once the store is gone, and
  // leaving them would have a store re-added under a new id inherit nothing
  // while the orphans went on matching against a shop nobody can name.
  db.runSync('DELETE FROM grocery_store_aliases WHERE shop_id = ?', [id]);
  db.runSync('DELETE FROM grocery_shops WHERE id = ?', [id]);
}

function rowToItemShopLink(row: Record<string, unknown>): ItemShopLink {
  return {
    itemId: row.item_id as string,
    shopId: row.shop_id as string,
    purchaseCount: (row.purchase_count as number) ?? 0,
    lastPurchasedAt: (row.last_purchased_at as string) ?? null,
    unavailableAt: (row.unavailable_at as string) ?? null,
    lastPriceMinor: (row.last_price_minor as number) ?? null,
    lastPricedAt: (row.last_priced_at as string) ?? null,
    lastPriceQuantity: (row.last_price_quantity as string) ?? null,
    priceHistory: parsePriceHistory(row.price_history as string | null),
    productId: (row.product_id as string) ?? null,
    unavailableProductIds: parseUnavailableProductIds(row.unavailable_product_ids as string | null),
  };
}

export function dbGetAllItemShopLinks(): ItemShopLink[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM grocery_item_shops');
  return rows.map(rowToItemShopLink);
}

/**
 * Upsert, so the manual "I get this here", the manual "they don't have it" and
 * a finished trip share one path. The whole row is written, `unavailable_at`
 * included — callers pass the link they want to exist, not a patch — so a
 * caller flipping a negative back off does it by passing null, not by hoping
 * the column is left alone.
 */
export function dbSetItemShopLink(link: ItemShopLink): void {
  db.runSync(
    `INSERT INTO grocery_item_shops
       (item_id, shop_id, purchase_count, last_purchased_at, unavailable_at,
        last_price_minor, last_priced_at, last_price_quantity, product_id, unavailable_product_ids)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(item_id, shop_id)
     DO UPDATE SET purchase_count = excluded.purchase_count,
                   last_purchased_at = excluded.last_purchased_at,
                   unavailable_at = excluded.unavailable_at,
                   last_price_minor = excluded.last_price_minor,
                   last_priced_at = excluded.last_priced_at,
                   last_price_quantity = excluded.last_price_quantity,
                   product_id = excluded.product_id,
                   unavailable_product_ids = excluded.unavailable_product_ids`,
    [
      link.itemId,
      link.shopId,
      link.purchaseCount,
      link.lastPurchasedAt ?? null,
      link.unavailableAt ?? null,
      link.lastPriceMinor ?? null,
      link.lastPricedAt ?? null,
      link.lastPriceQuantity ?? null,
      link.productId ?? null,
      JSON.stringify(link.unavailableProductIds ?? {}),
    ]
  );
}

export function dbDeleteItemShopLink(itemId: string, shopId: string): void {
  db.runSync('DELETE FROM grocery_item_shops WHERE item_id = ? AND shop_id = ?', [itemId, shopId]);
}

// ─── Item products ──────────────────────────────────────────────────────────

function rowToItemProduct(row: Record<string, unknown>): ItemProduct {
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    brand: (row.brand as string) ?? null,
    variant: (row.variant as string) ?? null,
    productKey: row.product_key as string,
    // Anything that isn't one of the two known ratings reads as no opinion —
    // a column written by a newer build, or a hand-edited backup, must not
    // render as a rating this build can't explain.
    rating: row.rating === 'loved' || row.rating === 'avoid' ? row.rating : null,
    note: (row.note as string) ?? '',
    purchaseCount: (row.purchase_count as number) ?? 0,
    lastPurchasedAt: (row.last_purchased_at as string) ?? null,
    gtin: (row.gtin as string) ?? null,
    onHandUntil: (row.on_hand_until as string) ?? null,
    expiresAt: (row.expires_at as string) ?? null,
    frozenAt: (row.frozen_at as string) ?? null,
    openedAt: (row.opened_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function dbGetAllItemProducts(): ItemProduct[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM grocery_item_products ORDER BY created_at ASC'
  );
  return rows.map(rowToItemProduct);
}

/**
 * Upsert by id, so writing a product and editing its brand, variant, note or
 * rating share one path — the same contract dbSetItemShopLink has: the caller
 * passes the row it wants to exist, not a patch.
 *
 * The UNIQUE index on `(item_id, product_key)` is what refuses a duplicate, so
 * this throws rather than silently merging two boxes into one. The store
 * catches that and matches the existing product instead — see `addProduct`.
 *
 * **`gtin` is deliberately absent from both the insert and the update**, which
 * is the one place this breaks the "the caller passes the row it wants to
 * exist" contract. A barcode is globally unique, so claiming one has to
 * release it from whichever box held it before, and that is two statements
 * rather than a column in an upsert — `dbSetProductGtin` is the only writer.
 * Without the carve-out `mergeItems` would throw: it re-parents the loser's
 * products *before* the cascade deletes them, so for a moment two rows would
 * claim one barcode.
 */
export function dbSetItemProduct(product: ItemProduct): void {
  db.runSync(
    `INSERT INTO grocery_item_products
       (id, item_id, brand, variant, product_key, rating, note, purchase_count, last_purchased_at,
        on_hand_until, expires_at, frozen_at, opened_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id)
     DO UPDATE SET brand = excluded.brand,
                   variant = excluded.variant,
                   product_key = excluded.product_key,
                   rating = excluded.rating,
                   note = excluded.note,
                   purchase_count = excluded.purchase_count,
                   last_purchased_at = excluded.last_purchased_at,
                   on_hand_until = excluded.on_hand_until,
                   expires_at = excluded.expires_at,
                   frozen_at = excluded.frozen_at,
                   opened_at = excluded.opened_at`,
    [
      product.id,
      product.itemId,
      product.brand ?? null,
      product.variant ?? null,
      product.productKey,
      product.rating ?? null,
      product.note,
      product.purchaseCount,
      product.lastPurchasedAt ?? null,
      product.onHandUntil ?? null,
      product.expiresAt ?? null,
      product.frozenAt ?? null,
      product.openedAt ?? null,
      product.createdAt,
    ]
  );
}

/**
 * Points a barcode at one box, taking it off whichever box held it before.
 *
 * Release then claim, in that order, because the partial UNIQUE index on
 * `gtin` means the two can't overlap even for a statement. That ordering is
 * also what makes this safe to call at any point during `mergeItems`, where a
 * folded product adopts the loser's barcode while the loser's row is still
 * there waiting for the cascade.
 *
 * **Two bare statements, no transaction of its own**, deliberately: both call
 * sites already run inside `dbTransaction`, and opening a second one there
 * would nest `withTransactionSync` — the thing that comment warns against.
 * Wrap a future standalone caller rather than putting one back here; a run
 * that released without claiming loses a link, which is recoverable, where a
 * nested BEGIN throws on device and passes in tests (better-sqlite3 nests via
 * savepoints, expo-sqlite does not).
 *
 * Re-scanning a barcode onto a different box is an ordinary correction, not an
 * error: the latest thing a person confirmed is what the code means, the same
 * rule `dbSetStoreAlias` applies to a phrase.
 */
export function dbSetProductGtin(productId: string, gtin: string): void {
  db.runSync('UPDATE grocery_item_products SET gtin = NULL WHERE gtin = ? AND id != ?', [gtin, productId]);
  db.runSync('UPDATE grocery_item_products SET gtin = ? WHERE id = ?', [gtin, productId]);
}

/**
 * Deleting a product takes every pointer at it with it, in both directions:
 * the item that preferred it goes back to "no opinion", the store links that
 * recorded getting it here forget which one it was, and the per-store "they
 * haven't got this one" claims about it go too.
 *
 * Hand-written like every other cascade here, because FKs are off. The claims
 * live inside a JSON column, so that half is a read-modify-write rather than a
 * DELETE — bounded by how many stores hold a claim about this one product.
 */
export function dbDeleteItemProduct(id: string): void {
  db.runSync('UPDATE grocery_items SET preferred_product_id = NULL WHERE preferred_product_id = ?', [id]);
  db.runSync('UPDATE grocery_item_shops SET product_id = NULL WHERE product_id = ?', [id]);
  const links = db.getAllSync<{ item_id: string; shop_id: string; unavailable_product_ids: string | null }>(
    `SELECT item_id, shop_id, unavailable_product_ids FROM grocery_item_shops
      WHERE unavailable_product_ids LIKE ?`,
    [`%${id}%`]
  );
  for (const link of links) {
    const claims = parseUnavailableProductIds(link.unavailable_product_ids);
    if (claims[id] === undefined) continue;
    delete claims[id];
    db.runSync(
      'UPDATE grocery_item_shops SET unavailable_product_ids = ? WHERE item_id = ? AND shop_id = ?',
      [JSON.stringify(claims), link.item_id, link.shop_id]
    );
  }
  db.runSync('DELETE FROM grocery_item_products WHERE id = ?', [id]);
}

// ─── Store aliases ──────────────────────────────────────────────────────────

function rowToStoreAlias(row: Record<string, unknown>): StoreAlias {
  return {
    id: row.id as string,
    shopId: (row.shop_id as string) ?? '',
    rawKey: row.raw_key as string,
    itemId: row.item_id as string,
    hitCount: (row.hit_count as number) ?? 0,
    createdAt: row.created_at as string,
    lastUsedAt: row.last_used_at as string,
  };
}

export function dbGetAllStoreAliases(): StoreAlias[] {
  return db
    .getAllSync<Record<string, unknown>>('SELECT * FROM grocery_store_aliases')
    .map(rowToStoreAlias);
}

/**
 * Records a confirmation, creating the alias or bumping the one already there.
 *
 * Upserts on the unique pair rather than on the id, because the caller knows
 * the phrase and the store but not whether this app has seen them together
 * before — and minting a second id for the same pair is exactly what the index
 * exists to refuse. A repeat confirmation bumps the count and the stamp; a
 * confirmation naming a *different* item overwrites the pointer, since the
 * latest thing a person said a phrase means is what it means.
 */
export function dbSetStoreAlias(alias: StoreAlias): void {
  db.runSync(
    `INSERT INTO grocery_store_aliases
       (id, shop_id, raw_key, item_id, hit_count, created_at, last_used_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(shop_id, raw_key) DO UPDATE SET
       item_id = excluded.item_id,
       hit_count = grocery_store_aliases.hit_count + 1,
       last_used_at = excluded.last_used_at`,
    [
      alias.id,
      alias.shopId,
      alias.rawKey,
      alias.itemId,
      alias.hitCount,
      alias.createdAt,
      alias.lastUsedAt,
    ]
  );
}

/** How many barcodes this device has answers for, for the Settings row. */
export function dbCountGtinLookups(): number {
  return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM gtin_lookups')?.n ?? 0;
}

/**
 * Forgets every cached barcode.
 *
 * The escape hatch for the one thing this cache can get permanently wrong. A
 * *miss* expires on its own after GTIN_MISS_TTL_DAYS, but a **hit is kept for
 * ever** on the reasoning that what a GTIN denotes never changes — which is
 * true of the barcode and not of this app's reading of it. A source that
 * returns an ugly or wrong name, or a parser that mis-reads a field, writes
 * that answer once and there is otherwise no way to ask again.
 *
 * Cheap to use and close to harmless: every row is reconstructible, and the
 * cost of clearing is one request per barcode the next time it is scanned.
 * That asymmetry is why this is a plain button rather than something guarded.
 */
export function dbClearGtinLookups(): void {
  db.runSync('DELETE FROM gtin_lookups');
}

export function dbDeleteStoreAlias(id: string): void {
  db.runSync('DELETE FROM grocery_store_aliases WHERE id = ?', [id]);
}

// ─── Barcode lookups ────────────────────────────────────────────────────────

function rowToGtinLookup(row: Record<string, unknown>): GtinLookup {
  return {
    gtin: row.gtin as string,
    found: row.found === 1,
    name: (row.name as string) ?? '',
    brand: (row.brand as string) ?? null,
    quantity: (row.quantity as string) ?? null,
    category: (row.category as string) ?? null,
    source: (row.source as string) ?? '',
    fetchedAt: row.fetched_at as string,
  };
}

/**
 * One cached barcode, or null if it has never been asked.
 *
 * Read one at a time rather than loaded into a store like every other grocery
 * table, and that's the deliberate difference: this is a cache nothing renders,
 * queried on the way to the network at the moment a code is scanned. Holding it
 * in memory would mean carrying every barcode ever seen for the lifetime of the
 * app to save a keyed lookup on a table with a primary key.
 */
export function dbGetGtinLookup(gtin: string): GtinLookup | null {
  const row = db.getFirstSync<Record<string, unknown>>(
    'SELECT * FROM gtin_lookups WHERE gtin = ?',
    [gtin]
  );
  return row ? rowToGtinLookup(row) : null;
}

/**
 * Upsert by GTIN — same contract as `dbSetItemProduct`: the caller passes the
 * row it wants to exist, not a patch. Re-asking a stale miss overwrites it in
 * place, so the table is bounded by distinct barcodes seen rather than by how
 * often they were asked about.
 */
export function dbSetGtinLookup(entry: GtinLookup): void {
  db.runSync(
    `INSERT INTO gtin_lookups (gtin, found, name, brand, quantity, category, source, fetched_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(gtin) DO UPDATE SET
       found = excluded.found,
       name = excluded.name,
       brand = excluded.brand,
       quantity = excluded.quantity,
       category = excluded.category,
       source = excluded.source,
       fetched_at = excluded.fetched_at`,
    [
      entry.gtin,
      entry.found ? 1 : 0,
      entry.name,
      entry.brand,
      entry.quantity,
      entry.category,
      entry.source,
      entry.fetchedAt,
    ]
  );
}

// ─── Substitutes ────────────────────────────────────────────────────────────

function rowToItemSubLink(row: Record<string, unknown>): ItemSubLink {
  return {
    itemId: row.item_id as string,
    subItemId: row.sub_item_id as string,
    note: (row.note as string) ?? null,
    createdAt: row.created_at as string,
    ratioFrom: (row.ratio_from as string) ?? null,
    ratioTo: (row.ratio_to as string) ?? null,
    standing: row.standing === 1,
  };
}

export function dbGetAllItemSubLinks(): ItemSubLink[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM grocery_item_subs');
  return rows.map(rowToItemSubLink);
}

/**
 * Upsert, so writing a link and editing its note share one path — the caller
 * passes the row it wants to exist, the same contract dbSetItemShopLink has.
 *
 * `created_at` is deliberately part of that: re-linking a pair the user
 * unlinked is a new fact, not a restoration of the old one.
 */
export function dbSetItemSubLink(link: ItemSubLink): void {
  db.runSync(
    `INSERT INTO grocery_item_subs (item_id, sub_item_id, note, created_at, ratio_from, ratio_to, standing)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(item_id, sub_item_id)
     DO UPDATE SET note = excluded.note,
                   ratio_from = excluded.ratio_from,
                   ratio_to = excluded.ratio_to,
                   standing = excluded.standing`,
    [
      link.itemId,
      link.subItemId,
      link.note ?? null,
      link.createdAt,
      link.ratioFrom ?? null,
      link.ratioTo ?? null,
      link.standing ? 1 : 0,
    ]
  );
}

export function dbDeleteItemSubLink(itemId: string, subItemId: string): void {
  db.runSync('DELETE FROM grocery_item_subs WHERE item_id = ? AND sub_item_id = ?', [
    itemId,
    subItemId,
  ]);
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
    sourceType: RECIPE_SOURCE_TYPES.includes(row.source_type as RecipeSourceType)
      ? (row.source_type as RecipeSourceType)
      : null,
    sourcePage: (row.source_page as string) ?? null,
    servings: (row.servings as number) ?? null,
    servingsMax: (row.servings_max as number) ?? null,
    recipeYield: (row.recipe_yield as string) ?? null,
    leftoverKeepDays: (row.leftover_keep_days as number) ?? null,
    imagePath: (row.image_path as string) ?? null,
    // Unrecognised reads as null (untagged), not a guessed value — unlike
    // MealSlot's dinner fallback below, an unset meal type is itself a valid,
    // common answer, so there's no "safest" one to substitute.
    mealType: RECIPE_MEAL_TYPES.includes(row.meal_type as RecipeMealType)
      ? (row.meal_type as RecipeMealType)
      : null,
    tags: parseRecipeTags(row.tags),
    ingredients: parseRecipeIngredients(row.ingredients),
    emptySections: parseEmptySections(row.empty_sections),
    components: parseRecipeComponents(row.components),
    prepTasks: parsePrepTasks(row.prep_tasks),
    steps: parseSteps(row.steps),
    favorite: Boolean(row.favorite),
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    cookCount: (row.cook_count as number) ?? 0,
    lastCookedAt: (row.last_cooked_at as string) ?? null,
    vote: row.vote === 'up' || row.vote === 'down' ? (row.vote as RecipeVote) : null,
    estimatedMinutes: (row.estimated_minutes as number) ?? null,
    timerStartedAt: (row.timer_started_at as string) ?? null,
    timerElapsedSeconds: (row.timer_elapsed_seconds as number) ?? 0,
    lastCookMinutes: (row.last_cook_minutes as number) ?? null,
    cookTimeCount: (row.cook_time_count as number) ?? 0,
    totalCookMinutes: (row.total_cook_minutes as number) ?? 0,
    prepMinutes: (row.prep_minutes as number) ?? null,
    prepTimerStartedAt: (row.prep_timer_started_at as string) ?? null,
    prepTimerElapsedSeconds: (row.prep_timer_elapsed_seconds as number) ?? 0,
    lastPrepMinutes: (row.last_prep_minutes as number) ?? null,
    prepTimeCount: (row.prep_time_count as number) ?? 0,
    totalPrepMinutes: (row.total_prep_minutes as number) ?? 0,
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
      (id, name, name_key, notes, source_url, source_name, author, source, source_type, source_page, servings, servings_max, recipe_yield, leftover_keep_days, image_path, meal_type, tags, ingredients, empty_sections, components, prep_tasks, steps, favorite, sort_order, created_at, cook_count, last_cooked_at, vote,
       estimated_minutes, timer_started_at, timer_elapsed_seconds, last_cook_minutes, cook_time_count, total_cook_minutes,
       prep_minutes, prep_timer_started_at, prep_timer_elapsed_seconds, last_prep_minutes, prep_time_count, total_prep_minutes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      recipe.id, recipe.name, recipe.nameKey, recipe.notes, recipe.sourceUrl ?? null,
      recipe.sourceName ?? null, recipe.author ?? null, recipe.source ?? null,
      recipe.sourceType ?? null, recipe.sourcePage ?? null,
      recipe.servings ?? null, recipe.servingsMax ?? null, recipe.recipeYield ?? null,
      recipe.leftoverKeepDays ?? null,
      recipe.imagePath ?? null, recipe.mealType ?? null,
      JSON.stringify(recipe.tags),
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.emptySections),
      JSON.stringify(recipe.components), JSON.stringify(recipe.prepTasks), JSON.stringify(recipe.steps),
      recipe.favorite ? 1 : 0, recipe.sortOrder, recipe.createdAt,
      recipe.cookCount, recipe.lastCookedAt ?? null, recipe.vote ?? null,
      recipe.estimatedMinutes ?? null, recipe.timerStartedAt ?? null, recipe.timerElapsedSeconds,
      recipe.lastCookMinutes ?? null, recipe.cookTimeCount, recipe.totalCookMinutes,
      recipe.prepMinutes ?? null, recipe.prepTimerStartedAt ?? null, recipe.prepTimerElapsedSeconds,
      recipe.lastPrepMinutes ?? null, recipe.prepTimeCount, recipe.totalPrepMinutes,
    ]
  );
}

export function dbUpdateRecipe(recipe: Recipe): void {
  db.runSync(
    `UPDATE recipes SET
       name=?, name_key=?, notes=?, source_url=?, source_name=?, author=?, source=?, source_type=?, source_page=?, servings=?, servings_max=?, recipe_yield=?, leftover_keep_days=?, image_path=?, meal_type=?, tags=?, ingredients=?, empty_sections=?, components=?, prep_tasks=?, steps=?,
       favorite=?, sort_order=?, cook_count=?, last_cooked_at=?, vote=?,
       estimated_minutes=?, timer_started_at=?, timer_elapsed_seconds=?, last_cook_minutes=?, cook_time_count=?, total_cook_minutes=?,
       prep_minutes=?, prep_timer_started_at=?, prep_timer_elapsed_seconds=?, last_prep_minutes=?, prep_time_count=?, total_prep_minutes=?
     WHERE id=?`,
    [
      recipe.name, recipe.nameKey, recipe.notes, recipe.sourceUrl ?? null,
      recipe.sourceName ?? null, recipe.author ?? null, recipe.source ?? null,
      recipe.sourceType ?? null, recipe.sourcePage ?? null,
      recipe.servings ?? null, recipe.servingsMax ?? null, recipe.recipeYield ?? null,
      recipe.leftoverKeepDays ?? null,
      recipe.imagePath ?? null, recipe.mealType ?? null,
      JSON.stringify(recipe.tags),
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.emptySections),
      JSON.stringify(recipe.components), JSON.stringify(recipe.prepTasks), JSON.stringify(recipe.steps),
      recipe.favorite ? 1 : 0, recipe.sortOrder,
      recipe.cookCount, recipe.lastCookedAt ?? null, recipe.vote ?? null,
      recipe.estimatedMinutes ?? null, recipe.timerStartedAt ?? null, recipe.timerElapsedSeconds,
      recipe.lastCookMinutes ?? null, recipe.cookTimeCount, recipe.totalCookMinutes,
      recipe.prepMinutes ?? null, recipe.prepTimerStartedAt ?? null, recipe.prepTimerElapsedSeconds,
      recipe.lastPrepMinutes ?? null, recipe.prepTimeCount, recipe.totalPrepMinutes,
      recipe.id,
    ]
  );
}

export function dbDeleteRecipe(id: string): void {
  db.runSync('DELETE FROM recipes WHERE id = ?', [id]);
}

/**
 * Repoints a single recipe's saved image at a new file, or clears it.
 *
 * Narrower than `dbUpdateRecipe` on purpose: this exists for restoring a
 * backup (see DataResetSettings.tsx), where the row's other columns already
 * landed verbatim via `dbReplaceAllData` and only `image_path` needs
 * rewriting — to wherever the image bytes the backup carried actually got
 * written on *this* device, which is never the origin device's own path.
 */
export function dbSetRecipeImagePath(id: string, imagePath: string | null): void {
  db.runSync('UPDATE recipes SET image_path = ? WHERE id = ?', [imagePath, id]);
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
    leftoverId: (row.leftover_id as string) ?? null,
    recipeChoices: parseRecipeChoices(row.recipe_choices),
    // Clamped rather than trusted: the column defaults to 1, but a restored
    // backup or a hand-edited row carrying 0 would otherwise render a meal with
    // no quantities at all.
    recipeScale: normalizeScale(row.recipe_scale as number | null),
    // Three-state, so the null has to survive the read rather than collapsing
    // to false the way every other boolean column here does — see
    // MealPlanEntry.cookTask.
    cookTask: row.cook_task === null || row.cook_task === undefined
      ? null
      : Boolean(row.cook_task),
    calendarEventId: (row.calendar_event_id as string | null) ?? null,
  };
}

/**
 * One entry by id, straight from SQLite.
 *
 * The by-id read the range-scoped store otherwise has no way to do. Completing
 * a "Cook X" task has to stamp its meal cooked whatever week the meal plan
 * screen happens to be showing — including never having been opened this
 * launch, which is the common case for a task ticked off on Today — and
 * `entries` holds only the loaded window. See cookTaskFor in useMealPlanStore.
 */
export function dbGetMealPlanEntry(id: string): MealPlanEntry | null {
  const row = db.getFirstSync<Record<string, unknown>>(
    'SELECT * FROM meal_plan_entries WHERE id = ?',
    [id]
  );
  return row ? rowToMealPlanEntry(row) : null;
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
    `INSERT INTO meal_plan_entries (id, date, slot, recipe_id, title, sort_order, created_at, cooked_at, leftover_id, recipe_choices, recipe_scale, cook_task, calendar_event_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      entry.id, entry.date, entry.slot, entry.recipeId ?? null,
      entry.title, entry.sortOrder, entry.createdAt, entry.cookedAt ?? null,
      entry.leftoverId ?? null, JSON.stringify(entry.recipeChoices ?? []),
      normalizeScale(entry.recipeScale),
      entry.cookTask === null || entry.cookTask === undefined ? null : (entry.cookTask ? 1 : 0),
      entry.calendarEventId ?? null,
    ]
  );
}

export function dbUpdateMealPlanEntry(entry: MealPlanEntry): void {
  db.runSync(
    `UPDATE meal_plan_entries SET date=?, slot=?, recipe_id=?, title=?, sort_order=?, cooked_at=?, leftover_id=?, recipe_choices=?, recipe_scale=?, cook_task=?, calendar_event_id=? WHERE id=?`,
    [
      entry.date, entry.slot, entry.recipeId ?? null, entry.title, entry.sortOrder,
      entry.cookedAt ?? null, entry.leftoverId ?? null,
      JSON.stringify(entry.recipeChoices ?? []), normalizeScale(entry.recipeScale),
      entry.cookTask === null || entry.cookTask === undefined ? null : (entry.cookTask ? 1 : 0),
      entry.calendarEventId ?? null,
      entry.id,
    ]
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

// ─── Leftovers ──────────────────────────────────────────────────────────────

function rowToLeftover(row: Record<string, unknown>): Leftover {
  const finishedAt = (row.finished_at as string) ?? null;
  const outcome = row.outcome as string | null;
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    recipeId: (row.recipe_id as string) ?? null,
    sourceEntryId: (row.source_entry_id as string) ?? null,
    storedAt: row.stored_at as string,
    keepUntil: row.keep_until as string,
    finishedAt,
    // The two columns are one fact, so the mapper enforces the invariant the
    // type states rather than trusting a restored backup with it: an outcome
    // with no instant would render as closed out while every "is it live" read
    // said otherwise, and a stamp with no outcome would leave the row unable to
    // say which ending it got. `eaten` is the honest guess for the latter —
    // "tossed" is a claim about waste this row has no evidence for.
    outcome: finishedAt
      ? (outcome === 'tossed' ? 'tossed' : 'eaten')
      : null,
    createdAt: row.created_at as string,
    frozenAt: (row.frozen_at as string) ?? null,
    useUpTask: row.use_up_task === null || row.use_up_task === undefined
      ? null
      : Boolean(row.use_up_task),
  };
}

/**
 * Every leftover, live and closed out.
 *
 * Wholesale rather than range-scoped, unlike the meal plan: the live set is what
 * the nudge counts and it's bounded by what fits in a fridge, while the closed
 * ones are bounded by LEFTOVER_RETENTION_DAYS. There is no window to scope it
 * *to* — "what's in the fridge right now" isn't a week.
 */
export function dbGetAllLeftovers(): Leftover[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM leftovers ORDER BY keep_until ASC, stored_at ASC'
  );
  return rows.map(rowToLeftover);
}

export function dbInsertLeftover(leftover: Leftover): void {
  db.runSync(
    `INSERT INTO leftovers (id, title, recipe_id, source_entry_id, stored_at, keep_until, finished_at, outcome, created_at, frozen_at, use_up_task)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      leftover.id, leftover.title, leftover.recipeId ?? null, leftover.sourceEntryId ?? null,
      leftover.storedAt, leftover.keepUntil, leftover.finishedAt ?? null,
      leftover.outcome ?? null, leftover.createdAt, leftover.frozenAt ?? null,
      leftover.useUpTask === null || leftover.useUpTask === undefined ? null : (leftover.useUpTask ? 1 : 0),
    ]
  );
}

export function dbUpdateLeftover(leftover: Leftover): void {
  db.runSync(
    `UPDATE leftovers SET title=?, recipe_id=?, source_entry_id=?, stored_at=?, keep_until=?, finished_at=?, outcome=?, frozen_at=?, use_up_task=? WHERE id=?`,
    [
      leftover.title, leftover.recipeId ?? null, leftover.sourceEntryId ?? null,
      leftover.storedAt, leftover.keepUntil, leftover.finishedAt ?? null,
      leftover.outcome ?? null, leftover.frozenAt ?? null,
      leftover.useUpTask === null || leftover.useUpTask === undefined ? null : (leftover.useUpTask ? 1 : 0),
      leftover.id,
    ]
  );
}

/**
 * Deletes the row outright.
 *
 * **No cascade onto meal_plan_entries.leftover_id**, and that's the same call
 * recipe_id makes: the entries that ate it keep their captured `title`, so last
 * Tuesday still reads "Leftover chilli" after the container is long gone.
 * Readers resolve-or-shrug.
 */
export function dbDeleteLeftover(id: string): void {
  db.runSync('DELETE FROM leftovers WHERE id = ?', [id]);
}

/**
 * Drops leftovers closed out before `beforeIso`, returning how many went.
 *
 * `finished_at IS NOT NULL` is load-bearing, not a redundant guard next to the
 * comparison — a live row has a null stamp, and a null compares false either
 * way, but spelling it out is what makes it obvious at the call site that an
 * ancient un-closed container survives this. See LEFTOVER_RETENTION_DAYS.
 */
export function dbPurgeOldLeftovers(beforeIso: string): number {
  return db.runSync(
    'DELETE FROM leftovers WHERE finished_at IS NOT NULL AND finished_at < ?',
    [beforeIso]
  ).changes ?? 0;
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

// The trip happening right now — the store you're standing in, and when you
// said so. Two keys rather than one JSON blob, following vacationMode/
// vacationEnd, which is the same shape: a mode plus the stamp that ends it.
// They are only ever written together (startTrip/endTrip), and a read missing
// either half is no trip, so they can't drift into a half-state.
//
// Nothing here decides whether the trip is still live — utils/activeTrip.ts
// does, against the clock, so a trip left running when the app closed is over
// by the time anything asks. Restoring a month-old backup resurrects these two
// rows and that's fine for the same reason.
export function dbGetTripShopId(): string | null {
  return dbGetSetting('grocery_trip_shop_id') || null;
}

export function dbGetTripStartedAt(): string | null {
  return dbGetSetting('grocery_trip_started_at') || null;
}

export function dbSetTrip(shopId: string | null, startedAt: string | null): void {
  dbSetSetting('grocery_trip_shop_id', shopId ?? '');
  dbSetSetting('grocery_trip_started_at', startedAt ?? '');
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
    completed: Boolean(row.completed),
    completedAt: (row.completed_at as string) ?? null,
    createdAt: row.created_at as string,
    nudgeCadenceDays: (row.nudge_cadence_days as number | null) ?? DEFAULT_NUDGE_CADENCE_DAYS,
    autoSchedule: Boolean(row.auto_schedule),
    sequential: Boolean(row.sequential),
    nudgeOptIn: Boolean(row.nudge_opt_in),
    reviewDeclinedAt: (row.review_declined_at as string) ?? null,
  };
}

export function dbGetAllProjects(): Project[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM projects ORDER BY sort_order ASC');
  return rows.map(rowToProject);
}

export function dbInsertProject(project: Project): void {
  db.runSync(
    'INSERT INTO projects (id, title, notes, target_start_date, target_end_date, category, sort_order, archived, archived_at, completed, completed_at, created_at, nudge_cadence_days, auto_schedule, sequential, nudge_opt_in, review_declined_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      project.id, project.title, project.notes, project.targetStartDate, project.targetEndDate,
      project.category, project.sortOrder, project.archived ? 1 : 0, project.archivedAt,
      project.completed ? 1 : 0, project.completedAt, project.createdAt,
      project.nudgeCadenceDays, project.autoSchedule ? 1 : 0, project.sequential ? 1 : 0, project.nudgeOptIn ? 1 : 0,
      project.reviewDeclinedAt,
    ]
  );
}

export function dbUpdateProject(project: Project): void {
  db.runSync(
    'UPDATE projects SET title=?, notes=?, target_start_date=?, target_end_date=?, category=?, sort_order=?, archived=?, archived_at=?, completed=?, completed_at=?, nudge_cadence_days=?, auto_schedule=?, sequential=?, nudge_opt_in=?, review_declined_at=? WHERE id=?',
    [
      project.title, project.notes, project.targetStartDate, project.targetEndDate,
      project.category, project.sortOrder, project.archived ? 1 : 0, project.archivedAt,
      project.completed ? 1 : 0, project.completedAt,
      project.nudgeCadenceDays, project.autoSchedule ? 1 : 0, project.sequential ? 1 : 0, project.nudgeOptIn ? 1 : 0,
      project.reviewDeclinedAt, project.id,
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
    questions: parseTemplateQuestions(row.questions),
    createdAt: row.created_at as string,
    sortOrder: row.sort_order as number,
    category: (row.category as string) ?? null,
    applyContainer: parseApplyContainer(row.apply_container),
    schedule: parseTemplateSchedule(row.schedule),
    scheduleLastFiredKey: (row.schedule_last_fired_key as string) ?? null,
  };
}

/**
 * Tolerates a null (pre-migration row), malformed JSON, and a frequency from a
 * newer app version — same contract as parseTemplateItems above.
 *
 * A schedule that can't be read comes back null rather than as a repaired
 * default: this is the field that makes the app write tasks unattended, and
 * guessing a frequency for a blob we couldn't parse is how a template starts
 * firing on a day nobody picked. Null means the template still applies fine by
 * hand, which is the safe half of the feature.
 */
function parseTemplateSchedule(raw: unknown): TemplateSchedule | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TemplateSchedule>;
    if (!parsed || typeof parsed !== 'object') return null;
    const frequency = parsed.frequency;
    if (frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'yearly') return null;
    return {
      frequency,
      weekday: typeof parsed.weekday === 'number' ? parsed.weekday : 0,
      monthDay: typeof parsed.monthDay === 'number' ? parsed.monthDay : 1,
      month: typeof parsed.month === 'number' ? parsed.month : 1,
      time: typeof parsed.time === 'string' ? parsed.time : '09:00',
      anchorSpanDays: typeof parsed.anchorSpanDays === 'number' ? parsed.anchorSpanDays : null,
    };
  } catch {
    return null;
  }
}

/** Tolerates a null (pre-migration row), malformed JSON and unknown fields, same as parseTemplateItems above. */
function parseTemplateQuestions(raw: unknown): TemplateQuestion[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeTemplateQuestion) : [];
  } catch {
    return [];
  }
}

/** Tolerates a null (pre-migration row) or an unknown value from a newer app version, same as parseTimeSegments. */
function parseApplyContainer(raw: unknown): TemplateContainer {
  return raw === 'none' || raw === 'project' || raw === 'task' ? raw : 'stack';
}

export function dbGetAllTemplates(): TaskTemplate[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM templates ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToTemplate);
}

export function dbInsertTemplate(template: TaskTemplate): void {
  db.runSync(
    'INSERT INTO templates (id, name, items, item_groups, questions, created_at, sort_order, category, apply_container, schedule, schedule_last_fired_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [template.id, template.name, JSON.stringify(template.items), JSON.stringify(template.itemGroups), JSON.stringify(template.questions), template.createdAt, template.sortOrder, template.category, template.applyContainer, template.schedule ? JSON.stringify(template.schedule) : null, template.scheduleLastFiredKey]
  );
}

export function dbUpdateTemplate(template: TaskTemplate): void {
  db.runSync(
    'UPDATE templates SET name = ?, items = ?, item_groups = ?, questions = ?, sort_order = ?, category = ?, apply_container = ?, schedule = ?, schedule_last_fired_key = ? WHERE id = ?',
    [template.name, JSON.stringify(template.items), JSON.stringify(template.itemGroups), JSON.stringify(template.questions), template.sortOrder, template.category, template.applyContainer, template.schedule ? JSON.stringify(template.schedule) : null, template.scheduleLastFiredKey, template.id]
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
