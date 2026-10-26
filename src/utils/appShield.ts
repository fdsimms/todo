import type { FocusSession } from '../types';
import { gateShieldWanted, gateSubtitle, gateWindowFor } from './appGate';
import { shieldWanted } from './focusShield';
import { KEY_LOCK_DETAIL } from './nfcKey';
import { isTimedBlock, manualBlockWanted, type ManualBlock } from './manualBlock';
import type { LiveSpeedBump } from './speedBump';
import { penaltyShieldWanted } from './penaltyShield';
import { screenTimeBridge } from './screenTimeBridge';
import { uniqueGroupIds, type GroupAssignments } from './appGroups';
import { activeSchedules, currentWindowEnd, nativeScheduleWindows, resolvedGroups, type BlockSchedule, type GroupResolver } from './blockSchedule';

/**
 * The one place that decides whether the system shield is on, and the only
 * place that writes it.
 *
 * Six reasons this app blocks apps — a focus session is running, a task was
 * failed, a task has to be done first, a key tag locked them, a schedule's
 * window is open, and the person started a timed block — and they share a single
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
 * **A key tag and the emergency button end every live reason, on purpose, and
 * leave a record.** That is `releaseAllBlocks` (`releaseBlocks.ts`), which ends
 * each reason where it lives rather than through this arbiter, so this file
 * still only ORs what is live. An earlier rule had a tag flip only `keyLocked`;
 * it was reversed because a lock that nothing could end early was worse than one
 * that could be ended and counted.
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
  /**
   * Deny deleting apps while the shield is up. Optional so a caller that
   * predates it, and a test that doesn't care, needn't supply it.
   */
  denyAppRemoval?: boolean;
  /**
   * The (resolved) ids of the groups that block everything except their own
   * apps. Optional so a caller that predates allowlists, and a test that doesn't
   * care, needn't supply it.
   */
  allowGroupIds?: readonly string[];
  /** What earned the block — a task's title — for the shield screen to name. */
  penaltyReason: string | null;
  gateEnabled: boolean;
  /**
   * A block the person started by hand, with its group already resolved (a
   * removed group is Default). Optional so a caller that predates it, and a
   * test that doesn't care, needn't supply it.
   */
  manual?: ManualBlock | null;
  /**
   * The speed bump the monitor extension raised and has not yet lifted, with its
   * groups already resolved. The app never starts one: it reads the extension's
   * record and keeps the shield up for it, or a reconcile would lift a block the
   * extension raised with the app closed. Optional for the same reason `manual` is.
   */
  speedBump?: LiveSpeedBump | null;
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
  /**
   * Resolves a stored group id to the plain groups it blocks: a removed group
   * becomes Default and a supergroup becomes its members. Every group id this
   * module hands to the shield or to native code has been through it, so a
   * supergroup never reaches iOS.
   */
  resolveGroup: GroupResolver;
  now: Date;
}

/** Why the apps are blocked, in the order a person should read the reasons. */
export type ShieldReasonKind = 'focus' | 'gate' | 'penalty' | 'key' | 'schedule' | 'manual' | 'speedBump';

