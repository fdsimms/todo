import { addDays } from 'date-fns/addDays';
import { addWeeks } from 'date-fns/addWeeks';
import { addMonths } from 'date-fns/addMonths';
import { addYears } from 'date-fns/addYears';
import { subDays } from 'date-fns/subDays';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { isSameWeek } from 'date-fns/isSameWeek';
import { startOfDay } from 'date-fns/startOfDay';
import { startOfMonth } from 'date-fns/startOfMonth';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { differenceInCalendarMonths } from 'date-fns/differenceInCalendarMonths';
import { differenceInCalendarYears } from 'date-fns/differenceInCalendarYears';
import { setDate } from 'date-fns/setDate';
import { lastDayOfMonth } from 'date-fns/lastDayOfMonth';
import type { Task } from '../types';
import { hhmmToDate, formatHHMM as formatClockTime, clockTimeToken, logicalDayStart, taskDayStart } from './clockTime';
import { useSettingsStore, type WeekStart } from '../store/useSettingsStore';

/**
 * Returns the start of the logical "day" for a given datetime.
 * If dayResetTime is "02:00" and it's 1:30 AM, we're still in the previous logical day.
 */
export function getDayStart(date: Date = new Date(), dayResetTime?: string): Date {
  // The math itself lives in the store-free clockTime module, so the modules
  // that can't reach the store share this one rather than forking it; all this
  // wrapper adds is the setting.
  return logicalDayStart(date, dayResetTime ?? useSettingsStore.getState().dayResetTime);
}

export function getCurrentDayStart(): Date {
  return getDayStart(new Date());
}

/**
 * The logical day (as a `YYYY-MM-DD` key) a real timestamp belongs to —
 * e.g. a task completed at 1am with a 4am dayResetTime keys under
 * yesterday's date, matching every other day-boundary computation in the
 * app. Unlike `getTaskDayStart`, this is for an actual moment (a
 * `completedAt`), not a stored anchor like `dueDate` — `getDayStart`'s
 * early-morning rollback is exactly what a real timestamp wants.
 */
export function getLogicalDayKey(date: Date, dayResetTime?: string): string {
  return dayKeyOf(getDayStart(date, dayResetTime));
}

/**
 * A date's calendar day as a `YYYY-MM-DD` string, in local time.
 *
 * Two jobs, which is why it's here rather than local to a component. It's the
 * identity of a day for comparison — CalendarPicker and WhenPicker each held
 * their own copy of this, and the three calendars have already had to be
 * de-duplicated once (that's what weekdayHeaders exists for). And it's the
 * *stored* form of a meal plan entry's date: a slot is a calendar day rather
 * than a moment, so it deliberately carries no time and no dayResetTime.
 *
 * Zero-padded, so the keys sort lexically — which is what lets a range read be
 * a plain `date >= ? AND date <= ?`.
 */
export function dayKeyOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * The inverse of dayKeyOf: a stored `YYYY-MM-DD` key back into a local-midnight
 * Date, for the handful of callers that need to format it (a weekday name, a
 * calendar-day comparison). `new Date('2026-08-09')` parses as UTC midnight and
 * reads as the previous day in any zone behind UTC — appending the local-time
 * marker is what keeps it a *local* midnight instead.
 */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

/**
 * The logical-day-start instant for a *stored* date like a task's dueDate or
 * deferUntil — the calendar day the value represents, at the dayResetTime
 * clock time. Unlike getDayStart(), this never rolls the result back a day:
 * getDayStart()'s rollback exists to handle "now" landing in the early-morning
 * grace window before today's reset has happened yet. A stored date's own
 * clock-time carries no such meaning — it's whatever anchor hour the picker
 * used (noon, midnight, the reset hour at generation time) — so treating an
 * early clock-time as "still the previous logical day" would silently pull a
 * task scheduled for tomorrow into today whenever that anchor happens to
 * precede the current dayResetTime.
 */
export function getTaskDayStart(date: Date, dayResetTime?: string): Date {
  // The math itself lives in the store-free clockTime module, same as
  // getDayStart's does, so postpone.ts can share it rather than fork it.
  return taskDayStart(date, dayResetTime ?? useSettingsStore.getState().dayResetTime);
}

