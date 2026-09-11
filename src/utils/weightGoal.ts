/**
 * A weight target the user set: the rate they chose, how far along they are,
 * and when their own arithmetic lands them on the number.
 *
 * **This is the one thing `weightLog.ts` and `docs/arch/health-data.md` spent
 * years ruling out, and it is here because it was asked for rather than because
 * the argument against it was wrong.** That argument is worth restating,
 * because it still binds everything around this file: the app must not form an
 * opinion about a body. What changed is *whose* opinion is in play. A goal
 * weight the app suggests is the app judging a body; a goal weight somebody
 * typed in is the same kind of thing as a sodium ceiling their doctor set or a
 * daily target they picked in `NutritionTargetsSheet` — a number they chose,
 * which this module does arithmetic against and nothing else.
 *
 * So the fence moved rather than came down, and these are the posts:
 *
 * - **Nothing here proposes a target weight or a rate.** There is no healthy
 *   range, no BMI, no "recommended" figure. `RATE_RANGE` bounds what a stepper
 *   will produce, which is an absurdity check in the shape `MAX_WEIGHT_KG`
 *   already uses, not a recommendation.
 * - **Nothing here judges the number somebody picked.** No warning that a
 *   target is too low, no encouragement that it is realistic.
 * - **Nothing generated fires off a goal.** It is not a `HealthRuleMetric`, no
 *   task is written from it, and reaching the target completes nothing — the
 *   same call `nutritionTargets.ts` makes about a daily figure, for the same
 *   reason. A goal is a record to read against, not a task to finish.
 * - **Ahead and behind are said about the user's own pace, never about them.**
 *   `goalPace` reports the gap in kilograms between where the weight is and
 *   where the rate *they set* would have put it. That is a fact they could work
 *   out from the chart, which is exactly the standard `weightChange` already
 *   holds itself to. It carries no colour, no arrow and no advice, and the
 *   caller must not add one.
 *
 * The goal itself lives in the settings table rather than in Apple Health,
 * because it is not a measurement — HealthKit has nowhere to put it and nothing
 * else should read it back as one. The *weights* it is read against are still
 * Health's, and this module never stores one.
 */

import { differenceInCalendarDays } from 'date-fns';
import { dayKeyToDate } from './dateUtils';
import { MAX_WEIGHT_KG, unitToKg, type WeightPoint, type WeightUnit } from './weightLog';

/**
 * Which way a goal points. Derived from the target and the starting weight
 * rather than stored, so the two can never disagree — a goal saying "lose"
 * while its target sits above the start is a state worth making unspellable.
 */
export type WeightGoalDirection = 'lose' | 'maintain' | 'gain';

/** A weight to reach, the weight it was set from, and how fast to get there. */
export interface WeightGoal {
  /** The weight when the goal was set. Fixed: progress is measured from it. */
  startKg: number;
  /** The logical day the goal was set on, which is day zero of the pace line. */
  startDayKey: string;
  /** The weight being aimed at. */
  targetKg: number;
  /**
   * How fast, in kilograms per week, as a **magnitude**.
   *
   * Unsigned on purpose: the direction is the target's business (see
   * `goalDirection`), so a sign here would be a second, redundant statement of
   * it that could contradict the first. `signedRateKgPerWeek` puts the two
   * together for the callers that need a signed figure.
   */
  rateKgPerWeek: number;
}

/**
 * What a rate may be set to, per unit, and where a stepper opens.
 *
 * **Bounds, not advice.** The ceiling is here for the same reason
 * `MAX_WEIGHT_KG` is: a stepper needs one, and a rate past it is far more
 * likely to be a mis-tap than a plan. The app says nothing about whether the
 * figure somebody lands on is a good idea, and there is deliberately no warning
 * band inside the range.
 *
 * Two tables rather than one converted table, because the steps people think in
 * differ by unit: a quarter of a pound is the granularity a scale in pounds
 * makes meaningful, and 0.113kg is not a number anybody means. Same reasoning
 * `NUTRITION_TARGET_RANGES` gives for not deriving its steps from anything.
 */
export const RATE_RANGE: Record<WeightUnit, { min: number; max: number; step: number; default: number }> = {
  lb: { min: 0.25, max: 2, step: 0.25, default: 1 },
  kg: { min: 0.1, max: 1, step: 0.1, default: 0.5 },
};

