import * as Notifications from 'expo-notifications';
import type { PermissionResponse } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { Task } from '../types';
import { isTimedTask, isTimerRunning, timerRemaining } from './timer';
import { displayTitleFor } from './visibilityUtils';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const existing = (await Notifications.getPermissionsAsync()) as unknown as PermissionResponse;
  if (existing.granted) return true;
  const result = (await Notifications.requestPermissionsAsync()) as unknown as PermissionResponse;
  return result.granted;
}

/**
 * `undetermined` means the OS prompt hasn't been shown yet, so asking still
 * works; `denied` means it has, and on iOS asking again is a no-op — the only
 * way back is the system Settings app.
 */
export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/**
 * The live permission state, for showing the user why their reminders aren't
 * arriving. `requestNotificationPermissions` returns a bare boolean that
 * nothing surfaced, so a declined prompt just looked like the app was broken.
 */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (Platform.OS === 'web') return 'unsupported';
  const existing = (await Notifications.getPermissionsAsync()) as unknown as PermissionResponse;
  if (existing.granted) return 'granted';
  // `canAskAgain` is the honest signal for "the prompt is still available":
  // iOS reports `undetermined` only before the first ask, and some platforms
  // report a provisional status that is neither granted nor a hard denial.
  return existing.status === 'undetermined' || existing.canAskAgain ? 'undetermined' : 'denied';
}

export async function scheduleTaskReminder(task: Task): Promise<void> {
  if (!task.reminderTime || task.completed || task.archived) return;
  const triggerDate = new Date(task.reminderTime);
  if (triggerDate <= new Date()) return;

  await Notifications.cancelScheduledNotificationAsync(task.id).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: task.id,
    content: {
      title: displayTitleFor(task) || 'Task reminder',
      body: task.notes || 'You have a task coming up',
      data: { taskId: task.id },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}

export async function cancelTaskReminder(taskId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(taskId).catch(() => {});
}

// iOS caps pending local notification requests at 64.
export const MAX_PENDING_REMINDERS = 64;

/**
 * Every reminder still ahead of `now`, soonest first — uncapped.
 *
 * Split out from rescheduleAllReminders so Settings can count what the user
 * asked for against what iOS will actually hold, without re-deriving the rule
 * and drifting from it.
 */
export function upcomingReminders(tasks: Task[], now: Date = new Date()): Task[] {
  return tasks
    .filter(t => t.reminderTime && !t.completed && !t.archived && new Date(t.reminderTime) > now)
    .sort((a, b) => new Date(a.reminderTime!).getTime() - new Date(b.reminderTime!).getTime());
}

export interface PendingReminderStats {
  /** Upcoming reminders the user has actually asked for. */
  wanted: number;
  /** How many of those iOS will hold — the rest are silently never scheduled. */
  scheduled: number;
  /** wanted − scheduled: reminders that will not fire, and used to say so. */
  dropped: number;
}

/**
 * What the reminder queue looks like against the OS cap.
 *
 * The scheduler drops the furthest-out reminders when there are more than the
 * cap, which is the right call — nearer ones matter sooner — but it happens
 * silently, so a user with 80 future reminders has 16 that will never fire and
 * nothing anywhere tells them.
 */
export function pendingReminderStats(tasks: Task[], now: Date = new Date()): PendingReminderStats {
  const wanted = upcomingReminders(tasks, now).length;
  const scheduled = Math.min(wanted, MAX_PENDING_REMINDERS);
  return { wanted, scheduled, dropped: wanted - scheduled };
}

export async function rescheduleAllReminders(tasks: Task[]): Promise<void> {
  const now = new Date();
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});

  const upcoming = upcomingReminders(tasks, now).slice(0, MAX_PENDING_REMINDERS);

  for (const task of upcoming) {
    await scheduleTaskReminder(task);
  }

  // cancelAllScheduledNotificationsAsync above is indiscriminate, so a timer
  // that was running when the app was last closed loses its alarm on cold
  // start unless we put it back.
  await rescheduleAllTimerAlarms(tasks);
}

// Timer alarms are namespaced away from reminders, which use the bare task id as
// their identifier. Sharing the id would mean any title/notes edit — which
// cancels and reschedules the reminder — silently destroying a running timer's
// alarm along the way.
const timerAlarmId = (taskId: string): string => `timer:${taskId}`;

/**
 * Fire a local notification when a timed task's countdown runs out, so the user
 * doesn't have to sit watching it. Scheduled against the remaining time, so it
 * lands correctly whether the timer was just started or resumed part-way.
 */
export async function scheduleTimerAlarm(task: Task): Promise<void> {
  await cancelTimerAlarm(task.id);
  if (task.completed || task.archived) return;
  if (!isTimedTask(task) || !isTimerRunning(task)) return;

  const remaining = timerRemaining(task);
  if (remaining <= 0) return; // already up — the row shows it as ready on sight

  await Notifications.scheduleNotificationAsync({
    identifier: timerAlarmId(task.id),
    content: {
      title: 'Time’s up',
      body: `${displayTitleFor(task) || 'Your task'} — ready to complete`,
      data: { taskId: task.id },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + remaining * 1000),
    },
  });
}

export async function cancelTimerAlarm(taskId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(timerAlarmId(taskId)).catch(() => {});
}

export async function rescheduleAllTimerAlarms(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    if (isTimedTask(task) && isTimerRunning(task) && !task.completed && !task.archived) {
      await scheduleTimerAlarm(task);
    }
  }
}
