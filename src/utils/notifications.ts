import * as Notifications from 'expo-notifications';
import type { PermissionResponse } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { StepTimer, Task } from '../types';
import type { FocusSession } from '../types';
import { isTimedTask, isTimerRunning, timerRemaining } from './timer';
import { formatStepDuration, isStepTimerRunning, stepTimerEndsAt } from './stepTimers';
import {
  currentFocusStep,
  focusStepRemaining,
  isFocusRunning,
  isFocusSessionFinished,
} from './focusPlan';
import { displayTitleFor, isHiddenForVacation } from './visibilityUtils';
import { agendaCounts, agendaBody, nextAgendaTime } from './dailyAgenda';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { nudgeReminderPastMeeting } from './reminderNudge';
import { isAlarmKitAvailable, requestAlarmAuthorization, scheduleNativeAlarm, cancelNativeAlarm } from 'todo-alarmkit-bridge';
import { ALARM_MAX_RINGS, alarmChainIds, alarmChainTimes, stepTimerAlarmUuid, taskAlarmUuid } from './alarmChain';
import { isDemoModeActive } from './demoState';
import { resolveActiveTrip } from './activeTrip';
import type { Shop } from '../types';
import type { EventReminder } from './eventReminders';
import { reminderTriggerDate } from './eventReminders';

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

// The category a task reminder's notification carries, so the system offers
// Complete/Snooze action buttons on it (see useNotificationTapSync, which
// tells the two apart by actionIdentifier). iOS resolves a notification's
// actions from whichever category was registered by the time it's
// *delivered*, not whenever the app next happens to call
// scheduleNotificationAsync — so this has to run at module scope, before the
// first reminder is ever scheduled, rather than lazily inside
// scheduleTaskReminder. It returns a Promise; at module scope there's
// nothing to await it, so the rejection (e.g. on a platform with no such
// API) is swallowed here rather than becoming an unhandled one.
export const TASK_REMINDER_CATEGORY = 'task-reminder';
export const COMPLETE_ACTION_IDENTIFIER = 'complete';
export const SNOOZE_ACTION_IDENTIFIER = 'snooze';
// How far "Snooze" pushes a reminder out. Fixed rather than a setting — this
// is a lightweight notification action, not the reschedule picker
// (snoozeEngine.ts).
export const SNOOZE_MINUTES = 15;

Notifications.setNotificationCategoryAsync(TASK_REMINDER_CATEGORY, [
  {
    identifier: COMPLETE_ACTION_IDENTIFIER,
    buttonTitle: 'Complete',
    // Background action taps don't reliably run JS in Expo managed, so both
    // actions foreground the app — the same trade the widget's
    // CompleteTaskIntent.openAppWhenRun makes.
    options: { opensAppToForeground: true },
  },
  {
    identifier: SNOOZE_ACTION_IDENTIFIER,
    buttonTitle: 'Snooze',
    options: { opensAppToForeground: true },
  },
]).catch(() => {});

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
  // Demo tasks are seeded through this same store action, but a real native
  // notification or AlarmKit alarm is a side effect on the device, not on the
  // scratch database demo mode swaps back out — so it must never fire for a
  // task nobody but the demo will ever see again.
  if (isDemoModeActive()) return;
  if (!task.reminderTime || task.completed || task.archived) return;
  let triggerDate = new Date(task.reminderTime);
  if (triggerDate <= new Date()) return;

  // A meeting first, quiet hours second: nudging past a 9am meeting into a
  // 9:15–9:45 quiet-hours window still needs the second push, and applying
  // them in the other order could land a reminder back inside quiet hours
  // with nothing left to defer it again.
  const { calendarReadEnabled, reminderMeetingNudgeEnabled, quietHoursStart, quietHoursEnd } = useSettingsStore.getState();
  if (calendarReadEnabled && reminderMeetingNudgeEnabled) {
    const { events, loaded } = useCalendarStore.getState();
    if (loaded) triggerDate = nudgeReminderPastMeeting(triggerDate, events).time;
  }

  // Quiet hours defer rather than drop: a reminder still matters at 7am even
  // if the moment the user asked for it was 3am. (Timer alarms below take the
  // opposite call — see scheduleTimerAlarm.)
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
      categoryIdentifier: TASK_REMINDER_CATEGORY,
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