/** One reason the shield is up, with only what a screen needs to say it. */
export interface ShieldReasonEntry {
  reason: ShieldReasonKind;
  /** The gate tasks standing in the way. Set for `gate` only. */
  titles?: readonly string[];
  /** When a penalty, manual, speed bump or schedule block runs out. Set for those only. */
  until?: string | null;
  /** The task a penalty was charged for, when it is known. Set for `penalty` only. */
  cause?: string | null;
  /** The schedule's name. Set for `schedule` only; its window end is `until`. */
  name?: string;
  /** The app groups this reason blocks: one for most reasons, several for a schedule or a manual block. Supergroups already expanded. */
  groupIds: string[];
  /**
   * The groups as the person named them, before a supergroup is expanded, so
   * the status card can say "Distractions" rather than the groups inside it.
   * Ids as stored: a missing group reads as the fallback when it is named
   * (`groupName`), the same rule the shield applies.
   */
  namedGroupIds?: string[];
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
  const held = (ids: readonly string[]) => resolvedGroups(ids, state.resolveGroup).groupIds;
  const named = (ids: readonly string[]) => [...new Set(ids)];
  if (shieldWanted(state.session, state.focusEnabled)) reasons.push({ reason: 'focus', groupIds: held([state.groups.focus]), namedGroupIds: named([state.groups.focus]) });
  // The person's own timed block reads right after the session: it is the
  // other thing they chose, and it names nothing but the clock.
  if (state.manual && manualBlockWanted(state.manual, state.now)) {
    reasons.push({
      reason: 'manual', until: state.manual.untilIso, groupIds: held(state.manual.groupIds), namedGroupIds: named(state.manual.groupIds),
    });
  }
  // A speed bump is the app's reaction to use, not a choice or a fault, so it
  // reads after the two the person made themselves and before the gate.
  if (speedBumpWanted(state.speedBump ?? null, state.now)) {
    const bump = state.speedBump!;
    reasons.push({ reason: 'speedBump', until: bump.untilIso, groupIds: held(bump.groupIds), namedGroupIds: named(bump.groupIds) });
  }
  if (gateShieldWanted(state.gateTitles.length, state.gateEnabled)) {
    // One entry per group, so a gate for Social and a gate for Games are two
    // lines on the status card and two groups in the union, each naming only
    // its own tasks.
    const byGroup = new Map<string, string[]>();
    state.gateTitles.forEach((title, i) => {
      const groupId = state.gateGroupIds?.[i] ?? state.groups.gate;
      byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), title]);
    });
    for (const [groupId, titles] of byGroup) reasons.push({ reason: 'gate', titles, groupIds: held([groupId]), namedGroupIds: named([groupId]) });
  }
  if (penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now)) {
    reasons.push({
      reason: 'penalty', until: state.penaltyUntil, cause: state.penaltyReason, groupIds: held([state.groups.penalty]),
      namedGroupIds: named([state.groups.penalty]),
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
      groupIds: resolvedGroups(schedule.groupIds, state.resolveGroup).groupIds,
      namedGroupIds: named(schedule.groupIds),
    });
  }
  if (state.keyLocked) reasons.push({ reason: 'key', groupIds: held([state.groups.key]), namedGroupIds: named([state.groups.key]) });
  return reasons;
}

/** Whether a speed bump the extension raised is still running at `now`. */
export function speedBumpWanted(bump: LiveSpeedBump | null, now: Date): boolean {
  if (!bump) return false;
  const end = new Date(bump.untilIso).getTime();
  return !Number.isNaN(end) && end > now.getTime();
}

/** The groups of apps to block right now: the union across every live reason. */
export function shieldGroupIds(state: AppShieldState): string[] {
  return uniqueGroupIds(shieldReasons(state).flatMap(r => r.groupIds));
}

/**
 * The allowlists that act as one, for the native side to union. A group named
 * directly is a set of its own; a supergroup of allowlists is one set of its
 * members, so "Work or Focus" keeps open the apps in either. Each set is then
 * intersected with the others as separate allowlists always were, so two
 * reasons naming different allowlists still leave open only what both name.
 * Block groups, and a supergroup of them, make no set.
 */
export function shieldAllowSets(state: AppShieldState, allowIds: readonly string[]): string[][] {
  const allow = new Set(allowIds);
  const seen = new Set<string>();
  const sets: string[][] = [];
  for (const reason of shieldReasons(state)) {
    for (const named of reason.namedGroupIds ?? []) {
      const ids = resolvedGroups([named], state.resolveGroup).groupIds.filter(id => allow.has(id));
      const key = [...ids].sort().join(',');
      if (ids.length === 0 || seen.has(key)) continue;
      seen.add(key);
      sets.push(ids);
    }
  }
  return sets;
}

