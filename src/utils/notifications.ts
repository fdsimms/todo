import * as Notifications from 'expo-notifications';
import type { PermissionResponse } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { Task } from '../types';

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

export async function rescheduleAllReminders(tasks: Task[]): Promise<void> {
  const now = new Date();
  for (const task of tasks) {
    if (task.completed || task.archived || !task.reminderTime || new Date(task.reminderTime) <= now) {
      await cancelTaskReminder(task.id);
    } else {
      await scheduleTaskReminder(task);
    }
  }
}
