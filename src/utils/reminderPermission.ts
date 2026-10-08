import { getNotificationPermission, requestNotificationPermissions } from './notifications';
import { isDemoModeActive } from './demoState';

/**
 * Asks the system for notification permission at the moment a person sets a
 * reminder, if it has never been asked.
 *
 * The prompt used to exist only in Settings > Notifications, so a new user who
 * set a reminder got nothing and no hint why. Asked here it is in context: the
 * person just said they want one. It is asked once. A permission that was
 * already answered, either way, is left alone (iOS shows the prompt a single
 * time, and a denied answer is shown, with a button to Settings, on the
 * Notifications row), and a reminder set by the app on its own never comes
 * through here.
 */
export async function askForReminderPermissionIfNeeded(): Promise<void> {
  if (isDemoModeActive()) return;
  if ((await getNotificationPermission()) !== 'undetermined') return;
  await requestNotificationPermissions();
}
