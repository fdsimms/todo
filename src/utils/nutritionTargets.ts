import type { NutrientKey } from '../types';
import { HEALTH_WRITABLE_NUTRIENTS, NUTRIENT_KEYS } from '../types';
import { NUTRIENT_LABEL } from './foodNutrition';

/**
 * A daily figure to aim at, per nutrient, and how a day's total reads against
 * one.
 *
 * **A target the user set, or nothing.** There are no suggested goals here, no
 * computed basal rate, and no default of any kind: the map ships empty and
 * stays empty until somebody types a number. The app has no business having an
 * opinion on what a person should eat, which is the same argument
 * `docs/arch/health-data.md` makes at length about a related case, and a
 * "recommended" figure sitting in a field nobody chose is exactly how an app
 * acquires one.
 *
 * **`healthTarget` is the precedent, not the quota fields.** A real number,
 * outside the quota mechanism, where reaching it completes nothing — because a
 * total is a record of what happened rather than a task to finish. `logQuotaUnit`
 * auto-completes on reaching its target and `MAX_TARGET_COUNT` is 99; neither
 * is any use for two thousand calories.
 *
 * **Counts, never a score, unless the person said the number is a limit.** A
 * plain target reports the number and the target and stops: no colour that
 * means bad, no encouragement, no "400 calories left", because the app is not
 * told whether reaching it is the point (protein) or staying under it is
 * (sodium), and guessing would be the app having an opinion about a body. A
 * nutrient the person marked **Stay under** (`NutritionLimits`) is the one
 * exception, and it is theirs rather than the app's: they named the direction,
 * so "4 g left" and a red bar past it repeat their own statement back to them.
 * Nothing is a limit by default, and the app never proposes one. Everything
 * limit-shaped lives under "Limits" below; `cookingStats.ts`'s no-score rule
 * still binds every other target here.
 *
 * **Absent is not zero.** A day with nothing logged has no total, not a total
 * of zero, so it reads as having no answer rather than as a day of nothing —
 * the same refusal `healthContextRows` makes about a step count every morning.
 */

/**
 * What a target may be set to, per nutrient.
 *
 * Deliberately its own table rather than `HEALTH_THRESHOLDS` from
 * `healthRules.ts`, for the reason `HEALTH_TARGET_RANGES` gives about the same
 * pair: **a floor and a goal are different numbers.** A rule asks whether the
 * day fell short, so its range starts low; a target is something to aim at, so
 * it runs further. Sharing one table would have a rule stepper offering figures
 * nobody meant.
 *
 * **The floor is zero, and zero is a real target.** "No caffeine" and "no added
 * sugar" are goals somebody has, and a floor above zero made them unsayable:
 * the stepper's minus stopped at 20mg and cleared to "None", which is a
 * different statement. Water's is zero too; the Food log's water card, which
 * steps what was *drunk*, keeps its own floor (`WATER_MIN_ML`) so nothing
 * there changed.
 *
 * The `default` here is what a stepper opens on when somebody first adds a
 * target for that nutrient. It is **not** a target: nothing is stored until
 * they accept it, and the map's own default is empty.
 *
 * **The three minerals open on the Daily Value the packet itself prints, and
 * that is the whole reason they are allowed to open on anything.** #2430 asked
 * whether targets here would mean shipping a table of RDAs, which vary by age,
 * sex and medical condition and would be the app having an opinion about a
 * body — the line `docs/arch/health-data.md` draws around every metric it
 * rules out. 1300mg of calcium, 18mg of iron and 4700mg of potassium are not
 * that: they are the reference figures US label law fixes the %DV column
 * against, so they are already printed on the food somebody is holding. The
 * app is repeating the packet rather than assessing the person, which is the
 * same thing every other figure in this table does (2300mg of sodium is the
 * label's number too). Nothing here is recommended, nothing is stored unasked,
 * and a person who needs a different figure types one.
 */
export const NUTRITION_TARGET_RANGES: Record<
  NutrientKey,
  { min: number; max: number; step: number; default: number }
