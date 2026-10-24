/**
 * Which stored files a backup carries, read off the raw rows it is built from:
 * a journal entry's `photos` and a task's `attachments` name files in their own
 * folders (`StoredFileFolder`), and the bytes ride in `Backup.storedFiles`.
 * Pure: the reads and writes are passed in, so what is collected and what is
 * restored is testable without a device.
 */
import type { BackupRow } from './backup';
import type { StoredFileFolder } from './recipePhoto';

/** The folders a backup carries besides the recipe photos, and the rows that name their files. */
/**
 * `plain` marks a column holding one file name rather than a JSON array of
 * them (a dish's `photo`).
 */
const SOURCES: { folder: Exclude<StoredFileFolder, 'recipe-images'>; table: string; column: string; key?: string; plain?: boolean }[] = [
  { folder: 'journal-photos', table: 'journal_entries', column: 'photos' },
  { folder: 'task-files', table: 'tasks', column: 'attachments', key: 'name' },
  { folder: 'dish-photos', table: 'dish_ratings', column: 'photo', plain: true },
];

function namesIn(cell: unknown, key: string | undefined, plain = false): string[] {
  if (typeof cell !== 'string' || !cell) return [];
  if (plain) return /^[A-Za-z0-9._-]+$/.test(cell) ? [cell] : [];
  try {
    const parsed = JSON.parse(cell);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => (key ? (item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : null) : item))
      .filter((name): name is string => typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name));
  } catch {
    return [];
  }
}

/** Every stored file the rows name, by folder. */
export function storedFileNamesIn(tables: Record<string, BackupRow[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const source of SOURCES) {
    const names = new Set<string>();
    for (const row of tables[source.table] ?? []) for (const name of namesIn(row[source.column], source.key, source.plain)) names.add(name);
    if (names.size > 0) out[source.folder] = [...names];
  }
  return out;
}

/** The bytes to embed: each named file `read` can find, by folder. A file that is gone is left out. */
export function collectStoredFiles(
  tables: Record<string, BackupRow[]>,
  read: (folder: StoredFileFolder, name: string) => string | null,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [folder, names] of Object.entries(storedFileNamesIn(tables))) {
    for (const name of names) {
      const base64 = read(folder as StoredFileFolder, name);
      if (base64) (out[folder] ??= {})[name] = base64;
    }
  }
  return out;
}

/**
 * Writes a backup's stored files back into their folders, and returns how many
 * failed. Only the folders this build knows, and only plain file names, so a
 * hand-edited backup can't write anywhere else.
 */
export function restoreStoredFiles(
  storedFiles: Record<string, Record<string, string>> | undefined,
  write: (folder: StoredFileFolder, name: string, base64: string) => void,
): number {
  let failed = 0;
  const known = new Set<string>(SOURCES.map(s => s.folder));
  for (const [folder, files] of Object.entries(storedFiles ?? {})) {
    if (!known.has(folder)) continue;
    for (const [name, base64] of Object.entries(files)) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      try {
        write(folder as StoredFileFolder, name, base64);
      } catch {
        failed++;
      }
    }
  }
  return failed;
}
