import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  LOCKED_PROJECTS_SETTING,
  isProjectLockedAway,
  parseLockedProjectIds,
  registerLockedProjectSource,
  withProjectLocked,
} from '../utils/projectLock';

/**
 * Projects the person has put behind Face ID, and whether they have been
 * unlocked since the app was last left.
 *
 * Same shape as `useJournalLockStore`: `unlocked` is a session flag no launch
 * persists, and "hidden" is derived (`locked id && !unlocked`), never stored, so
 * locking a project can unlock the session in the same handler and no render
 * sees the lock on with the session unknown. Closed whenever the app stops
 * being active (`AppLockGate`). The ids live in the settings table but stay
 * off the wire (`syncTracking`), like the other locks, so one device can't
 * switch another's lock off.
 *
 * `revision` exists for the task store: its list selectors read this store at
 * call time, and a selector only re-runs when the task store changes.
 */
interface ProjectLockStore {
  lockedIds: string[];
  unlocked: boolean;
  revision: number;
  initialize: () => void;
  setProjectLocked: (projectId: string, locked: boolean) => void;
  lock: () => void;
  unlock: () => void;
}

export const useProjectLockStore = create<ProjectLockStore>((set, get) => ({
  lockedIds: [],
  unlocked: false,
  revision: 0,
  initialize() {
    set({ lockedIds: parseLockedProjectIds(dbGetSetting(LOCKED_PROJECTS_SETTING)) });
  },
  setProjectLocked(projectId, locked) {
    const lockedIds = withProjectLocked(get().lockedIds, projectId, locked);
    dbSetSetting(LOCKED_PROJECTS_SETTING, JSON.stringify(lockedIds));
    set(s => ({ lockedIds, revision: s.revision + 1 }));
  },
  lock() {
    if (!get().unlocked) return;
    set(s => ({ unlocked: false, revision: s.revision + 1 }));
  },
  unlock() {
    if (get().unlocked) return;
    set(s => ({ unlocked: true, revision: s.revision + 1 }));
  },
}));

/** For code outside the React tree. Screens use `useProjectAccess`. */
export function isProjectHidden(projectId: string | null | undefined): boolean {
  const { lockedIds, unlocked } = useProjectLockStore.getState();
  return isProjectLockedAway(projectId, lockedIds, unlocked);
}

/**
 * Locked at all, whatever the session says. For what appears outside the app
 * (the widget, a notification): those can't ask for Face ID, so a locked
 * project stays out of them even while the app itself is unlocked.
 */
export function isProjectLocked(projectId: string | null | undefined): boolean {
  return !!projectId && useProjectLockStore.getState().lockedIds.includes(projectId);
}

registerLockedProjectSource(() => useProjectLockStore.getState().lockedIds);
