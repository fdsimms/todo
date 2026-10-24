/**
 * What the Storage section of Settings › Data & reset says, worked out from
 * numbers the database and the file system report.
 *
 * Deleting rows never shrinks a SQLite file: the pages they sat on go on a
 * free list and stay in the file until a VACUUM rewrites it. So "how big is
 * it" and "how much of that could come back" are two different figures, and
 * the screen shows both rather than a single total that a retention window or
 * a purge would never visibly lower.
 */

export interface StorageTable {
  /** Table name, indexes already folded into the table they belong to. */
  name: string;
  bytes: number;
}

export interface StorageStats {
  /** The database file as it stands, free pages included. */
  databaseBytes: number;
  /** Pages on the free list: space inside the file that holds no data. */
  freeBytes: number;
  /** Whether free pages are given back at launch, which compacting turns on. */
  autoReclaim: boolean;
  /** Largest first. Empty where the SQLite build can't report per-table sizes. */
  tables: StorageTable[];
  /** Recipe photos, which are files beside the database rather than rows in it. */
  photoBytes: number;
  /** Journal photos, task files and dish photos, the same kind of thing in folders of their own. Absent counts as none. */
  otherFileBytes?: { journal: number; task: number; dish?: number };
}

/** Decimal units with one decimal, the way iOS prints "276.3 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1000 * 1000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Below this, a compact would only be a progress bar for nothing. */
export const MIN_RECLAIMABLE_BYTES = 1_000_000;

export function worthOptimizing(stats: Pick<StorageStats, 'freeBytes'>): boolean {
  return stats.freeBytes >= MIN_RECLAIMABLE_BYTES;
}

/**
 * VACUUM writes a full copy of the live data before it swaps the file in, so
 * it needs about the database's own size free on the device. Refusing here
 * beats a half-finished rewrite on a full phone.
 */
export function optimizeBlockedReason(
  stats: Pick<StorageStats, 'databaseBytes' | 'freeBytes'>,
  availableBytes: number | null,
): string | null {
  if (availableBytes == null) return null;
  const needed = Math.max(0, stats.databaseBytes - stats.freeBytes);
  // A margin on top of the copy, for the WAL it is written through.
  if (availableBytes < needed * 1.2 + 10_000_000) {
    return `Free up about ${formatBytes(needed)} on your phone first. Compacting needs room to write a copy.`;
  }
  return null;
}

const TABLE_LABELS: Record<string, string> = {
  tasks: 'Tasks',
  food_logs: 'Food log',
  mood_logs: 'Mood log',
  medication_logs: 'Medication log',
  journal_entries: 'Journal',
  exercises: 'Workouts',
  workout_routines: 'Workouts',
  workout_programs: 'Workouts',
  workout_routine_versions: 'Workouts',
  workout_program_versions: 'Workouts',
  gyms: 'Workouts',
  gym_exercises: 'Workouts',
  workout_sessions: 'Workouts',
  workout_sets: 'Workouts',
  recipes: 'Recipes',
  meal_plan_entries: 'Meal plan',
  grocery_items: 'Grocery catalog',
  grocery_list_items: 'Grocery lists',
  gtin_lookups: 'Barcode lookups',
  sync_deletions: 'Sync records',
  sync_received: 'Sync records',
  sync_aliases: 'Sync records',
  unattended_log: 'Activity log',
  focus_session_log: 'Focus history',
  error_log: 'Error log',
  coin_entries: 'Coins',
};

function labelFor(name: string): string {
  return TABLE_LABELS[name] ?? name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/** The biggest `limit` areas by label, with tables that share a label added together. */
export function topAreas(tables: StorageTable[], limit = 4): { label: string; bytes: number }[] {
  const byLabel = new Map<string, number>();
  for (const t of tables) {
    if (t.bytes <= 0) continue;
    const label = labelFor(t.name);
    byLabel.set(label, (byLabel.get(label) ?? 0) + t.bytes);
  }
  return [...byLabel.entries()]
    .map(([label, bytes]) => ({ label, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

/** "Tasks 190.2 MB · Food log 12.0 MB" for a row's subtitle. */
export function describeAreas(tables: StorageTable[], limit = 3): string {
  return topAreas(tables, limit)
    .map(a => `${a.label} ${formatBytes(a.bytes)}`)
    .join(' · ');
}
