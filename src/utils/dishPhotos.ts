/**
 * The photo on a restaurant dish (`DishRating.photo`): one file per dish, in the
 * `dish-photos` folder under a name starting `dish-`.
 *
 * It travels between devices through the same image sync as recipe photos and
 * task files (`dishPhotoSync.ts`), and the prefix is how a name a peer sends
 * finds its folder (`routeStoredFileName`). `savePhotoIntoFolder` already sizes
 * a photo for display, which keeps it under the sync ceiling for one image.
 *
 * **A photo is never deleted with its dish, or when it is replaced.** Deleting
 * a dish and replacing its photo can both be undone, and an undo that brought
 * the row back without its file would be a loss nothing could repair. So the
 * only delete is the launch sweep, which takes a file once no dish names it.
 */
import type { DishRating } from '../types';
import { deleteStoredFile, listStoredFiles, storedFileOnDevice, storedFileUri } from './recipePhoto';
import { isDemoModeActive } from './demoState';

export const DISH_PHOTO_FOLDER = 'dish-photos' as const;
export const DISH_PHOTO_PREFIX = 'dish-';

/** Whether a stored-file name belongs to a dish, which is how sync routes it. */
export function isDishPhotoName(name: string): boolean {
  return name.startsWith(DISH_PHOTO_PREFIX);
}

/** Every photo name any dish still holds. */
export function dishPhotoNamesInUse(dishes: readonly Pick<DishRating, 'photo'>[]): Set<string> {
  const names = new Set<string>();
  for (const dish of dishes) if (dish.photo) names.add(dish.photo);
  return names;
}

/** The files to sweep: everything in the folder no dish names. */
export function unreferencedDishPhotos(files: readonly string[], inUse: ReadonlySet<string>): string[] {
  return files.filter(name => !inUse.has(name));
}

/** Where a dish's photo is on this device, or null when it has none or it hasn't arrived yet. */
export function dishPhotoUri(photo: string | null | undefined): string | null {
  if (!photo || !storedFileOnDevice(DISH_PHOTO_FOLDER, photo)) return null;
  return storedFileUri(DISH_PHOTO_FOLDER, photo);
}

/**
 * Deletes the dish photos no dish names. Launch-time only and never in demo
 * mode, for the reasons `sweepTaskFiles` gives: the folder is shared with the
 * real database.
 */
export function sweepDishPhotos(dishes: readonly Pick<DishRating, 'photo'>[]): number {
  if (isDemoModeActive()) return 0;
  const stale = unreferencedDishPhotos(listStoredFiles(DISH_PHOTO_FOLDER), dishPhotoNamesInUse(dishes));
  for (const name of stale) deleteStoredFile(DISH_PHOTO_FOLDER, name);
  return stale.length;
}
