import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

/**
 * The device half of export/restore: putting the backup somewhere the user can
 * get at it, and reading one back in.
 *
 * Kept apart from backup.ts because everything here needs a real device —
 * there's no renderer or native module in the Jest environment, so none of it
 * is unit tested. All the decisions worth testing (what a backup contains,
 * whether a file is a valid one, what the dialog says) live in backup.ts
 * instead, and this module is deliberately thin enough to read in one go.
 */

/**
 * Writes the backup to the cache directory and returns its file:// URI.
 *
 * The cache directory, not documents: the file only has to survive long enough
 * for the share sheet to copy it wherever the user is sending it, and a backup
 * that also accumulated silently on the device would be a second copy of all
 * their data that nothing ever cleans up. iOS reclaims this on its own.
 */
export function writeBackupFile(json: string, fileName: string): string {
  const file = new File(Paths.cache, fileName);
  // A backup taken twice in the same minute lands on the same name, and the
  // second one is the one the user just asked for.
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  return file.uri;
}

/** True when the OS can actually present a share sheet. */
export async function canShare(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

export async function shareBackupFile(uri: string): Promise<void> {
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Save your backup',
  });
}

/** Deletes a backup left in the cache once it's been handed off. */
export function discardBackupFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort — the cache directory is the system's to reclaim anyway,
    // and failing to tidy up is never worth surfacing over a successful export.
  }
}

/**
 * Opens the document picker and returns the chosen file's text, or null if the
 * user backed out.
 *
 * The type filter is a hint, not a guarantee — a JSON file arriving from
 * another app can be typed as text/plain or nothing at all, and refusing it
 * here would look like the file simply isn't selectable. Anything that isn't
 * really a backup is caught by parseBackup, which gives a better message than
 * a greyed-out file would.
 */
export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  return new File(result.assets[0].uri).text();
}
