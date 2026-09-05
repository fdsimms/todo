/**
 * Change tracking — the local half of multi-device sync (#1550).
 *
 * Two facts have to survive for a second device to be able to catch up: when
 * each row last changed, and which rows have been deleted. Neither is
 * recoverable after the fact, which is why this ships before any transport
 * exists (#1551) — a deletion that happened before tracking was installed is
 * simply gone, and no sync engine can invent it.
 *
 * **State-based, not an operation log.** The issue this came from said
 * "oplog", and that would have been the wrong shape. Row-level
 * last-writer-wins converges no matter what order changes arrive in, so the
 * current row plus its `updated_at` is already a complete description of what
 * a peer needs — an operations table would double every write, need its own
 * pruning, and buy nothing back. "Everything since cursor X" is a query here,
 * not a replay.
 *
 * **Triggers, not call sites.** Every write already funnels through
 * database.ts, but that is ~90 `runSync` calls and 20 `DELETE FROM`s, and the
 * failure mode of missing one is silent and unbounded: a row that never
 * reports itself as changed, forever. SQLite triggers cover every write to the
 * table including ones added later, so a store action written next year is
 * tracked without anybody remembering to stamp it. The ~13k lines of store
 * code needed no edits at all.
 */

/** A table whose changes are tracked, and the columns forming its primary key. */
export interface SyncTable {
  readonly name: string;
  /** Primary key columns, in order. More than one means a composite key. */
  readonly key: readonly string[];
}

/**
 * Joins the parts of a composite key into the single `row_key` string a
 * tombstone carries.
 *
 * Safe as a plain character because every id in this app comes from
 * `generateId()`, which is base36 throughout — see src/utils/id.ts. A table
 * keyed by user-entered text would need escaping instead; none is.
 */
export const KEY_SEPARATOR = '|';

/**
 * The tables change tracking is installed on.
 *
 * `settings` is here, but unlike every other table only *some of its rows*
 * travel — see SYNCED_SETTING_KEYS. Tracking the whole table and filtering on
 * read is deliberate: the alternative is a trigger with the allowlist compiled
 * into its WHEN clause, which would have to be rebuilt whenever a key is added
 * and would be invisible from the TypeScript that decides the policy.
 *
 * `database.test.ts`'s "every real table is accounted for" check reads the
 * live schema and fails if a table is in neither this list nor
 * SYNC_EXCLUDED_TABLES below — a table added to the schema and left off both
 * would otherwise just never sync, silently, with nothing to say why.
 */
export const SYNC_TRACKED_TABLES: readonly SyncTable[] = [
  { name: 'settings', key: ['key'] },
  { name: 'tasks', key: ['id'] },
  { name: 'task_groups', key: ['id'] },
  { name: 'projects', key: ['id'] },
  { name: 'people', key: ['id'] },
  { name: 'person_notes', key: ['id'] },
  // Mood entries. They have to travel or the Mood screen reports a different
  // history on each phone — the same reading nobody wants that focus_session_log
  // is tracked to avoid, and worse here: half a person's health record on each
  // device, with every correlation on the screen computed off whichever half.
  // Ids are base36 from generateId(), and an entry is written once and rarely
  // edited, so last-writer-wins is a no-op on almost every row.
  { name: 'mood_logs', key: ['id'] },
  { name: 'person_groups', key: ['id'] },
  { name: 'categories', key: ['id'] },
  { name: 'project_categories', key: ['id'] },
  { name: 'template_categories', key: ['id'] },
  { name: 'templates', key: ['id'] },
  { name: 'grocery_items', key: ['id'] },
  { name: 'grocery_shops', key: ['id'] },
  // The away lists. They have to travel even though *which* one a device is
  // looking at doesn't — see `grocery_active_list` in the prose below.
  { name: 'grocery_lists', key: ['id'] },
  // Which lists a row is in, and its place in each. The membership itself, so
  // without it a second device sees every trolley empty. Keyed on the pair it
  // is keyed on in SQLite; both halves are base36 from generateId() (or '' for
  // the home list), so joining them with KEY_SEPARATOR is safe — the same test
  // grocery_item_shops beside it passes and grocery_store_aliases fails.
  { name: 'grocery_list_items', key: ['item_id', 'list_id'] },
  { name: 'grocery_item_shops', key: ['item_id', 'shop_id'] },
  { name: 'grocery_item_subs', key: ['item_id', 'sub_item_id'] },
  // Keyed by id rather than (item_id, product_key) even though that pair is
  // unique: the id is what `GroceryItem.preferredProductId` and
  // `ItemShopLink.productId` point at, so a merge that re-minted a product
  // under a new id would break both pointers on the receiving device.
  { name: 'grocery_item_products', key: ['id'] },
  // Keyed by id rather than (shop_id, raw_key), which is the pair it is unique
  // on: row_key joins a composite key with KEY_SEPARATOR, and that is only safe
  // because every other key here is base36 from generateId(). This one is a
  // receipt's printed text and can contain anything, '|' included.
  { name: 'grocery_store_aliases', key: ['id'] },
  { name: 'cookbooks', key: ['id'] },
  { name: 'recipes', key: ['id'] },
  { name: 'leftovers', key: ['id'] },
  { name: 'meal_plan_entries', key: ['id'] },
  // Finished focus sessions, and the one place this feature parts company with
  // `focus_sessions` in the exclusion list below. That row is excluded because
  // it is a cursor two devices could fight over; these are closed accounts,
  // written once and never updated, so last-writer-wins on a row that never
  // changes is a no-op. They have to travel or Stats reports a different
  // history on each phone, which is the reading nobody wants of "how much did
  // I actually focus this week". Ids are base36 from generateId().
  { name: 'focus_session_log', key: ['id'] },
];

