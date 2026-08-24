import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useSharedLinkStore } from '../store/useSharedLinkStore';
import { widgetBridge } from '../utils/widgetBridge';

/**
 * Collects recipe pages the share extension has queued in the App Group
 * container (see `targets/todo-share/`) into `useSharedLinkStore`, where the
 * Recipes screen offers them.
 *
 * The same shape `processPendingWidgetCompletions` (`src/utils/widgetSync.ts`)
 * uses for the widget's own queue, and for the same two reasons: the native
 * module is absent outside a dev-client iOS build, so it's lazily required
 * behind a `Platform` check inside a `try`; and a share made while the app was
 * merely backgrounded doesn't remount this effect, so an `AppState` transition
 * to `'active'` is what tells us to look again. `drainSharedLinks` is safe to
 * call with nothing queued.
 *
 * **Hydrating comes first, and always runs.** The persisted queue is the app's
 * only copy once the native drain has deleted the file it read (see the store's
 * note), so it's read back before the first drain and on every platform —
 * including one where the drain itself can never do anything.
 */
export function useSharedRecipeLinks(): void {
  useEffect(() => {
    const { hydrate, enqueue } = useSharedLinkStore.getState();
    hydrate();
    if (Platform.OS !== 'ios') return;

    const drain = async (): Promise<void> => {
      // Null in demo mode, and skipping is the point: the queue holds real
      // links shared in from Safari, and `enqueue` writes through to whichever
      // database is live — which under demo is the throwaway one. Draining
      // there consumes the link and then discards it with the scratch file, so
      // a share the user made would vanish. Left alone, it's still queued for
      // the next foreground after the demo ends.
      const bridge = widgetBridge();
      if (!bridge) return;
      try {
        const urls = await bridge.drainSharedLinks();
        if (urls.length > 0) enqueue(urls);
      } catch {
        // A build predating drainSharedLinks — no-op.
      }
    };

    // Deferred rather than awaited during mount, matching useWidgetSync: the
    // very first native module call shouldn't happen while the app and its
    // native module registry are still mid-launch.
    void drain();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void drain();
    });

    return () => subscription.remove();
  }, []);
}
