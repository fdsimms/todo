import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { scheduleDailyAgenda } from './notifications';

// Same floor as the widget's snapshot write, and for the same reason: a bulk
// operation touches the task array many times in a row and only the settled
// result is worth scheduling against.
const DEBOUNCE_MS = 300;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSoon(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    scheduleDailyAgenda(useTaskStore.getState().tasks);
  }, DEBOUNCE_MS);
}

/**
 * Keeps the pending daily agenda matching the tasks it's meant to describe.
 *
 * The agenda's body is a count computed when it's scheduled, so it goes stale
 * the moment the tasks it counted change. Subscribing to the store — rather
 * than calling scheduleDailyAgenda from each mutating action — is the same
 * call made for useWidgetSync, and for the same reason: there are ~30 of those
 * actions and any new one would otherwise silently skip the refresh.
 *
 * The AppState hook matters more here than it looks. `rescheduleAllReminders`
 * rebuilds the agenda, but only runs at cold start, and iOS keeps an app alive
 * for days — so without this, an agenda would fire in the morning and then
 * never be replaced, because nothing about coming back to a running app
 * changes the task array. Returning to the app is exactly when the next one
 * needs scheduling.
 */
export function useDailyAgendaSync(): void {
  useEffect(() => {
    const unsubscribeTasks = useTaskStore.subscribe((state, prev) => {
      if (state.tasks !== prev.tasks) scheduleSoon();
    });

    // The time and the on/off switch both change what should be pending, and
    // both are set from a screen that has no business knowing about
    // scheduling. (Settings also schedules directly, so the toggle feels
    // immediate rather than waiting out the debounce.)
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.dailyAgendaEnabled !== prev.dailyAgendaEnabled ||
        state.dailyAgendaTime !== prev.dailyAgendaTime ||
        state.dayResetTime !== prev.dayResetTime ||
        state.vacationMode !== prev.vacationMode
      ) {
        scheduleSoon();
      }
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') scheduleSoon();
    });

    return () => {
      unsubscribeTasks();
      unsubscribeSettings();
      subscription.remove();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  }, []);
}
