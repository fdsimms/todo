import * as Notifications from 'expo-notifications';
import type { PermissionResponse } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { Task } from '../types';
import { isTimedTask, isTimerRunning, timerRemaining } from './timer';
import { displayTitleFor, isHiddenForVacation } from './visibilityUtils';
import { agendaCounts, agendaBody, nextAgendaTime } from './dailyAgenda';
import { useSettingsStore } from '../store/useSettingsStore';
import { isAlarmKitAvailable, requestAlarmAuthorization, scheduleNativeAlarm, cancelNativeAlarm } from 'todo-alarmkit-bridge';
import { ALARM_MAX_RINGS, alarmChainIds, alarmChainTimes, taskAlarmUuid } from './alarmChain';

export { isAlarmKitAvailable, requestAlarmAuthorization };

// A reminder rings as a native AlarmKit alarm only when the task asked for it
// AND the platform can actually deliver one — everywhere else (older iOS,
// Android, web, Expo Go) it silently falls back to a plain notification
// rather than dropping the reminder.
function usesAlarmKit(task: Task): boolean {
  return (task.reminderKind === 'alarm' || task.reminderKind === 'persistent') && isAlarmKitAvailable();
}

/**
 * How many times this task's reminder rings.
 *
 * A 'persistent' reminder that has fallen back to a plain notification rings
 * once, like every other notification: the fallback is a *notification*, and
 * twelve of them five minutes apart is a push-notification storm, not a
 * quieter version of an alarm. The loudness of this kind comes from AlarmKit's
 * alert, and where that isn't available the honest degrade is one reminder.
 */
function ringCountFor(task: Task): number {
  return task.reminderKind === 'persistent' && usesAlarmKit(task) ? ALARM_MAX_RINGS : 1;
}

// ─── Quiet hours ─────────────────────────────────────────────────────────────
//
// "Don't buzz me between X and Y" (useSettingsStore's quietHoursStart/End,
// both null = off). Pure clock-time comparison against a trigger Date's local
// hours/minutes — deliberately no dayResetTime/logical-day anchoring the way
// visibilityUtils' window gates use, because this isn't about which day a task
// belongs to, it's "what time does my phone read right now."

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * True when `date`'s wall-clock time falls inside the quiet-hours window.
 * Handles an overnight window (start > end, e.g. "22:00"–"07:00") by treating
 * "inside" as either side of midnight, same shape as effectiveWindowEnd's
 * overnight handling in visibilityUtils.ts. An equal start/end (zero-length
 * window) is treated as off rather than "always quiet."
 */
export function isWithinQuietHours(
  date: Date, quietHoursStart: string | null, quietHoursEnd: string | null
): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;
  const startMin = hhmmToMinutes(quietHoursStart);
  const endMin = hhmmToMinutes(quietHoursEnd);
  if (startMin === endMin) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return startMin < endMin
    ? minutes >= startMin && minutes < endMin
    : minutes >= startMin || minutes < endMin;
}

/**
 * Pushes a trigger date that lands inside quiet hours out to the window's
 * close. For an overnight window the close is on the *same* calendar day when
 * the trigger fell on the early-morning side (e.g. 3am inside 22:00–07:00
 * closes at that day's 7am) and on the *next* day when it fell on the
 * before-midnight side (e.g. 23:00 inside 22:00–07:00 closes at tomorrow's
 * 7am) — mirroring the wrap-around a window spanning midnight actually means.
 * A date outside the window (or quiet hours off) passes through unchanged.
 */
