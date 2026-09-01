/**
 * When a daily target's units fall due — the run's span, the grid of due
 * instants across it, and the count that grid implies.
 *
 * Pure, and store-free on purpose: `visibilityUtils` reads it for the pace
 * ramp, `useTaskStore` for the derived count and the run-ended sweep, and
 * `notifications` for the instants to nudge at. Three readers means the span
 * has to be computed in one place or the row on Today, the notification and
 * the day-close will each believe in a slightly different schedule. Same split
 * `focusSettings`/`focusPlan` already use, and for the same reason.
 *
 * ## The interval is the primitive, the count is derived
 *
 * A span and a count give an interval; a span and an interval give a count.
 * Which one is stored decides what survives the span changing, and the two
 * answers are genuinely different: keep the count and starting 90 minutes late
 * squeezes 24 breaks into the hours you have left, keep the interval and you
 * get breaks 20 minutes apart and simply fewer of them. The second is what
 * "every 20 minutes" means, so `Task.quotaIntervalMinutes` is what's stored
 * and `targetCount` is recomputed from it.
 *
 * Tasks with no interval are untouched by all of this: their count is what the
 * user typed, and `quotaDueTimes` divides the span by it exactly as the pace
 * ramp always did.
 */

import { hhmmToDate } from './clockTime';

/** A run's bounds for one logical day. */
export interface QuotaSpan {
  start: Date;
  end: Date;
}

/** Everything the span depends on, named so callers can't pass them in the wrong order. */
export interface QuotaSpanInput {
  /** The task's own window start, `"HH:MM"`, or null to fall back to active hours. */
  windowStart: string | null;
  /** The task's own window end, `"HH:MM"`, or null to fall back to active hours. */
  windowEnd: string | null;
  /** When today's run was started by hand — `Task.quotaStartedAt`. */
  quotaStartedAt: string | null;
  /** The global fallback, `"HH:MM"`. */
  activeHoursStart: string;
  /** The global fallback, `"HH:MM"`. */
  activeHoursEnd: string;
  /** The current logical day's start, from `getCurrentDayStart()`. */
  dayStart: Date;
}

/**
 * The span the pace ramps across today.
 *
 * A hand-started run moves the start and leaves the end alone. That asymmetry
 * is the feature rather than an omission: "start now" answers *when do I sit
 * down*, and the answer to *when do I stop* is the window, which hasn't
 * changed just because the morning did. Moving both would make the run
 * overrun a window the user set precisely so it wouldn't.
 *
 * A stamp from an earlier day is ignored rather than cleared here — this
 * module writes nothing — so an app left closed over a weekend opens on Monday
 * with the window back in charge. `completeTask` clears the field for real
 * when the day's occurrence closes.
 */
export function quotaRunSpan(input: QuotaSpanInput): QuotaSpan {
  const {
    windowStart, windowEnd, quotaStartedAt,
    activeHoursStart, activeHoursEnd, dayStart,
  } = input;

  const scheduledStart = onDay(dayStart, windowStart ?? activeHoursStart);
  let end = onDay(dayStart, windowEnd ?? activeHoursEnd);
  // A close time at or before the start doesn't mean the run is already shut
  // for the day — "22:00–06:00" (active hours set for a night owl) reads as a
  // span that runs into the small hours of the *next* calendar day, the same
  // resolution categoryWindowEnd gives an overnight category schedule. Without
  // this, quotaExpectedByNow's own end-doesn't-resolve guard read it as
  // already closed and owed the whole target the instant the day started.
  if (end <= scheduledStart) {
    end.setDate(end.getDate() + 1);
  }

  const started = quotaStartedAt ? new Date(quotaStartedAt) : null;
  // Only today's stamp counts, and only one that actually falls inside the
  // span: a run "started" after the window shut has no run left to hold.
  const startedToday =
    started && !Number.isNaN(+started) && started >= dayStart && started < end
      ? started
      : null;

  // Starting *before* the window opens doesn't drag the schedule earlier —
  // tapping "start now" at 8am against a 9am window is someone getting ahead
  // of themselves, not redefining their work day.
  const start = startedToday && startedToday > scheduledStart ? startedToday : scheduledStart;
  return { start, end };
}

/** `"HH:MM"` anchored to a logical day, the same math `getWindowThreshold` does. */
function onDay(dayStart: Date, hhmm: string): Date {
  return hhmmToDate(hhmm, new Date(dayStart));
}

