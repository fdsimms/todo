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
  /** What earned the block — a task's title — for the shield screen to name. */
  penaltyReason: string | null;
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
 *
 * Three writes rather than one, because a penalty block has to end on time even
 * with the app closed and none of this code is running then:
 *
 * - **The shield itself**, as before.
 * - **The answer the monitor extension will need.** It wakes at the end of a
 *   penalty window with no way to ask whether anything else still wants the
 *   apps blocked, so the answer is written ahead of it, on every reconcile
 *   rather than only when a penalty is armed — a focus session can start, or
 *   the feature be switched off, while a window is already running.
 * - **The window.** Armed while a block is being served and disarmed the moment
 *   it isn't, so its end can never lift a shield some later focus session
 *   raised.
 *
 * Re-arming on every reconcile keeps this as stateless as it was: the end
 * instant is what the window is built from, so re-arming an unchanged block
 * lands on the same moment and costs nothing. That is what lets this be called
 * on every foreground without remembering what it last did.
 */
export function syncAppShield(state: AppShieldState): void {
  const bridge = screenTimeBridge();
  if (!bridge) return;

  const focusWants = shieldWanted(state.session, state.focusEnabled);
  const penaltyWants = penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now);

  // Focus leads when both are in force: it is the one the person is in the
  // middle of and can end themselves, where a penalty only runs out.
  bridge.setShieldState({
    otherReasonWantsShield: focusWants,
    reason: focusWants ? 'focus' : penaltyWants ? 'penalty' : 'none',
    untilIso: penaltyWants ? state.penaltyUntil : null,
    detail: penaltyWants ? state.penaltyReason : null,
  });

  if (focusWants || penaltyWants) bridge.applyShield();
  else bridge.clearShield();

  // `penaltyWants` being true is what makes penaltyUntil non-null — it is the
  // first thing that predicate checks.
  if (penaltyWants && state.penaltyUntil) bridge.schedulePenaltyExpiry(state.penaltyUntil);
  else bridge.cancelPenaltyExpiry();
}
