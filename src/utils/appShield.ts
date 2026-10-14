import type { FocusSession } from '../types';
import { gateShieldWanted, gateSubtitle, gateWindowFor } from './appGate';
import { shieldWanted } from './focusShield';
import { KEY_LOCK_DETAIL } from './nfcKey';
import { penaltyShieldWanted } from './penaltyShield';
import { screenTimeBridge } from './screenTimeBridge';
import { uniqueGroupIds, type GroupAssignments } from './appGroups';
import { activeSchedules, currentWindowEnd, nativeScheduleWindows, type BlockSchedule } from './blockSchedule';

/**
 * The one place that decides whether the system shield is on, and the only
 * place that writes it.
 *
 * Five reasons this app blocks apps — a focus session is running, a task was
 * failed, a task has to be done first, a key tag locked them, and a schedule's
 * window is open — and they share a single
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
   * The resolved group of each gate in `gateTitles`, in the same order. A gate
   * with no entry here (or no array at all) holds the gate setting's group
   * (`groups.gate`). Optional so a caller that predates per-task groups, and a
   * test that doesn't care, needn't supply it.
   */
  gateGroupIds?: readonly string[];
  /**
   * The next gate that isn't live yet: when it becomes live, and the titles to
   * name for it. Null when there is none within reach.
   *
   * Separate from `gateTitles` because they answer different questions and are
   * usually different tasks — that one is what's blocking now, this is what the
   * monitor extension should block for while the app is closed. A gate already
   * live has nothing to arm.
   */
  pendingGate: { liveAt: Date; titles: readonly string[]; groupIds?: readonly string[] } | null;
  /**
   * The group each of the four reasons blocks, already resolved (a removed
   * group is Default). Every reason names a group of apps rather than one
   * shared selection, and the shield is the union of the groups its live
   * reasons name.
   */
  groups: GroupAssignments;
  /** Every schedule; which are open right now is decided here against `now`. */
  schedules: readonly BlockSchedule[];
  /** Resolves a schedule's stored group id (a removed group becomes Default). */
  resolveGroup: (groupId: string) => string;
  now: Date;
}

/** Why the apps are blocked, in the order a person should read the reasons. */
export type ShieldReasonKind = 'focus' | 'gate' | 'penalty' | 'key' | 'schedule';

/** One reason the shield is up, with only what a screen needs to say it. */
export interface ShieldReasonEntry {
  reason: ShieldReasonKind;
  /** The gate tasks standing in the way. Set for `gate` only. */
  titles?: readonly string[];
  /** When a penalty block runs out. Set for `penalty` only. */
  until?: string | null;
  /** The task a penalty was charged for, when it is known. Set for `penalty` only. */
  cause?: string | null;
  /** The schedule's name. Set for `schedule` only; its window end is `until`. */
  name?: string;
  /** The app group this reason blocks. */
  groupId: string;
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
  if (shieldWanted(state.session, state.focusEnabled)) reasons.push({ reason: 'focus', groupId: state.groups.focus });
  if (gateShieldWanted(state.gateTitles.length, state.gateEnabled)) {
    // One entry per group, so a gate for Social and a gate for Games are two
    // lines on the status card and two groups in the union, each naming only
    // its own tasks.
    const byGroup = new Map<string, string[]>();
    state.gateTitles.forEach((title, i) => {
      const groupId = state.gateGroupIds?.[i] ?? state.groups.gate;
      byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), title]);
    });
    for (const [groupId, titles] of byGroup) reasons.push({ reason: 'gate', titles, groupId });
  }
  if (penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now)) {
    reasons.push({
      reason: 'penalty', until: state.penaltyUntil, cause: state.penaltyReason, groupId: state.groups.penalty,
    });
  }
  // A schedule is a window that opens and closes on the clock, so it reads
  // after the reasons that name something the person did and before a key lock,
  // which only the tag ends.
  for (const schedule of activeSchedules(state.schedules, state.now)) {
    reasons.push({
      reason: 'schedule',
      name: schedule.name,
      until: currentWindowEnd(schedule, state.now)?.toISOString() ?? null,
      groupId: state.resolveGroup(schedule.groupId),
    });
  }
  if (state.keyLocked) reasons.push({ reason: 'key', groupId: state.groups.key });
  return reasons;
}

/** The groups of apps to block right now: the union across every live reason. */
export function shieldGroupIds(state: AppShieldState): string[] {
  return uniqueGroupIds(shieldReasons(state).map(r => r.groupId));
}

/** Whether anything wants the apps blocked right now. */
export function appShieldWanted(state: AppShieldState): boolean {
  return (
    shieldWanted(state.session, state.focusEnabled) ||
    penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now) ||
    gateShieldWanted(state.gateTitles.length, state.gateEnabled) ||
    activeSchedules(state.schedules, state.now).length > 0 ||
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

  const reasons = shieldReasons(state);
  const focusWants = reasons.some(r => r.reason === 'focus');
  const penaltyWants = reasons.some(r => r.reason === 'penalty');
  const gateWants = reasons.some(r => r.reason === 'gate');
  const keyWants = reasons.some(r => r.reason === 'key');
  const scheduleWants = reasons.some(r => r.reason === 'schedule');
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
  // reading (`shieldReasons`).
  //
  // The extension answers three questions with the app closed, and each needs
  // the groups a reason holds rather than a yes or no, because the shield is
  // the union of groups and lifting one reason's must leave the others':
  //
  // - `otherGroupIds`: the groups held by reasons that don't end on a clock the
  //   extension watches (focus, gate, key). A penalty running out, a gate
  //   coming due or a schedule closing all keep these.
  // - the penalty's group and end, so a schedule closing doesn't lift a penalty
  //   that is still running, and a penalty ending doesn't lift a schedule.
  // - the pending gate's group and moment, so a schedule closing after a gate
  //   window has started doesn't lift the gate the extension raised.
  const lead = reasons[0];
  bridge.setShieldState({
    otherReasonWantsShield: focusWants || gateWants || keyWants || scheduleWants,
    reason: lead?.reason ?? 'none',
    untilIso: lead?.reason === 'penalty' || lead?.reason === 'schedule' ? lead.until ?? null : null,
    detail: !lead
      ? null
      : lead.reason === 'gate'
        ? gateSubtitle(state.gateTitles)
        : lead.reason === 'penalty'
          ? state.penaltyReason
          : lead.reason === 'schedule'
            ? lead.name ?? null
            : lead.reason === 'key' ? KEY_LOCK_DETAIL : null,
    // Written only when a window is actually armed: it is what the monitor
    // extension checks before raising a shield, so a detail left behind by an
    // earlier reconcile would be a standing permission to block for a gate
    // that has since been completed or deferred.
    pendingGateDetail: gateWindow ? pendingDetail : null,
    groups: {
      otherGroupIds: uniqueGroupIds(reasons
        .filter(r => r.reason === 'focus' || r.reason === 'gate' || r.reason === 'key')
        .map(r => r.groupId)),
      penaltyGroupId: penaltyWants ? state.groups.penalty : null,
      penaltyEndIso: penaltyWants ? state.penaltyUntil : null,
      pendingGateGroupIds: gateWindow
        ? uniqueGroupIds(state.pendingGate?.groupIds ?? [state.groups.gate])
        : [],
      pendingGateLiveAtIso: gateWindow ? gateWindow.startIso : null,
    },
  });
  bridge.setBlockSchedules(nativeScheduleWindows(state.schedules, state.resolveGroup));

  const groupIds = shieldGroupIds(state);
  if (groupIds.length > 0) bridge.applyShield(groupIds);
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
