import * as Notifications from 'expo-notifications';
import type { PermissionResponse } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { Task } from '../types';
import { isTimedTask, isTimerRunning, timerRemaining } from './timer';
import { displayTitleFor, isHiddenForVacation } from './visibilityUtils';
import { agendaCounts, agendaBody, nextAgendaTime } from './dailyAgenda';
import { useSettingsStore } from '../store/useSettingsStore';

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

  // cancelAllScheduledNotificationsAsync above is indiscriminate — it clears
  // every notification this app owns, not just the reminders this function
  // rebuilt. Anything else the app schedules has to be put back here, and
  // there are now two such things: a timer that was running when the app was
  // last closed would otherwise lose its alarm on cold start, and the daily
  // agenda would simply stop happening.
  //
  // If a third arrives, that's the signal to give each kind its own id prefix
  // and cancel by prefix instead — the blanket cancel is only tenable while
  // the put-it-back list is short enough to read.
  await rescheduleAllTimerAlarms(tasks);
  await scheduleDailyAgenda(tasks);
}

// ─── Daily agenda ────────────────────────────────────────────────────────────

// Namespaced like the timer alarms, and a fixed id rather than a per-day one:
// scheduling the agenda always replaces the pending one instead of stacking a
// second copy behind it.
const DAILY_AGENDA_ID = 'daily-agenda';

/**
 * Schedules the next morning's summary, replacing any pending one.
 *
 * **Only ever the next one.** A repeating trigger can't carry a body that
 * changes between scheduling and firing, and the count is the whole point of
 * the notification — so this reschedules from live tasks every time reminders
 * are rebuilt, and each firing covers exactly one day. The trade is that an
 * app left unopened past the next agenda stops sending them until it's opened
 * again, which is the right way round: a summary that's silently weeks stale
 * is worse than no summary.
 *
 * Nothing is scheduled for a day with nothing on it (see agendaBody) — a daily
 * notification that fires on empty days is the one people turn off.
 */
export async function scheduleDailyAgenda(tasks: Task[]): Promise<void> {
  await cancelDailyAgenda();

  const { dailyAgendaEnabled, dailyAgendaTime, dayResetTime } = useSettingsStore.getState();
  if (!dailyAgendaEnabled) return;

  const when = nextAgendaTime(new Date(), dailyAgendaTime);
  // Vacation-hidden tasks are filtered here rather than inside agendaCounts,
  // which stays free of store reads so it can be tested directly.
  const body = agendaBody(
    agendaCounts(tasks.filter(t => !isHiddenForVacation(t)), when, dayResetTime)
  );
  if (!body) return;

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_AGENDA_ID,
    content: { title: 'Today', body, data: { dailyAgenda: true }, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });
}

export async function cancelDailyAgenda(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(DAILY_AGENDA_ID).catch(() => {});
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
