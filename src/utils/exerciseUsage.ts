import type { WorkoutSet } from '../types';
import { countsForRecords } from './workoutRecords';

/** How far back "Most used" looks, so a lift dropped a year ago stops leading the list. */
export const MOST_USED_DAYS = 90;
/** An exercise needs this many workouts in that window to count as used, so one workout never makes everything in it "most used". */
export const MOST_USED_MIN_SESSIONS = 2;
export const MOST_USED_LIMIT = 6;

/**
 * The exercises the person does most, for the top of "Add exercise": ranked by
 * how many different workouts had a done, non-warm-up set of it in the last
 * `MOST_USED_DAYS`, ties to the one done most recently. A workout counts once
 * however many sets it has, so a 5x5 isn't five uses.
 */
export function mostUsedExerciseIds(
  sets: readonly WorkoutSet[],
  now: Date,
  limit: number = MOST_USED_LIMIT,
): string[] {
  const since = now.getTime() - MOST_USED_DAYS * 86_400_000;
  const stats = new Map<string, { sessions: Set<string>; last: number }>();
  for (const s of sets) {
    if (!countsForRecords(s)) continue;
    const at = new Date(s.completedAt as string).getTime();
    if (!(at >= since)) continue;
    const stat = stats.get(s.exerciseId) ?? { sessions: new Set<string>(), last: 0 };
    stat.sessions.add(s.sessionId);
    if (at > stat.last) stat.last = at;
    stats.set(s.exerciseId, stat);
  }
  return [...stats.entries()]
    .filter(([, v]) => v.sessions.size >= MOST_USED_MIN_SESSIONS)
    .sort((a, b) => b[1].sessions.size - a[1].sessions.size || b[1].last - a[1].last || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}