> = {
  calorieKcal: { min: 0, max: 6000, step: 50, default: 2000 },
  fatG: { min: 0, max: 300, step: 5, default: 70 },
  satFatG: { min: 0, max: 100, step: 1, default: 20 },
  // No Daily Value exists for trans fat, so this is only where the stepper
  // opens, and `NO_DAILY_VALUE` keeps it out of "Set to U.S. Daily Value".
  transFatG: { min: 0, max: 20, step: 1, default: 2 },
  cholesterolMg: { min: 0, max: 1000, step: 25, default: 300 },
  carbsG: { min: 0, max: 800, step: 10, default: 250 },
  fiberG: { min: 0, max: 100, step: 1, default: 30 },
  sugarG: { min: 0, max: 300, step: 5, default: 50 },
  addedSugarG: { min: 0, max: 200, step: 5, default: 50 },
  proteinG: { min: 0, max: 400, step: 5, default: 60 },
  sodiumMg: { min: 0, max: 6000, step: 100, default: 2300 },
  calciumMg: { min: 0, max: 3000, step: 50, default: 1300 },
  ironMg: { min: 0, max: 60, step: 1, default: 18 },
  potassiumMg: { min: 0, max: 8000, step: 100, default: 4700 },
  caffeineMg: { min: 0, max: 1000, step: 10, default: 400 },
  waterMl: { min: 0, max: 6000, step: 250, default: 2000 },
};

/**
 * The nutrients a label prints with no %DV, so "Use Daily Value" has no figure to
 * offer and their `default` above is only where a stepper opens.
 */
export const NO_DAILY_VALUE: ReadonlySet<NutrientKey> = new Set<NutrientKey>(['transFatG']);

/** What a person has set, keyed by nutrient. Empty is the shipping state. */
export type NutritionTargets = Partial<Record<NutrientKey, number>>;

/**
 * The targets a stored blob actually carries, dropping anything unreadable.
 *
 * Unknown keys go, because this build has no unit for a nutrient it does not
 * know, and a negative figure goes with the malformed. Zero stays: it is a
 * target somebody chose ("no caffeine"), not an absence.
 */
export function parseNutritionTargets(raw: string | null | undefined): NutritionTargets {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const targets: NutritionTargets = {};
    for (const key of NUTRIENT_KEYS) {
      const value = parsed[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) targets[key] = value;
    }
    return targets;
  } catch {
    return {};
  }
}

export function serializeNutritionTargets(targets: NutritionTargets): string {
  return JSON.stringify(targets);
}

/** The nutrients with a target set, in the order a label prints them. */
export function targetedNutrients(targets: NutritionTargets): NutrientKey[] {
  return NUTRIENT_KEYS.filter(key => targets[key] !== undefined);
}

/**
 * "1,840 of 2,000 cal", or null when there is nothing to say.
 *
 * **"0 of 2,000" for a nutrient nothing logged today stated, as long as a
 * target is set.** A target is something the person is aiming at for the
 * whole day, and a day with no entries yet hasn't missed it — it just hasn't
 * been recorded against yet, same as a fresh morning's step count. Showing
 * the target line lets it answer "what am I aiming for today" before
 * anything is logged, rather than only once something is.
 *
 * Null for a nutrient with no target, since the caller is asking how the
 * day reads against one and there isn't one. The total on its own is the day
 * view's own business.
 */
export function describeAgainstTarget(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
): string | null {
  const target = targets[key];
  if (target === undefined) return null;
  const unit = NUTRIENT_LABEL[key].unit;
  const suffix = unit === 'cal' ? ' cal' : unit;
  return `${round(total ?? 0).toLocaleString()} of ${target.toLocaleString()}${suffix}`;
}

/**
 * How far through a target the day is, 0 to 1, for a caller drawing a bar.
 *
 * Clamped at 1, the same call `healthTargetProgress` makes: a bar past its own
 * end is not more information, and here it would be the one place a reading
 * could look like a failure. Zero when nothing is known, because a bar has to
 * draw something and empty is the honest picture of a day nobody has logged.
 *
 * **Whether being over a target is good or bad is not this module's business
 * and is not knowable.** Somebody tracking protein wants to reach it and
 * somebody tracking sodium wants to stay under, and the app is not told which.
 * `targetStatus` below reads distance from the target, never a direction, for
 * exactly that reason.
 */
export function targetProgress(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
): number {
  const target = targets[key];
  if (target === undefined || total === undefined) return 0;
  // A target of zero is met by an empty day and passed by any logged amount.
  if (target <= 0) return total > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, total / target));
}

/**
 * How far above or below the target the day landed. `'met'` covers a band
 * around the target rather than the exact figure, because a target is typed
 * in as a round number and a day that lands at 1,980 of a 2,000 target hasn't
 * missed it in any sense a person would recognize.
 *
 * **Direction-agnostic on purpose, same as `targetProgress`.** This says only
 * how far the total sits from the number the person chose, never whether
 * that's good — the app still doesn't know if reaching this particular
 * nutrient is the point (protein) or staying under it is (sodium), so
 * `'under'` and `'over'` are not colored as better or worse than each other.
 * `'met'` marks that the day landed on the number chosen, not that the
 * number itself was the right one to choose. A nutrient the person marked
 * Stay under has told the app its direction, so it reads through
 * `limitStatus` instead.
 */
