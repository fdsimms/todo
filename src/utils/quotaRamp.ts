/**
 * A daily or weekly target that raises itself: "add 1 after every 7 days I hit it,
 * up to 20".
 *
 * Pure, and the only place the rule lives. `completeTask` calls `advanceQuotaRamp`
 * when it spawns the next occurrence; the editor calls `canRampQuota` to decide
 * whether to offer the option; `describeQuotaRamp` words it.
 *
 * ## The ramp moves `targetCount`, nothing else reads it
 *
 * `targetCount` stays the one stored number every reader already uses (pace,
 * progress, completion, Stats). The ramp is only a writer of it, at the moment
 * an occurrence closes. That is why there is no "start" to store: the count the
 * user typed is the starting level, and editing it mid-ramp just moves the level
 * the ramp climbs from.
 *
 * ## It steps only after an occurrence that met the target
 *
 * `quotaRampHits` counts occurrences in a row of the task's own period (days for
 * a daily target, weeks for a weekly one) that were completed with the target
 * met. Reaching `quotaRampEvery` adds `quotaRampStep` and starts the count over.
 * A missed occurrence, or a shortfall closed by `rolloverQuotas`, changes
 * nothing: no step, and no reset either. Resetting would punish a slip twice
 * (the streak already breaks), and a ramp that waits is the point of asking for
 * one that only moves after a hit.
 *
 * ## Which targets can ramp
 *
 * Only the plain kind. An interval target derives its count from a span, a
 * rotation from its member list, a water-linked one from the food log's goal,
 * and `allowOvershoot` rides the day out in its own sweep. Each of those already
 * has a writer for `targetCount`; a second one would fight it. The editor
 * withholds the option for them and `advanceQuotaRamp` refuses them anyway.
 */

import type { Task } from '../types';

/** The same ceiling the target stepper enforces; see `MAX_TARGET_COUNT`. */
export const QUOTA_RAMP_MAX_TARGET = 99;
/** The largest step or cadence the editor offers. */
export const QUOTA_RAMP_MAX_STEP = 20;
export const QUOTA_RAMP_MAX_EVERY = 60;

type RampInput = Pick<Task, 'targetCount'>
  & Partial<Pick<Task,
    | 'quotaIntervalMinutes' | 'rotationItems' | 'rotationEnabled' | 'followWaterTarget'
    | 'allowOvershoot' | 'recurrenceType'
    | 'quotaRampStep' | 'quotaRampEvery' | 'quotaRampGoal' | 'quotaRampHits'
  >>;

/** Whether this target is the kind a ramp can drive. */
export function canRampQuota(task: RampInput): boolean {
  if (task.targetCount == null) return false;
  if (task.quotaIntervalMinutes != null) return false;
  if (task.followWaterTarget) return false;
  if (task.allowOvershoot) return false;
  if (task.rotationEnabled || (task.rotationItems?.length ?? 0) > 0) return false;
  // A target with no repeat has no next occurrence to carry the new count.
  if (task.recurrenceType === 'none') return false;
  return true;
}

/** True when a ramp is configured, whether or not it can currently advance. */
export function hasQuotaRamp(task: Pick<Task, 'quotaRampStep'>): boolean {
  return typeof task.quotaRampStep === 'number' && task.quotaRampStep > 0;
}

/** Whether the count has already reached the goal (or the app's ceiling). */
export function quotaRampAtGoal(task: RampInput): boolean {
  if (task.targetCount == null) return false;
  const ceiling = Math.min(task.quotaRampGoal ?? QUOTA_RAMP_MAX_TARGET, QUOTA_RAMP_MAX_TARGET);
  return task.targetCount >= ceiling;
}

export interface QuotaRampResult {
  targetCount: number | null;
  quotaRampHits: number;
}

/**
 * What the next occurrence carries, given how the one just closed went.
 *
 * `hit` is true only for an occurrence completed with its target met. Anything
 * else returns the inputs unchanged.
 */
export function advanceQuotaRamp(task: RampInput, hit: boolean): QuotaRampResult {
  const unchanged: QuotaRampResult = {
    targetCount: task.targetCount,
    quotaRampHits: task.quotaRampHits ?? 0,
  };
  if (!hit || !hasQuotaRamp(task) || !canRampQuota(task)) return unchanged;
  // At the goal there is nothing to count toward; keep the count at zero so
  // raising the goal later starts a fresh run of hits rather than stepping at once.
  if (quotaRampAtGoal(task)) return { targetCount: task.targetCount, quotaRampHits: 0 };

  const every = Math.max(1, task.quotaRampEvery ?? 1);
  const hits = (task.quotaRampHits ?? 0) + 1;
  if (hits < every) return { targetCount: task.targetCount, quotaRampHits: hits };

  const ceiling = Math.min(task.quotaRampGoal ?? QUOTA_RAMP_MAX_TARGET, QUOTA_RAMP_MAX_TARGET);
  return {
    targetCount: Math.min(task.targetCount! + task.quotaRampStep!, ceiling),
    quotaRampHits: 0,
  };
}

/**
 * One line for the editor row and the row's summary:
 * "Adds 1 after every 7 days you hit it, up to 20".
 * Null when no ramp is set.
 */
export function describeQuotaRamp(
  task: Pick<Task, 'quotaRampStep'> & Partial<Pick<Task, 'quotaRampEvery' | 'quotaRampGoal' | 'quotaPeriod'>>,
): string | null {
  if (!hasQuotaRamp(task)) return null;
  const every = Math.max(1, task.quotaRampEvery ?? 1);
  const unit = task.quotaPeriod === 'week' ? 'week' : 'day';
  const span = every === 1 ? `${unit} you hit it` : `${every} ${unit}s you hit it`;
  const goal = task.quotaRampGoal != null ? `, up to ${task.quotaRampGoal}` : '';
  return `Adds ${task.quotaRampStep} after every ${span}${goal}`;
}
