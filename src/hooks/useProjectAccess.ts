import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useAppLockStore } from '../store/useAppLockStore';
import { useProjectLockStore } from '../store/useProjectLockStore';
import { isProjectLockedAway } from '../utils/projectLock';
import { authenticateForAppLock } from '../utils/appLockAuth';

/**
 * Asks for Face ID to open the locked projects, for the length of the session
 * (`useProjectLockStore`). One unlock opens every locked project, not just the
 * one asked for, so the rows beside it don't each need their own prompt.
 *
 * Marks the app lock as prompting while the sheet is up, because iOS reports
 * the app inactive for it and `AppLockGate` would otherwise count that as
 * leaving (see `useJournalAccess`, which this mirrors).
 */
export async function unlockProjects(): Promise<boolean> {
  const { prompting, setPrompting } = useAppLockStore.getState();
  if (prompting) return false;
  setPrompting(true);
  try {
    const result = await authenticateForAppLock('Unlock your locked projects');
    if (result === 'unavailable') {
      // Nothing on this device can answer the prompt and there is no other way
      // in, so it opens out loud rather than leaving the projects unreachable.
      Alert.alert(
        'Project lock unavailable',
        'This device has no Face ID or passcode set up, so the projects opened without asking.',
      );
    } else if (result !== 'success') {
      return false;
    }
    useProjectLockStore.getState().unlock();
    return true;
  } finally {
    useAppLockStore.getState().setPrompting(false);
  }
}

/** Whether `projectId` is hidden right now, and how to ask for it. */
export function useProjectAccess(projectId: string | null | undefined): { locked: boolean; unlock: () => Promise<boolean> } {
  const lockedIds = useProjectLockStore(s => s.lockedIds);
  const unlocked = useProjectLockStore(s => s.unlocked);
  const unlock = useCallback(() => unlockProjects(), []);
  return { locked: isProjectLockedAway(projectId, lockedIds, unlocked), unlock };
}
