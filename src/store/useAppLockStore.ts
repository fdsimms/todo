import { create } from 'zustand';
import { useSettingsStore } from './useSettingsStore';
import { shouldLockOnResume } from '../utils/appLock';

/**
 * Whether the app is currently showing its lock screen, and the AppState
 * bookkeeping that decides when it should.
 *
 * Nothing here is persisted — a launch always starts locked, which is the
 * point. It's a store rather than component state for one specific reason:
 * **`locked` is derived, not stored.**
 *
 *     locked = appLockEnabled && !unlocked
 *
 * so turning the setting on can mark the session unlocked in the same handler,
 * and there is never a render where the setting is on and the session is
 * unknown. An `isLocked` flag set from an effect would have exactly that
 * render, and it goes both ways: a frame of the task list at cold start, and a
 * frame of the lock screen the moment you enable the feature in Settings.
 *
 * Keeping it out of useSettingsStore keeps that store's one job (values that
 * live in the settings table) intact.
 */
interface AppLockStore {
  /** Authenticated for this foreground stretch. */
  unlocked: boolean;
  /**
   * When the app last stopped being active, or null while it's active. Reset on
   * every resume so a grace period is measured from the *last* departure.
   */
  leftAt: number | null;
  /**
   * An unlock prompt is on screen. iOS goes 'inactive' while it's up, and
   * without this that would be recorded as leaving the app — which, at a grace
   * of 0, re-locks the moment you finish authenticating, forever.
   */
  prompting: boolean;
  lock: () => void;
  unlock: () => void;
  setPrompting: (on: boolean) => void;
  /** The app stopped being active. Starts the grace clock. */
  noteInactive: (at: number) => void;
  /** The app came back. Re-locks if the grace period ran out while away. */
  noteActive: (now: number, graceSeconds: number) => void;
}

export const useAppLockStore = create<AppLockStore>((set, get) => ({
  unlocked: false,
  leftAt: null,
  prompting: false,

  lock() {
    set({ unlocked: false });
  },

  unlock() {
    set({ unlocked: true, leftAt: null });
  },

  setPrompting(on: boolean) {
    set({ prompting: on });
  },

  noteInactive(at: number) {
    // Only the first departure counts: iOS can emit inactive → background as
    // one leaving, and taking the later timestamp would shorten the grace
    // period by the gap between them.
    if (get().leftAt === null) set({ leftAt: at });
  },

  noteActive(now: number, graceSeconds: number) {
    const { leftAt } = get();
    const relock = shouldLockOnResume(leftAt, now, graceSeconds);
    set({ leftAt: null, ...(relock ? { unlocked: false } : null) });
  },
}));

/**
 * Whether the lock screen is up right now — for the handful of things that run
 * outside the React tree and would otherwise act on a locked app (shake to
 * undo being the one that surfaces task titles in an alert).
 */
export function isAppLocked(): boolean {
  return useSettingsStore.getState().appLockEnabled && !useAppLockStore.getState().unlocked;
}