/**
 * Real tables deliberately outside SYNC_TRACKED_TABLES, with the reason
 * attached — an exception has to be argued for here, not just missing from
 * the list above, or nothing would distinguish a deliberate omission from a
 * forgotten one.
 */
export const SYNC_EXCLUDED_TABLES = [
  // The tombstone table itself (SYNC_DELETIONS_TABLE below — named as a
  // literal here because that constant isn't declared until later in this
  // file, and const bindings can't be read before their own declaration).
  // Tracking changes to the change-tracking table is meaningless: there is no
  // peer that needs to know a tombstone row was written, only that the row it
  // describes was deleted, and the tombstone already says that.
  'sync_deletions',
  // The barcode cache. It holds no user data — only what a GTIN denotes, which
  // is the same answer on every device and for everyone — so there is nothing
  // for two devices to disagree about and nothing a merge would resolve. A
  // second device re-asks as it scans, at one free request per barcode, which
  // is cheaper than a merge strategy for a table whose whole content is a
  // cache of someone else's database.
  'gtin_lookups',
  // The focus session in flight. It is a description of what is happening on
  // one device right now — a countdown mid-step, a cursor into a plan the
  // person is looking at — and there is no second device to merge that with.
  // Two phones running one session between them is not a state this feature
  // has, and syncing the row would create it: whichever device wrote last
  // would move the other one's cursor mid-stretch.
  'focus_sessions',
] as const;

/**
 * The settings rows that travel between devices — an allowlist, never a
 * denylist.
 *
 * The direction matters more than the contents. `settings` is a key/value
 * table holding four quite different kinds of row, and only the first should
 * ever leave the device:
 *
 * 1. **Preferences** — what the app looks like and how it behaves. These are
 *    the reason to sync settings at all: without them a second device has to
 *    be configured from scratch and the two drift apart for good.
 * 2. **One-time migration flags** (`effort_xxs_migration_done`, …). Sending
 *    one of these to a device that has not run that migration makes it skip
 *    the migration **permanently**. Silent, unrecoverable, and it would be
 *    nobody's first guess.
 * 3. **Device-local records** — calendar and list identifiers, the imported-
 *    reminder record, the sync cursors and this device's own id. Meaningless
 *    or actively wrong on another device.
 * 4. **Credentials** — the Anthropic API key. See REDACTED_SETTING_KEYS.
 *
 * A denylist would default a *new* key into syncing, so the day someone adds
 * the next migration flag it ships itself to the other device and that
 * migration never runs. An allowlist defaults to silence: the worst a
 * forgotten key can do is fail to sync, which is visible and fixable.
 */
