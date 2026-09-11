import type { FocusSession } from '../types';
import { gateShieldWanted, gateSubtitle, gateWindowFor } from './appGate';
import { shieldWanted } from './focusShield';
import { penaltyShieldWanted } from './penaltyShield';
import { screenTimeBridge } from './screenTimeBridge';

/**
 * The one place that decides whether the system shield is on, and the only
 * place that writes it.
 *
 * Three reasons this app blocks apps — a focus session is running, a task was
 * failed, and a task has to be done first — and they share a single
 * `ManagedSettingsStore`. That sharing is not an implementation detail to route
 * around: the native side exposes one shield, so a reconciler per reason is not
 * three features, it is one feature with a race. Whichever ran last would win,
 * and the losing case is specific and bad — a focus session ending mid-penalty
 * would call `clearShield` and hand back the apps somebody was supposed to be
 * locked out of, silently, because from the focus side nothing was wrong.
 *
 * So the shield is on if *any* reason wants it on, and off only when none does.
 * Each reason keeps its own rule as a pure predicate (`focusShield.ts`,
 * `penaltyShield.ts`, `appGate.ts`); this ORs them and makes the single call.
 * Adding a fourth is a predicate and a line here, which is what the arbiter was
 * for.
 *
 * Safe to over-call, which is the point: it runs on every session write, every
 * settings change, every foreground, every task write and every penalty expiry,
 * and most of those agree with each other. Applying is idempotent on the native
 * side, so re-asserting costs nothing and this needs no memory of what it last
 * did.
 */
export interface AppShieldState {
  session: FocusSession | null;
  focusEnabled: boolean;
  penaltyUntil: string | null;
  penaltyEnabled: boolean;
  /** What earned the block — a task's title — for the shield screen to name. */
  penaltyReason: string | null;
  gateEnabled: boolean;
  /**
   * The titles of the gate tasks standing in the way, in the order the screen
   * should name them. Empty when nothing is gating.
   *
   * Titles rather than tasks because that is all any reader here needs, and it
   * keeps the caller honest about having already applied the visibility rule
   * (`outstandingGates`) rather than leaving that decision to this module.
   */
  gateTitles: readonly string[];
  /**
   * The next gate that isn't live yet: when it becomes live, and the titles to
   * name for it. Null when there is none within reach.
   *
   * Separate from `gateTitles` because they answer different questions and are
   * usually different tasks — that one is what's blocking now, this is what the
   * monitor extension should block for while the app is closed. A gate already
   * live has nothing to arm.
   */
  pendingGate: { liveAt: Date; titles: readonly string[] } | null;
  now: Date;
}

/** Whether anything wants the apps blocked right now. */
export function appShieldWanted(state: AppShieldState): boolean {
  return (
    shieldWanted(state.session, state.focusEnabled) ||
    penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now) ||
    gateShieldWanted(state.gateTitles.length, state.gateEnabled)
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
  const gateWants = gateShieldWanted(state.gateTitles.length, state.gateEnabled);
  // A window is armed only while the feature is on, so switching it off
  // disarms whatever was armed rather than leaving a shield to be raised for a
  // setting that no longer holds.
  const pendingDetail = state.gateEnabled && state.pendingGate
    ? gateSubtitle(state.pendingGate.titles)
    : null;
  const gateWindow = state.gateEnabled && state.pendingGate && pendingDetail
    ? gateWindowFor(state.pendingGate.liveAt, state.now)
    : null;

  // The screen can only lead with one of them, in the order they're worth
  // reading: a session is what the person is in the middle of, a gate is the
  // one they can act on right now, and a penalty is the one that only runs out.
  //
  // `otherReasonWantsShield` is what the monitor extension checks before
  // lifting a shield at the end of a penalty window, so a gate has to count as
  // one of the others. Left out, a penalty running out would hand back apps a
  // gate was still holding — the same race this arbiter exists to prevent,
  // reappearing in the one process that can't see any of this.
  bridge.setShieldState({
    otherReasonWantsShield: focusWants || gateWants,
    reason: focusWants ? 'focus' : gateWants ? 'gate' : penaltyWants ? 'penalty' : 'none',
    untilIso: penaltyWants && !focusWants && !gateWants ? state.penaltyUntil : null,
    detail: focusWants
      ? null
      : gateWants
        ? gateSubtitle(state.gateTitles)
        : penaltyWants ? state.penaltyReason : null,
    // Written only when a window is actually armed: it is what the monitor
    // extension checks before raising a shield, so a detail left behind by an
    // earlier reconcile would be a standing permission to block for a gate
    // that has since been completed or deferred.
    pendingGateDetail: gateWindow ? pendingDetail : null,
  });

  if (focusWants || penaltyWants || gateWants) bridge.applyShield();
  else bridge.clearShield();

  // Nothing is armed for a gate that is already live — the shield is up, and a
  // window would only re-raise it — nor for one further out than the horizon
  // `gateWindowFor` enforces.
  if (gateWindow) bridge.scheduleGateWindow(gateWindow.startIso, gateWindow.endIso);
  else bridge.cancelGateWindow();

  // `penaltyWants` being true is what makes penaltyUntil non-null — it is the
  // first thing that predicate checks.
  if (penaltyWants && state.penaltyUntil) bridge.schedulePenaltyExpiry(state.penaltyUntil);
  else bridge.cancelPenaltyExpiry();
}
