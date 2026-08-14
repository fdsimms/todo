/**
 * Backup file format — the pure half of export/restore.
 *
 * Everything here is plain data in, plain data out: building the object that
 * gets written, validating one that was read back, and describing it for the
 * confirmation dialog. The file and share-sheet plumbing lives in backupFile.ts
 * and the SQLite reads/writes in db/database.ts, so the part that decides what
 * is and isn't a valid backup can be tested without a device.
 *
 * The unit of the format is the **raw table row**, not the app's model objects.
 * A backup of `Task[]` would have to go back through rowToTask on the way in
 * and could only ever carry the fields that mapping knows about — so a column
 * added to the schema and not yet threaded into the model would be silently
 * dropped from every backup taken before it was. Raw rows make the round trip
 * lossless by default and mean a new column needs no work here at all.
 *
 * One thing a table row can't carry is a recipe's photo: `Recipe.imagePath` is
 * a `file://` URI into the app's document directory (src/utils/recipePhoto.ts),
 * and that path is meaningless off the device that wrote it — a fresh install
 * gets a new container, so even restoring to the *same* phone after a reinstall
 * left every recipe pointing at a file that no longer existed. `images` is the
 * one place this format steps outside "raw row" to carry the actual bytes,
 * keyed by the filename rather than the full path so a restore can write them
 * wherever the current device's document directory happens to be and repoint
 * `image_path` at that, not at the origin device's own layout.
 */

/**
 * Bumped only for a change that an older build could not read correctly.
 * Adding a table or a column doesn't qualify — the importer intersects against
 * the live schema either way — but renaming one, or changing how a value is
 * encoded, does.
 */
export const BACKUP_FORMAT = 1;

/**
 * Settings deliberately left out of the export.
 *
 * The Anthropic API key is a live billing credential, and a backup is a file
 * the user is about to hand to AirDrop, email or iCloud Drive — a place a
 * credential should never end up as a side effect of saving your tasks. It
 * has to be typed back in after a restore, which is the right trade.
 *
 * The key now lives in the keychain (src/utils/secureApiKey.ts), which the
 * export never reads, so on most installs there is no row here to leave out.
 * This stays as the belt to that braces: it still covers the launch window
 * before the migration has run, and an install whose keychain write failed and
 * whose plaintext row is therefore still sitting in the table.
 */
export const REDACTED_SETTING_KEYS = ['anthropicApiKey'];

/** A raw SQLite row: column name to primitive. */
export type BackupRow = Record<string, string | number | null>;

export interface Backup {
  format: number;
  /** The app version that wrote the file, for support/debugging only. */
  appVersion: string;
  exportedAt: string;
  tables: Record<string, BackupRow[]>;
  /** Recipe photo bytes, base64-encoded and keyed by filename — see the note above. */
  images: Record<string, string>;
}

export type ParseResult =
  | { ok: true; backup: Backup }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * True for the value types SQLite can actually hold in a TEXT/INTEGER/REAL
 * column. Anything else in a backup means the file was edited or corrupted:
 * even the app's JSON columns (tags, cycle_items, …) are stored as strings, so
 * a nested object or array here is never something we wrote.
 */
function isCellValue(v: unknown): v is string | number | null {
  return v === null || typeof v === 'string' || typeof v === 'number';
}

/** Drops the settings rows that must never leave the device. */
export function redactSettings(rows: BackupRow[]): BackupRow[] {
  return rows.filter(row => !REDACTED_SETTING_KEYS.includes(String(row.key)));
}

export function buildBackup(
  tables: Record<string, BackupRow[]>,
  opts: { appVersion: string; exportedAt: Date; images?: Record<string, string> }
): Backup {
  const safe: Record<string, BackupRow[]> = {};
  for (const [table, rows] of Object.entries(tables)) {
    safe[table] = table === 'settings' ? redactSettings(rows) : rows;
  }
  return {
    format: BACKUP_FORMAT,
    appVersion: opts.appVersion,
    exportedAt: opts.exportedAt.toISOString(),
    tables: safe,
    images: opts.images ?? {},
  };
}

export function serializeBackup(backup: Backup): string {
  // Indented: a backup is a file people open, and being able to eyeball it in
  // a text editor is most of what makes a local-only format trustworthy. The
  // size cost is paid once, on a file that is written and then handed off.
  return JSON.stringify(backup, null, 2);
}