// The "HH:MM" clock helpers live in the store-free clockTime module; re-exported
// here because most callers reach for them alongside the rest of the date math.
export { hhmmToDate, dateToHHMM } from './clockTime';

/**
 * Formats an "HH:MM" clock time, honouring the 12/24-hour setting.
 *
 * Wraps the store-free version in clockTime the same way getDayStart wraps
 * dayResetTime: the preference is an optional argument, and falls back to the
 * store when the caller doesn't care. This is the one the app imports —
 * clockTime's is for modules that must not touch the store.
 */
export function formatHHMM(hhmm: string, use24Hour?: boolean): string {
  return formatClockTime(hhmm, use24Hour ?? useSettingsStore.getState().use24HourTime);
}

/**
 * Formats a Date's clock time, honouring the 12/24-hour setting — the Date
 * counterpart to formatHHMM, for reminders and Logbook timestamps.
 */
export function formatTimeOfDay(date: Date, use24Hour?: boolean): string {
  return format(date, clockTimeToken(use24Hour ?? useSettingsStore.getState().use24HourTime));
}

/**
 * The configured first day of the week, for date-fns' `weekStartsOn`.
 *
 * Everything that slices a week has to agree on this or the same completion
 * lands in different weeks on different screens — which is exactly what used
 * to happen, with the calendar grid on Sunday and Stats' "this week" on
 * Monday. One reader, so there's one answer.
 */
export function getWeekStart(): WeekStart {
  return useSettingsStore.getState().weekStartsOn;
}

/**
 * The calendar date of the current logical day — i.e. the date a task needs
 * to fall on to be visible right now. Normally today's date, but in the
 * early-morning window before dayResetTime it's still yesterday's date.
 */
export function getLogicalToday(dayResetTime?: string): Date {
  return startOfDay(getDayStart(new Date(), dayResetTime));
}

export function getLogicalTomorrow(dayResetTime?: string): Date {
  return addDays(getLogicalToday(dayResetTime), 1);
}

/**
 * True during the early-morning window (after midnight, before
 * dayResetTime) — when "today" by the wall clock is still part of
 * yesterday's logical day, so "Today"/"Tomorrow" need clarifying with
 * actual dates.
 */
/**
 * The current instant, pinned to the logical day's calendar date — for
 * feeding into parseNaturalDate/parseTaskInput so "tomorrow" typed in the
 * early-morning window before dayResetTime resolves relative to the logical
 * day (still "yesterday") rather than the wall-clock calendar day. Preserves
 * the actual clock time so relative durations ("in 30 min") stay accurate.
 */
export function getLogicalNow(dayResetTime?: string): Date {
  const now = new Date();
  return isBeforeDayReset(dayResetTime) ? subDays(now, 1) : now;
}

export function isBeforeDayReset(dayResetTime?: string): boolean {
  return getLogicalToday(dayResetTime).getTime() !== startOfDay(new Date()).getTime();
}

/**
 * The date a task's row should *read* as, which isn't always its dueDate. A
 * task pushed to a later day keeps its dueDate and gains a later deferUntil
 * (see deferTask/deferGroup — deferring deliberately leaves dueDate alone so a
 * recurring task's schedule grid doesn't rotate). It surfaces on the deferred
 * day, so showing the dueDate would date a move the user *chose* to two days
 * ago. Falls back to whichever of the two is set.
 */
export function getEffectiveTaskDate(
  task: Pick<Task, 'dueDate' | 'deferUntil'>,
  dayResetTime?: string,
): string | null {
  if (task.deferUntil && task.dueDate) {
    const deferStart = getTaskDayStart(new Date(task.deferUntil), dayResetTime);
    const dueStart = getTaskDayStart(new Date(task.dueDate), dayResetTime);
    return deferStart > dueStart ? task.deferUntil : task.dueDate;
  }
  return task.deferUntil ?? task.dueDate;
}

/** formatScheduledDate applied to getEffectiveTaskDate — the label for a task's own date. */
export function formatTaskDate(
  task: Pick<Task, 'dueDate' | 'deferUntil'>,
  dayResetTime?: string,
): string | null {
  const iso = getEffectiveTaskDate(task, dayResetTime);
  return iso ? formatScheduledDate(iso, dayResetTime) : null;
}

