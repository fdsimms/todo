import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { syncFocusShield } from '../utils/focusShield';
import { useFocusStore } from '../store/useFocusStore';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Keeps the focus shield in line with the session, the setting, and the app
 * coming back to the foreground. Mount once, near the root.
 *
 * The rule it delivers is in `src/utils/focusShield.ts`; this is the wiring,
 * and the three triggers are each load-bearing:
 *
 * - **The session**, which is the ordinary case.
 * - **The setting**, so turning the feature off mid-session unblocks
 *   immediately rather than at the end of the stretch. `initialized` counts as
 *   a change for the same reason: the setting reads false until the store
 *   hydrates, so a session restored before that would otherwise sit unshielded
 *   until the next thing to happen.
 * - **Foregrounding**, which is the crash backstop. A shield written by a run
 *   that has since died is still in force, and the app coming back with
 *   nothing running is what lifts it. This is why the sync is a subscription
 *   over current state and not a call at the end of a session — the run that
 *   was supposed to make that call is exactly the one that isn't there any
 *   more.
 *
 * iOS-only for the reason `useWeatherSync` is: there is nothing to reconcile
 * with elsewhere, and the gate would refuse anyway.
 */
export function useFocusShieldSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const reconcile = () => {
      syncFocusShield(
        useFocusStore.getState().session,
        useSettingsStore.getState().focusShieldEnabled,
      );
    };

    reconcile();

    const unsubscribeFocus = useFocusStore.subscribe((state, prev) => {
      if (state.session !== prev.session) reconcile();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.focusShieldEnabled !== prev.focusShieldEnabled ||
        state.initialized !== prev.initialized
      ) reconcile();
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') reconcile();
    });

    return () => {
      unsubscribeFocus();
      unsubscribeSettings();
      subscription.remove();
    };
  }, []);
}