export const SYNCED_SETTING_KEYS: readonly string[] = [
  // Appearance.
  'theme',
  'themeMode',
  'appFont',
  'appFontRandomize',
  'appFontPool',

  // The shape of a day. These decide what counts as due, so two devices
  // disagreeing about them show genuinely different task lists.
  'dayResetTime',
  'morningStart',
  'afternoonStart',
  'eveningStart',
  'nightStart',
  'activeHoursStart',
  'activeHoursEnd',
  'quietHoursStart',
  'quietHoursEnd',
  'weekStartsOn',

  // Behaviour.
  'newTaskDefaults',
  'defaultReminderLeadMinutes',
  'defaultProjectNudgeCadenceDays',
  // Legacy key name for what is now autoCompleteProjectsOnDone: the setting
  // changed from archiving a finished project to completing one, but it is
  // still persisted (and therefore synced) under the key it shipped with, so
  // devices on either side of the change agree about what it holds.
  'autoArchiveProjectsOnComplete',
  'autoRemoveExpiredTasks',
  'completedRetentionDays',
  'postponeCheckEnabled',
  'postponeCheckThreshold',
  'simpleTaskForm',
  'simpleMode',
  'sortOption',
  'hideCategories',
  'collapsedCategories',
  'mealsOnToday',
  'calendarEventCategory',
  'kitchenEnabled',
  'unitSystem',
  'currencySymbol',

  // Automatic tasks. Per-generator, matching the settings keys themselves
  // (see the note on GeneratedTasksSection — these were never merged).
  'mealCookTasks',
  'mealCookTaskCategory',
  'groceryUseUpTasks',
  'groceryUseUpTaskCategory',
  'groceryUseUpLeadDays',
  'leftoverUseUpTasks',
  'leftoverUseUpTaskCategory',
  'mealPlanNudgeEnabled',
  'mealPlanNudgeTime',
  'mealPlanNudgeWeekday',
  'mealPlanNudgeTaskCategory',
  'projectReviewTasks',
  'projectReviewTaskCategory',
  'pantryCheckTasks',
  'pantryCheckTaskCategory',
  // calendarReviewLastDayKey is deliberately not here — state, not a
  // preference, like mealPlanNudgeLastFiredWeekKey beside it.
  'calendarReviewTasks',

  // Vocabularies the user builds. These are data as much as preference — a
  // tag that exists but is unused, and the walk round the shop — and a device
  // missing them renders sections it has no order for.
  'tag_registry',
  'grocery_aisle_order',
  'grocery_aisle_hidden',
  'grocery_aisle_overrides',

  // Vacation mode is a statement about the person, not the device.
  'vacationMode',
  'vacationStart',
  'vacationEnd',
  // Which trip switched it on, so a peer doesn't read a mode it can see as one
  // nobody owns and turn it off. Rides with the three above for the same
  // reason: it is a statement about the person, not the device.
  'vacationDrivenBy',
];

/**
 * Deliberately absent, and why — kept as prose rather than a denylist so it
 * can't be mistaken for something the code enforces:
 *
 * - `hapticsEnabled`, `shakeToUndoEnabled`, `timerLiveActivity`,
 *   `tripLiveActivity`, `focusLiveActivity`, `fabHand` — capabilities and
 *   ergonomics of one device. A Mac has no haptics and no thumb reach.
 * - `appLockEnabled`, `appLockGraceSeconds` — syncing these would let a
 *   device turn the lock off on another one. Security settings are per-device
 *   by design.
 * - `dailyAgendaEnabled`, `dailyAgendaTime`, `reminderMeetingNudgeEnabled` —
 *   notification schedules. Shared, both devices would fire the same
 *   notification and every reminder would arrive twice.
 * - `calendarIds`, `calendarReadEnabled`, `calendarPeopleHistory`,
 *   `deadlineCalendarId`, `mealCalendarId`, `remindersImport*`,
 *   `groceryImport*` — identifiers for calendars and lists that exist on one
 *   device. Wrong, not just useless, on the other. `calendarPeopleHistory`
 *   is a preference rather than an id, but it refines `calendarReadEnabled`
 *   and is worth nothing on a device that isn't reading a calendar.
 * - `calendarHistoryHandled` — which past events the user has already answered
 *   about on a person's screen, keyed by EventKit event id. Same objection as
 *   `groceryImportLinks`: an event id names a record on one device, so the
 *   other phone would read it as answers about events it has never seen.
 * - `aiFeatureConfig` — the API key it depends on is device-local by design,
 *   so syncing the config turns features on for a device that cannot run them.
 * - `grocery_active_list`, `grocery_group_by` — which shopping list one device
 *   is showing and how it groups the rows. The lists themselves sync
 *   (`grocery_lists`); which of them you are *looking at* is the same kind of
 *   fact as `grocery_trip_shop_id` below, and one phone in the rental kitchen
 *   should not move the other one's screen off the list at home.
 * - `grocery_trip_shop_id`, `grocery_trip_started_at`,
 *   `mealPlanNudgeLastFiredWeekKey`, `mealPlanNudgeGroupId`,
 *   `meal_plan_added_to_list`, `patchNotesQaStatus`, `filterEfforts`,
 *   `filterPriorities` — transient state about what one device is doing right
 *   now. `mealPlanNudgeGroupId` names the stack this device last laid the
 *   weekly nudge into; the other device is kept from laying down a second one
 *   by seeing the synced tasks themselves (`hasLiveMealPlanNudgeTask`), which
 *   is the gate that already had to work cross-device, since
 *   `mealPlanNudgeLastFiredWeekKey` has never synced either.
 * - `syncDeviceId`, `syncCursor:*` — the sync machinery itself. Two devices
 *   sharing a device id would each ignore the other's payloads as their own.
 * - Anything ending `_done` — the migration flags above.
 */
