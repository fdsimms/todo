import { useMemo } from 'react';
import { useProjectLockStore } from '../store/useProjectLockStore';
import { isProjectLockedAway } from '../utils/projectLock';
import type { Task } from '../types';

/**
 * `tasks` with the ones in a locked project removed, until the session is
 * unlocked. For a screen that reads the whole task array rather than a store
 * list selector (those filter inside `useTaskStore`). Returns the same array
 * when nothing is hidden, so a memo keyed on it doesn't recompute.
 */
export function useWithoutLockedTasks(tasks: Task[]): Task[] {
  const lockedIds = useProjectLockStore(s => s.lockedIds);
  const unlocked = useProjectLockStore(s => s.unlocked);
  return useMemo(
    () => (unlocked || lockedIds.length === 0
      ? tasks
      : tasks.filter(t => !isProjectLockedAway(t.projectId, lockedIds, false))),
    [tasks, lockedIds, unlocked],
  );
}
