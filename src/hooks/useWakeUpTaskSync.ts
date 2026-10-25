import { useEffect } from 'react';
import { useAlarmStore } from '../store/useAlarmStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { syncWakeUpAlarm } from '../utils/wakeUpAlarm';

/**
 * Re-runs `checkWakeUpTasks`, and sets this phone's alarm for what it wrote,
 * whenever the calendar window it reads lands or its settings change. Call
 * once from the root component.
 *
 * `useTravelTaskSync`'s reason: the foreground sweep fires on the AppState
 * change that starts the calendar read, so it usually runs before the window
 * lands. The alarm half also waits for the alarm store, since an unread list
 * looks like "nothing rings" (`syncWakeUpAlarm` refuses until it is read).
 *
 * Over-firing is cheap: the task sweep is idempotent and the alarm is set once
 * per answer (`wakeAlarmKey`), and both return at once while the feature is off.
 */
export function useWakeUpTaskSync(): void {
  useEffect(() => {
    const check = () => {
      useTaskStore.getState().checkWakeUpTasks();
      syncWakeUpAlarm();
    };

    const unsubscribeCalendar = useCalendarStore.subscribe((state, prev) => {
      if (state.events !== prev.events || state.loaded !== prev.loaded) check();
    });
    const unsubscribeAlarms = useAlarmStore.subscribe((state, prev) => {
      if (state.initialized !== prev.initialized) check();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.wakeUpTasks !== prev.wakeUpTasks
        || state.wakeUpTaskCategory !== prev.wakeUpTaskCategory
        || state.wakeUpUsualMinutes !== prev.wakeUpUsualMinutes
        || state.wakeUpGetReadyMinutes !== prev.wakeUpGetReadyMinutes
        || state.travelLeadMinutes !== prev.travelLeadMinutes
        || state.travelArriveEarlyMinutes !== prev.travelArriveEarlyMinutes
        || state.travelLeadByCalendar !== prev.travelLeadByCalendar
        || state.calendarReadEnabled !== prev.calendarReadEnabled
      ) {
        check();
      }
    });

    return () => {
      unsubscribeCalendar();
      unsubscribeAlarms();
      unsubscribeSettings();
    };
  }, []);
}
