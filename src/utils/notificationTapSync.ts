import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { resetToToday } from '../navigation/navigationRef';

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
export function useNotificationTapSync(): void {
  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data as { taskId?: string; dailyAgenda?: boolean } | undefined;
      if (data?.taskId) resetToToday();
    };

    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
