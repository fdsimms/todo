import type { NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { figure, shortName } from './limitWarningTasks';
import { goalNutrientKeys, targetStatus, type NutritionTargets } from './nutritionTargets';

/**
 * An "Aim for" task per nutrient goal: "Aim for 120g protein · 80g so far".
 *
 * The sibling of `limitWarningTasks.ts` for the targets that are a figure to
 * reach rather than a ceiling. **A one-off task for today, not a habit**: it is
 * keyed by the nutrient and the day (`protein|2026-10-13`), so each day gets its
 * own and one from a day that has gone is dropped rather than carried forward.
 * Nobody declines a day that merely ended.
 *
 * **The app checks it off when the day reaches the goal**, quietly: a
 * `neutral` completion, so no coins and no streak, since nobody tapped
 * anything. It uses `targetStatus`, so "reached" is the same band the Food log
 * calls met (within 10% below counts, and anything above does too). It
 * deliberately says nothing about having gone past a goal: the app is not told
 * whether more is better, which is the rule `nutritionTargets.ts` opens with.
 * A total that drops back under after it was checked off (an entry deleted)
 * leaves it checked.
 *
 * **A goal of zero gets no task.** "No added sugar" as a plain target is met by
 * an empty day, so its task would complete the moment it was written. That is
 * a limit, and Stay under is the way to say it.
 *
 * Deleting one stops it for that nutrient (`goalTargetDeclined`), and so does
 * the per-nutrient switch in Settings, which writes the same list. Pure: the
 * store pass does the writing.
 */

/** Where today stands against one goal, for the task's title and notes. */
export interface GoalReading {
  key: NutrientKey;
  total: number;
  target: number;
  reached: boolean;
}

export const GOAL_TARGET_LINK = 'dundundun://foodlog';

export const GOAL_TARGET_NOTES =
  'From the food log, against the goal set in Nutrition. It is checked off when the day reaches the goal.';

/** Each goal against today's totals, in label order. Zero goals are left out. */
export function goalReadings(
  totals: Partial<Record<NutrientKey, number>>,
  targets: NutritionTargets,
  limits: readonly NutrientKey[],
): GoalReading[] {
  return goalNutrientKeys(targets, limits)
    .filter(key => targets[key]! > 0)
    .map(key => {
      const total = totals[key] ?? 0;
      return { key, total, target: targets[key]!, reached: targetStatus(key, total, targets) !== 'under' };
    });
}

/** The source id of one nutrient's task for one day. */
export function goalTargetSourceId(key: NutrientKey, dayKey: string): string {
  return `${key}|${dayKey}`;
}

function parts(sourceId: string | null | undefined): { key: NutrientKey; dayKey: string } | null {
  if (!sourceId) return null;
  const [key, dayKey] = sourceId.split('|');
  if (!dayKey || !(NUTRIENT_KEYS as readonly string[]).includes(key)) return null;
  return { key: key as NutrientKey, dayKey };
}

/** The nutrient a task's source id names, or null for one this build can't read. */
export function goalTargetKeyOf(sourceId: string | null | undefined): NutrientKey | null {
  return parts(sourceId)?.key ?? null;
}

/** The day a task's source id was written for, or null for one this build can't read. */
export function goalTargetDayOf(sourceId: string | null | undefined): string | null {
  return parts(sourceId)?.dayKey ?? null;
}

/** "Aim for 120g protein", then " · 80g so far" once anything logged today states it. */
export function goalTargetTitle(reading: GoalReading): string {
  const base = `Aim for ${figure(reading.key, reading.target)} ${shortName(reading.key)}`;
  return reading.total > 0 ? `${base} · ${figure(reading.key, reading.total)} so far` : base;
}

/** "Today: 80 of 120g, 40g to go.", then where the figure comes from. */
export function goalTargetNotes(reading: GoalReading): string {
  const rounded = Math.round(reading.total * 10) / 10;
  const left = Math.round((reading.target - reading.total) * 10) / 10;
  const today = `Today: ${rounded.toLocaleString('en-US')} of ${figure(reading.key, reading.target)}${
    left > 0 ? `, ${figure(reading.key, left)} to go` : ', reached'
  }.`;
  return `${today}\n\n${GOAL_TARGET_NOTES}`;
}
