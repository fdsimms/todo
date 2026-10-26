/**
 * The file half of syncing task attachments: the recipe photo adapter
 * (`recipeImageSync.ts`) for the `task-files` folder. Both share the sync's one
 * flat namespace of image names, and a task file's `task-` prefix is how a name
 * finds its folder (`routeStoredFileName`). The sync loop wants a file only once
 * a row here names it (`downloadFromImageStore`), so a file never arrives ahead
 * of its task.
 *
 * Nothing is deleted here. A task's file outlives its row for the undo's sake,
 * and the launch sweep (`sweepTaskFiles`) is the only delete.
 *
 * **Every call is best effort and never throws**, as in the recipe adapter: the
 * MCP replica runs this in Node, where expo-file-system isn't there to load.
 */
import { dbTaskAttachmentNames } from '../db/database';
import { readStoredFileBase64, storedFileOnDevice, writeStoredFile } from './recipePhoto';
import { isSyncImageName } from './syncMerge';
import { TASK_FILE_FOLDER, isTaskFileName } from './taskFiles';

/** Which adapter a name a peer sent belongs to. Pure. */
export function routeStoredFileName(name: string): 'task' | 'recipe' {
  return isTaskFileName(name) ? 'task' : 'recipe';
}

/** Every task file this device's rows name. */
export function taskFileNames(): string[] {
  try {
    return dbTaskAttachmentNames().filter(name => isSyncImageName(name));
  } catch {
    return [];
  }
}

export function readTaskFileForSync(name: string): string | null {
  if (!isSyncImageName(name) || !isTaskFileName(name)) return null;
  try {
    return readStoredFileBase64(TASK_FILE_FOLDER, name);
  } catch {
    return null;
  }
}

export function hasTaskFileForSync(name: string): boolean {
  if (!isSyncImageName(name) || !isTaskFileName(name)) return false;
  try {
    return storedFileOnDevice(TASK_FILE_FOLDER, name);
  } catch {
    return false;
  }
}

/** Writes a file a peer sent, never over one already here (a name is minted once per file). */
export function writeTaskFileFromSync(name: string, base64: string): boolean {
  if (!isSyncImageName(name) || !isTaskFileName(name) || !base64) return false;
  try {
    if (storedFileOnDevice(TASK_FILE_FOLDER, name)) return false;
    writeStoredFile(TASK_FILE_FOLDER, name, base64);
    return true;
  } catch {
    return false;
  }
}
