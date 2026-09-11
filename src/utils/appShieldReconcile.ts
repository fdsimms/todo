import { nextPendingGate, outstandingGates } from './appGate';
import { syncAppShield } from './appShield';
import { beginVisibleAtPass, getVisibleAt, isTaskVisible } from './visibilityUtils';
import { useFocusStore } from '../store/useFocusStore';
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
 * Returns that moment so a caller with a running process can wait at it too.
 * The armed window is for the app being closed; with it open and idle nothing
 * else would fire at 06:00 either, and a gate that only bit once you touched
 * something would be the same hole one layer up.
 */
export function reconcileAppShield(): Date | null {
  const settings = useSettingsStore.getState();
  const tasks = useTaskStore.getState().tasks;
  const now = new Date();

  // One pass shared across every task, the way every other bulk read of this
  // does it: it caches the day boundary and the segment thresholds, which are
  // the same answer for all of them.
  const pass = beginVisibleAtPass();
  const pending = nextPendingGate(tasks, task => getVisibleAt(task, pass), now);

  syncAppShield({
    session: useFocusStore.getState().session,
    focusEnabled: settings.focusShieldEnabled,
    penaltyUntil: settings.penaltyShieldUntil,
    penaltyEnabled: settings.penaltyShieldEnabled,
    penaltyReason: settings.penaltyShieldReason,
    gateEnabled: settings.gateShieldEnabled,
    gateTitles: outstandingGates(tasks, isTaskVisible).map(t => t.title),
    pendingGate: pending ? { liveAt: pending.liveAt, titles: pending.tasks.map(t => t.title) } : null,
    now,
  });

  return pending?.liveAt ?? null;
}

/** The gate titles standing in the way right now, for the sync hook's own change check. */
export function gateTitlesNow(): string[] {
  return outstandingGates(useTaskStore.getState().tasks, isTaskVisible).map(t => t.title);
}