/** The widest rate this app will store, in kg/week — the `lb` ceiling above. */
export const MAX_RATE_KG_PER_WEEK = unitToKg(RATE_RANGE.lb.max, 'lb');

/**
 * Which way the goal points, from the target against the starting weight.
 *
 * The tolerance is a tenth of a kilogram because that is the precision a weight
 * is displayed to (`formatWeight`), so a target that rounds to the same shown
 * number as the start is a maintain however the kilograms actually compare.
 */
export function goalDirection(goal: WeightGoal): WeightGoalDirection {
  const delta = goal.targetKg - goal.startKg;
  if (Math.abs(delta) < 0.05) return 'maintain';
  return delta < 0 ? 'lose' : 'gain';
}

/**
 * The rate with the direction's sign on it: negative to lose, zero to maintain.
 *
 * Zero for a maintain regardless of what `rateKgPerWeek` holds, since "maintain
 * at half a kilo a week" is not a thing to mean, and a stored rate left over
 * from before the target was changed must not resurface as a drift.
 */
export function signedRateKgPerWeek(goal: WeightGoal): number {
  const direction = goalDirection(goal);
  if (direction === 'maintain') return 0;
  const magnitude = Math.abs(goal.rateKgPerWeek);
  return direction === 'lose' ? -magnitude : magnitude;
}

/** How far along a goal is, in the plainest terms the numbers allow. */
export interface WeightGoalProgress {
  /** Signed: negative when the current weight is below where it started. */
  changedKg: number;
  /** Signed, toward the target. Negative once the target is passed. */
  remainingKg: number;
  /**
   * 0 to 1, clamped at both ends.
   *
   * Clamped at 1 for the reason `targetProgress` gives about its own bar — past
   * the end is not more information — and clamped at 0 because a weight that
   * has moved away from the target would otherwise render as a negative bar,
   * which is a scold drawn as a graphic. The signed `changedKg` above is where
   * a caller reads which way it actually went.
   */
  fraction: number;
  /** True once the target has been reached or passed. */
  reached: boolean;
}

/**
 * Where `currentKg` sits between the goal's start and its target.
 *
 * A maintain goal has no span to be a fraction of, so it reports 1 while the
 * weight is within `MAINTAIN_BAND_KG` of the target and 0 outside it. That is
 * the one place a fraction here is a threshold rather than a ratio, and the
 * alternative — dividing by a zero span — has no answer at all.
 */
export function goalProgress(goal: WeightGoal, currentKg: number): WeightGoalProgress {
  const span = goal.targetKg - goal.startKg;
  const changedKg = currentKg - goal.startKg;
  const remainingKg = goal.targetKg - currentKg;

  if (goalDirection(goal) === 'maintain') {
    const held = Math.abs(remainingKg) <= MAINTAIN_BAND_KG;
    return { changedKg, remainingKg, fraction: held ? 1 : 0, reached: held };
  }

  const fraction = Math.min(1, Math.max(0, changedKg / span));
  // Signs agree exactly when there is still ground to cover: a negative
  // remaining on a losing goal means the weight went past the target.
  const reached = span < 0 ? remainingKg >= 0 : remainingKg <= 0;
  return { changedKg, remainingKg, fraction, reached };
}

/**
 * How close to the target a maintain goal counts as held, in kilograms.
 *
 * Half a kilo, because a body varies by about that much across a day on water
 * alone and a band narrower than the noise would report somebody as off their
 * maintain every other morning.
 */
export const MAINTAIN_BAND_KG = 0.5;

/**
 * The weight the goal's own rate would have reached `days` after it was set.
 *
 * Clamped at the target, so the pace line stops on the number rather than
 * continuing through it — a plan to lose 5kg at half a kilo a week describes
 * ten weeks, not an indefinite descent, and projecting past the end would put
 * somebody "behind" their pace for ever after reaching it.
 */
export function paceWeightAfterDays(goal: WeightGoal, days: number): number {
  const rate = signedRateKgPerWeek(goal);
  if (rate === 0) return goal.targetKg;
  const projected = goal.startKg + (rate * days) / 7;
  return rate < 0 ? Math.max(goal.targetKg, projected) : Math.min(goal.targetKg, projected);
}

