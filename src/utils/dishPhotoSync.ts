/**
 * The file half of syncing dish photos: the same adapter shape as
 * `taskFileSync.ts`, for the `dish-photos` folder. The sync loop wants a file
 * only once a row here names it, so a photo never arrives ahead of its dish.
 *
 * Nothing is deleted here (see `dishPhotos.ts`), and **every call is best
 * effort and never throws**: the MCP replica runs this in Node, where
 * expo-file-system isn't there to load.
 */
import { dbDishPhotoNames } from '../db/database';
import { readStoredFileBase64, storedFileOnDevice, writeStoredFile } from './recipePhoto';
import { isSyncImageName } from './syncMerge';
import { DISH_PHOTO_FOLDER, isDishPhotoName } from './dishPhotos';

/** Every dish photo this device's rows name. */
export function dishPhotoNames(): string[] {
  try {
    return dbDishPhotoNames().filter(name => isSyncImageName(name));
  } catch {
    return [];
  }
}

export function readDishPhotoForSync(name: string): string | null {
  if (!isSyncImageName(name) || !isDishPhotoName(name)) return null;
  try {
    return readStoredFileBase64(DISH_PHOTO_FOLDER, name);
  } catch {
    return null;
  }
}

export function hasDishPhotoForSync(name: string): boolean {
  if (!isSyncImageName(name) || !isDishPhotoName(name)) return false;
  try {
    return storedFileOnDevice(DISH_PHOTO_FOLDER, name);
  } catch {
    return false;
  }
}

/** Writes a photo a peer sent, never over one already here (a name is minted once per file). */
export function writeDishPhotoFromSync(name: string, base64: string): boolean {
  if (!isSyncImageName(name) || !isDishPhotoName(name) || !base64) return false;
  try {
    if (storedFileOnDevice(DISH_PHOTO_FOLDER, name)) return false;
    writeStoredFile(DISH_PHOTO_FOLDER, name, base64);
    return true;
  } catch {
    return false;
  }
}