export function deferPastQuietHours(
  date: Date, quietHoursStart: string | null, quietHoursEnd: string | null
): Date {
  if (!isWithinQuietHours(date, quietHoursStart, quietHoursEnd)) return date;
  const startMin = hhmmToMinutes(quietHoursStart!);
  const endMin = hhmmToMinutes(quietHoursEnd!);
  const [endH, endM] = quietHoursEnd!.split(':').map(Number);
  const result = new Date(date);
  result.setHours(endH, endM, 0, 0);
  if (startMin > endMin) {
    // Overnight window — only the before-midnight side needs the day bumped;
    // the early-morning side's close is already later today.
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (minutes >= startMin) result.setDate(result.getDate() + 1);
  }
  return result;
}

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
  let triggerDate = new Date(task.reminderTime);
  if (triggerDate <= new Date()) return;

  // Quiet hours defer rather than drop: a reminder still matters at 7am even
  // if the moment the user asked for it was 3am. (Timer alarms below take the
  // opposite call — see scheduleTimerAlarm.)
  const { quietHoursStart, quietHoursEnd } = useSettingsStore.getState();
  triggerDate = deferPastQuietHours(triggerDate, quietHoursStart, quietHoursEnd);

  if (usesAlarmKit(task)) {
    // Belt-and-suspenders: a reminder that switched from 'alarm' to
    // 'notification' (or vice versa) must never leave a stale entry behind
    // in the backend it no longer uses.
    await Notifications.cancelScheduledNotificationAsync(task.id).catch(() => {});
    // Clear the previous chain before laying down the new one. Shortening a
    // persistent reminder to a plain alarm otherwise leaves rings 1..11 of the
    // old chain scheduled, and they'd ring against a task with nothing left
    // pointing at them — an alarm no cancel path can name is the one failure
    // this feature genuinely cannot ship with.
    await cancelAlarmChain(task.id);

    const title = displayTitleFor(task) || 'Task reminder';
    const { quietHoursStart: qStart, quietHoursEnd: qEnd } = useSettingsStore.getState();
    const times = alarmChainTimes(triggerDate, ringCountFor(task));

    for (let i = 0; i < times.length; i++) {
      // Repeats that run into quiet hours are dropped, not deferred — the
      // opposite call to the first ring above, and the same one
      // scheduleTimerAlarm makes. Deferring them would stack the remainder of
      // the chain onto the window's close, so a 3am chain silenced at 3am
      // would fire its leftover rings back to back at 7am.
      if (isWithinQuietHours(times[i], qStart, qEnd)) break;
      await scheduleNativeAlarm(taskAlarmUuid(task.id, i), times[i], title);
    }
    return;
  }

  await cancelAlarmChain(task.id);
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

/**
 * Cancel every alarm a task could be holding.
 *
 * Deliberately uninformed: it names all `ALARM_MAX_RINGS` ids without knowing
 * (or being able to know) which kind the reminder was, because the caller
 * usually only has an id — and because the two ways of being wrong are not
 * symmetric. Cancelling an alarm that was never scheduled is a no-op AlarmKit
 * already swallows; *failing* to cancel one leaves a task ringing every five
 * minutes with the task it belonged to already gone. The calls go out together
 * rather than in sequence, and on every platform without AlarmKit the bridge
 * short-circuits before touching native at all, so the loop costs nothing off
 * an iOS 26 device.
 */
async function cancelAlarmChain(taskId: string): Promise<void> {
  await Promise.all(
    alarmChainIds(taskId, ALARM_MAX_RINGS).map(id => cancelNativeAlarm(id).catch(() => {}))
  );
}

export async function cancelTaskReminder(taskId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(taskId).catch(() => {});
  await cancelAlarmChain(taskId);
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
  // AlarmKit alarms don't compete for the 64-notification OS cap — they're a
  // separate subsystem from UNUserNotificationCenter — so they're excluded
  // from the count Settings shows against that cap.
  const wanted = upcomingReminders(tasks, now).filter(t => !usesAlarmKit(t)).length;
  const scheduled = Math.min(wanted, MAX_PENDING_REMINDERS);
  return { wanted, scheduled, dropped: wanted - scheduled };
}

export async function rescheduleAllReminders(tasks: Task[]): Promise<void> {
  const now = new Date();
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});

  const upcoming = upcomingReminders(tasks, now);

  // AlarmKit alarms are untouched by cancelAllScheduledNotificationsAsync
  // above (it only reaches UNUserNotificationCenter) and have no equivalent
  // pending-request cap, so every one of them reschedules from the full,
  // uncapped list rather than sharing the 64-slot budget below.
  for (const task of upcoming) {
    if (usesAlarmKit(task)) await scheduleTaskReminder(task);
  }

  for (const task of upcoming.filter(t => !usesAlarmKit(t)).slice(0, MAX_PENDING_REMINDERS)) {
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

  const triggerDate = new Date(Date.now() + remaining * 1000);

  // Quiet hours suppress rather than defer here, unlike scheduleTaskReminder:
  // a finished timer's "ready to complete" is stale by the time the window
  // ends, and a stack of them all landing at 7am is worse than none.
  const { quietHoursStart, quietHoursEnd } = useSettingsStore.getState();
  if (isWithinQuietHours(triggerDate, quietHoursStart, quietHoursEnd)) return;

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
      date: triggerDate,
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