export function isSyncedSettingKey(key: string): boolean {
  return SYNCED_SETTING_KEYS.includes(key);
}

/** Where deletions go. A row here is the only evidence a row ever existed. */
export const SYNC_DELETIONS_TABLE = 'sync_deletions';

/**
 * UTC, milliseconds, `Z`-suffixed — the same ISO shape every date in this app
 * is stored as, so a value read out of a row needs no conversion to be
 * compared against one written by JS.
 */
export const NOW_EXPR = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/**
 * How long a tombstone is kept.
 *
 * A tombstone deleted before every device has seen it resurrects the row, so
 * this is the window a device may be offline for and still catch up by the
 * ordinary path. Ninety days is deliberately far more generous than it needs
 * to be: the table holds three short strings per deleted row, so the cost of
 * being wrong in the safe direction is nothing, while the cost of being wrong
 * in the other direction is a deleted task quietly coming back.
 *
 * A device that has been away longer than this needs a full reconcile rather
 * than an incremental catch-up — which the transport has to handle anyway for
 * the first-pair case, so this adds no work that wasn't already required.
 */
export const TOMBSTONE_RETENTION_DAYS = 90;

/** `NEW.id`, or `NEW.item_id || '|' || NEW.shop_id` for a composite key. */
export function rowKeyExpr(table: SyncTable, alias: 'NEW' | 'OLD'): string {
  return table.key
    .map(col => `${alias}.${col}`)
    .join(` || '${KEY_SEPARATOR}' || `);
}

/** `id = NEW.id`, and-ed across every key column for a composite. */
function keyMatchExpr(table: SyncTable, alias: 'NEW' | 'OLD'): string {
  return table.key.map(col => `${col} = ${alias}.${col}`).join(' AND ');
}

