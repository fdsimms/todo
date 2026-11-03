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

/** A local date's `YYYY-MM-DD`, here rather than imported so this module stays clear of the stores. */
function localKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The rows forgiving a project's pause writes: each open repeating task in a
 * project whose pause has ended, with a streak to lose, gets its streak dated
 * to the day before the pause lifted. `endedOn` maps a project id to the day
 * key its pause ended on (`pausedUntil`, or today for one ended early).
 *
 * Vacation's rule, for a project's pause: a paused daily habit read as broken
 * the morning the pause lifted, since nothing it held had been done. Dated to
 * the day before the pause ended rather than to today, so the pause's gap is
 * forgiven and nothing after it is: a habit left undone for a week after the
 * pause still lapses, however late this runs. That also makes it safe to run on
 * every pass: a forgiven row already sits on that day, and a row completed
 * since sits later. Like vacation's, it can revive a streak that had already
 * lapsed before the pause began, since nothing records when a pause started.
 */
export function forgivePausedProjectStreaks(tasks: readonly Task[], endedOn: ReadonlyMap<string, string>): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (!t.projectId || t.completed || t.recurrenceType === 'none' || t.streakCount <= 0 || !t.streakDate) continue;
    const end = endedOn.get(t.projectId);
    if (!end) continue;
    const [y, m, d] = end.split('-').map(Number);
    const dayBefore = new Date(y, m - 1, d - 1, 12);
    if (localKey(new Date(t.streakDate)) >= localKey(dayBefore)) continue;
    out.push({ ...t, streakDate: dayBefore.toISOString() });
  }
  return out;
}

