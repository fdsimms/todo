import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppLockStore } from '../store/useAppLockStore';
import { useJournalLockStore } from '../store/useJournalLockStore';
import { authenticateForAppLock } from '../utils/appLockAuth';

/**
 * Whether the journal and dreams are hidden right now, and how to ask for them.
 * Every reader of journal text checks `locked` (the Journal and Dreams screens,
 * the mood day page, Looking back); see `useJournalLockStore`.
 *
 * `unlock` marks the app lock as prompting for the length of the Face ID sheet,
 * because iOS reports the app inactive while it is up and `AppLockGate` would
 * otherwise count that as leaving.
 */
export function useJournalAccess(): { locked: boolean; unlock: () => Promise<boolean> } {
  const enabled = useSettingsStore(s => s.journalLockEnabled);
  const unlocked = useJournalLockStore(s => s.unlocked);

  const unlock = useCallback(async () => {
    const { prompting, setPrompting } = useAppLockStore.getState();
    if (prompting) return false;
    setPrompting(true);
    try {
      const result = await authenticateForAppLock('Unlock your journal');
      if (result === 'unavailable') {
        // Nothing on this device can answer the prompt, and there is no other
        // way in: open it out loud, as the app lock does.
        Alert.alert(
          'Journal lock unavailable',
          'This device has no Face ID or passcode set up, so the journal opened without asking.',
        );
      } else if (result !== 'success') {
        return false;
      }
      useJournalLockStore.getState().unlock();
      return true;
    } finally {
      useAppLockStore.getState().setPrompting(false);
    }
  }, []);

  return { locked: enabled && !unlocked, unlock };
}
