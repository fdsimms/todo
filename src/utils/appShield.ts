import type { FocusSession } from '../types';
import { shieldWanted } from './focusShield';
import { penaltyShieldWanted } from './penaltyShield';
import { screenTimeBridge } from './screenTimeBridge';

/**
 * The one place that decides whether the system shield is on, and the only
 * place that writes it.
 *
 * There are two reasons this app blocks apps — a focus session is running, and
 * a task was failed — and they share a single `ManagedSettingsStore`. That
 * sharing is not an implementation detail to route around: the native side
 * exposes one shield, so two reconcilers driving it independently is not two
 * features, it is one feature with a race. Whichever ran second would win, and
 * the losing case is specific and bad — a focus session ending mid-penalty
 * would call `clearShield` and hand back the apps somebody was supposed to be
 * locked out of, silently, because from the focus side nothing was wrong.
 *
 * So the shield is on if *any* reason wants it on, and off only when none does.
 * Each reason keeps its own rule as a pure predicate (`focusShield.ts`,
 * `penaltyShield.ts`); this ORs them and makes the single call.
 *
 * Safe to over-call, which is the point: it runs on every session write, every
 * settings change, every foreground and every penalty expiry, and most of those
 * agree with each other. Applying is idempotent on the native side, so
 * re-asserting costs nothing and this needs no memory of what it last did.
 */
export interface AppShieldState {
  session: FocusSession | null;
  focusEnabled: boolean;
  penaltyUntil: string | null;
  penaltyEnabled: boolean;
  now: Date;
}

/** Whether anything wants the apps blocked right now. */
export function appShieldWanted(state: AppShieldState): boolean {
  return (
    shieldWanted(state.session, state.focusEnabled) ||
    penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now)
  );
}

/**
 * Bring the system shield into line with the state given.
 *
 * Demo mode, Android and a build without the native half are all refused by
 * `screenTimeBridge()` itself — including for the clearing branch, which has to
 * go through the same door or the launch backstop that lifts a shield left
 * behind by a crash would be the one call that couldn't run.
 */
export function syncAppShield(state: AppShieldState): void {
  const bridge = screenTimeBridge();
  if (!bridge) return;
  if (appShieldWanted(state)) bridge.applyShield();
  else bridge.clearShield();
}
