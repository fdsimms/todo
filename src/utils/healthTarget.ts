import type { HealthTargetMetric } from '../types';
import type { ActivityRings } from './activityRings';

/**
 * A task that is ready to check off once Apple Health reaches a number.
 *
 * `timer.ts` for a reading instead of a clock, and the parallel is exact and
 * deliberate — read that file's note first, because the rule it states is the
 * one thing here that must not be relaxed:
 *
 * > This marks the task as ready to complete — it never blocks completing it
 * > early, which stays a normal tap at any point.
 *
 * **Nothing here completes a task, and nothing anywhere may.** That is the most
 * consistently held line in this app: `isTimerReady` derives *ready* and leaves
 * the tap to a person, `pantryCheckTasks` refuses to read a tick as an answer,
 * and `DayContextRow` refuses to guess between "eaten" and "thrown out" with
 * one glyph. A step count is the most tempting place to break it — the number
 * is right there, and the task plainly *is* done — and it is also the worst,
 * because the reading is a claim rather than a statement (see
 * `docs/arch/health-data.md`). A watch left on the side, a walk with the phone
 * in a bag, a treadmill: the app would be striking things off a person's list
 * on the strength of a guess about their body, and the row would be gone before
 * they could disagree with it.
 *
 * So the whole of this module is derived and read-only. It says how far along
 * the reading is and whether it has arrived; the checkbox stays a checkbox.
 *
 * ## Why it is not a quota
 *
 * "Walk 8,000 steps" looks like `targetCount`/`progressCount` and is not one. A
 * quota is *logged* — you tap once per unit and `logQuotaUnit` counts them, the
 * pace ramp spreads them across the day, and `MAX_TARGET_COUNT` is 99. Nobody
 * taps eight thousand times, and pointing the ramp at a number the user never
 * entered would nudge them per step. It is its own shape, which is what a
 * `TaskKind` is for.
 */

/**
 * Every metric a target may name, as a runtime list: the database narrows a
 * stored column against it, so a row naming a metric this build doesn't know
 * reads as "not a health-target task" rather than a task nothing can judge.
 */
export const HEALTH_TARGET_METRICS: readonly HealthTargetMetric[] = [
  'steps', 'sleepHours', 'exerciseMinutes', 'activeEnergyKcal', 'standHours',
];

/** The two fields, as much of a task as any of this needs. */
export interface HealthTargetState {
  healthMetric: HealthTargetMetric | null;
  healthTarget: number | null;
  /** Optional so a caller that never follows a goal need not name it. */
  healthFollowGoal?: boolean;
}

/** Today's reading, as much of it as any of this needs. */
export interface HealthTargetReading {
  dayKey: string;
  steps: number | null;
  sleepHours: number | null;
  /** Optional so a reading that predates the ring metrics still satisfies this. */
  exerciseMinutes?: number | null;
  activeEnergyKcal?: number | null;
  rings?: ActivityRings | null;
}

/**
 * What a target may be set to, per metric.
 *
 * Deliberately not `HEALTH_THRESHOLDS` from `healthRules.ts`, even though the
 * shape is identical: **a floor and a goal are different numbers.** A rule asks
 * "did the day fall short", so its steps range starts at 500 and defaults to
 * 3,000; a target is something to reach, so it runs further and defaults to
 * 8,000. Sharing one table would have the rule stepper offering fifty thousand
 * and the target stepper starting at five hundred, and neither reads as a
 * number anybody meant.
 */
export const HEALTH_TARGET_RANGES: Record<
  HealthTargetMetric,
  { min: number; max: number; step: number; default: number }
> = {
  steps: { min: 500, max: 50000, step: 500, default: 8000 },
  sleepHours: { min: 4, max: 12, step: 1, default: 8 },
  // The Fitness defaults, since the goal most people set a task against is the
  // ring they already have: 30 minutes, 12 hours, and a Move goal that is
  // theirs to change (500 is the stepper's start, not Apple's figure).
  exerciseMinutes: { min: 5, max: 300, step: 5, default: 30 },
  activeEnergyKcal: { min: 50, max: 3000, step: 50, default: 500 },
  standHours: { min: 1, max: 24, step: 1, default: 12 },
};

/** Does this task's readiness come from a Health reading? */
export function hasHealthTarget(task: HealthTargetState): boolean {
  return task.healthMetric !== null && task.healthTarget !== null && task.healthTarget > 0;
}

/**
 * Today's reading for this task's metric, or null when there isn't one.
 *
 * Null covers every reason at once and they are not distinguishable: the read
 * is off, the day has turned over since the snapshot was taken, nothing has
 * been recorded yet, or the read was refused — HealthKit serves a refusal as an
 * empty store. Every caller below treats null as "no answer" rather than as
 * zero, which is the rule the whole feature rests on.
 */
export function healthTargetValue(
  task: HealthTargetState,
  reading: HealthTargetReading | null,
  todayKey: string,
): number | null {
  if (!hasHealthTarget(task)) return null;
  if (!reading || reading.dayKey !== todayKey) return null;
  switch (task.healthMetric) {
    case 'steps':
      return reading.steps;
    case 'sleepHours':
      return reading.sleepHours;
    // The ring figures prefer the Activity summary, which is Apple's own
    // de-duplicated total, so the row agrees with the rings drawn elsewhere.
    // They fall back to the quantity total where it exists, because an install
    // that allowed Health before the rings were added has not been asked for
    // the summary and gets an empty one. Stand hours have no such fallback.
    case 'exerciseMinutes':
      return reading.rings?.exercise.value ?? reading.exerciseMinutes ?? null;
    case 'activeEnergyKcal':
      return reading.rings?.move.value ?? reading.activeEnergyKcal ?? null;
    case 'standHours':
      return reading.rings?.stand.value ?? null;
    default:
      return null;
  }
}

