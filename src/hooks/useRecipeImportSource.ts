import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { RecipeSource } from '../services/aiSuggestions';
import { fetchRecipePage, type FetchedRecipePage } from '../services/recipePage';
import { pickRecipePhoto, type RecipePhoto, type RecipePhotoSource } from '../utils/recipePhoto';
import type { RecipeInputMode } from '../components/RecipeSourcePicker';
import { haptics } from '../utils/haptics';

/** Every call site that doesn't opt into more — a receipt is one document, not several pages to combine. */
const DEFAULT_MAX_PHOTOS = 1;

export interface ResolvedRecipeSource {
  /** What `extractRecipe` reads — the pasted text, the photo, or the page's. */
  source: RecipeSource;
  /** The page this came off, for a link. Null for a paste or a photo. */
  page: FetchedRecipePage | null;
}

/**
 * The "we asked and they said no" alert, shared with `useRecipeComponentImports`
 * rather than written twice.
 *
 * iOS only ever prompts once, so without an alert naming the permission a second
 * tap on "Take a photo" does nothing visible at all — which is the reason this
 * exists, and the reason two surfaces that both pick photos must not drift into
 * two phrasings of it.
 */
export function alertPhotoAccessDenied(
  source: RecipePhotoSource,
  canAskAgain: boolean,
  purpose: string,
): void {
  const what = source === 'camera' ? 'the camera' : 'your photos';
  Alert.alert(
    `dundundun can't reach ${what}`,
    canAskAgain
      ? `Allow access to ${what} to ${purpose}.`
      : `Turn on access to ${what} in Settings to ${purpose}.`,
    canAskAgain
      ? [{ text: 'OK' }]
      : [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ],
  );
}

/**
 * The paste-or-link-or-photo state every recipe import sheet keeps, plus the
 * three non-success outcomes of picking a photo.
 *
 * Lives here rather than in `RecipeSourcePicker` because the picker is a dumb
 * controlled component and the *sheet* owns when a run happens. Lives here
 * rather than in each sheet because the denial alert is the same three lines of
 * user-facing copy in all of them, and iOS only prompts once — without an alert
 * naming the permission, a second tap on "Take a photo" does nothing visible.
 *
 * **`resolveSource` is async for one mode and that's why it exists.** A link
 * has to be fetched before there's anything to extract, and putting that in
 * each sheet's own `run()` would be three copies of the same two-step. The
 * sheets stayed one line different from what they were: `input.source` became
 * `await input.resolveSource()`.
 *
 * **`photos` is an array for every caller, even the ones that only ever hold
 * one.** `maxPhotos` is what tells them apart: the default of 1 keeps the
 * receipt scanner's "one document" behavior (`pick` replaces rather than
 * appends, and there is nothing to remove but the whole thing), while a recipe
 * import sheet passes `MAX_RECIPE_PHOTOS` to let a cookbook page that runs
 * across a page turn be photographed as more than one image.
 */
export function useRecipeImportSource(
  initialMode: RecipeInputMode = 'paste',
  /**
   * What the photo is *for*, completing "Allow access to the camera to …".
   * Parameterized rather than fixed because the denial alert is the one piece
   * of user-facing copy in here, and the receipt scanner — which reuses this
   * hook's photo half — telling someone it wants the camera "to read a recipe
   * off a page" is simply the wrong sentence.
   */
  purpose = 'read a recipe off a page',
  /** How many photos `pick` will accumulate before it stops adding more. */
  maxPhotos = DEFAULT_MAX_PHOTOS,
) {
  const [mode, setMode] = useState<RecipeInputMode>(initialMode);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [photos, setPhotos] = useState<RecipePhoto[]>([]);
  const [picking, setPicking] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [page, setPage] = useState<FetchedRecipePage | null>(null);

  const reset = useCallback(() => {
    setMode(initialMode);
    setText('');
    setUrl('');
    setPhotos([]);
    setPicking(false);
    setPhotoError(null);
    setFetching(false);
    setPage(null);
  }, [initialMode]);

  const pick = useCallback(async (source: RecipePhotoSource) => {
    setPicking(true);
    setPhotoError(null);
    try {
      const result = await pickRecipePhoto(source);
      if (result.status === 'ok') {
        haptics.success();
        // `maxPhotos === 1` keeps the old replace-on-pick behavior rather than
        // ever holding two — a receipt re-photographed is a correction, not a
        // second page.
        setPhotos(prev => (maxPhotos > 1 ? [...prev, result.photo] : [result.photo]).slice(0, maxPhotos));
      } else if (result.status === 'denied') {
        alertPhotoAccessDenied(source, result.canAskAgain, purpose);
      } else if (result.status === 'failed') {
        setPhotoError(result.message);
      }
      // 'canceled' is a deliberate no-op — they changed their mind.
    } finally {
      setPicking(false);
    }
  }, [purpose, maxPhotos]);

  /** Drops one photo by index, or every photo when called with none. */
  const clearPhoto = useCallback((index?: number) => {
    setPhotoError(null);
    setPhotos(prev => (index === undefined ? [] : prev.filter((_, i) => i !== index)));
  }, []);

  /**
   * What to hand `extractRecipe`, or null when the active mode has nothing in
   * it. Throws a `RecipePageError` when a link can't be read — the sheets map
   * it through `describeImportError` alongside the extraction's own failures.
   *
   * **The page comes back rather than only being stashed in state**, because a
   * caller reading `page` from the same tick that called this would read the
   * render it was created in — i.e. the previous run's page, or null. State is
   * still kept for the later reads (a Create tap, several renders on), where it
   * is the fresh value.
   */
  const resolveSource = useCallback(async (): Promise<ResolvedRecipeSource | null> => {
    // Cleared up front so a second run can never attribute its recipe to the
    // page the *previous* run fetched.
    setPage(null);
    // extractRecipe treats a one-entry array exactly like a bare image, so
    // there's no need to unwrap it back to a single object here.
    if (mode === 'photo') return photos.length ? { source: photos, page: null } : null;
    if (mode === 'paste') return text.trim() ? { source: text, page: null } : null;

    const typed = url.trim();
    if (!typed) return null;
    setFetching(true);
    try {
      const fetched = await fetchRecipePage(typed);
      setPage(fetched);
      return { source: fetched.text, page: fetched };
    } finally {
      setFetching(false);
    }
  }, [mode, photos, text, url]);

  return {
    mode, setMode,
    text, setText,
    url, setUrl,
    photos, clearPhoto,
    maxPhotos,
    picking, pick,
    photoError,
    /** True only while the page request is in flight, not during extraction. */
    fetching,
    /** The page the last run read, when it read one — its title, site and method. */
    page,
    resolveSource,
    usingPhoto: mode === 'photo',
    usingLink: mode === 'link',
    reset,
  };
}