/** The DDL for the tombstone table. */
export function deletionsTableStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${SYNC_DELETIONS_TABLE} (
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, row_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_${SYNC_DELETIONS_TABLE}_deleted_at
       ON ${SYNC_DELETIONS_TABLE} (deleted_at)`,
  ];
}

/** `ALTER TABLE … ADD COLUMN updated_at`, one per tracked table. */
export function updatedAtMigrations(): string[] {
  return SYNC_TRACKED_TABLES.map(
    t => `ALTER TABLE ${t.name} ADD COLUMN updated_at TEXT`
  );
}

/**
 * The four triggers and one index that track a single table.
 *
 * Dropped and recreated rather than `CREATE TRIGGER IF NOT EXISTS`, so that
 * editing a trigger body here actually reaches an install that already has the
 * old one. Fifty-odd statements at startup is nothing next to a device
 * silently running last release's tracking rules.
 */
export function changeTrackingStatements(
  table: SyncTable,
  /**
   * The SQL expression for "now". Only ever overridden by tests, which need a
   * clock that doesn't move between statements: SQLite freezes `'now'` within
   * a single step but not across them, so the same-millisecond edge cases
   * below are otherwise reproducible only by racing the real clock.
   */
  nowExpr: string = NOW_EXPR
): string[] {
  const { name } = table;
  const newKey = rowKeyExpr(table, 'NEW');
  const oldKey = rowKeyExpr(table, 'OLD');
  const match = keyMatchExpr(table, 'NEW');

  return [
    `DROP TRIGGER IF EXISTS ${name}_sync_stamp_insert`,
    `DROP TRIGGER IF EXISTS ${name}_sync_undelete`,
    `DROP TRIGGER IF EXISTS ${name}_sync_stamp_update`,
    `DROP TRIGGER IF EXISTS ${name}_sync_tombstone`,

    // A row inserted without an explicit stamp is a local change, so it gets
    // one. The guard is what lets the sync client insert a row *with* a peer's
    // timestamp and have it survive — without it, applying a remote change
    // would restamp it as locally-modified and the two devices would hand the
    // same row back and forth forever.
    `CREATE TRIGGER ${name}_sync_stamp_insert
       AFTER INSERT ON ${name}
       WHEN NEW.updated_at IS NULL
     BEGIN
       UPDATE ${name} SET updated_at = ${nowExpr} WHERE ${match};
     END`,

    // Re-inserting a row clears its tombstone. This is not a theoretical case:
    // shake-to-undo and bulkDeleteTasks both put deleted rows back under their
    // original ids, and a surviving tombstone would have the next sync delete
    // them again on every device — an undo that works locally and silently
    // loses the data a minute later.
    `CREATE TRIGGER ${name}_sync_undelete
       AFTER INSERT ON ${name}
     BEGIN
       DELETE FROM ${SYNC_DELETIONS_TABLE}
        WHERE table_name = '${name}' AND row_key = ${newKey};
     END`,

    // First clause: the same peer-write guard as the insert, for the same
    // reason.
    //
    // Second clause: don't restamp a row that already carries this
    // millisecond's stamp. Without it the trigger is not self-terminating —
    // two writes inside one millisecond produce an inner UPDATE that sets
    // updated_at to the value it already had, leaving the WHEN true and
    // recursing until SQLite gives up. That only bites while
    // `PRAGMA recursive_triggers` is ON, which is not the default and which
    // nothing here turns on, but "correct only because of a pragma we don't
    // set" is not a property worth depending on in the layer that decides
    // whether data survives.
    //
    // The cost is that a same-millisecond write leaves the stamp where it
    // was. That is safe only because the cursor in dbSyncChangesSince is
    // inclusive — see the note there; the two decisions are load-bearing for
    // each other.
    `CREATE TRIGGER ${name}_sync_stamp_update
       AFTER UPDATE ON ${name}
       WHEN NEW.updated_at IS OLD.updated_at
        AND (OLD.updated_at IS NULL OR OLD.updated_at <> ${nowExpr})
     BEGIN
       UPDATE ${name} SET updated_at = ${nowExpr} WHERE ${match};
     END`,

    // INSERT OR REPLACE, not INSERT: a row can be deleted, restored by an
    // undo, and deleted again, and it is the *last* deletion that has to win.
    `CREATE TRIGGER ${name}_sync_tombstone
       AFTER DELETE ON ${name}
     BEGIN
       INSERT OR REPLACE INTO ${SYNC_DELETIONS_TABLE} (table_name, row_key, deleted_at)
       VALUES ('${name}', ${oldKey}, ${nowExpr});
     END`,

    // The sync loop's only read pattern is "everything after this cursor".
    `CREATE INDEX IF NOT EXISTS idx_${name}_updated_at ON ${name} (updated_at)`,
  ];
}

/**
 * Stamps rows that predate tracking.
 *
 * Uniform rather than falling back to `created_at` (which only nine of the
 * thirteen tables have anyway): the value is only ever read to decide which of
 * two conflicting *copies of the same row* is newer, and rows can only collide
 * once the devices have synced at least once. Nothing that exists before the
 * first sync can conflict with anything, so a truthful "tracking started here"
 * is worth more than a reconstructed history that implies an ordering the app
 * never actually observed.
 */
export function backfillStatements(): string[] {
  return SYNC_TRACKED_TABLES.map(
    t => `UPDATE ${t.name} SET updated_at = ${NOW_EXPR} WHERE updated_at IS NULL`
  );
}

/** Every statement needed to install tracking, in order. */
export function installStatements(): string[] {
  return [
    ...deletionsTableStatements(),
    // Arrow rather than a bare reference: flatMap passes (element, index),
    // and the index would land in changeTrackingStatements' nowExpr parameter.
    ...SYNC_TRACKED_TABLES.flatMap(t => changeTrackingStatements(t)),
  ];
}
