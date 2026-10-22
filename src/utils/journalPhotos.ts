/**
 * Photos on journal and dream entries (`JournalEntry.photos`).
 *
 * The files live in the `journal-photos` folder and the entry keeps only their
 * names. They never leave this device except in a backup: the journal is
 * withheld from iCloud, and the sync server carries no files, so the column is
 * device-local too (`SYNC_DEVICE_LOCAL_COLUMNS`). Every reader draws only the
 * names whose file is actually here (`journalPhotosOnDevice`), since a restore
 * or a lost file can leave a name behind.
 *
 * A file nothing names any more (the entry deleted on another device, a photo
 * added to a page that was then cancelled after a crash) is taken by the
 * launch sweep, never while a sheet could be holding one it just picked.
 */
import type { JournalEntry } from '../types';
import { deleteStoredFile, listStoredFiles, storedFileOnDevice, storedFileUri } from './recipePhoto';
import { isDemoModeActive } from './demoState';

export const JOURNAL_PHOTO_FOLDER = 'journal-photos' as const;

/** The most photos one entry carries. */
export const MAX_JOURNAL_PHOTOS = 8;

/** Every photo name any entry still holds. */
export function journalPhotoNamesInUse(entries: readonly Pick<JournalEntry, 'photos'>[]): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) for (const name of entry.photos ?? []) names.add(name);
  return names;
}

/** The names in `before` that `after` no longer holds: what an edit dropped. */
export function droppedPhotos(before: readonly string[] | undefined, after: readonly string[] | undefined): string[] {
  const kept = new Set(after ?? []);
  return (before ?? []).filter(name => !kept.has(name));
}

/** The files to sweep: everything in the folder no entry names. */
export function unreferencedPhotos(files: readonly string[], inUse: ReadonlySet<string>): string[] {
  return files.filter(name => !inUse.has(name));
}

/** An entry's photos that are on this device, as URIs to draw. */
export function journalPhotosOnDevice(entry: Pick<JournalEntry, 'photos'>): { name: string; uri: string }[] {
  return (entry.photos ?? [])
    .filter(name => storedFileOnDevice(JOURNAL_PHOTO_FOLDER, name))
    .map(name => ({ name, uri: storedFileUri(JOURNAL_PHOTO_FOLDER, name) }));
}

export function deleteJournalPhotos(names: readonly string[]): void {
  for (const name of names) deleteStoredFile(JOURNAL_PHOTO_FOLDER, name);
}

/**
 * Deletes the photo files no entry names. Launch-time only, and never in demo
 * mode: the folder is shared with the real database, and the demo's entries
 * name none of the real photos.
 */
export function sweepJournalPhotos(entries: readonly Pick<JournalEntry, 'photos'>[]): number {
  if (isDemoModeActive()) return 0;
  const stale = unreferencedPhotos(listStoredFiles(JOURNAL_PHOTO_FOLDER), journalPhotoNamesInUse(entries));
  deleteJournalPhotos(stale);
  return stale.length;
}