export type TargetStatus = 'under' | 'met' | 'over';

/** The band around a target, as a fraction of it, that still counts as met. */
export const TARGET_MET_TOLERANCE = 0.1;

export function targetStatus(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
): TargetStatus {
  const target = targets[key];
  if (target === undefined) return 'under';
  if (target <= 0) return (total ?? 0) > 0 ? 'over' : 'met';
  const ratio = (total ?? 0) / target;
  if (ratio < 1 - TARGET_MET_TOLERANCE) return 'under';
  if (ratio > 1 + TARGET_MET_TOLERANCE) return 'over';
  return 'met';
}

function round(amount: number): number {
  return Math.round(amount * 10) / 10;
}

// ==== Limits ====

/**
 * The nutrients whose target the person marked **Stay under**, in label order.
 *
 * **A set the person builds, empty by default.** It is what makes a target a
 * ceiling: `describeLimit` says what's left, the bar turns red past it, Today
 * can show it, and the limit warning can fire on it. A nutrient listed here
 * without a target means nothing until a target is set, and stays listed so
 * clearing and re-setting a target doesn't silently forget the choice.
 */
export type NutritionLimits = NutrientKey[];

/** Reads the stored set. Unknown keys and water (never something to stay under) drop. */
export function parseNutritionLimits(raw: string | null | undefined): NutritionLimits {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const wanted = new Set(parsed);
    return NUTRIENT_KEYS.filter(key => key !== 'waterMl' && wanted.has(key));
  } catch {
    return [];
  }
}

export function serializeNutritionLimits(limits: NutritionLimits): string {
  return JSON.stringify(limits);
}

/** True when `key` is a limit with a target to be a limit against. */
export function isActiveLimit(
  key: NutrientKey,
  targets: NutritionTargets,
  limits: readonly NutrientKey[],
): boolean {
  return targets[key] !== undefined && limits.includes(key);
}

/** The limits that have a target set, in label order. */
export function activeLimits(targets: NutritionTargets, limits: readonly NutrientKey[]): NutrientKey[] {
  return NUTRIENT_KEYS.filter(key => isActiveLimit(key, targets, limits));
}

/**
 * Where a day sits against a limit. `'near'` starts at `warnShare` of it (the
 * limit warning's own setting, `DEFAULT_LIMIT_WARN_PERCENT` by default), so the
 * Food log, Today and the warning task all agree on when a day is close.
 *
 * **No tolerance band, unlike `targetStatus`.** A goal landing 5% short has
 * met it in any sense a person recognizes; a limit 5% over has been passed,
 * and calling 16.8 of 16 g "met" is the exact misreading a limit exists to stop.
 */
export type LimitStatus = 'within' | 'near' | 'over';

/** The share of a limit at which a day counts as close to it, as a percent. */
export const DEFAULT_LIMIT_WARN_PERCENT = 75;

export function limitStatus(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
  warnPercent: number = DEFAULT_LIMIT_WARN_PERCENT,
): LimitStatus {
  const target = targets[key];
  const amount = total ?? 0;
  if (target === undefined) return 'within';
  if (amount > target) return 'over';
  if (target <= 0) return 'within';
  return amount >= target * (warnPercent / 100) ? 'near' : 'within';
}

/**
 * "4 g left", "At the limit" or "3 g over", for a nutrient with a target.
 * Null with no target. Rounded the way `describeAgainstTarget` rounds, so the
 * two lines on one row can't disagree by a tenth.
 */
export function describeLimit(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
): string | null {
  const target = targets[key];
  if (target === undefined) return null;
  const unit = NUTRIENT_LABEL[key].unit;
  const suffix = unit === 'cal' ? ' cal' : unit;
  const diff = round(target - round(total ?? 0));
  if (diff === 0) return 'At the limit';
  return diff > 0
    ? `${diff.toLocaleString()}${suffix} left`
    : `${(-diff).toLocaleString()}${suffix} over`;
}

/** One limit an entry about to be logged would move. See `limitImpact`. */
export interface LimitImpact {
  key: NutrientKey;
  /** The day's total once the entry is in. */
  after: number;
  target: number;
  /** Where the day sits once the entry is in. */
  status: LimitStatus;
  /** True when this entry is the one that takes the day past the limit. */
  crosses: boolean;
}

/**
 * What logging `amounts` would do to each limit it states, for a sheet to show
 * before the person confirms ("Puts you at 14 of 16 g saturated fat").
 *
 * Only the limits the entry actually states: an entry with no saturated fat
 * figure moves nothing anyone knows about, and reporting the day's existing
 * total against it would read as this food's doing. `dayTotals` is the day the
 * entry is going to, without it.
 */
