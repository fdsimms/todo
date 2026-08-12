import type { Task } from '../types';
import { isRealCompletion } from './missed';

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
