import { addDays } from 'date-fns/addDays';

/** Health takes a workout of at most a day. */
const HEALTH_MAX_MS = 24 * 3_600_000;

/** `day` with the hours and minutes of `clock`, seconds cleared. */
export function withClock(day: Date, clock: Date): Date {
  const out = new Date(day);
  out.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return out;
}

/** `date` moved by whole calendar days, keeping its clock time across a DST change. */
export function shiftDays(date: Date, days: number): Date {
  return addDays(date, days);
}

/** Whole minutes from `start` to `end`, 0 when the end isn't after the start. */
export function spanMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

/** Whether two times fall in the same minute. The pickers work in whole minutes. */
export function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
}

/**
 * Why a start and finish can't be saved, in words for the sheet, or null when
 * they can. A finish at the start is refused along with one before it: it is
 * no workout, and Health takes none of zero length, so one there would be
 * retracted and not written again. `healthLimited` is a workout whose new
 * times would reach Health, which takes one up to a day long; over that the
 * rewrite would retract it and fail to write it again, so it is refused here.
 */
export function workoutTimesProblem(
  start: Date,
  end: Date,
  { now, healthLimited }: { now: Date; healthLimited: boolean },
): string | null {
  if (end.getTime() <= start.getTime()) return 'A workout has to finish after it starts.';
  if (end.getTime() > now.getTime()) return 'A workout can’t finish in the future.';
  if (healthLimited && end.getTime() - start.getTime() > HEALTH_MAX_MS) {
    return 'Apple Health takes a workout up to a day long.';
  }
  return null;
}
