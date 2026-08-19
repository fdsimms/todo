import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { pickSharedRecipeUrl } from './sharedRecipeQueue';
import { openRecipeImportFromShare } from '../navigation/navigationRef';

/**
 * "Share → dundundun" from Safari: the extension writes the address into the
 * App Group queue and this drains it when the app comes forward.
 *
 * The extension deliberately does none of the work — it's a memory-capped,
 * short-lived process, and the API key lives here rather than there — so what
 * arrives is only ever an address. From this point on a shared link is exactly
 * a typed one: it lands in `RecipeCreateSheet` on the Link tab, and the user
 * still presses the button.
 */

/** Drains the queue and returns the address to import, if any. */
export async function drainSharedRecipeImport(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    // Required lazily, like widgetSync does: the native module isn't present
    // in the jest `node` environment, and reaching it at import time would
    // take down every suite that transitively loads this file.
    const { drainSharedRecipeUrls } = require('todo-widget-bridge') as {
      drainSharedRecipeUrls: () => Promise<string[]>;
    };
    return pickSharedRecipeUrl(await drainSharedRecipeUrls());
  } catch {
    // An older build with no such native function, or a container that won't
    // open. Nothing to recover — the share is lost rather than the launch.
    return null;
  }
}

/**
 * Watches for shared addresses and hands them to the Recipes screen.
 *
 * Drains on mount *and* on every foreground, the same pair `useWidgetSync`
 * needs: the extension tries to bring the app forward itself, and when the app
 * was already running in the background that arrives as an AppState change with
 * no remount to hang the drain off.
 */
export function useSharedRecipeImport(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const drain = () => {
      void drainSharedRecipeImport().then(url => {
        if (url) openRecipeImportFromShare(url);
      });
    };

    drain();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') drain();
    });
    return () => subscription.remove();
  }, []);
}