/** The three metrics a ring's goal can stand in for. */
export function followsRingGoal(metric: HealthTargetMetric | null): boolean {
  return metric === 'exerciseMinutes' || metric === 'activeEnergyKcal' || metric === 'standHours';
}

/**
 * The number this task is reaching for today: the goal the person set in
 * Fitness when the task follows it and that goal has been read, otherwise the
 * task's own `healthTarget`.
 *
 * The typed number is the fallback rather than being replaced, for the same
 * reason the ring figures fall back to the quantity totals: an install that
 * allowed Health before the rings were added gets no summary, and a task that
 * suddenly had no target would stop being a health task. A goal read from a day
 * that has turned over is not used either; Fitness goals can change by weekday.
 * Everything below judges a task against whatever this returns.
 */
export function effectiveHealthTarget(
  task: HealthTargetState,
  reading: HealthTargetReading | null,
  todayKey: string,
): number | null {
  if (!hasHealthTarget(task)) return null;
  if (task.healthFollowGoal && followsRingGoal(task.healthMetric)
      && reading && reading.dayKey === todayKey && reading.rings) {
    const ring = task.healthMetric === 'exerciseMinutes' ? reading.rings.exercise
      : task.healthMetric === 'activeEnergyKcal' ? reading.rings.move
        : reading.rings.stand;
    if (ring.goal !== null && ring.goal > 0) return ring.goal;
  }
  return task.healthTarget;
}

/**
 * How far through the target, 0–1. Zero for a task with no target, and zero
 * for a reading that hasn't arrived — a bar has to draw *something*, and an
 * empty one is the honest picture of "nothing known yet".
 *
 * Clamped at 1: `timerProgress` does the same, and a bar past its own end is
 * not more information.
 */
export function healthTargetProgress(task: HealthTargetState, value: number | null): number {
  if (!hasHealthTarget(task) || value === null) return 0;
  return Math.min(1, Math.max(0, value / (task.healthTarget as number)));
}

/**
 * Has the reading reached the target? This marks the task as **ready to
 * complete** — it never completes it, and it never blocks completing it early,
 * which stays a normal tap at any point. See the module note.
 *
 * A missing reading is never ready. Note the direction: a *target* is met by
 * reaching it, where a *rule* (`ruleShortfallToday`) fires on falling under
 * one. The two are mirror images on purpose — one is something to achieve, the
 * other something to notice.
 */
export function isHealthTargetReady(task: HealthTargetState, value: number | null): boolean {
  if (!hasHealthTarget(task) || value === null) return false;
  return value >= (task.healthTarget as number);
}

/**
 * The row's readout — "4,120 / 8,000 steps", "7 / 8 hrs asleep" — or null when
 * there is nothing to say.
 *
 * Null rather than "0 / 8,000" for a reading that hasn't arrived, because a
 * zero there would be a claim: it is the same figure somebody who refused the
 * read would see, and it would be the app telling them they had walked nowhere.
 */
export function describeHealthTarget(
  task: HealthTargetState,
  value: number | null,
): string | null {
  if (!hasHealthTarget(task) || value === null) return null;
  const target = task.healthTarget as number;
  switch (task.healthMetric) {
    case 'steps':
      return `${Math.round(value).toLocaleString()} / ${target.toLocaleString()} steps`;
    case 'exerciseMinutes':
      return `${Math.round(value).toLocaleString()} / ${target.toLocaleString()} min exercise`;
    case 'activeEnergyKcal':
      return `${Math.round(value).toLocaleString()} / ${target.toLocaleString()} active cal`;
    case 'standHours':
      return `${Math.round(value)} / ${target} stand hrs`;
    default:
      return `${roundHalf(value)} / ${target} hrs asleep`;
  }
}

/**
 * The goal alone, as the editor and the type summary say it: "8,000 steps",
 * "8 hours asleep", "30 minutes of exercise", "500 active calories",
 * "12 stand hours".
 */
export function describeHealthGoalAmount(metric: HealthTargetMetric, goal: number): string {
  switch (metric) {
    case 'steps':
      return `${goal.toLocaleString()} steps`;
    case 'sleepHours':
      return `${goal} ${goal === 1 ? 'hour' : 'hours'} asleep`;
    case 'exerciseMinutes':
      return `${goal.toLocaleString()} ${goal === 1 ? 'minute' : 'minutes'} of exercise`;
    case 'activeEnergyKcal':
      return `${goal.toLocaleString()} active ${goal === 1 ? 'calorie' : 'calories'}`;
    case 'standHours':
      return `${goal} stand ${goal === 1 ? 'hour' : 'hours'}`;
  }
}

/** How a metric is named on the editor's picker. */
export const HEALTH_TARGET_LABELS: Record<HealthTargetMetric, string> = {
  steps: 'Steps',
  sleepHours: 'Hours asleep',
  exerciseMinutes: 'Exercise',
  activeEnergyKcal: 'Active cal',
  standHours: 'Stand',
};

/** One decimal, and no trailing ".0" — "7" and "6.5", never "6.50". */
function roundHalf(hours: number): string {
  return String(Math.round(hours * 2) / 2);
}