export async function rescheduleAllReminders(
  tasks: Task[],
  // Optional and destructured to plain fields (not a Shop-store read) for the
  // same reason rescheduleTripReminder takes them raw: this file must not
  // import useGroceryStore. Omitted entirely, every existing caller (and
  // every test) still gets the right behavior — no active trip, so the
  // reminder is simply left cancelled.
  trip?: { shopId: string | null; startedAt: string | null; shops: readonly Shop[] },
  // Same reasoning, same shape: raw reminders rather than a useEventReminderStore
  // read, so this file never has to import that store either.
  eventReminders?: readonly EventReminder[]
): Promise<void> {
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
  // there are now three such things: a timer that was running when the app
  // was last closed would otherwise lose its alarm on cold start, the daily
  // agenda would simply stop happening, and a trip left running would lose
  // its two-hour backstop.
  //
  // Four now, and calendar-event reminders are exactly the "own id prefix,
  // cancel by prefix" case the note above called out — each one is cancelled
  // and rescheduled by its own `event-reminder:<key>` id, independent of this
  // blanket cancel.
  await rescheduleAllTimerAlarms(tasks);
  await scheduleDailyAgenda(tasks);
  await rescheduleTripReminder(trip?.shopId ?? null, trip?.startedAt ?? null, trip?.shops ?? []);
  await rescheduleAllEventReminders(eventReminders ?? []);
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
  if (isDemoModeActive()) return;

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
  if (isDemoModeActive()) return;
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
      body: `${displayTitleFor(task) || 'Your task'} is ready to complete`,
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

// ─── Focus session steps ─────────────────────────────────────────────────────

// One id, because there is only ever one session and only ever one step of it
// running: scheduling always replaces whatever was pending rather than
// stacking a second chime behind it. Namespaced away from reminders and timer
// alarms for the reason the timer's own note gives.
const FOCUS_STEP_ALARM_ID = 'focus-step';

/**
 * Chime when the current focus step runs out, so nobody has to sit watching a
 * countdown.
 *
 * Scheduled against what's *left* of the step rather than its full length, so
 * it lands correctly whether the step just started, was resumed part-way, or
 * had time added to it. `session` is nullable and a null cancels: every write
 * in `useFocusStore` funnels through here, including the one that ends the
 * session, so there's no separate path that has to remember to clean up.
 *
 * The chime never advances anything. It says the step is up; the session waits
 * where it is until the user moves it on (see the note in utils/focusPlan.ts).
 */
export async function scheduleFocusStepAlarm(session: FocusSession | null): Promise<void> {
  if (isDemoModeActive()) return;
  await cancelFocusStepAlarm();
  if (session === null || isFocusSessionFinished(session)) return;
  // A paused session has no end time to fire at. Resuming reschedules.
  if (!isFocusRunning(session)) return;

  const step = currentFocusStep(session);
  if (!step) return;
  const remaining = focusStepRemaining(session);
  if (remaining <= 0) return; // already up — the session shows it as ready on sight

  const triggerDate = new Date(Date.now() + remaining * 1000);

  // Suppressed rather than deferred inside quiet hours, exactly as
  // scheduleTimerAlarm is: "your break is over" delivered at 7am, hours after
  // the fact, is noise rather than information.
  const { quietHoursStart, quietHoursEnd } = useSettingsStore.getState();
  if (isWithinQuietHours(triggerDate, quietHoursStart, quietHoursEnd)) return;

  const isRest = step.kind === 'rest';
  await Notifications.scheduleNotificationAsync({
    identifier: FOCUS_STEP_ALARM_ID,
    content: {
      title: isRest ? 'Break’s over' : 'Time’s up',
      body: isRest
        ? 'Back to it when you’re ready.'
        : 'That stretch is done. Take your break when you’re ready.',
      data: { focusSessionId: session.id },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}

export async function cancelFocusStepAlarm(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(FOCUS_STEP_ALARM_ID).catch(() => {});
}

// ─── Cooking step timers ─────────────────────────────────────────────────────

// One id per timer, namespaced away from task reminders and timer alarms for
// the reason the timer's own note above gives. Several step timers run at once
// by design, so unlike the focus step's single fixed id these can't share one.
const stepAlarmNotificationId = (timerId: string): string => `step-timer:${timerId}`;

/**
 * Ring when a cooking step timer runs out.
 *
 * **Two deliberate divergences from every other alarm in this file**, both
 * following from the same fact: this is a countdown the user started seconds
 * ago and then walked away from a hot pan.
 *
 * - **Quiet hours don't apply.** `scheduleTimerAlarm` and
 *   `scheduleFocusStepAlarm` suppress inside the window, and they're right to:
 *   a task timer may have been left running for hours, and "your break is over"
 *   delivered at 7am is noise. A step timer is minutes long and was started on
 *   purpose by someone standing at a stove. Someone cooking at 11pm with quiet
 *   hours from 10 has not asked the app to let dinner burn.
 * - **It rings as a native alarm where AlarmKit can deliver one**, rather than
 *   as a plain notification, so it comes through the silent switch and a focus
 *   mode. That is what a kitchen timer is: the phone is face down on the
 *   counter, or in another room, which is the entire reason a timer was set
 *   rather than the cook just watching the pan. Everywhere AlarmKit isn't
 *   available it falls back to a notification with a sound, the same degrade
 *   `usesAlarmKit` gives a task reminder.
 *
 * Scheduled against what's *left* rather than the full length, so it lands
 * correctly whether the timer just started, was resumed from a pause, or had a
 * minute added to it. Always cancels first, so every one of those is a
 * replacement rather than a second alarm behind the first.
 */
export async function scheduleStepAlarm(timer: StepTimer): Promise<void> {
  // A step timer is started through the same store action inside demo mode,
  // and an alarm is a side effect on the device rather than on the scratch
  // database — it would outlive the demo it belongs to.
  if (isDemoModeActive()) return;
  await cancelStepAlarm(timer.id);
  if (!isStepTimerRunning(timer)) return;

  const triggerDate = stepTimerEndsAt(timer);
  if (!triggerDate || triggerDate.getTime() <= Date.now()) return; // already up — the row says so on sight

  const length = formatStepDuration(timer.durationSeconds);
  const title = timer.recipeName || 'Cooking timer';
  const body = timer.stepLabel
    ? `${timer.stepLabel}: your ${length} timer is up.`
    : `Your ${length} timer is up.`;

  if (isAlarmKitAvailable()) {
    // AlarmKit's alert carries one line, so it has to say both which dish and
    // which step on its own.
    const label = timer.stepLabel ? `${title} · ${timer.stepLabel}` : title;
    await scheduleNativeAlarm(stepTimerAlarmUuid(timer.id), triggerDate, label);
    return;
  }

  await Notifications.scheduleNotificationAsync({
    identifier: stepAlarmNotificationId(timer.id),
    content: {
      title,
      body,
      data: { stepTimerId: timer.id, recipeId: timer.recipeId },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}

/**
 * Cancel a step timer's alarm in both backends without being told which one it
 * used — same uninformed cancel `cancelAlarmChain` makes, and for the same
 * reason: cancelling one that was never scheduled is a no-op, where failing to
 * cancel one leaves a phone ringing about a pan that came off the heat ten
 * minutes ago.
 */
export async function cancelStepAlarm(timerId: string): Promise<void> {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(stepAlarmNotificationId(timerId)).catch(() => {}),
    cancelNativeAlarm(stepTimerAlarmUuid(timerId)).catch(() => {}),
  ]);
}

export async function rescheduleAllTimerAlarms(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    if (isTimedTask(task) && isTimerRunning(task) && !task.completed && !task.archived) {
      await scheduleTimerAlarm(task);
    }
  }
}

// ─── Active-trip reminder ────────────────────────────────────────────────────

// A fixed id, like the daily agenda: there's only ever one trip, so
// scheduling always replaces whatever was pending rather than stacking a
// second copy behind it.
const TRIP_REMINDER_ID = 'active-trip-reminder';

// Long enough that an ordinary shop is unambiguously over, well short of
// TRIP_MAX_MS (activeTrip.ts) ending the trip outright — a nudge with time
// left to act on, not a postmortem on one that already auto-expired.
const TRIP_REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;

/**
 * The backstop for someone who's left the store (or just left the app) and
 * forgotten to finish shopping — a single notification two hours after a
 * trip starts, for whenever the persistent trip bar isn't enough because the
 * app isn't open to show it. Opt-in (`tripReminderEnabled`), same reasoning
 * as the daily agenda: a notification nobody asked for is how people turn
 * notifications off wholesale.
 */
export async function scheduleTripReminder(shopName: string, startedAt: string): Promise<void> {
  await cancelTripReminder();
  if (isDemoModeActive()) return;
  if (!useSettingsStore.getState().tripReminderEnabled) return;

  const triggerDate = new Date(Date.parse(startedAt) + TRIP_REMINDER_DELAY_MS);
  if (triggerDate <= new Date()) return;

  // Suppressed rather than deferred, like the timer alarm: "still shopping?"
  // is stale by the time a quiet-hours window ends, and a nudge that arrives
  // hours after the question stopped applying is worse than none.
  const { quietHoursStart, quietHoursEnd } = useSettingsStore.getState();
  if (isWithinQuietHours(triggerDate, quietHoursStart, quietHoursEnd)) return;

  await Notifications.scheduleNotificationAsync({
    identifier: TRIP_REMINDER_ID,
    content: {
      title: 'Still shopping?',
      body: `Tap to wrap up your trip at ${shopName}`,
      data: { activeTripReminder: true },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}

export async function cancelTripReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(TRIP_REMINDER_ID).catch(() => {});
}

/**
 * Puts the trip reminder back after a blanket cancel — the same job
 * `rescheduleAllTimerAlarms` does for timer alarms, and folded into
 * `rescheduleAllReminders` below for the same reason. Takes the trip's raw
 * fields rather than reading `useGroceryStore` directly, so this file never
 * has to import the grocery store — `rescheduleAllReminders`'s one caller
 * already has both stores in hand.
 */
export async function rescheduleTripReminder(
  shopId: string | null,
  startedAt: string | null,
  shops: readonly Shop[]
): Promise<void> {
  const shop = resolveActiveTrip(shopId, startedAt, shops, new Date());
  if (!shop || !startedAt) {
    await cancelTripReminder();
    return;
  }
  await scheduleTripReminder(shop.name, startedAt);
}

// ─── Calendar-event reminders ────────────────────────────────────────────────

// Namespaced rather than a bare `reminder.key`: a BusyEvent id is just an
// EventKit string with no relation to this app's own id space, so nothing
// stops one from coinciding with a task id or another reminder's key.
function eventReminderNotificationId(key: string): string {
  return `event-reminder:${key}`;
}

/**
 * Schedules (or replaces) the one notification for a calendar-event reminder
 * (`useEventReminderStore`). Cancel-then-reschedule, like every other
 * reminder in this file — there is no check-if-already-scheduled path.
 */
export async function scheduleEventReminder(reminder: EventReminder): Promise<void> {
  // Same reasoning as scheduleTaskReminder: a real notification is a device
  // side effect, and must never fire for an event a demo session rendered.
  if (isDemoModeActive()) return;
  const id = eventReminderNotificationId(reminder.key);
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});

  const triggerDate = reminderTriggerDate(reminder);
  if (triggerDate <= new Date()) return;

  // Suppressed rather than deferred, like the timer and trip alarms: "starts
  // in 15 minutes" shown after the event has already started is actively
  // wrong, not just late, and a same-day meeting reminder landing inside
  // quiet hours is the common case this guards.
  const { quietHoursStart, quietHoursEnd } = useSettingsStore.getState();
  if (isWithinQuietHours(triggerDate, quietHoursStart, quietHoursEnd)) return;

  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: reminder.eventTitle,
      body: reminder.offsetMinutes === 0
        ? 'Starting now'
        : `Starts in ${reminder.offsetMinutes < 60 ? `${reminder.offsetMinutes} min` : `${reminder.offsetMinutes / 60} hr`}`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}

export async function cancelEventReminder(key: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(eventReminderNotificationId(key)).catch(() => {});
}

/**
 * Puts every pending event reminder back after a blanket cancel — the same
 * job `rescheduleAllTimerAlarms`/`rescheduleTripReminder` do, folded into
 * `rescheduleAllReminders` above. The caller (`useEventReminderStore.initialize`)
 * is expected to have already pruned reminders for events that have started.
 */
export async function rescheduleAllEventReminders(reminders: readonly EventReminder[]): Promise<void> {
  for (const reminder of reminders) {
    await scheduleEventReminder(reminder);
  }
}
