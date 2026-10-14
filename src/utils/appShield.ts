import type { FocusSession } from '../types';
import { gateShieldWanted, gateSubtitle, gateWindowFor } from './appGate';
import { shieldWanted } from './focusShield';
import { KEY_LOCK_DETAIL } from './nfcKey';
import { penaltyShieldWanted } from './penaltyShield';
import { screenTimeBridge } from './screenTimeBridge';

/**
 * The one place that decides whether the system shield is on, and the only
 * place that writes it.
 *
 * Four reasons this app blocks apps — a focus session is running, a task was
 * failed, a task has to be done first, and a key tag locked them — and they
 * share a single
 * `ManagedSettingsStore`. That sharing is not an implementation detail to route
 * around: the native side exposes one shield, so a reconciler per reason is not
 * three features, it is one feature with a race. Whichever ran last would win,
 * and the losing case is specific and bad — a focus session ending mid-penalty
 * would call `clearShield` and hand back the apps somebody was supposed to be
 * locked out of, silently, because from the focus side nothing was wrong.
 *
 * So the shield is on if *any* reason wants it on, and off only when none does.
 * Each reason keeps its own rule as a pure predicate (`focusShield.ts`,
 * `penaltyShield.ts`, `appGate.ts`, `nfcKey.ts`); this ORs them and makes the
 * single call. Adding another is a predicate and a line here, which is what the
 * arbiter was for.
 *
 * **A key tag is one reason among the four, not an override of them.** Scanning
 * it flips only `keyLocked`, so it ends the block a tag raised and can never
 * end a penalty or a gate. That is the same invariant as above, applied to the
 * one reason a person can lift by hand.
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
   * A key tag has locked the apps and not yet unlocked them. The caller has
   * already required a key to be enrolled (`canLock`), so a lock with nothing
   * to end it never reaches here.
   */
  keyLocked: boolean;
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

/** Why the apps are blocked, in the order a person should read the reasons. */
export type ShieldReasonKind = 'focus' | 'gate' | 'penalty' | 'key';

/** One reason the shield is up, with only what a screen needs to say it. */
export interface ShieldReasonEntry {
  reason: ShieldReasonKind;
  /** The gate tasks standing in the way. Set for `gate` only. */
  titles?: readonly string[];
  /** When a penalty block runs out. Set for `penalty` only. */
  until?: string | null;
  /** The task a penalty was charged for, when it is known. Set for `penalty` only. */
  cause?: string | null;
}

/**
 * Every reason the shield is up right now, in the order the shield screen
 * leads with them: a session is what the person is in the middle of, a gate is
 * the one they can act on right now, a penalty is the one that only runs out,
 * and a key lock comes last because only the tag ends it and it names nothing
 * the person did.
 *
 * The one place that order lives. `syncAppShield` takes its lead reason from
 * the first entry, and the Screen Time page draws the whole list, so the page
 * and the iOS shield screen cannot disagree about which reason comes first.
 * Structured rather than sentences because a time has to be formatted against
 * the person's own 12/24-hour setting, which this module does not read.
 */
export function shieldReasons(state: AppShieldState): ShieldReasonEntry[] {
  const reasons: ShieldReasonEntry[] = [];
  if (shieldWanted(state.session, state.focusEnabled)) reasons.push({ reason: 'focus' });
  if (gateShieldWanted(state.gateTitles.length, state.gateEnabled)) {
    reasons.push({ reason: 'gate', titles: state.gateTitles });
  }
  if (penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now)) {
    reasons.push({ reason: 'penalty', until: state.penaltyUntil, cause: state.penaltyReason });
  }
  if (state.keyLocked) reasons.push({ reason: 'key' });
  return reasons;
}

/** Whether anything wants the apps blocked right now. */
export function appShieldWanted(state: AppShieldState): boolean {
  return (
    shieldWanted(state.session, state.focusEnabled) ||
    penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now) ||
    gateShieldWanted(state.gateTitles.length, state.gateEnabled) ||
    state.keyLocked
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
  const keyWants = state.keyLocked;
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
  // one they can act on right now, a penalty is the one that only runs out, and
  // a key lock comes last because it is the one that only the tag ends and
  // names nothing the person did.
  //
  // `otherReasonWantsShield` is what the monitor extension checks before
  // lifting a shield at the end of a penalty window, so a gate has to count as
  // one of the others, and so does a key lock, or a penalty running out would
  // hand back apps a tag was still holding. Left out, a penalty running out would hand back apps a
  // gate was still holding — the same race this arbiter exists to prevent,
  // reappearing in the one process that can't see any of this.
  bridge.setShieldState({
    otherReasonWantsShield: focusWants || gateWants || keyWants,
    reason: shieldReasons(state)[0]?.reason ?? 'none',
    untilIso: penaltyWants && !focusWants && !gateWants ? state.penaltyUntil : null,
    detail: focusWants
      ? null
      : gateWants
        ? gateSubtitle(state.gateTitles)
        : penaltyWants ? state.penaltyReason : keyWants ? KEY_LOCK_DETAIL : null,
    // Written only when a window is actually armed: it is what the monitor
    // extension checks before raising a shield, so a detail left behind by an
    // earlier reconcile would be a standing permission to block for a gate
    // that has since been completed or deferred.
    pendingGateDetail: gateWindow ? pendingDetail : null,
  });

  if (focusWants || penaltyWants || gateWants || keyWants) bridge.applyShield();
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