export function limitImpact(
  amounts: Partial<Record<NutrientKey, number>>,
  dayTotals: Partial<Record<NutrientKey, number>>,
  targets: NutritionTargets,
  limits: readonly NutrientKey[],
  warnPercent: number = DEFAULT_LIMIT_WARN_PERCENT,
): LimitImpact[] {
  const impacts: LimitImpact[] = [];
  for (const key of activeLimits(targets, limits)) {
    const adds = amounts[key];
    if (adds === undefined || adds <= 0) continue;
    const target = targets[key]!;
    const before = dayTotals[key] ?? 0;
    const after = before + adds;
    impacts.push({
      key,
      after,
      target,
      status: limitStatus(key, after, targets, warnPercent),
      crosses: before <= target && after > target,
    });
  }
  return impacts;
}

/**
 * "Puts you at 14 of 16 g saturated fat" (or "…, 2 g over"), one line per
 * impact. Plain statements of the arithmetic, the way the rest of the log
 * talks; the colour the caller gives an `'over'` line is the warning.
 */
export function describeLimitImpact(impact: LimitImpact): string {
  const { key, after, target } = impact;
  const unit = NUTRIENT_LABEL[key].unit;
  const suffix = unit === 'cal' ? ' cal' : unit;
  const name = NUTRIENT_LABEL[key].label.toLowerCase();
  const base = `Puts you at ${round(after).toLocaleString()} of ${target.toLocaleString()}${suffix} ${name}`;
  if (impact.status !== 'over') return base;
  return `${base}, ${round(after - target).toLocaleString()}${suffix} over`;
}

/**
 * What the Food log's totals card shows before "Show every nutrient" is
 * tapped, on an install that has never chosen otherwise — the same pair the
 * card always showed before this was configurable.
 */
export const DEFAULT_FOOD_LOG_PINNED_NUTRIENTS: NutrientKey[] = ['calorieKcal', 'proteinG'];

/**
 * The pinned-nutrient set a stored blob actually carries.
 *
 * **Falls back to the default only when nothing was ever stored.** A stored
 * empty array is a real choice ("show nothing above the fold") and stays
 * empty — `JSON.stringify([])` is the truthy string `"[]"`, so it's never
 * confused with the unset `null`/`undefined` a fresh install reads. Water is
 * dropped the same way `statedKeys` drops it in the Food log itself: it has
 * its own card and reads twice otherwise.
 */
export function parseFoodLogPinnedNutrients(raw: string | null | undefined): NutrientKey[] {
  if (!raw) return [...DEFAULT_FOOD_LOG_PINNED_NUTRIENTS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_FOOD_LOG_PINNED_NUTRIENTS];
    return parsed.filter(
      (key): key is NutrientKey => NUTRIENT_KEYS.includes(key as NutrientKey) && key !== 'waterMl',
    );
  } catch {
    return [...DEFAULT_FOOD_LOG_PINNED_NUTRIENTS];
  }
}

export function serializeFoodLogPinnedNutrients(keys: NutrientKey[]): string {
  return JSON.stringify(keys);
}

/**
 * Every nutrient a logged meal writes to Health, on an install that has never
 * chosen otherwise — every one HealthKit has a type for, matching what
 * `healthFoodSync.ts` always wrote before which ones to write became a choice.
 */
export const DEFAULT_HEALTH_WRITE_NUTRIENTS: NutrientKey[] = [...HEALTH_WRITABLE_NUTRIENTS];

/**
 * The Health write-selection a stored blob actually carries.
 *
 * Same shape as `parseFoodLogPinnedNutrients` above and for the same reason:
 * falls back to the default (here, every nutrient) only when the setting was
 * never written at all, so an install that predates this choice keeps writing
 * everything it always did. A stored empty array is a real, distinct choice —
 * "write nothing a meal states" — and stays empty.
 */
export function parseHealthWriteNutrients(raw: string | null | undefined): NutrientKey[] {
  if (!raw) return [...DEFAULT_HEALTH_WRITE_NUTRIENTS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_HEALTH_WRITE_NUTRIENTS];
    return parsed.filter((key): key is NutrientKey => HEALTH_WRITABLE_NUTRIENTS.includes(key as NutrientKey));
  } catch {
    return [...DEFAULT_HEALTH_WRITE_NUTRIENTS];
  }
}

export function serializeHealthWriteNutrients(keys: NutrientKey[]): string {
  return JSON.stringify(keys);
}
