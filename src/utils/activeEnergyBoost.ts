/**
 * A day's calorie target, raised by however far today's active energy runs past
 * an ordinary day of the person's own — the baseline they typed in.
 *
 * **`waterExerciseBoost.ts` is the pattern and most of the argument.** Same
 * fence: this is arithmetic against a number the user chose, not a figure the
 * app worked out and recommended; it is off until somebody turns it on; and it
 * is **display-time only**, so `nutritionTargets.calorieKcal` — the number they
 * actually set — never silently drifts. `energyBudget.ts` states the rule this
 * is bounded by ("a target that silently tracks a formula is a figure nobody
 * chose driving the food log") and nothing here writes a target.
 *
 * **Why a baseline, and why it is the whole feature.** The obvious version of
 * this adds today's active energy to the target outright, and it double-counts
 * for nearly everybody: a target arrived at through `energyBudget.ts` has
 * already been multiplied by an activity level, and one arrived at any other
 * way was still chosen by somebody who knew roughly how much they move. Adding
 * a 500-calorie walk to a target that assumed a 500-calorie day pays for the
 * walk twice. So what is added is the *excess* — `active − baseline` — and the
 * baseline is what makes an ordinary day add nothing at all. Somebody whose
 * target really was built from a resting rate sets it to zero and gets the
 * naive behaviour on purpose.
 *
 * **It only ever raises, never lowers**, and that is not politeness. Active
 * energy accrues through the day: at nine in the morning it is a fraction of
 * what it will be by bedtime, so a signed adjustment would open every day
 * several hundred calories *below* the target and climb back to it — a figure
 * that is wrong all morning, reads as a scold, and is the same mistake
 * `describeAgainstTarget` refuses when it withholds "0 of 2,000" from a day
 * nobody has eaten in yet. Flooring at zero makes a partial day understate the
 * boost rather than overstate it, so the number on screen is never one the
 * evening takes back.
 *
 * **Calories only.** The macro targets are not scaled along with it. A split is
 * something the person picked (see `MACRO_PRESETS`, which preselects none), and
 * re-dividing a day they did not ask to have re-divided would be this module
 * acquiring an opinion about what the extra calories should be made of.
 *
 * **Never treats a null reading as a zero** — the rule every reader of a Health
 * figure in this app holds, and `HealthDay.activeEnergyKcal` says why it bites
 * hardest here. A refused read, a day with nothing recorded and a device that
 * has never recorded any are one answer, so all three mean no boost rather than
 * an ordinary day's worth of one.
 */

/** Today's calorie target, raised while today's active energy clears a baseline. */
export interface ActiveEnergyBoost {
  /**
   * Active calories an ordinary day of this person's already involves, which
   * their calorie target is therefore assumed to account for. Only what today
   * burns *past* this raises the target.
   *
   * Zero is a real setting and means "add all of it", which is right for a
   * target built from a resting rate. It is not a default: the stepper opens
   * on `default` below, and `typicalActiveEnergyKcal` can offer this person's
   * own recent figure, but neither is stored until somebody accepts one.
   */
  baselineKcal: number;
}

/**
 * What the baseline may be set to, and where its stepper opens.
 *
 * The ceiling is high enough for somebody with a physical job and a watch that
 * credits it; the floor is zero because "add all of it" is a real answer rather
 * than an edge case. The `default` is where a stepper opens and nothing else —
 * 500 is a round number near a common Move goal, chosen so the control starts
 * somewhere recognizable rather than because the app thinks anybody's day is
 * 500 calories. Same distinction `NUTRITION_TARGET_RANGES` draws about its own.
 */
export const ACTIVE_ENERGY_BASELINE_RANGE = { min: 0, max: 2000, step: 50, default: 500 };

/** A stored boost, or null if there isn't a readable one. */
export function parseActiveEnergyBoost(raw: string | null | undefined): ActiveEnergyBoost | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { baselineKcal } = parsed;
    if (typeof baselineKcal !== 'number' || !Number.isFinite(baselineKcal)) return null;
    return {
      baselineKcal: Math.min(
        ACTIVE_ENERGY_BASELINE_RANGE.max,
        Math.max(ACTIVE_ENERGY_BASELINE_RANGE.min, Math.round(baselineKcal)),
      ),
    };
  } catch {
    return null;
  }
}

