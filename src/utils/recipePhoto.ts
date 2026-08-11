import type { RecipeImage } from '../services/aiSuggestions';

/**
 * Getting a photo of a recipe into the shape `extractRecipe` wants.
 *
 * Two decisions here are load-bearing and both are about what *doesn't* happen:
 *
 * 1. **The picker is never asked for base64.** `launchCameraAsync({ base64: true })`
 *    materialises the full-resolution image as a JS string before anything has
 *    been downscaled — a 12MP HEIC is ~4MB binary, ~5.5MB as a string, and then
 *    it's copied again into the JSON request body. We pick to a file URI,
 *    downscale natively, and only then ask for base64 of the small JPEG.
 *
 * 2. **The re-encode is unconditional**, even for a photo already under the size
 *    cap. iOS cameras hand back HEIC, which the Messages API rejects outright,
 *    and an asset's own `mimeType` isn't reliable enough to detect that. Always
 *    saving as JPEG means the media type is a literal rather than a guess — which
 *    is why `RecipePhoto.mediaType` is narrowed to the one value.
 *
 * The native modules are `require`d at call site, never imported: this file is
 * reachable from RecipesScreen, and a module-scope import pulls
 * expo-modules-core into Jest's `node` environment, which throws on sight.
 * Same rule as backupFile.ts and secureApiKey.ts.
 */

/**
 * Long edge we downscale to. This is the standard vision tier's ceiling — above
 * it the API downscales anyway and bills for the upload regardless.
 *
 * Deliberately not the 2576px high-resolution-tier ceiling that Sonnet 5 and
 * Opus 5 would allow: a shot of a cookbook page is comfortably legible at 1568,
 * and pinning it here makes an import cost the same whichever model the user
 * picked in Settings instead of ~3x more on the larger two.
 */
export const MAX_PHOTO_EDGE = 1568;

/** JPEG quality for the downscaled copy. Text on a page survives this easily. */
const PHOTO_COMPRESS = 0.7;

export type RecipePhotoSource = 'camera' | 'library';

export interface RecipePhoto extends RecipeImage {
  /** Always JPEG — see the note above about HEIC. */
  mediaType: 'image/jpeg';
  width: number;
  height: number;
}

/**
 * Four outcomes, because three of them need different UI and none of them is
 * exceptional. Cancelling is a silent no-op, a denial needs an alert pointing at
 * Settings, and a failure needs error copy in the sheet — throwing would make
 * "the user changed their mind" an exception.
 */
export type RecipePhotoResult =
  | { status: 'ok'; photo: RecipePhoto }
  | { status: 'canceled' }
  | { status: 'denied'; source: RecipePhotoSource; canAskAgain: boolean }
  | { status: 'failed'; message: string };

/**
 * The dimension to resize to, or null when the photo is already small enough.
 *
 * Returns only one axis on purpose — the manipulator preserves the aspect ratio
 * when given one, and letterboxes when given both.
 */
export function photoTargetSize(
  width: number,
  height: number,
  maxLongEdge: number = MAX_PHOTO_EDGE,
): { width: number } | { height: number } | null {
  const long = Math.max(width, height);
  // A resize also *up*scales, so anything already inside the cap is left alone.
  if (!Number.isFinite(long) || long <= 0 || long <= maxLongEdge) return null;
  return width >= height ? { width: maxLongEdge } : { height: maxLongEdge };
}

function imagePicker(): typeof import('expo-image-picker') {
  return require('expo-image-picker');
}

function imageManipulator(): typeof import('expo-image-manipulator') {
  return require('expo-image-manipulator');
}

function fileSystem(): typeof import('expo-file-system') {
  return require('expo-file-system');
}

/**
 * The temp file `saveAsync` writes to the cache directory. We only ever wanted
 * the string, so the copy of the user's photo goes straight back out — best
 * effort, same as discardBackupFile: a cache file we couldn't delete is not
 * worth failing an import over.
 */
function discardTempPhoto(uri: string): void {
  try {
    new (fileSystem().File)(uri).delete();
  } catch {
    // Cache directory; the OS reclaims it.
  }
}

/** Takes or picks a photo and returns it sized and encoded for the Messages API. */
export async function pickRecipePhoto(source: RecipePhotoSource): Promise<RecipePhotoResult> {
  try {
    const ImagePicker = imagePicker();

    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    // Don't launch into a picker that can only fail.
    if (!permission.granted) {
      return { status: 'denied', source, canAskAgain: permission.canAskAgain !== false };
    }

    const options: import('expo-image-picker').ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      // iOS's built-in crop is a fixed square and would slice half a cookbook
      // page off. A crop worth offering here would have to be free-form.
      allowsEditing: false,
      quality: 1,
      exif: false,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) return { status: 'canceled' };
    const asset = result.assets?.[0];
    if (!asset?.uri) return { status: 'failed', message: 'No photo came back from the picker.' };

    const { ImageManipulator, SaveFormat } = imageManipulator();
    const context = ImageManipulator.manipulate(asset.uri);
    const target = photoTargetSize(asset.width, asset.height);
    if (target) context.resize(target);

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: PHOTO_COMPRESS,
      format: SaveFormat.JPEG,
      base64: true,
    });

    if (saved.uri) discardTempPhoto(saved.uri);
    if (!saved.base64) return { status: 'failed', message: 'That photo could not be read.' };

    return {
      status: 'ok',
      photo: {
        base64: saved.base64,
        mediaType: 'image/jpeg',
        width: saved.width,
        height: saved.height,
      },
    };
  } catch (e) {
    return {
      status: 'failed',
      message: e instanceof Error && e.message ? e.message : 'That photo could not be read.',
    };
  }
}