/**
 * Parses and validates a backup file's text.
 *
 * Deliberately strict, and deliberately returns a message rather than throwing:
 * restore replaces everything the user has, so a file that isn't obviously a
 * backup of theirs should be refused before the confirmation dialog, not
 * discovered halfway through the transaction.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON, so it isn't a backup this app wrote." };
  }

  if (!isPlainObject(raw)) {
    return { ok: false, error: "That file doesn't look like a backup." };
  }

  if (typeof raw.format !== 'number' || !Number.isInteger(raw.format)) {
    return { ok: false, error: "That file doesn't look like a backup — it has no format version." };
  }

  // Refusing a newer file is the whole point of carrying a version: a future
  // format could mean something different by the same column, and importing it
  // on trust would corrupt the data rather than fail.
  if (raw.format > BACKUP_FORMAT) {
    return {
      ok: false,
      error: `That backup was made by a newer version of the app (format ${raw.format}). Update, then restore it.`,
    };
  }

  if (!isPlainObject(raw.tables)) {
    return { ok: false, error: 'That backup is missing its data.' };
  }

  const tables: Record<string, BackupRow[]> = {};
  for (const [table, rows] of Object.entries(raw.tables)) {
    if (!Array.isArray(rows)) {
      return { ok: false, error: `That backup's "${table}" data is damaged.` };
    }
    for (const row of rows) {
      if (!isPlainObject(row) || !Object.values(row).every(isCellValue)) {
        return { ok: false, error: `That backup's "${table}" data is damaged.` };
      }
    }
    tables[table] = rows as BackupRow[];
  }

  // Optional and defaulted rather than required: a backup taken before this
  // shipped, or one holding no recipe photos, simply has none to restore.
  let images: Record<string, string> = {};
  if (raw.images !== undefined) {
    if (!isPlainObject(raw.images) || !Object.values(raw.images).every(v => typeof v === 'string')) {
      return { ok: false, error: 'That backup\'s image data is damaged.' };
    }
    images = raw.images as Record<string, string>;
  }

  return {
    ok: true,
    backup: {
      format: raw.format,
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : 'unknown',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      tables,
      images,
    },
  };
}

/**
 * Keeps only the columns the running build actually has, so a backup and a
 * schema that don't match still restore.
 *
 * Both directions happen in practice: a file from a newer build carries columns
 * this one has never heard of (dropped here — inserting them would throw and
 * lose the whole restore over a field nothing reads yet), and a file from an
 * older one is missing columns this build added (absent from the INSERT, so
 * SQLite fills in the schema default).
 *
 * It doubles as the injection guard. Column names come out of a user-supplied
 * file and end up in SQL text, so `allowed` — which is always the live
 * PRAGMA table_info list — is what makes them safe: a name that isn't already
 * a real column of that table can't survive this filter.
 */
export function projectRow(row: BackupRow, allowed: readonly string[]): BackupRow {
  const out: BackupRow = {};
  for (const column of allowed) {
    if (Object.prototype.hasOwnProperty.call(row, column)) out[column] = row[column];
  }
  return out;
}

/** Row counts per table, for the confirmation dialog. */
export function backupCounts(backup: Backup): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(backup.tables)) counts[table] = rows.length;
  return counts;
}

const SUMMARY_LABELS: { table: string; one: string; many: string }[] = [
  { table: 'tasks', one: 'task', many: 'tasks' },
  { table: 'projects', one: 'project', many: 'projects' },
  { table: 'task_groups', one: 'stack', many: 'stacks' },
  { table: 'grocery_items', one: 'grocery item', many: 'grocery items' },
  { table: 'recipes', one: 'recipe', many: 'recipes' },
  { table: 'meal_plan_entries', one: 'planned meal', many: 'planned meals' },
  { table: 'templates', one: 'template', many: 'templates' },
  { table: 'categories', one: 'category', many: 'categories' },
];

/**
 * "1,240 tasks, 12 projects and 3 stacks" — what the restore dialog says is
 * about to replace what's there. Only non-empty tables appear, so a backup of
 * a fresh install doesn't read as a wall of zeroes.
 */
export function summarizeBackup(backup: Backup): string {
  const counts = backupCounts(backup);
  const parts = SUMMARY_LABELS
    .filter(({ table }) => (counts[table] ?? 0) > 0)
    .map(({ table, one, many }) => {
      const n = counts[table];
      return `${n.toLocaleString()} ${n === 1 ? one : many}`;
    });
  if (parts.length === 0) return 'no tasks or projects';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * A filename that sorts chronologically and survives every filesystem —
 * "todo-backup-2026-08-06-1930.json". Colons are deliberately not in it: they
 * are legal on iOS but get mangled the moment a file crosses into iCloud
 * Drive or a Windows share, which is exactly where a backup goes.
 */
export function backupFileName(exportedAt: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${exportedAt.getFullYear()}-${p(exportedAt.getMonth() + 1)}-${p(exportedAt.getDate())}` +
    `-${p(exportedAt.getHours())}${p(exportedAt.getMinutes())}`;
  return `todo-backup-${stamp}.json`;
}