/**
 * A date that decides *when a task shows up* — `dueDate`/`deferUntil`, and the
 * other dates of a series. Nothing here can be missed: the day arrives, the
 * task becomes available, and it stays available until it's done. So a past
 * one reads as elapsed ("2d ago"), never as late.
 *
 * **"Overdue" belongs to `Task.deadline` and nothing else** — that's the
 * separate, optional field for a date there's an actual cost to blowing past,
 * and it has its own formatter (formatDeadlineDate) and its own flag badge on
 * the row. Labelling a do-date "2d overdue" tells someone they're behind on a
 * task that was only ever scheduled, and hands the word to the field where it
 * means nothing, leaving the field where it means something with no way to
 * sound more serious.
 *
 * It keeps the day count on purpose: "sitting here two days" is exactly what a
 * task row is trying to say.
 */
export function formatScheduledDate(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, today);
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (isSameWeek(d, today, { weekStartsOn: getWeekStart() })) return format(d, 'EEEE');
  return format(d, d.getFullYear() === today.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * A date that can actually be missed — `Task.deadline` and `Project.deadline`,
 * which is why they share a name. This is the only formatter that says
 * "overdue", and it is never correct on a `dueDate`; use formatScheduledDate
 * there.
 */
export function formatDeadlineDate(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, today);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (isSameWeek(d, today, { weekStartsOn: getWeekStart() })) return format(d, 'EEEE');
  return format(d, d.getFullYear() === today.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * Formats a Later-list section header.
 *
 * Dates within the next week (today + 6 days) get their own header, with the
 * date alongside the relative label so headers remain unambiguous. Dates
 * further out are batched together by month (with a year suffix when it
 * differs from the current year) so the list doesn't grow one header per day.
 */
export function formatGroupHeader(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  const diff = differenceInCalendarDays(d, today);
  if (diff < 7) {
    if (isSameDay(d, today)) return `Today · ${format(d, 'MMM d')}`;
    if (isSameDay(d, addDays(today, 1))) return `Tomorrow · ${format(d, 'MMM d')}`;
    return format(d, 'EEEE · MMM d');
  }
  return d.getFullYear() === today.getFullYear() ? format(d, 'MMMM') : format(d, 'MMMM yyyy');
}

/**
 * The day-of-month a monthly or yearly rule's grid should be anchored to, read
 * off the task's own due date.
 *
 * Only for the rules that have no other anchor: an explicit `recurrenceMonthDay`
 * ("on the 5th") or `recurrenceWeekOrdinal` ("the 2nd Tuesday") already says
 * where the grid sits, and `recurrenceFromCompletion` measures from the day you
 * finish rather than from a date at all. What's left is the picker's "same day
 * as the due date" anchor, which is the one that used to be destroyed by its
 * own clamp.
 *
 * Callers capture this whenever the user *writes* the schedule, and never when
 * the app moves the row on its own — that split is the whole mechanism, so a
 * successor spawned onto February keeps the 31st it was anchored to. Saving the
 * editor on a clamped occurrence does re-derive it, which is correct: that's the
 * date the user was shown and kept.
 */
export function recurrenceAnchorDayFor(
  task: Pick<
    Task,
    'recurrenceType' | 'recurrenceMonthDay' | 'recurrenceWeekOrdinal' | 'recurrenceFromCompletion' | 'dueDate'
  > & Partial<Pick<Task, 'recurrenceAnchorDate'>>,
): number | null {
  if (task.recurrenceType !== 'monthly' && task.recurrenceType !== 'yearly') return null;
  if (task.recurrenceMonthDay !== null || task.recurrenceWeekOrdinal !== null) return null;
  if (task.recurrenceFromCompletion) return null;
  // The grid's day, not the row's, for the same reason getNextDueDate steps
  // from it: a monthly task pulled forward from the 31st to the 28th once must
  // still come back on the 31st, and reading the moved date here would hand the
  // drift straight back through the very field that exists to prevent it.
  const anchorIso = task.recurrenceAnchorDate ?? task.dueDate;
  return anchorIso ? new Date(anchorIso).getDate() : null;
}

/**
 * A ceiling on the catch-up walk in getNextDueDate. A daily task left alone
 * for a year needs ~365 steps to reach today, which is nothing; this is the
 * backstop for a rule that somehow advances by less than it should, so the
 * completion returns a stale date rather than hanging on it.
 */
const MAX_CATCH_UP_STEPS = 500;

/**
 * The next date this task's rule produces after the occurrence it's holding.
 *
 * `catchUp` is for the callers that are *placing a real row* — completeTask's
 * successor and skipNextRecurrence — and it walks the grid forward until the
 * answer is today or later. Without it, finishing a weekly task five weeks
 * late spawns a successor dated four weeks ago: the schedule steps one
 * interval from the occurrence it was handed, and that occurrence is already
 * in the past. The row arrives overdue, and you have to complete it five more
 * times (five more tombstones) to work back to the present. `rolloverQuotas`
 * already made this call for quota tasks in its own way, for the same reason
 * ("its answer for *when* would still be in the past if the app sat closed for
 * a week"); this is that rule, for every recurring task, on the grid rather
 * than pinned to today, so a fixed schedule still lands on one of its own
 * dates.
 *
 * It is deliberately off by default. `projectOccurrences` walks this function
 * one occurrence at a time to draw a month, and a walk that skipped to today
 * on its first step would drop every earlier cell in the month on the floor;
 * `recurrenceHorizonDays` floors its own answer at tomorrow already.
 *
 * The count is not decremented per skipped occurrence — completeTask takes one
 * off for the completion that happened, and "repeat 10 times" means ten times
 * the user actually did it, not ten weeks on the calendar. `recurrenceEndDate`
 * is the opposite and is checked on the caught-up answer: a series whose end
 * has passed while the app was shut is over, not owed a final occurrence.
 */
export function getNextDueDate(
  task: Task,
  dayResetTime?: string,
  options?: { catchUp?: boolean },
): Date | null {
  // Fixed schedule: anchor to the previous due date so the recurrence grid doesn't drift.
  // After completion: anchor to today (the completion day) so it's always relative to when you finished.
  //
  // `recurrenceAnchorDate` first, and it is null on almost every task. It holds
  // the grid's own day for the one case `dueDate` can't (#1953): an occurrence
  // *pulled forward* has to move its real date, because there is no "un-hide"
  // to pair with `deferUntil`'s hide, and without a separate anchor a Friday
  // task done once on Wednesday became a Wednesday task for ever. Irrelevant
  // under `recurrenceFromCompletion`, which measures from the day you finished
  // and has no grid to be knocked off.
  const anchorIso = task.recurrenceAnchorDate ?? task.dueDate;
  const base =
    !task.recurrenceFromCompletion && anchorIso
      ? getTaskDayStart(new Date(anchorIso), dayResetTime)
      : getDayStart(new Date(), dayResetTime);

  const step = (from: Date): Date => {
    switch (task.recurrenceType) {
      case 'daily':
        return addDays(from, task.recurrenceInterval);
      case 'weekly':
        return task.recurrenceDays.length > 0
          ? getNextWeekdayOccurrence(task.recurrenceDays, from, task.recurrenceInterval)
          : addWeeks(from, task.recurrenceInterval);
      case 'monthly':
        return task.recurrenceWeekOrdinal !== null && task.recurrenceDays.length > 0
          ? getNextWeekdayOfMonthOccurrence(task.recurrenceDays[0], task.recurrenceWeekOrdinal, from, task.recurrenceInterval)
          // recurrenceMonthDay is the user's explicit "on the 5th"; the anchor
          // behind it is the picker's "same day as the due date", which means
          // the same thing to this function and differs only in where the day
          // number came from. Falling back to `from`'s own date keeps a row
          // that predates the anchor column behaving exactly as it did.
          : getNextMonthDayOccurrence(
              task.recurrenceMonthDay ?? task.recurrenceAnchorDay ?? from.getDate(),
              from,
              task.recurrenceInterval,
            );
      case 'yearly':
        return getNextYearDayOccurrence(
          task.recurrenceMonthDay ?? task.recurrenceAnchorDay,
          from,
          task.recurrenceInterval,
        );
      default:
        return addDays(from, 1);
    }
  };

  let next = step(base);
  if (options?.catchUp) {
    const todayStart = getDayStart(new Date(), dayResetTime);
    for (let i = 0; i < MAX_CATCH_UP_STEPS; i++) {
      if (getTaskDayStart(next, dayResetTime) >= todayStart) break;
      const after = step(next);
      // A rule that doesn't advance is a rule that loops — same backstop
      // projectOccurrences keeps, and the same choice: a stale answer beats a
      // hang.
      if (after <= next) break;
      next = after;
    }
  }

  if (task.recurrenceEndDate && next > new Date(task.recurrenceEndDate)) {
    return null;
  }
  if (task.recurrenceCount !== null && task.recurrenceCount <= 1) {
    return null;
  }
  return next;
}

/**
 * The next selected weekday after `from`, `interval` weeks on once the week
 * runs out.
 *
 * Positions are measured from the user's own week start rather than from
 * Sunday. Only `interval > 1` can tell the difference — that's where "the next
 * week block" has to be a specific seven days — but with a Monday start and a
 * set spanning the weekend, a Sunday-anchored block splits the pair the user
 * picked across two blocks and spaces them 9 and 5 days apart instead of 2 and
 * 12. With weekStartsOn 0 every line below reduces to what it was.
 */
function getNextWeekdayOccurrence(days: number[], from: Date, interval: number): Date {
  const weekStartsOn = getWeekStart() ?? 0;
  const position = (day: number) => (day - weekStartsOn + 7) % 7;
  const here = position(from.getDay());
  const sorted = [...days].sort((a, b) => position(a) - position(b));
  for (const day of sorted) {
    if (position(day) > here) return addDays(from, position(day) - here);
  }
  return addDays(from, 7 - here + position(sorted[0]) + (interval - 1) * 7);
}

/**
 * The Nth weekday-of-month occurrence within the month containing `monthDate`,
 * e.g. "the 2nd Tuesday" (ordinal=2) or "the last Friday" (ordinal=-1).
 * Ordinals 1-4 are always within the month (every month has at least 28 days).
 */
export function nthWeekdayOfMonth(monthDate: Date, weekday: number, ordinal: number): Date {
  if (ordinal === -1) {
    const last = lastDayOfMonth(monthDate);
    return subDays(last, (last.getDay() - weekday + 7) % 7);
  }
  const first = startOfMonth(monthDate);
  const offset = (weekday - first.getDay() + 7) % 7;
  return addDays(first, offset + (ordinal - 1) * 7);
}

function getNextWeekdayOfMonthOccurrence(weekday: number, ordinal: number, from: Date, interval: number): Date {
  const thisMonth = nthWeekdayOfMonth(from, weekday, ordinal);
  if (interval === 1 && thisMonth > from) return thisMonth;
  return nthWeekdayOfMonth(addMonths(from, interval), weekday, ordinal);
}

/**
 * Next occurrence of a fixed day-of-month (e.g. "the 5th"), clamped to the
 * last day of short months. `day === -1` means "the last day of the month",
 * whatever that is for each occurrence (28-31).
 */
function getNextMonthDayOccurrence(day: number, from: Date, interval: number): Date {
  const clampToMonth = (d: Date) =>
    day === -1 ? lastDayOfMonth(d) : setDate(d, Math.min(day, lastDayOfMonth(d).getDate()));
  const thisMonth = clampToMonth(from);
  if (interval === 1 && thisMonth > from) return thisMonth;
  return clampToMonth(addMonths(from, interval));
}

/**
 * Next occurrence of a yearly rule, restoring the day-of-month the grid is
 * anchored to. The month never drifts (addYears keeps it), so only the day
 * needs putting back: "every year on Feb 29" would otherwise clamp to the 28th
 * in the first non-leap year and stay there through every leap year after,
 * which is the same one-way clamp getNextMonthDayOccurrence exists to avoid a
 * month at a time. `null` means no anchor was ever captured (a row older than
 * the column), which is exactly the old behaviour.
 */
function getNextYearDayOccurrence(day: number | null, from: Date, interval: number): Date {
  const next = addYears(from, interval);
  if (day === null) return next;
  return day === -1 ? lastDayOfMonth(next) : setDate(next, Math.min(day, lastDayOfMonth(next).getDate()));
}

/**
 * The day-of-month anchors implied by a hand-picked set of dates — what a
 * series repeats on once Repeat monthly is turned on (see Task.seriesMonthDays).
 * Deduped and sorted, so picking the 10th of one month and the 15th of the
 * next still describes one monthly pair rather than a two-month span.
 */
export function seriesMonthDaysFrom(dates: Date[]): number[] {
  return Array.from(new Set(dates.map(d => d.getDate()))).sort((a, b) => a - b);
}

/**
 * The next set of dates for a repeating series. Anchored to the month of the
 * finished set's last date plus `repeatMonths`, then rebuilt from the stored
 * day numbers rather than by shifting the current dates — so an anchor on the
 * 31st that had to clamp to the 28th for February comes back as the 31st in
 * March instead of staying on the 28th for good. `-1` means the last day of
 * the month, the same convention as recurrenceMonthDay.
 *
 * Two anchors can land on the same day in a short month (the 30th and the
 * 31st both clamp to February 28th), so the result is deduped after clamping
 * rather than before — otherwise that month would get two identical rows.
 * Time of day carries over from the set that just finished, keeping reminders
 * on the same hour.
 */
export function getNextSeriesDates(
  currentDueDates: Date[],
  monthDays: number[],
  repeatMonths: number
): Date[] {
  if (currentDueDates.length === 0 || monthDays.length === 0) return [];

  const latest = currentDueDates.reduce((max, d) => (d > max ? d : max));
  const earliest = currentDueDates.reduce((min, d) => (d < min ? d : min));
  const targetMonth = addMonths(startOfMonth(latest), Math.max(1, repeatMonths));
  const lastDay = lastDayOfMonth(targetMonth).getDate();

  const byTime = new Map<number, Date>();
  for (const day of monthDays) {
    const date = setDate(targetMonth, day === -1 ? lastDay : Math.min(Math.max(1, day), lastDay));
    date.setHours(earliest.getHours(), earliest.getMinutes(), 0, 0);
    byTime.set(+date, date);
  }
  return Array.from(byTime.values()).sort((a, b) => +a - +b);
}

/** Formats time remaining until an "HH:MM" window end, e.g. "2h 15m left" or "15m left". */
export function formatWindowRemaining(windowEnd: string): string {
  const minutesLeft = Math.max(0, Math.round((hhmmToDate(windowEnd).getTime() - Date.now()) / 60000));
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m left`;
  if (hours > 0) return `${hours}h left`;
  return `${minutes}m left`;
}

/**
 * Days remaining until a task's deadline, using the logical (reset-time-aware)
 * day boundary. Negative once the deadline has passed.
 */
export function getDeadlineCountdown(deadline: string, dayResetTime?: string): number {
  const today = getDayStart(new Date(), dayResetTime);
  const target = getDayStart(new Date(deadline), dayResetTime);
  return differenceInCalendarDays(target, today);
}

/**
 * Deadline expressed as a day count either side of a due date, e.g. the
 * Wednesday before a Thursday recurrence. Positive counts back from the due
 * date, negative counts forward from it — a deadline *after* the due date is
 * an ordinary case ("filed on the 1st, has to clear by the 10th"), not an
 * inverted one, since a deadline is only a target and never gates visibility.
 */
export function getDeadlineFromOffset(dueDate: Date, offsetDays: number): Date {
  return subDays(dueDate, offsetDays);
}

/**
 * The user-facing wording for a relative deadline offset, owned here so the
 * editor's row summary and its stepper label can't drift on the direction —
 * the sign is the whole meaning of the field and reads backwards if either
 * one hardcodes "before".
 */
export function describeDeadlineOffset(offsetDays: number): string {
  if (offsetDays === 0) return 'on the due date';
  const magnitude = Math.abs(offsetDays);
  const unit = magnitude === 1 ? 'day' : 'days';
  return `${magnitude} ${unit} ${offsetDays > 0 ? 'before' : 'after'} due`;
}

/**
 * Deadline expressed as a fixed day-of-month within the due date's own month,
 * e.g. "due the 20th, deadline the last day of the month" — unlike
 * getDeadlineFromOffset, this stays correct across months of different
 * lengths since it isn't a fixed day count from the due date. `day === -1`
 * means the last day of the month, same convention as recurrenceMonthDay.
 */
/**
 * Where a relative reminder (Task.reminderOffsetDays) lands: N days before
 * dueDate, at whatever time-of-day the reminder itself carries — the caller
 * still has to set the hours/minutes on the result. Same shape as
 * getDeadlineFromOffset, kept as its own function so the two concepts (a
 * reminder and a deadline) don't share a name that only means one of them.
 */
export function getReminderOffsetDate(dueDate: Date, offsetDays: number): Date {
  return subDays(dueDate, offsetDays);
}

/**
 * The user-facing wording for a relative reminder offset — owned here for the
 * same reason describeDeadlineOffset is, so the editor's row summary and the
 * picker's stepper label can't drift apart. Unlike a deadline, a reminder is
 * always "before": there's no reading of "remind me after it's due".
 */
export function describeReminderOffset(offsetDays: number): string {
  const unit = offsetDays === 1 ? 'day' : 'days';
  return `${offsetDays} ${unit} before due`;
}

export function getDeadlineFromMonthDay(dueDate: Date, day: number): Date {
  return day === -1 ? lastDayOfMonth(dueDate) : setDate(dueDate, Math.min(day, lastDayOfMonth(dueDate).getDate()));
}

/**
 * How many days late a weekly completion can land and still count as "on
 * schedule" (e.g. a Monday habit finished on Tuesday). Daily cadences stay
 * exact — "every day" or "every N days" means what it says, with no slack —
 * so this only widens the weekly window.
 */
const STREAK_LATE_TOLERANCE_DAYS = 1;

/**
 * The cadence-derived gap (in days) a daily/weekly task expects between
 * consecutive completions, evaluated from `from` (the previous completion's
 * logical day) — daily is just its interval, weekly is either the interval
 * in weeks or, when specific weekdays are picked, the actual day-count to
 * the next selected weekday (so e.g. Mon/Wed/Fri expects a 2-or-3-day gap,
 * not a flat 7).
 */
function getExpectedStreakGapDays(task: Task, from: Date): number {
  if (task.recurrenceType === 'daily') return task.recurrenceInterval;
  if (task.recurrenceDays.length > 0) {
    return Math.max(1, differenceInCalendarDays(getNextWeekdayOccurrence(task.recurrenceDays, from, task.recurrenceInterval), from));
  }
  return 7 * task.recurrenceInterval;
}

/**
 * Whether completing a recurring task today continues its streak, per #691:
 * the daily-only `daysBetween === 1` check reset every non-daily habit's
 * streak on its very first on-time completion. The expected gap is derived
 * from the task's own cadence instead of assuming one day, with a small
 * tolerance for lateness (e.g. a weekly Monday habit finished on Tuesday
 * still continues). Monthly/yearly use calendar-unit differences rather than
 * day counts, since month/year lengths vary — that unit itself supplies the
 * tolerance, so no extra grace period is added on top.
 */
export function getStreakOutcome(
  task: Task,
  dayResetTime?: string
): 'same-day' | 'continued' | 'reset' {
  if (task.recurrenceType === 'none' || !task.streakDate) return 'reset';

  // streakDate is a stored anchor (stamped from a previous getCurrentDayStart()
  // call, or shifted by hand in TaskEditor) rather than a fresh "now" moment —
  // getTaskDayStart is the one that doesn't second-guess it if dayResetTime
  // has changed since it was written. Only "now" itself uses getDayStart.
  const lastDay = getTaskDayStart(new Date(task.streakDate), dayResetTime);
  const todayDay = getDayStart(new Date(), dayResetTime);
  const daysBetween = differenceInCalendarDays(todayDay, lastDay);
  if (daysBetween <= 0) return 'same-day';

  if (task.recurrenceType === 'monthly' || task.recurrenceType === 'yearly') {
    const unitsBetween =
      task.recurrenceType === 'monthly'
        ? differenceInCalendarMonths(todayDay, lastDay)
        : differenceInCalendarYears(todayDay, lastDay);
    return unitsBetween >= 1 && unitsBetween <= task.recurrenceInterval ? 'continued' : 'reset';
  }

  const expectedGapDays = getExpectedStreakGapDays(task, lastDay);
  const tolerance = task.recurrenceType === 'weekly' ? STREAK_LATE_TOLERANCE_DAYS : 0;
  return daysBetween <= expectedGapDays + tolerance ? 'continued' : 'reset';
}
