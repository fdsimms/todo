/**
 * Photos and files on tasks (`Task.attachments`).
 *
 * The files live in the `task-files` folder under names starting `task-`, and
 * the task keeps only the names. Unlike a journal photo they travel between
 * devices, through the same image sync as recipe photos (`taskFileSync.ts`),
 * which is why a file is capped at `MAX_TASK_FILE_BYTES`: one image in a sync
 * payload has a ceiling (`MAX_SYNC_IMAGE_CHARS`), and a file past it would sit
 * on one device for ever.
 *
 * **A file is never deleted with its task.** Deleting a task, or removing an
 * attachment in the editor, can be undone, and an undo that brought the row
 * back without its file would be a loss nothing could repair. So the only
 * delete is the launch sweep, which takes a file once no task names it.
 */
import type { Task, TaskAttachment } from '../types';
import { deleteStoredFile, listStoredFiles, storedFileOnDevice, storedFileUri } from './recipePhoto';
import { isDemoModeActive } from './demoState';

export const TASK_FILE_FOLDER = 'task-files' as const;
export const TASK_FILE_PREFIX = 'task-';

/** The most attachments one task carries. */
export const MAX_TASK_ATTACHMENTS = 10;

/**
 * The largest file that can be attached: under the sync ceiling for one image
 * (10 MB of base64, which is about 7.5 MB of file), with room to spare.
 */
export const MAX_TASK_FILE_BYTES = 7 * 1024 * 1024;

/** Whether a stored-file name belongs to a task, which is how sync routes it. */
export function isTaskFileName(name: string): boolean {
  return name.startsWith(TASK_FILE_PREFIX);
}

/** Every attachment file name any task still holds. */
export function taskFileNamesInUse(tasks: readonly Pick<Task, 'attachments'>[]): Set<string> {
  const names = new Set<string>();
  for (const task of tasks) for (const a of task.attachments ?? []) names.add(a.name);
  return names;
}

/** The files to sweep: everything in the folder no task names. */
export function unreferencedTaskFiles(files: readonly string[], inUse: ReadonlySet<string>): string[] {
  return files.filter(name => !inUse.has(name));
}

/** Why a file can't be attached, or null when it can. */
export function taskFileProblem(sizeBytes: number | null | undefined, count: number): string | null {
  if (count >= MAX_TASK_ATTACHMENTS) return `A task can hold ${MAX_TASK_ATTACHMENTS} photos and files.`;
  if (typeof sizeBytes === 'number' && sizeBytes > MAX_TASK_FILE_BYTES) {
    return 'That file is over 7 MB, which is the most a task can hold so it can reach your other devices.';
  }
  return null;
}

/** A task's attachments with where each file is and whether it is here yet. */
export function taskAttachmentsOnDevice(attachments: readonly TaskAttachment[] | undefined): (TaskAttachment & { uri: string; present: boolean })[] {
  return (attachments ?? []).map(a => ({
    ...a,
    uri: storedFileUri(TASK_FILE_FOLDER, a.name),
    present: storedFileOnDevice(TASK_FILE_FOLDER, a.name),
  }));
}

/** The extension a file's name ends in, uppercased for a tile ("PDF"), or "FILE". */
export function attachmentBadge(title: string): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(title)?.[1];
  return ext ? ext.toUpperCase() : 'FILE';
}

/**
 * Deletes the task files no task names. Launch-time only and never in demo
 * mode, for the reasons `sweepJournalPhotos` gives: the folder is shared with
 * the real database.
 */
export function sweepTaskFiles(tasks: readonly Pick<Task, 'attachments'>[]): number {
  if (isDemoModeActive()) return 0;
  const stale = unreferencedTaskFiles(listStoredFiles(TASK_FILE_FOLDER), taskFileNamesInUse(tasks));
  for (const name of stale) deleteStoredFile(TASK_FILE_FOLDER, name);
  return stale.length;
}