export function serializeActiveEnergyBoost(boost: ActiveEnergyBoost): string {
  return JSON.stringify(boost);
}

/**
 * How many calories today's movement adds to the target: whatever today's
 * active energy runs past the baseline, and zero in every other case.
 *
 * Zero rather than null for "no boost", so a caller adding it needs no branch.
 * Whether there is anything to *say* is `> 0`, which is the same question.
 */
export function activeEnergyBoostKcal(
  activeEnergyToday: number | null,
  boost: ActiveEnergyBoost | null,
): number {
  if (!boost) return 0;
  // The null refusal, stated once here so no caller has to remember it.
  if (activeEnergyToday === null || !Number.isFinite(activeEnergyToday)) return 0;
  return Math.max(0, Math.round(activeEnergyToday - boost.baselineKcal));
}

/**
 * Today's calorie target with the boost applied, or the base target unchanged.
 *
 * Refuses to invent a target: a `baseKcal` of `undefined` (no calorie target
 * set in `NutritionTargetsSheet`) comes back `undefined`, since there is
 * nothing to raise and a boost is not itself a target. Same refusal
 * `effectiveWaterTargetMl` makes for the same reason.
 */
export function effectiveCalorieTargetKcal(
  baseKcal: number | undefined,
  activeEnergyToday: number | null,
  boost: ActiveEnergyBoost | null,
): number | undefined {
  if (baseKcal === undefined) return undefined;
  return baseKcal + activeEnergyBoostKcal(activeEnergyToday, boost);
}

/**
 * How far back the typical-day figure looks.
 *
 * A fortnight, matching `EXERCISE_LIVE_WINDOW_DAYS` and round for the same
 * admitted reason: long enough to cover two of every weekday, so a routine
 * shows through, and short enough that somebody whose life changed a month ago
 * is not still being told about the old one.
 */
export const TYPICAL_ACTIVE_ENERGY_WINDOW_DAYS = 14;

/**
 * How many days of readings the typical-day figure needs before it will answer.
 *
 * A week, so one unusual day cannot be most of the evidence and so the figure
 * spans a whole week's shape (people move differently at weekends). Below it
 * the honest answer is that there isn't one yet.
 */
export const MIN_TYPICAL_ACTIVE_ENERGY_DAYS = 7;

/**
 * A typical day's active energy for this person, from a window of their own
 * days — or null when there aren't enough to say.
 *
 * **The median, not the mean.** One marathon, or one day the watch sat on a
 * charger, moves a mean enough to mis-set a baseline for a fortnight; the
 * median ignores both. Days with no figure are dropped rather than counted as
 * zero, the same refusal every other reader here makes, which is also why the
 * count is taken *after* dropping them.
 *
 * **This proposes and nothing more.** Nothing calls it to fill a setting in:
 * the sheet puts the figure behind a button somebody presses, which is the
 * arrangement `WeightGoalSheet` uses for a far larger number and the reason
 * either is allowed to exist.
 */
export function typicalActiveEnergyKcal(days: (number | null)[]): number | null {
  const known = days
    .filter((d): d is number => d !== null && Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  if (known.length < MIN_TYPICAL_ACTIVE_ENERGY_DAYS) return null;
  const middle = Math.floor(known.length / 2);
  const median = known.length % 2 === 0 ? (known[middle - 1] + known[middle]) / 2 : known[middle];
  return Math.round(median);
}

/**
 * A figure rounded to something the baseline stepper can actually hold, so
 * accepting the suggestion doesn't leave the control on a value its own − and +
 * would immediately snap away from.
 */
export function snapToBaselineStep(kcal: number): number {
  const { min, max, step } = ACTIVE_ENERGY_BASELINE_RANGE;
  return Math.min(max, Math.max(min, Math.round(kcal / step) * step));
}
