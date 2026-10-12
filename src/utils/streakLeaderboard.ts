import type { Task } from '../types';
import { liveStreakCount } from './dateUtils';
import { baseCoinsFor } from './rewards';

/**
 * Which streaks the Stats leaderboard ranks, and in what order.
 *
 * Ranked by run length alone it was nine ties of "Drink water" and "Floss":
 * the habits nobody can miss, all started the same week. So a run is scored as
 * its length times what the task is worth, which is `baseCoinsFor` (the effort
 * bucket scaled by difficulty) rather than a second weighting, so the board and
 * the coin rules can't disagree about which task is the bigger one. A task with
 * no rating or estimate scores as an ordinary short task, as it does for coins.
 *
 * A trivial task is worth nothing under the coin rules and so is left off the
 * board entirely, which is how a habit that is too easy to count stays off it
 * without a separate switch. The streak shown on the row is still the run's
 * length in days; only the order uses the score.
 */
export const LEADERBOARD_SIZE = 10;

/** Length of the live run times the task's worth, or 0 when it isn't ranked. */
export function streakScore(task: Task, dayResetTime?: string): number {
  return liveStreakCount(task, dayResetTime) * baseCoinsFor(task);
}

/**
 * The top streaks, best first. Ties on score fall back to the longer run, then
 * the higher priority, then the title, so the order always has a reason and
 * doesn't change between renders.
 */
export function rankStreaks(
  tasks: readonly Task[],
  dayResetTime?: string,
  limit: number = LEADERBOARD_SIZE,
): Task[] {
  return tasks
    .filter(t => !t.parentId && !t.completed && t.recurrenceType !== 'none')
    .map(t => ({ t, score: streakScore(t, dayResetTime), run: liveStreakCount(t, dayResetTime) }))
    .filter(r => r.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.run - a.run ||
      b.t.priority - a.t.priority ||
      a.t.title.localeCompare(b.t.title),
    )
    .slice(0, limit)
    .map(r => r.t);
}
