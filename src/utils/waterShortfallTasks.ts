import type { Task } from '../types';
import { getLogicalDayKey } from './dateUtils';
import { describeWater, WATER_STEP_ML, type WaterUnit } from './waterLog';

/**
 * `waterShortfall`: a one-off task for the water still owed after a daily water
 * task that follows the food log's target (`Task.followWaterTarget`) has
 * already been finished for the day.
 *
 * See `docs/arch/generated-tasks.md` for the mechanism it shares. What is worth
 * reading here is why it exists at all, since the followed task already takes
 * the target's rises on its own.
 *
 * **It covers the one case the followed task can't.** A task still open takes
 * its new count from the target (`syncWaterQuotaTasks`), so a workout at noon
 * simply makes the day's task longer. A task finished at 3 PM is a record of
 * something that was done, and reopening it would undo a streak and a successor
 * row for a rise nobody could have planned for. So the finished one stays
 * finished, and what is still owed becomes its own task.
 *
 * **The amount is measured against the food log, not against the finished
 * task.** Whatever got the day to where it is (the task, the stepper, a bottle
 * logged as food), the question is how far today's total sits below today's
 * target. Rounded up to the stepper's own step, so the title never names a
 * volume smaller than a press of it.
 *
 * **Day-keyed with no source row**, `weighIn`'s position: at most one a day,
 * and a completed or deleted one blocks the next that day (`blocksOnFinished`,
 * `waterShortfallDeclinedDayKey`).
 */

/** The title, naming the amount in the unit the person reads water in. */
export function waterShortfallTitle(owedMl: number, unit: WaterUnit): string {
  return `Drink ${describeWater(owedMl, unit)} more water`;
}

/** Why the task exists, in the plain terms the rest of the app uses. */
export const WATER_SHORTFALL_NOTES = 'Today’s water target went up after the daily water task was done.';

/**
 * How much water is still owed, in ml, or null when nothing is.
 *
 * Null on no target, and on a gap smaller than one step: a few millilitres
 * under is rounding, not a task.
 */
export function waterShortfallMl(targetMl: number | undefined, totalMl: number): number | null {
  if (targetMl === undefined || !(targetMl > 0)) return null;
  const owed = targetMl - totalMl;
  if (owed < WATER_STEP_ML) return null;
  return Math.ceil(owed / WATER_STEP_ML) * WATER_STEP_ML;
}

/**
 * Whether a daily water task that follows the target was completed on the
 * logical day `dayKey`. The only thing that makes a shortfall this generator's
 * business: with the daily task still open, the task itself carries the target.
 */
export function followedWaterTaskDoneOn(tasks: readonly Task[], dayKey: string): boolean {
  return tasks.some(t =>
    t.followWaterTarget &&
    t.completed &&
    !t.archived &&
    t.completedAt !== null &&
    t.logHealthMetric === 'waterMl' &&
    getLogicalDayKey(new Date(t.completedAt)) === dayKey,
  );
}
