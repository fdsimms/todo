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
 * A protected streak is an open repeating task that vacation mode is hiding and
 * that has a streak to lose. **"Hiding" is the caller's `hiddenForVacation`**,
 * which is `isHiddenForVacation` in both callers: a task's own `vacationPause`
 * or its category's hide-on-vacation. Checking the flag alone left a task
 * hidden through its category losing its streak at the end of every vacation.
 * It is passed in rather than imported because that reader reads the stores,
 * which is exactly what this module has to stay clear of. Callers run this
 * before switching the mode off, which is what the reader checks.
 *
 * Forgiving re-dates the streak to the start of today, so the gap the vacation
 * left reads as no gap at all. The count is untouched: nothing was done, and
 * nothing is credited.
 */
export function isVacationProtectedStreak(task: Task, hiddenForVacation: (task: Task) => boolean): boolean {
  return hiddenForVacation(task) && task.recurrenceType !== 'none' && !task.completed && task.streakCount > 0;
}

/** The rows forgiving writes: each protected streak with `streakDate` moved to `todayStartIso`. */
export function forgiveVacationStreaks(
  tasks: readonly Task[],
  todayStartIso: string,
  hiddenForVacation: (task: Task) => boolean,
): Task[] {
  return tasks.filter(t => isVacationProtectedStreak(t, hiddenForVacation)).map(t => ({ ...t, streakDate: todayStartIso }));
}
