import { dbRecipeImagePaths } from '../db/database';
import {
  deleteRecipeImage,
  readRecipeImageBase64,
  recipeImageBasename,
  recipeImageOnDevice,
  writeRecipeImageFile,
} from './recipePhoto';
import { isSyncImageName, type ApplyReport, type SyncPayload } from './syncMerge';

/**
 * The file half of syncing recipe photos (#2704): which photos this device
 * holds, reading one out, writing one a peer sent, and removing the file of a
 * photo a peer's edit or delete stopped pointing at. The sync loop decides
 * when (`pushImages` and the pull loop in syncEngine.ts); this only touches
 * files, and `databaseSyncLocal` wires it in.
 *
 * A recipe row carries its photo as a path, and the path names a file on the
 * device that took it, so before this the other device got a path to nothing
 * and a blank hero. Backup already carried the bytes beside the rows
 * (`Backup.images`); this is the same idea for sync, keyed the same way, by the
 * filename `pickRecipeImage` minted, which is the one part of the path that
 * means anything on another device (`resolveRecipeImagePath`).
 *
 * **Every call is best effort and never throws.** A photo that can't be read
 * or written costs that photo, never the sync, and the MCP replica runs this
 * same adapter in Node, where expo-file-system isn't there to load at all.
 */

/** Every recipe photo this device's rows point at, by filename, each once. */
export function recipeImageNames(): string[] {
  try {
    const names = new Set<string>();
    for (const path of dbRecipeImagePaths().values()) {
      const name = recipeImageBasename(path);
      if (isSyncImageName(name)) names.add(name);
    }
    return [...names];
  } catch {
    return [];
  }
}

/** One photo's bytes, for a peer. Null when the file isn't on this device. */
export function readRecipeImageForSync(name: string): string | null {
  if (!isSyncImageName(name)) return null;
  try {
    return readRecipeImageBase64(name);
  } catch {
    return null;
  }
}

/** Whether a photo's file is already on this device. */
export function hasRecipeImageForSync(name: string): boolean {
  if (!isSyncImageName(name)) return false;
  try {
    return recipeImageOnDevice(name);
  } catch {
    return false;
  }
}

/**
 * Writes a photo a peer sent into this device's recipe-images directory, under
 * the name it was sent with, which is the name the synced row resolves to.
 * Never over a file already here: the name is minted once per photo, so a file
 * of that name is this photo already.
 *
 * Written whether or not a recipe here points at it yet. A store needn't hand
 * payloads back in the order they were pushed, and a photo refused for
 * arriving before its row would never be offered again, since the sender
 * records it as sent.
 */
export function writeRecipeImageFromSync(name: string, base64: string): boolean {
  if (!isSyncImageName(name) || !base64) return false;
  try {
    if (recipeImageOnDevice(name)) return false;
    writeRecipeImageFile(name, base64);
    return true;
  } catch {
    return false;
  }
}

/** The recipes a payload writes or deletes, by id. Pure. */
export function recipeIdsIn(payload: Pick<SyncPayload, 'tables' | 'deletions'>): string[] {
  const ids = new Set<string>();
  for (const row of payload.tables.recipes ?? []) {
    if (typeof row.id === 'string') ids.add(row.id);
  }
  for (const d of payload.deletions) {
    if (d.table === 'recipes') ids.add(d.rowKey);
  }
  return [...ids];
}

/**
 * The photo filenames that were in use before and no longer are. Pure. A
 * photo two recipes share (a duplicated recipe keeps its original's path)
 * stays in use while either still points at it.
 */
export function unreferencedImageNames(before: Iterable<string>, after: Iterable<string>): string[] {
  const inUse = new Set<string>();
  for (const path of after) {
    const name = recipeImageBasename(path);
    if (name) inUse.add(name);
  }
  const out = new Set<string>();
  for (const path of before) {
    const name = recipeImageBasename(path);
    if (name && !inUse.has(name)) out.add(name);
  }
  return [...out];
}

/**
 * Applies a payload and then removes the file of any photo it left nothing
 * pointing at: a recipe another device deleted, or one whose photo it
 * replaced or removed. The local paths already do this (`deleteRecipe`,
 * `useRecipeStore.setImage`), and without the same here a device receiving photos
 * would keep every one it was ever sent.
 *
 * Only names that were in use *before* the apply are candidates, so a photo
 * just taken on this device, whose file is written before its row, is never
 * one of them.
 */
export function applyWithRecipeImages(
  payload: SyncPayload,
  transport: string | undefined,
  apply: (payload: SyncPayload, transport?: string) => ApplyReport
): ApplyReport {
  const ids = recipeIdsIn(payload);
  let before: string[] = [];
  if (ids.length > 0) {
    try {
      before = [...dbRecipeImagePaths(ids).values()];
    } catch {
      before = [];
    }
  }

  const report = apply(payload, transport);

  if (before.length > 0) {
    try {
      for (const name of unreferencedImageNames(before, dbRecipeImagePaths().values())) {
        deleteRecipeImage(name);
      }
    } catch {
      // Best effort: a file left behind costs space, never data.
    }
  }
  return report;
}
