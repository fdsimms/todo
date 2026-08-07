import type { Task } from '../types';
import { isRealCompletion } from './missed';

export interface TimeTrackedSummary {
  /** Sum of actualMinutes across every completed, timed top-level task. */
  totalMinutes: number;
  /** Number of tasks that contributed to totalMinutes. */
  trackedCount: number;
}

/** Total measured time across completed tasks — powers the Stats "TIME TRACKED" section. */
export function timeTrackedSummary(tasks: readonly Task[]): TimeTrackedSummary {
  let totalMinutes = 0;
  let trackedCount = 0;
  for (const t of tasks) {
    if (t.parentId || t.actualMinutes == null) continue;
    totalMinutes += t.actualMinutes;
    trackedCount++;
  }
  return { totalMinutes, trackedCount };
}

export interface OnTimeSummary {
  onTime: number;
  total: number;
  /** 0..1; 0 when there are no deadlined completions to judge. */
  rate: number;
}

/** Of completed tasks that had a deadline, how many were completed by it. */
export function onTimeSummary(tasks: readonly Task[]): OnTimeSummary {
  let onTime = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.parentId || !isRealCompletion(t) || !t.completedAt || !t.deadline) continue;
    total++;
    if (t.completedAt <= t.deadline) onTime++;
  }
  return { onTime, total, rate: total > 0 ? onTime / total : 0 };
}

export interface EstimateAccuracy {
  /** Number of comparisons that went into the average. */
  count: number;
  /**
   * Average of actual/estimate across comparisons — 1 means estimates were
   * spot on, above 1 means tasks ran long, below 1 means they ran short.
   */
  averageRatio: number;
}

/**
 * How well estimates predicted actual time. Compares *this* occurrence's
 * actualMinutes against the *previous* occurrence's estimatedMinutes (one hop
 * via previousOccurrenceId), not the occurrence's own estimate: since
 * applyMeasuredTime backfills a missing estimate from the measurement itself,
 * a same-occurrence comparison is zero by construction whenever the user
 * never typed an estimate. A task with no predecessor (a one-off, or the
 * first occurrence of a series) falls back to its own estimate, since that's
 * the only estimate available for it. Deliberately doesn't walk the
 * previousOccurrenceId chain past one hop — see groupRoster's single-pass
 * `superseded` Set in visibilityUtils.ts for why an unbounded walk back
 * through completion history is a trap here.
 */
export function estimateAccuracy(tasks: readonly Task[]): EstimateAccuracy {
  const byId = new Map(tasks.map(t => [t.id, t]));
  let sum = 0;
  let count = 0;
  for (const t of tasks) {
    if (t.parentId || !isRealCompletion(t) || t.actualMinutes == null) continue;
    const estimate = t.previousOccurrenceId
      ? byId.get(t.previousOccurrenceId)?.estimatedMinutes ?? null
      : t.estimatedMinutes;
    if (estimate == null || estimate <= 0) continue;
    sum += t.actualMinutes / estimate;
    count++;
  }
  return { count, averageRatio: count > 0 ? sum / count : 1 };
}
