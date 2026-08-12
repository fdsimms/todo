import type { Task } from '../types';
import { isRealCompletion } from './missed';

export interface TimeTrackedSummary {
  /** Sum of measured time across every completed, timed top-level task. */
  totalMinutes: number;
  /** Number of tasks that contributed to totalMinutes. */
  trackedCount: number;
}

/**
 * Total measured time across completed tasks — powers the Stats "TIME TRACKED"
 * section.
 *
 * Reads `actualMinutes` rather than `estimatedMinutes` even though timing a
 * task now sets both to the same number: only a *measured* task has an
 * actual, so this stays a sum of time really spent rather than a sum of
 * guesses. That's the field's whole remaining job — see applyMeasuredTime.
 */
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
