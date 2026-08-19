import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { RecipeSource } from '../services/aiSuggestions';
import { fetchRecipePage, type FetchedRecipePage } from '../services/recipePage';
import { pickRecipePhoto, type RecipePhoto, type RecipePhotoSource } from '../utils/recipePhoto';
import type { RecipeInputMode } from '../components/RecipeSourcePicker';
import { haptics } from '../utils/haptics';

export interface ResolvedRecipeSource {
  /** What `extractRecipe` reads — the pasted text, the photo, or the page's. */
  source: RecipeSource;
  /** The page this came off, for a link. Null for a paste or a photo. */
  page: FetchedRecipePage | null;
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
 */
export function useRecipeImportSource(initialMode: RecipeInputMode = 'paste') {
  const [mode, setMode] = useState<RecipeInputMode>(initialMode);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [photo, setPhoto] = useState<RecipePhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [page, setPage] = useState<FetchedRecipePage | null>(null);

  const reset = useCallback(() => {
    setMode(initialMode);
    setText('');
    setUrl('');
    setPhoto(null);
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
        setPhoto(result.photo);
      } else if (result.status === 'denied') {
        const what = source === 'camera' ? 'the camera' : 'your photos';
        Alert.alert(
          `dundundun can't reach ${what}`,
          result.canAskAgain
            ? `Allow access to ${what} to read a recipe off a page.`
            : `Turn on access to ${what} in Settings to read a recipe off a page.`,
          result.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ],
        );
      } else if (result.status === 'failed') {
        setPhotoError(result.message);
      }
      // 'canceled' is a deliberate no-op — they changed their mind.
    } finally {
      setPicking(false);
    }
  }, []);

  const clearPhoto = useCallback(() => {
    setPhoto(null);
    setPhotoError(null);
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
    if (mode === 'photo') return photo ? { source: photo, page: null } : null;
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
  }, [mode, photo, text, url]);

  return {
    mode, setMode,
    text, setText,
    url, setUrl,
    photo, clearPhoto,
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
