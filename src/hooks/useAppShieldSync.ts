import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { syncAppShield } from '../utils/appShield';
import { useFocusStore } from '../store/useFocusStore';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Keeps the system app shield in line with everything that can want it on or
 * off. Mount once, near the root.
 *
 * The rules it delivers are in `src/utils/focusShield.ts` and
 * `src/utils/penaltyShield.ts`, arbitrated by `src/utils/appShield.ts`; this is
 * the wiring, and each trigger is load-bearing:
 *
 * - **The session**, which is the ordinary focus case.
 * - **The settings**, so turning either feature off mid-block unblocks
 *   immediately rather than at the end of the stretch, and so a penalty charged
 *   by a sweep reaches the shield the moment it is written. `initialized`
 *   counts as a change for the same reason it always did: the settings read
 *   false and null until the store hydrates, so a session or a block restored
 *   before that would otherwise sit unenforced until the next thing to happen.
 * - **Foregrounding**, which is the crash backstop. A shield written by a run
 *   that has since died is still in force, and the app coming back with nothing
 *   running is what lifts it. This is why the sync is a subscription over
 *   current state and not a call at the end of a session — the run that was
 *   supposed to make that call is exactly the one that isn't there any more.
 * - **The moment a penalty runs out**, which is the one trigger a subscription
 *   cannot supply, because nothing writes anything then. A block is a promise
 *   about a future instant, so something has to be waiting at it; with the app
 *   open and idle, nothing else here would fire until the person next touched
 *   something. The timer is re-armed on every reconcile rather than set once,
 *   so a block extended by a second failure is waited out to its new end.
 *
 * That timer is a backstop against the app being *open*, not against it being
 * closed — a JS timer dies with the process. Lifting a block while the app is
 * gone is what the native schedule is for; until then a block outlives its
 * window until the next foreground, which is the safe direction to fail only
 * because foregrounding reconciles before anything is drawn.
 *
 * iOS-only for the reason `useWeatherSync` is: there is nothing to reconcile
 * with elsewhere, and the gate would refuse anyway.
 */
export function useAppShieldSync(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const reconcile = () => {
      const settings = useSettingsStore.getState();
      const now = new Date();
      syncAppShield({
        session: useFocusStore.getState().session,
        focusEnabled: settings.focusShieldEnabled,
        penaltyUntil: settings.penaltyShieldUntil,
        penaltyEnabled: settings.penaltyShieldEnabled,
        penaltyReason: settings.penaltyShieldReason,
        now,
      });

      clearTimer();
      if (!settings.penaltyShieldUntil) return;
      const remaining = new Date(settings.penaltyShieldUntil).getTime() - now.getTime();
      // A block already over needs no timer — this reconcile has just cleared
      // it. The ceiling keeps the delay inside what setTimeout can represent;
      // past it the value overflows to a near-immediate fire, and a stored date
      // far enough in the future to hit that is a corrupt one rather than a
      // block anybody is serving.
      if (remaining <= 0 || remaining > MAX_SHIELD_TIMER_MS) return;
      timerRef.current = setTimeout(reconcile, remaining);
    };

    reconcile();

    const unsubscribeFocus = useFocusStore.subscribe((state, prev) => {
      if (state.session !== prev.session) reconcile();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.focusShieldEnabled !== prev.focusShieldEnabled ||
        state.penaltyShieldEnabled !== prev.penaltyShieldEnabled ||
        state.penaltyShieldUntil !== prev.penaltyShieldUntil ||
        state.penaltyShieldReason !== prev.penaltyShieldReason ||
        state.initialized !== prev.initialized
      ) reconcile();
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') reconcile();
    });

    return () => {
      clearTimer();
      unsubscribeFocus();
      unsubscribeSettings();
      subscription.remove();
    };
  }, []);
}

/** Just under 24.8 days, the largest delay setTimeout stores without overflowing. */
const MAX_SHIELD_TIMER_MS = 2_147_483_647;
