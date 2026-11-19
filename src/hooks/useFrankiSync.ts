import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useFrankiStore } from '../store/useFrankiStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';

/** How often an open, foregrounded app reads the server again: WaniKani's figure. */
const FOREGROUND_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Keeps the Franki tasks current. Call once from the root component.
 * `useWaniKaniSync`'s two jobs, for its reasons: it keeps the read fresh (on
 * mount, when a setting the read depends on changes, on coming to the
 * foreground, and on an interval while the app is in front), and it re-runs
 * `checkFrankiTasks` when what that check reads changes. The check reads the
 * store and never fetches.
 */
export function useFrankiSync(): void {
  useEffect(() => {
    const check = () => useTaskStore.getState().checkFrankiTasks();
    const refresh = (force = false) => {
      const s = useSettingsStore.getState();
      if (s.initialized && s.frankiTasks) void useFrankiStore.getState().refresh(force);
    };

    void useFrankiStore.getState().initialize();

    const unsubscribeSnapshot = useFrankiStore.subscribe((state, prev) => {
      if (state.snapshot !== prev.snapshot) check();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.frankiReviewThreshold !== prev.frankiReviewThreshold ||
        state.frankiTaskCategory !== prev.frankiTaskCategory ||
        state.frankiReadTasks !== prev.frankiReadTasks ||
        state.vacationMode !== prev.vacationMode
      ) {
        check();
      }
      // A new address is a new server to read.
      if (
        state.initialized !== prev.initialized ||
        state.frankiTasks !== prev.frankiTasks ||
        state.frankiServer !== prev.frankiServer
      ) {
        if (state.frankiTasks) refresh(true);
        else useFrankiStore.getState().clear();
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
