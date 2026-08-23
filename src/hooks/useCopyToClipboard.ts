import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { haptics } from '../utils/haptics';

/**
 * How long a copy button stays a tick afterwards. Long enough to be read on
 * the way to the other app, short enough that coming back to the screen
 * doesn't find a stale confirmation sitting there.
 */
export const COPIED_TICK_MS = 2000;

/**
 * A copy-to-clipboard button's whole behaviour: write the text, buzz, and
 * report `copied` for a couple of seconds so the caller can show a tick in
 * place of its copy glyph.
 *
 * The tick is the entire confirmation. A copy leaves nothing on screen and
 * this app has no toast, so without it the button looks like it did nothing
 * — which is exactly when someone taps it again and wonders what they pasted.
 *
 * Empty text is a no-op rather than a cleared clipboard: every caller gates
 * its button on having something to copy, and the two disagreeing should not
 * cost the user whatever they had copied before.
 */
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback((text: string) => {
    if (!text) return;
    haptics.success();
    // A rejected write (no pasteboard access) leaves the tick unshown rather
    // than claiming a copy that didn't happen.
    Clipboard.setStringAsync(text)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_TICK_MS);
      })
      .catch(() => {});
  }, []);

  return { copied, copy };
}
