import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Whether the system clipboard holds an image right now, for a paste-text field
 * to offer it as a photo. iOS never offers "Paste" in a text box for an image,
 * so without this a screenshot copied from another app looks unpasteable.
 *
 * `hasImageAsync` only asks whether one is there; it reads nothing and does
 * not raise iOS's paste banner (that appears when the image is actually read,
 * by `pickRecipePhoto('clipboard')`). It is re-checked when `active` turns on
 * and each time the app returns to the foreground, which is when a copy made
 * in another app lands.
 */
export function useClipboardImage(active: boolean): boolean {
  const [hasImage, setHasImage] = useState(false);

  useEffect(() => {
    if (!active) { setHasImage(false); return; }

    let cancelled = false;
    const check = () => {
      Clipboard.hasImageAsync()
        .then((has) => { if (!cancelled) setHasImage(has); })
        .catch(() => { if (!cancelled) setHasImage(false); });
    };

    check();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { cancelled = true; sub.remove(); };
  }, [active]);

  return hasImage;
}
