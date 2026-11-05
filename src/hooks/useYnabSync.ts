import { useEffect } from 'react';
import { AppState } from 'react-native';
import { ynabWanted } from '../services/ynab';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useYnabStore } from '../store/useYnabStore';

/**
 * How often an open, foregrounded app reads the plan again. Six reads an hour
 * at three requests each is well inside YNAB's 200 an hour.
 */
const FOREGROUND_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Keeps the YNAB read fresh and the YNAB tasks current. Call once from the
 * root component. `useWaniKaniSync`'s two jobs, for its reasons:
 *
 * **It keeps the read fresh**: on mount, when a setting the read depends on
 * changes, on coming to the foreground, and on an interval while the app is
 * open and in front. Nothing at all is read while every YNAB feature is off.
 *
 * **It re-runs `checkYnabTasks` when what it reads changes**: a new read, or
 * one of the task settings. That check reads the store and never fetches, so
 * this is where it runs. Here rather than in either store because
 * `useTaskStore` already imports `useYnabStore`, so a subscription there
 * reaching back would be an import cycle.
 */
export function useYnabSync(): void {
  useEffect(() => {
    const check = () => useTaskStore.getState().checkYnabTasks();
    const refresh = (force = false) => {
      const s = useSettingsStore.getState();
      if (s.initialized && ynabWanted(s)) void useYnabStore.getState().refresh(force);
    };

    void useYnabStore.getState().initialize();

    const unsubscribeSnapshot = useYnabStore.subscribe((state, prev) => {
      if (state.snapshot !== prev.snapshot) check();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.ynabTaskCategory !== prev.ynabTaskCategory ||
        state.ynabOverspentTasks !== prev.ynabOverspentTasks ||
        state.currencySymbol !== prev.currencySymbol ||
        state.vacationMode !== prev.vacationMode
      ) {
        check();
      }
      // The queue is read only while the task is on, and a different plan is
      // a different read, so these are a new read rather than a re-check.
      if (
        state.initialized !== prev.initialized ||
        state.ynabTasks !== prev.ynabTasks ||
        state.ynabGroceryBudget !== prev.ynabGroceryBudget ||
        state.ynabPlanId !== prev.ynabPlanId
      ) {
        if (ynabWanted(state)) refresh(true);
        else useYnabStore.getState().clear();
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
