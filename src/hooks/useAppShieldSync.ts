import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { gateKeyNow, reconcileAppShield } from '../utils/appShieldReconcile';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useFocusStore } from '../store/useFocusStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';
import { useTaskStore } from '../store/useTaskStore';

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
 * - **The moment a penalty runs out, a gate comes due, or a schedule opens or closes**, which is the one
 *   trigger a subscription cannot supply, because nothing writes anything then.
 *   A block is a promise about a future instant, so something has to be waiting
 *   at it; with the app open and idle, nothing else here would fire until the
 *   person next touched something. The timer is re-armed on every reconcile
 *   rather than set once, so a block extended by a second failure is waited out
 *   to its new end, and it waits at whichever of the two instants is nearer.
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
      const gateLiveAt = reconcileAppShield();

      clearTimer();
      const settings = useSettingsStore.getState();
      const until = settings.penaltyShieldUntil ? new Date(settings.penaltyShieldUntil) : null;
      // Whichever of the two comes first. They are the same kind of trigger —
      // an instant nothing writes anything at — differing only in direction:
      // one lifts a block, the other raises one.
      const next = [until, gateLiveAt].filter((d): d is Date => d !== null)
        .reduce<Date | null>((a, d) => (a === null || d < a ? d : a), null);
      if (!next) return;
      const remaining = next.getTime() - Date.now();
      // A moment already past needs no timer — this reconcile has just acted on
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
        state.gateShieldEnabled !== prev.gateShieldEnabled ||
        state.initialized !== prev.initialized
      ) reconcile();
    });
    // A tag scan, or the lock button in Settings, writes the key store; the
    // shield has to follow in the same breath or a tap would unlock nothing
    // until the next foreground.
    // Groups, which group each reason uses, and schedules (including a tag
    // pausing one) all change what the shield holds or when.
    const unsubscribeGroups = useAppGroupStore.subscribe((state, prev) => {
      if (
        state.groups !== prev.groups ||
        state.assignments !== prev.assignments ||
        state.schedules !== prev.schedules
      ) reconcile();
    });
    const unsubscribeKey = useNfcKeyStore.subscribe((state, prev) => {
      if (state.locked !== prev.locked || state.keys !== prev.keys) reconcile();
    });
    // Ending a gate's or a focus session's block is remembered here, and the
    // shield has to follow at once, like a scan or a schedule being paused.
    const unsubscribeReleases = useShieldReleaseStore.subscribe((state, prev) => {
      if (state.releases !== prev.releases) reconcile();
    });
    // Ticking off the task a gate hangs on is a task write, and the block has
    // to come off in the same breath — waiting for the next foreground would
    // mean finishing the walk and still being locked out of the apps. Compared
    // by the titles it resolves to rather than firing on every task write,
    // since most of them change nothing here and each one costs a native call.
    let lastGateKey = gateKeyNow();
    const unsubscribeTasks = useTaskStore.subscribe(() => {
      const key = gateKeyNow();
      if (key === lastGateKey) return;
      lastGateKey = key;
      reconcile();
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') reconcile();
    });

    return () => {
      clearTimer();
      unsubscribeFocus();
      unsubscribeSettings();
      unsubscribeKey();
      unsubscribeReleases();
      unsubscribeGroups();
      unsubscribeTasks();
      subscription.remove();
    };
  }, []);
}

/** Just under 24.8 days, the largest delay setTimeout stores without overflowing. */
const MAX_SHIELD_TIMER_MS = 2_147_483_647;
