import type { Task } from '../types';

/**
 * Which projects sit behind Face ID, and which tasks that hides.
 *
 * The lock is a display rule, not a visibility one. A locked project's tasks
 * are still due, still repeat, still earn streaks and penalties and still fire
 * their reminders, so none of this goes through `isWithheld` (which stands a
 * task down, and would stop all of that). It only decides whether a list may
 * show the row.
 */

export const LOCKED_PROJECTS_SETTING = 'lockedProjectIds';

/** The stored value is a JSON array of ids; anything else reads as none. */
export function parseLockedProjectIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  } catch {
    return [];
  }
}

/** True when `projectId` is locked and the session hasn't been unlocked. */
export function isProjectLockedAway(
  projectId: string | null | undefined,
  lockedIds: readonly string[],
  unlocked: boolean,
): boolean {
  if (unlocked || !projectId) return false;
  return lockedIds.includes(projectId);
}

/** True when a task's own project (or its parent task's project) is locked away. */
export function isTaskLockedAway(
  task: Pick<Task, 'projectId'>,
  lockedIds: readonly string[],
  unlocked: boolean,
): boolean {
  return isProjectLockedAway(task.projectId, lockedIds, unlocked);
}

/** How many of `tasks` are hidden by the lock, for the "N tasks in locked projects" row. */
export function lockedAwayCount(
  tasks: readonly Pick<Task, 'projectId'>[],
  lockedIds: readonly string[],
  unlocked: boolean,
): number {
  if (unlocked || lockedIds.length === 0) return 0;
  let n = 0;
  for (const t of tasks) if (isProjectLockedAway(t.projectId, lockedIds, false)) n += 1;
  return n;
}

/** Add or remove one id, keeping the list free of duplicates. */
export function withProjectLocked(lockedIds: readonly string[], projectId: string, locked: boolean): string[] {
  const rest = lockedIds.filter(id => id !== projectId);
  return locked ? [...rest, projectId] : rest;
}

let lockedIdsSource: () => readonly string[] = () => [];

/**
 * How code that can't import `useProjectLockStore` (it reaches the database,
 * and `notifications.ts` is loaded by suites that mock none of it) reads the
 * locked ids. The store registers itself on load, as `blockerRegistry` does.
 */
export function registerLockedProjectSource(source: () => readonly string[]): void {
  lockedIdsSource = source;
}

/** Locked at all, whatever the session says. For anything outside the app. */
export function isProjectLockedAtAll(projectId: string | null | undefined): boolean {
  return !!projectId && lockedIdsSource().includes(projectId);
}
