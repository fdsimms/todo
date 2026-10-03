import { useEffect } from 'react';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { meetingSignature } from '../utils/reminderNudge';
import { rebuildNotificationQueue } from '../utils/maintenancePasses';

/**
 * Re-applies "push a reminder past a meeting" when the meetings change. Call
 * once from the root component.
 *
 * `nudgeReminderPastMeeting` runs as each reminder is scheduled, against
 * whatever the calendar store holds at that moment. Two things slipped past
 * that: a meeting booked over a reminder after it was scheduled, and the cold
 * start, where the queue is rebuilt as the task store loads, usually before
 * the calendar read has landed, so nothing was nudged at all until something
 * else rescheduled. Rebuilding the queue whenever the set of meetings changes
 * (`meetingSignature`) covers both: the first successful read after launch is
 * always a change.
 *
 * Switching the nudge (or calendar reading) off rebuilds too, so a reminder
 * already moved goes back to the time the user picked rather than staying
 * moved until something else happens to reschedule it.
 *
 * Waits for the task store: rebuilding before it loads would schedule the
 * daily agenda against no tasks. Demo mode needs no gate here, since every
 * scheduling function in `notifications.ts` already returns early in one.
 */
export function useReminderMeetingResync(): void {
  useEffect(() => {
    // Null until the nudge has been applied against a read, so the first read
    // after launch (or after the setting comes back on) always rebuilds.
    let applied: string | null = null;

    const enabled = () => {
      const s = useSettingsStore.getState();
      return s.initialized && s.calendarReadEnabled && s.reminderMeetingNudgeEnabled;
    };

    const sync = () => {
      if (!useTaskStore.getState().initialized || !enabled()) return;
      const calendar = useCalendarStore.getState();
      if (!calendar.loaded) return;
      const signature = meetingSignature(calendar.events);
      if (signature === applied) return;
      applied = signature;
      rebuildNotificationQueue();
    };

    const unsubscribeCalendar = useCalendarStore.subscribe((state, prev) => {
      if (state.events !== prev.events || state.loaded !== prev.loaded) sync();
    });
    const unsubscribeTasks = useTaskStore.subscribe((state, prev) => {
      if (state.initialized && !prev.initialized) sync();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      const was = prev.initialized && prev.calendarReadEnabled && prev.reminderMeetingNudgeEnabled;
      const now = state.initialized && state.calendarReadEnabled && state.reminderMeetingNudgeEnabled;
      if (was === now) return;
      applied = null;
      if (now) sync();
      // Turned off: put any reminder the nudge had moved back where it was.
      else if (useTaskStore.getState().initialized && state.initialized) rebuildNotificationQueue();
    });
    sync();

    return () => {
      unsubscribeCalendar();
      unsubscribeTasks();
      unsubscribeSettings();
    };
  }, []);
}
