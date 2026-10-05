import type { Task } from '../types';

/**
 * Which streaks vacation mode protects, and what forgiving them writes.
 *
 * Lifted out of `useTaskStore.forgivVacationStreaks` the way `taskCompletion.ts`
 * was lifted out of `completeTask`, and for the same reason: the store imports
 * `useFocusStore`, which imports `expo-notifications`, so the MCP server
 * cannot load it, and every path that turns vacation mode off has to forgive
 * first (the Settings toggle, the project pull sheet, the expiry pass) or a
 * paused daily habit reads as broken the moment the pause lifts. The store
 * calls this; the server calls this; the rule lives in one place.
 *
 * A protected streak is a repeating task marked for vacation pause that is
 * still open and has a streak to lose. Forgiving it re-dates the streak to the
 * start of today, so the gap the vacation left reads as no gap at all. The
 * count is untouched: nothing was done, and nothing is credited.
 */
export function isVacationProtectedStreak(task: Task): boolean {
  return task.vacationPause && task.recurrenceType !== 'none' && !task.completed && task.streakCount > 0;
}

/** The rows forgiving writes: each protected streak with `streakDate` moved to `todayStartIso`. */
export function forgiveVacationStreaks(tasks: readonly Task[], todayStartIso: string): Task[] {
  return tasks.filter(isVacationProtectedStreak).map(t => ({ ...t, streakDate: todayStartIso }));
}