/**
 * The logical week `dayStart` falls in, as the day-start instant of its first
 * day — see `Task.quotaPeriod`.
 *
 * Derived by subtracting whole days from the logical day start rather than by
 * `startOfWeek`, and that is the load-bearing part: `startOfWeek` zeroes the
 * time, which would put the boundary at calendar midnight and hand every user
 * with a `dayResetTime` a week that starts hours away from where all their days
 * do. Subtracting days keeps the reset time exactly as `getCurrentDayStart`
 * left it, so a week begins when a day does.
 */
export function quotaWeekStart(dayStart: Date, weekStartsOn: 0 | 1): Date {
  const back = (dayStart.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(dayStart);
  start.setDate(start.getDate() - back);
  return start;
}

/**
 * The span a weekly target's pace ramps across: its logical week, end to end.
 *
 * Deliberately not built from the window/active-hours pair `quotaRunSpan` uses.
 * Those answer "when in the day am I expected to be doing this", and a weekly
 * target has no such expectation — any three days will do, which is the whole
 * point of asking for it by the week. Ramping linearly across the seven days
 * answers the question it *does* have, which is whether you are going to run
 * out of week. So Wednesday lunchtime owes you about half of it whatever your
 * active hours say.
 *
 * A hand-started run still moves the start, on the same reasoning
 * `quotaRunSpan` documents and with the same guard: only a stamp inside this
 * week counts, so an app left closed doesn't resume last week's run.
 */
export function quotaWeekSpan(input: {
  quotaStartedAt: string | null;
  dayStart: Date;
  weekStartsOn: 0 | 1;
}): QuotaSpan {
  const scheduledStart = quotaWeekStart(input.dayStart, input.weekStartsOn);
  const end = new Date(scheduledStart);
  end.setDate(end.getDate() + 7);

  const started = input.quotaStartedAt ? new Date(input.quotaStartedAt) : null;
  const startedThisWeek =
    started && !Number.isNaN(+started) && started >= scheduledStart && started < end
      ? started
      : null;

  return { start: startedThisWeek ?? scheduledStart, end };
}

/**
 * How many units an interval implies across a span, clamped to the range a
 * target is allowed to hold.
 *
 * Floor, not round: the last unit has to fall *inside* the run, or the day
 * closes one short of a count it was never possible to reach. A span too short
 * to hold two is still 2 — the floor `isQuotaTask` recognises — because the
 * alternative is a task silently ceasing to be a daily target when someone
 * starts an hour before their window closes.
 */
export function quotaTargetForInterval(
  span: QuotaSpan,
  intervalMinutes: number,
  { min = 2, max = 99 }: { min?: number; max?: number } = {},
): number {
  const spanMs = +span.end - +span.start;
  if (spanMs <= 0 || intervalMinutes <= 0) return min;
  return clamp(Math.floor(spanMs / (intervalMinutes * 60_000)), min, max);
}

/**
 * Every moment a unit falls due across the span, in order.
 *
 * The grid the pace ramp already implies: `quotaExpectedByNow` owes the kth
 * unit once `k/target` of the span has passed, so the kth boundary is
 * `start + k·span/target`. Written out here because a notification has to be
 * scheduled at each of them, and re-deriving that arithmetic in
 * `notifications.ts` is how the row and the nudge drift apart.
 *
 * Deliberately *not* keyed off `progressCount`: `quotaNextDueAt` answers "when
 * is the next one owed given what you've logged", which slides the whole rest
 * of the day forward when you log three at once. That's right for water and
 * wrong for anything on a cadence — logging three eye breaks in a row does not
 * buy an hour of uninterrupted staring.
 */
export function quotaDueTimes(span: QuotaSpan, targetCount: number): Date[] {
  const spanMs = +span.end - +span.start;
  if (spanMs <= 0 || targetCount < 1) return [];
  const times: Date[] = [];
  for (let k = 0; k < targetCount; k++) {
    times.push(new Date(+span.start + (spanMs * k) / targetCount));
  }
  return times;
}

/**
 * The next `limit` due instants strictly after `now`.
 *
 * What the notifier schedules. Capped by the caller rather than here because
 * the cap is a budget (iOS holds 64 pending requests in total) rather than a
 * property of the schedule.
 */
export function quotaDueTimesAfter(
  span: QuotaSpan,
  targetCount: number,
  now: Date,
  limit: number,
): Date[] {
  return quotaDueTimes(span, targetCount)
    .filter(t => t > now)
    .slice(0, Math.max(0, limit));
}

/** True once the run's own span has closed, whatever the count reached. */
export function isQuotaRunOver(span: QuotaSpan, now: Date): boolean {
  return now >= span.end;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
