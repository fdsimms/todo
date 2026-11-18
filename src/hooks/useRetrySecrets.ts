import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Reads the keychain-backed keys again when the app comes to the front with one
 * of them empty. iOS can start the app in the background with the phone locked,
 * where the keychain read fails and the key reads as "no key"; the process then
 * lives on, and without this the key stays missing until the app is quit. A
 * key that really isn't set costs one keychain read per foreground.
 */
export function useRetrySecrets(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const { anthropicApiKey, fdcApiKey, goUpcApiKey, initializeSecrets } = useSettingsStore.getState();
      if (anthropicApiKey && fdcApiKey && goUpcApiKey) return;
      void initializeSecrets();
    });
    return () => subscription.remove();
  }, []);
}
