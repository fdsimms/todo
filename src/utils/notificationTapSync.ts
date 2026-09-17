import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useTaskStore } from '../store/useTaskStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { resetToToday } from '../navigation/navigationRef';
import { COMPLETE_ACTION_IDENTIFIER, SNOOZE_ACTION_IDENTIFIER, SNOOZE_MINUTES } from './notifications';
import { useSettingsStore } from '../store/useSettingsStore';
import { speakAgenda } from './agendaSpeech';

// Tapping a reminder (or a fired AlarmKit alarm, which launches the app the
// same way a notification tap does) used to do nothing app-specific — the
// `data.taskId` payload set in scheduleTaskReminder was written but never
// read. Landing on Today, the same place the widget's tap already goes, is
// the fix that matters for alarms: an alarm you dismissed the system UI on
// should still bring you to something useful, not whatever screen the app
// happened to be left on. Opening the exact tapped task is a further
// enhancement — it would need a global "open task by id" hook that no screen
// currently exposes (TaskEditor is opened as per-screen local state, not a
// route), out of scope here.
//
// The Complete/Snooze buttons on the 'task-reminder' category (see
// notifications.ts) land here too, told apart by actionIdentifier — a plain
// tap's is Notifications.DEFAULT_ACTION_IDENTIFIER. Complete enqueues into
// useWidgetCompletionStore rather than calling completeTask() directly: it's
// the same queue-and-drain TodayScreen already runs for the widget checkbox
// and Live Activity's Done button, so it plays the real tap-to-complete
// animation when the task is on Today, or completes silently when it isn't,
// exactly as those do. Snooze re-anchors reminderTime to SNOOZE_MINUTES from
// now and lets updateTask's own reminderTime handling reschedule it, so
// quiet hours and the meeting nudge apply just as they would to a hand-
// picked time.
export function useNotificationTapSync(): void {
  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data as {
        taskId?: string; dailyAgenda?: boolean; agendaSpoken?: string | null; completionTimer?: boolean;
      } | undefined;

      // The agenda notification carries no taskId, so this has to come before
      // the bail below — which is why the dailyAgenda flag had been declared
      // here and never acted on.
      //
      // It speaks the line the notification was scheduled with rather than
      // recounting: a tap is frequently a cold launch, so the stores may hold
      // nothing yet, and anything ticked off since would make a fresh count
      // disagree with the words the person is looking at. See agendaRequest.
      if (data?.dailyAgenda) {
        const line = data.agendaSpoken;
        if (line && useSettingsStore.getState().dailyAgendaSpoken) speakAgenda(line);
        resetToToday();
        return;
      }

      const taskId = data?.taskId;
      if (!taskId) return;

      // The completion timer's own Live Activity has a Done button for this
      // (see the completionTimer: deep link in deepLinks.ts), but most people
      // find the notification first — and tapping it was landing on Today
      // with the Live Activity's countdown left sitting at 0:00 forever,
      // because nothing here read this payload. Same dismissal either way.
      if (data?.completionTimer) {
        useTaskStore.getState().dismissCompletionTimer(taskId);
        resetToToday();
        return;
      }

      if (response.actionIdentifier === COMPLETE_ACTION_IDENTIFIER) {
        useWidgetCompletionStore.getState().enqueue([taskId]);
      } else if (response.actionIdentifier === SNOOZE_ACTION_IDENTIFIER) {
        useTaskStore.getState().updateTask(taskId, {
          reminderTime: new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000).toISOString(),
          reminderUtcOffsetMinutes: new Date().getTimezoneOffset(),
        });
      }
      resetToToday();
    };

    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
