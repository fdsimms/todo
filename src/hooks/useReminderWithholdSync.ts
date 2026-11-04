import { useEffect } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useProjectStore } from '../store/useProjectStore';
import { rebuildNotificationQueue } from '../utils/maintenancePasses';
import { pauseSignature } from '../utils/projectPause';

/**
 * Rebuilds the notification queue when a task's reminders start or stop being
 * withheld: vacation mode turning on or off, or a project's pause being set or
 * lifted. Call once from the root component.
 *
 * `scheduleTaskReminder` leaves a withheld task alone and the rebuild only
 * schedules what is wanted, so nothing took back a reminder that was already
 * pending when the withholding began. Turning vacation on kept firing the
 * reminders it was meant to quiet, and so did the app arming it on departure
 * morning (the away dates pass runs after the launch rebuild). The same rebuild
 * puts the reminders back when it lifts. Waits for the task store, since the
 * settings and projects load first and that flip is not a change.
 */
export function useReminderWithholdSync(): void {
  useEffect(() => {
    const rebuild = () => {
      if (useTaskStore.getState().initialized) rebuildNotificationQueue();
    };
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (state.vacationMode !== prev.vacationMode) rebuild();
    });
    const unsubscribeProjects = useProjectStore.subscribe((state, prev) => {
      if (state.projects !== prev.projects && pauseSignature(state.projects) !== pauseSignature(prev.projects)) rebuild();
    });
    return () => {
      unsubscribeSettings();
      unsubscribeProjects();
    };
  }, []);
}
