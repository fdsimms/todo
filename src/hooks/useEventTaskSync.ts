import { useEffect } from 'react';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';

/**
 * Re-runs `checkEventTasks` whenever the calendar windows it reads land or its
 * rules change. Call once from the root component.
 *
 * The same reason `useTravelTaskSync` gives for its own check: the foreground
 * sweep fires on the AppState change that starts the calendar read, so it
 * usually runs before the window lands. For a rule that fires ahead of an event
 * that costs a day at worst. For a follow-up it would be a task that never
 * appears until the next foreground, and its window (`followUpEvents`) is read
 * separately and lands later still. It lives in a hook rather than in
 * `useCalendarStore` because `useTaskStore` imports that store.
 *
 * Over-firing is cheap: the sweep is idempotent (a handled record keeps a task
 * from being written twice) and returns at once while the feature is off.
 */
export function useEventTaskSync(): void {
  useEffect(() => {
    const check = () => useTaskStore.getState().checkEventTasks();

    const unsubscribeCalendar = useCalendarStore.subscribe((state, prev) => {
      if (
        state.events !== prev.events
        || state.loaded !== prev.loaded
        || state.followUpEvents !== prev.followUpEvents
        || state.followUpLoaded !== prev.followUpLoaded
      ) {
        check();
      }
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.eventTasks !== prev.eventTasks
        || state.eventRules !== prev.eventRules
        || state.eventTaskCategory !== prev.eventTaskCategory
      ) {
        check();
      }
    });

    return () => {
      unsubscribeCalendar();
      unsubscribeSettings();
    };
  }, []);
}
