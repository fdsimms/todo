import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Whether the clipboard is holding something worth offering to paste, and a way
 * to fetch it.
 *
 * **The split between the two calls is the whole design, and it's an iOS
 * privacy rule rather than a preference.** `hasUrlAsync`/`hasStringAsync` answer
 * "is there one" without handing over the contents, so they don't trip the
 * system's paste prompt and can be called on a tab change nobody asked for.
 * `getStringAsync` *does* read it, and does prompt — which is correct there,
 * because by then the user has tapped a button that says Paste. Reading up front
 * to decide whether to show the button would put an OS permission alert on
 * screen for a control they hadn't touched.
 *
 * `hasUrlAsync` is iOS-only; everywhere else falls back to "is there any text",
 * which over-offers slightly rather than never offering at all.
 */
export function useClipboardUrl(active: boolean) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!active) {
      setAvailable(false);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const has = Platform.OS === 'ios'
          ? await Clipboard.hasUrlAsync()
          : await Clipboard.hasStringAsync();
        if (live) setAvailable(has);
      } catch {
        // A clipboard that won't answer is one we don't offer — the field is
        // still there to type into, and long-press paste is untouched.
        if (live) setAvailable(false);
      }
    })();
    return () => { live = false; };
  }, [active]);

  /** The clipboard's text, or null when it can't be read. */
  const paste = useCallback(async (): Promise<string | null> => {
    try {
      const text = await Clipboard.getStringAsync();
      return text.trim() || null;
    } catch {
      return null;
    }
  }, []);

  return { available, paste };
}
