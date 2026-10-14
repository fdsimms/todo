import { gateGroupFor, nextPendingGate, outstandingGates } from './appGate';
import { syncAppShield } from './appShield';
import { canLock } from './nfcKey';
import type { Task } from '../types';
import { nextScheduleBoundary } from './blockSchedule';
import { beginVisibleAtPass, getVisibleAt, isHiddenForVacation, isTaskVisible } from './visibilityUtils';
import { resolvedAssignments, resolveGroupNow, useAppGroupStore } from '../store/useAppGroupStore';
import { useFocusStore } from '../store/useFocusStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useSettingsStore } from '../store/useSettingsStore';
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
  const settings = useSettingsStore.getState();
  const tasks = useTaskStore.getState().tasks;
  const now = new Date();
  const schedules = useAppGroupStore.getState().schedules;
  // A gate holds its own group when it names one, else the gate setting's.
  const settingGroup = resolvedAssignments().gate;
  const groupOf = (t: Task) => gateGroupFor(t, settingGroup, resolveGroupNow);
  const gates = outstandingGates(tasks, isTaskVisible);

  // One pass shared across every task, the way every other bulk read of this
  // does it: it caches the day boundary and the segment thresholds, which are
  // the same answer for all of them.
  const pass = beginVisibleAtPass();
  // getVisibleAt names the next *clock* moment and knows nothing about
  // vacation, so a gate task vacation mode is hiding would otherwise get a
  // window armed for tomorrow morning: being gated by something the app is
  // withholding is the one outcome appGate.ts rules out. A paused project's
  // task stays in, since getVisibleAt does return the day its pause lifts.
  const pending = nextPendingGate(tasks.filter(t => !isHiddenForVacation(t)), task => getVisibleAt(task, pass), now);

  syncAppShield({
    session: useFocusStore.getState().session,
    focusEnabled: settings.focusShieldEnabled,
    penaltyUntil: settings.penaltyShieldUntil,
    penaltyEnabled: settings.penaltyShieldEnabled,
    penaltyReason: settings.penaltyShieldReason,
    gateEnabled: settings.gateShieldEnabled,
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
  });

  const boundary = nextScheduleBoundary(schedules, now);
  const gateAt = pending?.liveAt ?? null;
  if (gateAt && boundary) return gateAt < boundary ? gateAt : boundary;
  return gateAt ?? boundary;
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
  return outstandingGates(useTaskStore.getState().tasks, isTaskVisible)
    .map(t => `${t.title}:${gateGroupFor(t, settingGroup, resolveGroupNow)}`)
    .join('\n');
}

/** The gate titles standing in the way right now. */
export function gateTitlesNow(): string[] {
  return outstandingGates(useTaskStore.getState().tasks, isTaskVisible).map(t => t.title);
}
