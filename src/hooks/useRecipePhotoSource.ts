import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { RecipeSource } from '../services/aiSuggestions';
import { pickRecipePhoto, type RecipePhoto, type RecipePhotoSource } from '../utils/recipePhoto';
import type { RecipeInputMode } from '../components/RecipeSourcePicker';
import { haptics } from '../utils/haptics';

/**
 * The paste-or-photo state every recipe import sheet keeps, plus the three
 * non-success outcomes of picking a photo.
 *
 * Lives here rather than in `RecipeSourcePicker` because the picker is a dumb
 * controlled component and the *sheet* owns when a run happens. Lives here
 * rather than in each sheet because the denial alert is the same three lines of
 * user-facing copy in all of them, and iOS only prompts once — without an alert
 * naming the permission, a second tap on "Take a photo" does nothing visible.
 */
export function useRecipePhotoSource() {
  const [mode, setMode] = useState<RecipeInputMode>('paste');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<RecipePhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMode('paste');
    setText('');
    setPhoto(null);
    setPicking(false);
    setPhotoError(null);
  }, []);

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

  /** What to hand `extractRecipe`, or null when the active mode has nothing in it. */
  const source: RecipeSource | null = mode === 'photo'
    ? photo
    : (text.trim() ? text : null);

  return {
    mode, setMode,
    text, setText,
    photo, clearPhoto,
    picking, pick,
    photoError,
    source,
    usingPhoto: mode === 'photo',
    reset,
  };
}