/** The pace line and the actual weight, side by side. Not a verdict. */
export interface WeightGoalPace {
  /** Days since the goal was set. Never negative. */
  daysElapsed: number;
  /** Where the chosen rate would have put the weight by now. */
  paceKg: number;
  /**
   * How far ahead of that pace the weight is, in kilograms, positive meaning
   * further toward the target than the rate called for.
   *
   * Signed toward the goal rather than up or down the scale, so one number
   * reads the same way for a losing goal and a gaining one.
   */
  aheadKg: number;
}

/**
 * The chosen pace against what actually happened, as of `today`.
 *
 * Null before the goal's own start day, which is the case a clock change or a
 * restored backup can produce: a pace line running backwards from day zero
 * would describe a plan that had not begun.
 */
export function goalPace(goal: WeightGoal, currentKg: number, today: Date): WeightGoalPace | null {
  const daysElapsed = differenceInCalendarDays(today, dayKeyToDate(goal.startDayKey));
  if (daysElapsed < 0) return null;
  const paceKg = paceWeightAfterDays(goal, daysElapsed);
  const towardTarget = goal.targetKg < goal.startKg ? -1 : 1;
  return { daysElapsed, paceKg, aheadKg: (currentKg - paceKg) * towardTarget };
}

/**
 * How many days from `currentKg` to the target at the chosen rate, or null when
 * the arithmetic has no answer.
 *
 * Null for a maintain goal (no rate to divide by), for a target already
 * reached (nothing left to project), and — the one worth stating — for a weight
 * that has moved the *wrong* way past its own start: the rate still points at
 * the target from there, so a projection is arithmetically fine, and it is
 * withheld anyway. "You will reach 70kg in 340 days" said to somebody currently
 * heading away from it is the app's first opinion about how it is going, and
 * this module does not have those. The caller shows the pace gap instead, which
 * is a fact rather than a forecast.
 */
export function daysToTarget(goal: WeightGoal, currentKg: number): number | null {
  const rate = signedRateKgPerWeek(goal);
  if (rate === 0) return null;
  const remaining = goal.targetKg - currentKg;
  // Same sign as the rate means the target is still ahead in the rate's own
  // direction; opposite means it has been passed.
  if (remaining === 0 || Math.sign(remaining) !== Math.sign(rate)) return null;
  return Math.ceil(Math.abs(remaining / rate) * 7);
}

/**
 * The most recent reading at or after the goal's start day, or null.
 *
 * Scoped to the goal's own window rather than taking the series' last reading
 * outright, because a goal set today against a series full of last year's
 * weights would otherwise read its progress from a number recorded before it
 * existed. A goal with no weigh-in since it was set has no progress to report,
 * which the caller renders as "nothing recorded yet" rather than as zero.
 */
export function weightSinceGoalStart(goal: WeightGoal, points: WeightPoint[]): number | null {
  let latest: number | null = null;
  for (const point of points) {
    if (point.kilograms === null) continue;
    if (point.dayKey < goal.startDayKey) continue;
    latest = point.kilograms;
  }
  return latest;
}

/** A stored goal, or null if there isn't a readable one. */
export function parseWeightGoal(raw: string | null | undefined): WeightGoal | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const startKg = weightField(parsed.startKg);
    const targetKg = weightField(parsed.targetKg);
    const startDayKey = parsed.startDayKey;
    if (startKg === null || targetKg === null) return null;
    if (typeof startDayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDayKey)) return null;
    const rate = parsed.rateKgPerWeek;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) return null;
    return {
      startKg,
      startDayKey,
      targetKg,
      // Clamped rather than refused: a rate past the ceiling is still a goal
      // somebody meant, where a nonsense *weight* is a typo with nothing to
      // salvage. Same split parseWeightInput draws between the two.
      rateKgPerWeek: Math.min(rate, MAX_RATE_KG_PER_WEEK),
    };
  } catch {
    return null;
  }
}

export function serializeWeightGoal(goal: WeightGoal): string {
  return JSON.stringify(goal);
}

function weightField(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value >= MAX_WEIGHT_KG) return null;
  return value;
}
