import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useWaniKaniStore } from '../store/useWaniKaniStore';

/** How often an open, foregrounded app reads the account again. Reviews arrive on the hour. */
const FOREGROUND_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Keeps the WaniKani tasks current. Call once from the root component.
 * `useTravelTaskSync`'s two jobs, for its reasons:
 *
 * **It keeps the read fresh**: on mount, when a setting the read depends on
 * changes, on coming to the foreground, and on an interval while the app is
 * open and in front. Nothing is read while the app is closed (see
 * `backgroundRefresh.ts`); the forecast is what covers that, since a task
 * wanted at 3 PM is written ahead and held until then.
 *
 * **It re-runs `checkWaniKaniTasks` when what it reads changes**: a new read,
 * or one of its settings. That check reads the store and never fetches, so it
 * is the only place it runs. It lives here rather than in either store
 * because `useTaskStore` already imports `useWaniKaniStore`, so a subscription
 * there reaching back would be an import cycle.
 */
export function useWaniKaniSync(): void {
  useEffect(() => {
    const check = () => useTaskStore.getState().checkWaniKaniTasks();
    const refresh = (force = false) => {
      const s = useSettingsStore.getState();
      if (s.initialized && s.wanikaniTasks) void useWaniKaniStore.getState().refresh(force);
    };

    void useWaniKaniStore.getState().initialize();

    const unsubscribeSnapshot = useWaniKaniStore.subscribe((state, prev) => {
      if (state.snapshot !== prev.snapshot) check();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.wanikaniReviewThreshold !== prev.wanikaniReviewThreshold ||
        state.wanikaniTaskCategory !== prev.wanikaniTaskCategory ||
        state.wanikaniNotify !== prev.wanikaniNotify ||
        state.wanikaniClientLink !== prev.wanikaniClientLink ||
        state.vacationMode !== prev.vacationMode
      ) {
        check();
      }
      // A read asks for lessons and Apprentice only when the lessons task
      // wants them, so changing that is a new read rather than a re-check.
      if (
        state.initialized !== prev.initialized ||
        state.wanikaniTasks !== prev.wanikaniTasks ||
        state.wanikaniLessonsPerDay !== prev.wanikaniLessonsPerDay ||
        state.wanikaniApprenticeCap !== prev.wanikaniApprenticeCap
      ) {
        if (state.wanikaniTasks) refresh(true);
        else useWaniKaniStore.getState().clear();
      }
    });

    refresh();

    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (interval === null) interval = setInterval(() => refresh(), FOREGROUND_REFRESH_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === 'active') startInterval();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
        startInterval();
      } else {
        stopInterval();
      }
    });

    return () => {
      unsubscribeSnapshot();
      unsubscribeSettings();
      subscription.remove();
      stopInterval();
    };
  }, []);
}
