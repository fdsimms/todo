import type { Task } from '../types';
import { scoreSubstring } from './fuzzySearch';

// High bar (near-exact title match, not just "shares some letters") — this
// only fires to catch "I'm re-adding the thing I archived months ago", not
// to flag every task that vaguely resembles an old one.
const MATCH_THRESHOLD = 70;

export function findArchivedMatch(archivedTasks: Task[], title: string): Task | null {
  const q = title.trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  let best: { task: Task; score: number } | null = null;
  for (const task of archivedTasks) {
    const t = task.title.trim();
    if (!t) continue;
    if (t.toLowerCase() === qLower) return task;
    const { score } = scoreSubstring(t, q);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { task, score };
    }
  }
  return best?.task ?? null;
}
