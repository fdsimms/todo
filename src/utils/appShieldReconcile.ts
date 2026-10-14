import { gateGroupFor, nextPendingGate, outstandingGates } from './appGate';
import { shieldReasons, syncAppShield, type AppShieldState, type ShieldReasonEntry } from './appShield';
import { isFocusReleased, isGateReleased } from './shieldRelease';
import { canLock } from './nfcKey';
import { isTimedBlock, manualBlockWanted } from './manualBlock';
import type { Task } from '../types';
import { nextScheduleBoundary } from './blockSchedule';
import { beginVisibleAtPass, getVisibleAt, isHiddenForVacation, isTaskVisible } from './visibilityUtils';
import { resolvedAssignments, resolveGroupNow, useAppGroupStore } from '../store/useAppGroupStore';
import { useFocusStore } from '../store/useFocusStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useManualBlockStore } from '../store/useManualBlockStore';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';
import { useTaskStore } from '../store/useTaskStore';

/**
 * Read the stores and bring the system shield into line with them.
 *
 * `appShield.ts` is the rule and is deliberately store-free; this is the one
 * place that goes and gets it the answers. It exists as a plain function rather
 * than living inside `useAppShieldSync` because the shield has to be reconciled
 * from somewhere with no React tree at all: a background refresh charges
 * penalties (`sweepTaskPenalties`) and rolls the day over, and until this was
 * callable from there, a block charged while the app was closed sat in settings
 * with nothing applying it.
 *
 * Two things the stores supply that the rule cannot work out for itself:
 *
 * - **Which gates are in the way**, which is `isTaskVisible`'s answer and so
 *   inherits every reason a task isn't yours to do yet.
 * - **When the next one turns up**, which is `getVisibleAt`'s. That is what a
 *   window is armed from, and the only reason a gate can take hold without the
 *   app being opened.
 *
 * Returns the next moment the shield changes with nothing writing anything — a
 * gate coming due or a schedule's window opening or closing — so a caller with
 * a running process can wait at it too.
 * The armed window is for the app being closed; with it open and idle nothing
 * else would fire at 06:00 either, and a gate that only bit once you touched
 * something would be the same hole one layer up.
 */
export function reconcileAppShield(): Date | null {
  const now = new Date();
  const state = buildShieldState(now);
  syncAppShield(state);

  const boundary = nextScheduleBoundary(state.schedules, now);
  const gateAt = state.pendingGate?.liveAt ?? null;
  // The moments nothing writes anything at: a gate coming due, a schedule
  // opening or closing, and a timed block running out.
  const manualEnd = isTimedBlock(state.manual ?? null) && manualBlockWanted(state.manual ?? null, now)
    ? new Date(state.manual!.untilIso!)
    : null;
  return [gateAt, boundary, manualEnd]
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((a, d) => (a === null || d < a ? d : a), null);
}

/**
 * Every gate task standing in the way, whether or not it has been released. The
 * set a release prunes against: a released gate that is no longer in it is gone.
 */
export function outstandingGatesNow(): Task[] {
  return outstandingGates(useTaskStore.getState().tasks, isTaskVisible);
}

/**
 * The gates still holding the apps: outstanding and not released. A release is
 * remembered per task row, so a repeating task's next occurrence gates again.
 */
export function liveGatesNow(): Task[] {
  const { releases } = useShieldReleaseStore.getState();
  return outstandingGatesNow().filter(t => !isGateReleased(t.id, releases));
}

/**
 * The state every reader of "is the shield up" starts from: the stores, with
 * what has been released applied. Kept in one place so the shield, the Screen
 * Time page and a release deciding what to end cannot read different answers.
 */
function buildShieldState(now: Date): AppShieldState {
  const settings = useSettingsStore.getState();
  const tasks = useTaskStore.getState().tasks;
  const schedules = useAppGroupStore.getState().schedules;
  const { releases } = useShieldReleaseStore.getState();
  // A gate holds its own group when it names one, else the gate setting's.
  const settingGroup = resolvedAssignments().gate;
  const groupOf = (t: Task) => gateGroupFor(t, settingGroup, resolveGroupNow);
  const gates = liveGatesNow();

  // One pass shared across every task, the way every other bulk read of this
  // does it: it caches the day boundary and the segment thresholds, which are
  // the same answer for all of them.
  const pass = beginVisibleAtPass();
  // getVisibleAt names the next *clock* moment and knows nothing about
  // vacation, so a gate task vacation mode is hiding would otherwise get a
  // window armed for tomorrow morning: being gated by something the app is
  // withholding is the one outcome appGate.ts rules out. A paused project's
  // task stays in, since getVisibleAt does return the day its pause lifts. A
  // released gate is left out for the same reason: a window armed for it would
  // raise the shield at the moment it was released from.
  const pending = nextPendingGate(
    tasks.filter(t => !isHiddenForVacation(t) && !isGateReleased(t.id, releases)),
    task => getVisibleAt(task, pass),
    now,
  );

  const session = useFocusStore.getState().session;
  const manualBlock = useManualBlockStore.getState().block;
  return {
    session: isFocusReleased(session?.id, releases) ? null : session,
    focusEnabled: settings.focusShieldEnabled,
    penaltyUntil: settings.penaltyShieldUntil,
    penaltyEnabled: settings.penaltyShieldEnabled,
    penaltyReason: settings.penaltyShieldReason,
    gateEnabled: settings.gateShieldEnabled,
    // A removed group is Default, as for every other reason.
    manual: manualBlock ? { ...manualBlock, groupId: resolveGroupNow(manualBlock.groupId) } : null,
    keyLocked: keyLockedNow(),
    groups: resolvedAssignments(),
    schedules,
    resolveGroup: resolveGroupNow,
    gateTitles: gates.map(t => t.title),
    gateGroupIds: gates.map(groupOf),
    pendingGate: pending
      ? { liveAt: pending.liveAt, titles: pending.tasks.map(t => t.title), groupIds: pending.tasks.map(groupOf) }
      : null,
    now,
  };
}

/** Why the apps are blocked right now, as the shield itself would say it. */
export function currentShieldReasons(now: Date = new Date()): ShieldReasonEntry[] {
  return shieldReasons(buildShieldState(now));
}

/**
 * Whether a key tag holds the lock. Requires an enrolled key as well as the
 * flag, so a lock whose last key was removed (or whose row failed to parse)
 * never keeps the apps blocked with nothing to end it.
 */
export function keyLockedNow(): boolean {
  const { locked, keys } = useNfcKeyStore.getState();
  return locked && canLock(keys);
}

/**
 * The gates standing in the way right now, each with the group it holds, as one
 * string for the sync hook's own change check. The group is part of it because
 * moving a gate to another group changes what is blocked while changing no title.
 */
export function gateKeyNow(): string {
  const settingGroup = resolvedAssignments().gate;
  return liveGatesNow()
    .map(t => `${t.title}:${gateGroupFor(t, settingGroup, resolveGroupNow)}`)
    .join('\n');
}

/** The gate titles standing in the way right now. */
export function gateTitlesNow(): string[] {
  return liveGatesNow().map(t => t.title);
}