/** Whether anything wants the apps blocked right now. */
export function appShieldWanted(state: AppShieldState): boolean {
  return (
    shieldWanted(state.session, state.focusEnabled) ||
    penaltyShieldWanted(state.penaltyUntil, state.penaltyEnabled, state.now) ||
    gateShieldWanted(state.gateTitles.length, state.gateEnabled) ||
    manualBlockWanted(state.manual ?? null, state.now) ||
    speedBumpWanted(state.speedBump ?? null, state.now) ||
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
  const manualWants = reasons.some(r => r.reason === 'manual');
  // Only a timed block ends on a clock the extension watches. An open-ended one
  // has no end to arm, so it is held like the key lock: a standing reason that
  // a penalty or schedule ending must not lift.
  const manualTimed = manualWants && isTimedBlock(state.manual ?? null);
  const manualOpen = manualWants && !manualTimed;
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
  // - the penalty's and the manual block's group and end, so a schedule closing
  //   doesn't lift a penalty or a timed block that is still running, and either
  //   ending doesn't lift another.
  // - the pending gate's group and moment, so a schedule closing after a gate
  //   window has started doesn't lift the gate the extension raised.
  const lead = reasons[0];
  const penaltyGroups = penaltyWants ? resolvedGroups([state.groups.penalty], state.resolveGroup).groupIds : [];
  const manualGroups = manualTimed ? resolvedGroups(state.manual?.groupIds ?? [], state.resolveGroup).groupIds : [];
  bridge.setShieldState({
    otherReasonWantsShield: focusWants || gateWants || keyWants || scheduleWants || manualOpen,
    reason: lead?.reason ?? 'none',
    untilIso: lead?.reason === 'penalty' || lead?.reason === 'schedule' || lead?.reason === 'manual' || lead?.reason === 'speedBump' ? lead.until ?? null : null,
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
        .filter(r => r.reason === 'focus' || r.reason === 'gate' || r.reason === 'key' || (r.reason === 'manual' && manualOpen))
        .flatMap(r => r.groupIds)),
      penaltyGroupId: penaltyGroups[0] ?? null,
      penaltyGroupIds: penaltyGroups,
      penaltyEndIso: penaltyWants ? state.penaltyUntil : null,
      manualGroupId: manualGroups[0] ?? null,
      manualGroupIds: manualGroups,
      manualEndIso: manualTimed ? state.manual?.untilIso ?? null : null,
      pendingGateGroupIds: gateWindow
        ? resolvedGroups(state.pendingGate?.groupIds ?? [state.groups.gate], state.resolveGroup).groupIds
        : [],
      pendingGateLiveAtIso: gateWindow ? gateWindow.startIso : null,
    },
  });
  bridge.setBlockSchedules(nativeScheduleWindows(state.schedules, state.resolveGroup));

  const groupIds = shieldGroupIds(state);
  // Before the shield, which reads it. Over the live reasons rather than the
  // groups' contents, so it holds exactly as long as the block does.
  bridge.setShieldOptions(state.denyAppRemoval === true);
  // Written every time, so a group switched back to a block list stops being
  // read as an allowlist. If the build can't take it, the allowlist groups are
  // left out of the shield rather than applied as block lists, which would
  // block exactly the apps they are meant to leave open.
  const allowIds = state.allowGroupIds ?? [];
  const allowWritten = bridge.setAllowGroups(allowIds);
  // Right after, and best effort: a build without it leaves each allowlist its own set.
  if (allowWritten) bridge.setAllowSets(shieldAllowSets(state, allowIds));
  const applied = allowWritten ? groupIds : groupIds.filter(id => !allowIds.includes(id));
  if (applied.length > 0) bridge.applyShield(applied);
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

  // The manual block's own window, for the reason the penalty has one: it has
  // to end on time with the app closed, and only this arms that.
  if (manualTimed && isTimedBlock(state.manual ?? null)) bridge.scheduleManualExpiry(state.manual!.untilIso!);
  else bridge.cancelManualExpiry();
}
