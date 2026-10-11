import { create } from 'zustand';
import { useSettingsStore } from './useSettingsStore';

/**
 * Whether the journal and dreams have been unlocked since the app was last
 * left. Not persisted, and closed again whenever the app stops being active
 * (`AppLockGate`), so every return to the journal asks for Face ID again.
 *
 * Same shape as `useAppLockStore`, for the same reason: the locked state is
 * derived (`journalLockEnabled && !unlocked`), never stored, so turning the
 * setting on can unlock the session in the same handler and no render sees
 * the setting on with the session unknown.
 */
interface JournalLockStore {
  unlocked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useJournalLockStore = create<JournalLockStore>(set => ({
  unlocked: false,
  lock() {
    set({ unlocked: false });
  },
  unlock() {
    set({ unlocked: true });
  },
}));

/** For code outside the React tree. Screens use `useJournalAccess`. */
export function isJournalLocked(): boolean {
  return useSettingsStore.getState().journalLockEnabled && !useJournalLockStore.getState().unlocked;
}
