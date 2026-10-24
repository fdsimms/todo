import type { Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import type { BloodPressureReading } from './bloodPressureLog';
import { dayKeyGap } from './weightTasks';

/**
 * `bloodPressureLog` — `weighIn`'s sibling, and the third generator that exists
 * to ask for a number rather than to react to one.
 *
 * Everything about its shape is `src/utils/weightTasks.ts`, and that file is the
 * one to read for the reasoning; `docs/arch/generated-tasks.md` has the section.
 * In short: the trigger is a gap in Apple Health rather than a cadence, so
 * somebody who takes a reading every morning never sees the task; it is its own
 * switch rather than part of `health`, because one reacts to a reading and this
 * one asks for one; and the pass needs both Health switches, the read to know
 * whether to ask and the write so the sheet can record the answer.
 *
 * **Nothing here reads a reading's value, only whether one exists.** The same
 * fence `bloodPressureLog.ts` draws: the app may notice you have not recorded a
 * number, which is a fact about your logging. It may not notice what the number
 * was, which would be a fact about your body and the app having an opinion on it.
 * The notes name the gap and nothing else.
 */

/**
 * The task's title. Never varies, so the reconcile has nothing to chase.
 * Literal about the action, per the copy rule: no encouragement, no target.
 */
export const BLOOD_PRESSURE_TITLE = 'Record your blood pressure';

/** How often to ask, when the user hasn't said. */
export const DEFAULT_BLOOD_PRESSURE_EVERY_DAYS = 7;

/** A day is the floor: a reading every morning is a real practice, and the gap trigger keeps it quiet on any day one is already in. */
export const BLOOD_PRESSURE_EVERY_DAYS_MIN = 1;

/** A month is the ceiling, for the reason `WEIGH_IN_EVERY_DAYS_MAX` gives. */
export const BLOOD_PRESSURE_EVERY_DAYS_MAX = 30;

export function clampBloodPressureEveryDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_BLOOD_PRESSURE_EVERY_DAYS;
  return Math.min(
    BLOOD_PRESSURE_EVERY_DAYS_MAX,
    Math.max(BLOOD_PRESSURE_EVERY_DAYS_MIN, Math.round(days)),
  );
}

/** What the row's link button opens: the Blood pressure screen, with the sheet up. */
export const BLOOD_PRESSURE_LINK_URL = 'dundundun://bloodpressure?log=1';

/** The day key a request is asking about, or null for any other task. */
export function bloodPressureDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
): string | null {
  return generatedSourceOf(task, 'bloodPressureLog');
}

/**
 * Whether to ask, given the readings in the window the request would cover.
 *
 * **An empty array means "asked Health and got nothing", which is a real
 * answer.** The caller must not pass one when the read failed or was never made
 * (`readRecentBloodPressure` returns null for that, and `checkBloodPressureTasks`
 * returns on it), since a refused read and a fortnight of no readings are
 * indistinguishable from here.
 */
export function wantsBloodPressure(readings: readonly Pick<BloodPressureReading, 'at'>[]): boolean {
  return readings.length === 0;
}

/**
 * Whether a deleted request still holds, so the pass should not ask today.
 * Deleting the request means "not this time": it holds for the window the
 * person chose from the day they declined, the same length of silence a
 * recorded reading would have bought. A stamp dated after today (the clock
 * moved back) holds, but never for longer than the window.
 */
export function bloodPressureDeclineHolds(
  declinedDayKey: string | null,
  todayKey: string,
  everyDays: number,
): boolean {
  if (!declinedDayKey) return false;
  const days = clampBloodPressureEveryDays(everyDays);
  const gap = dayKeyGap(declinedDayKey, todayKey);
  return gap < days && gap > -days;
}

/** The row's notes: why it is on the list. States the gap and nothing else. */
export function bloodPressureNotes(everyDays: number): string {
  const days = clampBloodPressureEveryDays(everyDays);
  return days === 1
    ? 'Nothing recorded in Apple Health today.'
    : `Nothing recorded in Apple Health in the last ${days} days.`;
}
