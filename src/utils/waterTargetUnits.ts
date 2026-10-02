import type { Task } from '../types';
import { MAX_TARGET_COUNT, MIN_TARGET_COUNT } from './taskKinds';
import { effectiveWaterTargetMl, type WaterExerciseBoost } from './waterExerciseBoost';

/**
 * How many units a daily water task should be counting toward today, when it
 * follows the food log's water target (`Task.followWaterTarget`).
 *
 * **The count is derived, never typed.** The task's own `targetCount` is the
 * food log's target (the one set on the targets sheet, raised by the exercise
 * boost when today qualifies) divided by the amount one unit logs
 * (`logHealthAmount`), rounded up so the last partial glass is still owed.
 * `syncWaterQuotaTasks` writes the result onto the row, so everything that reads
 * a quota (pace, progress, completion) keeps reading `targetCount` and needs no
 * second path.
 *
 * **Null means "leave the count where it is", and it is the answer to every case
 * with nothing to compute from**: the toggle is off, the task isn't a daily
 * water log, no water target is set, or the result isn't a valid quota (below
 * `MIN_TARGET_COUNT`, where the task would stop being a target at all). It is
 * deliberately not a fall back to some default count.
 *
 * **A reading that hasn't arrived is not "no exercise".** `exerciseReadToday` is
 * whether Health has handed back a reading for the logical today. While it
 * hasn't, and a boost is configured, the boosted count a yesterday's occurrence
 * carried over is kept rather than recomputed against the base target: a
 * background pass with no Health snapshot would otherwise shrink the target and
 * complete a task that was nowhere near done. Once a reading is in, a day with
 * no recorded exercise is simply the base target, the same answer
 * `effectiveWaterTargetMl` gives.
 */
export function followedWaterTargetCount(
  task: Pick<Task, 'followWaterTarget' | 'logHealthMetric' | 'logHealthAmount' | 'targetCount' | 'quotaPeriod'>,
  baseTargetMl: number | undefined,
  exerciseMinutesToday: number | null,
  boost: WaterExerciseBoost | null,
  exerciseReadToday: boolean,
): number | null {
  if (!task.followWaterTarget) return null;
  if (task.targetCount === null || task.quotaPeriod !== 'day') return null;
  if (task.logHealthMetric !== 'waterMl') return null;
  if (!task.logHealthAmount || task.logHealthAmount <= 0) return null;
  if (baseTargetMl === undefined || baseTargetMl <= 0) return null;
  if (boost && !exerciseReadToday) return null;

  const targetMl = effectiveWaterTargetMl(baseTargetMl, exerciseMinutesToday, boost);
  if (targetMl === undefined) return null;
  const units = Math.ceil(targetMl / task.logHealthAmount);
  if (units < MIN_TARGET_COUNT) return null;
  return Math.min(MAX_TARGET_COUNT, units);
}
