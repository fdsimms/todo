import * as Notifications from 'expo-notifications';
import type { PermissionResponse } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { Task } from '../types';
import { isTimedTask, isTimerRunning, timerRemaining } from './timer';

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

export async function scheduleTaskReminder(task: Task): Promise<void> {
  if (!task.reminderTime || task.completed || task.archived) return;
  const triggerDate = new Date(task.reminderTime);
  if (triggerDate <= new Date()) return;

  await Notifications.cancelScheduledNotificationAsync(task.id).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: task.id,
    content: {
      title: task.title || 'Task reminder',
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
const MAX_PENDING_REMINDERS = 64;

export async function rescheduleAllReminders(tasks: Task[]): Promise<void> {
  const now = new Date();
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});

  const upcoming = tasks
    .filter(t => t.reminderTime && !t.completed && !t.archived && new Date(t.reminderTime) > now)
    .sort((a, b) => new Date(a.reminderTime!).getTime() - new Date(b.reminderTime!).getTime())
    .slice(0, MAX_PENDING_REMINDERS);

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
      body: `${task.title || 'Your task'} — ready to complete`,
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
