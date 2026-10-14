import { useEffect, useMemo, useState } from 'react';
import { outstandingGates } from '../utils/appGate';
import { shieldReasons, type AppShieldState, type ShieldReasonEntry } from '../utils/appShield';
import { canLock } from '../utils/nfcKey';
import { isTaskVisible } from '../utils/visibilityUtils';
import { useFocusStore } from '../store/useFocusStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';

/** Just under 24.8 days, the largest delay setTimeout stores without overflowing. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Why the apps are blocked right now, for the Screen Time page.
 *
 * The same answer `reconcileAppShield` gives the system shield, built from the
 * same stores and the same `shieldReasons` rule, so the page cannot say
 * something the shield is not doing. It reads only: nothing here writes the
 * shield, which stays `syncAppShield`'s alone.
 *
 * A penalty ends at an instant nothing writes anything at, so a timer
 * re-renders at it, the way `useAppShieldSync` waits at it to lift the block.
 * Without that, an expired penalty would stay listed until something else
 * happened to change.
 */
export function useShieldReasons(): ShieldReasonEntry[] {
  const session = useFocusStore(s => s.session);
  const focusEnabled = useSettingsStore(s => s.focusShieldEnabled);
  const penaltyEnabled = useSettingsStore(s => s.penaltyShieldEnabled);
  const penaltyUntil = useSettingsStore(s => s.penaltyShieldUntil);
  const penaltyReason = useSettingsStore(s => s.penaltyShieldReason);
  const gateEnabled = useSettingsStore(s => s.gateShieldEnabled);
  const keys = useNfcKeyStore(s => s.keys);
  const locked = useNfcKeyStore(s => s.locked);
  // Held as one string so a task write that changes no gate costs no render.
  const gateKey = useTaskStore(s => (
    gateEnabled ? JSON.stringify(outstandingGates(s.tasks, isTaskVisible).map(t => t.title)) : '[]'
  ));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    if (!penaltyUntil) return;
    const remaining = new Date(penaltyUntil).getTime() - Date.now();
    if (remaining <= 0 || remaining > MAX_TIMER_MS) return;
    const timer = setTimeout(() => setNow(new Date()), remaining + 50);
    return () => clearTimeout(timer);
  }, [penaltyUntil]);

  return useMemo(() => {
    const state: AppShieldState = {
      session,
      focusEnabled,
      penaltyUntil,
      penaltyEnabled,
      penaltyReason,
      gateEnabled,
      keyLocked: locked && canLock(keys),
      gateTitles: JSON.parse(gateKey) as string[],
      pendingGate: null,
      now,
    };
    return shieldReasons(state);
  }, [session, focusEnabled, penaltyUntil, penaltyEnabled, penaltyReason, gateEnabled, locked, keys, gateKey, now]);
}
