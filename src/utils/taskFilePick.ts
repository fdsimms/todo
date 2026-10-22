/**
 * The device half of task attachments: choosing a document and opening one.
 * `require`d where used, like `backupFile.ts`'s pickers, so the modules load
 * only when somebody actually attaches or opens a file.
 */
import { copyFileIntoFolder } from './recipePhoto';
import { TASK_FILE_FOLDER, taskFileProblem } from './taskFiles';

function documentPicker(): typeof import('expo-document-picker') {
  return require('expo-document-picker');
}
function sharing(): typeof import('expo-sharing') {
  return require('expo-sharing');
}

export type PickedTaskFile =
  | { status: 'ok'; name: string; title: string }
  | { status: 'canceled' }
  | { status: 'refused'; message: string }
  | { status: 'failed'; message: string };

/**
 * Asks for one document and copies it into the task-files folder, refusing one
 * over the size a task can hold before copying anything.
 */
export async function pickTaskDocument(existingCount: number): Promise<PickedTaskFile> {
  try {
    const result = await documentPicker().getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.length) return { status: 'canceled' };
    const asset = result.assets[0];
    const problem = taskFileProblem(asset.size ?? null, existingCount);
    if (problem) return { status: 'refused', message: problem };
    const title = asset.name || 'File';
    const name = await copyFileIntoFolder(TASK_FILE_FOLDER, asset.uri, title);
    return { status: 'ok', name, title };
  } catch (e) {
    require('./errorLog').logError('task-file-pick', e);
    return { status: 'failed', message: e instanceof Error && e.message ? e.message : 'Couldn’t read that file. Try another.' };
  }
}

/** Opens a document in the system share sheet, which previews it and offers apps to open it in. */
export async function openTaskFile(uri: string, title: string): Promise<boolean> {
  try {
    if (!(await sharing().isAvailableAsync())) return false;
    await sharing().shareAsync(uri, { dialogTitle: title });
    return true;
  } catch {
    return false;
  }
}
