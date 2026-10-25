import { Alert } from 'react-native';
import { format } from 'date-fns/format';
import type { MedicationLog } from '../types';
import { useMedicationStore, type DoseInput } from '../store/useMedicationStore';
import { useTaskStore } from '../store/useTaskStore';
import { dayKeyOf, getCurrentDayStart } from './dateUtils';
import { isCountedUnit, medicationKey, taskSupplyFor } from './medicationLog';
import {
  crossedRefill,
  describeLimit,
  describeSupplyLeft,
  doseOverMax,
  formatCapAmount,
  limitStatus,
  prefsFor,
  supplyRemaining,
} from './medicationSettings';
import {
  cancelMedicationOkAgain,
  requestNotificationPermissions,
  scheduleMedicationOkAgain,
} from './notifications';
import { BUTTON_LABEL } from '../copy/shared';
import { alertPermissionOff } from './permissionAlert';

/**
 * How long the refill offer waits after the dose that set it off. Most doses
 * are recorded from a sheet that is closing in the same moment, and an Alert
 * raised while a modal is being dismissed is dropped by iOS rather than shown.
 */
const REFILL_OFFER_DELAY_MS = 600;

/**
 * Recording a dose by hand, and what follows it.
 *
 * Every way a person records a dose themselves (the row's quick button, the
 * log sheet, quick add, Siri) goes through `recordDose`, so the two things a
 * dose can set off happen whichever door it came in by: the "OK again"
 * notification is moved, and a supply that just crossed its threshold offers
 * a refill. A dose recorded by a task completion doesn't come through here:
 * its supply is the task's own (`supply.ts`), and the completion path already
 * has its own follow-ups.
 *
 * `confirmWithinLimit` is separate because only the paths with a person
 * looking at the screen ask it. Siri has already been told to do it, and
 * asking again from inside the app would be a second "are you sure" for one
 * request.
 */

/** Move a medication's "OK again" notification to match its doses now. */
export function syncOkAgainNotification(name: string, now: Date = new Date()): void {
  const { logs, settings } = useMedicationStore.getState();
  const key = medicationKey(name);
  const { limit } = prefsFor(settings, name);
  if (!key) return;
  // Caught rather than left floating: a schedule refused for want of
  // permission is the person's setting, not an error to surface here.
  if (!limit?.notify) {
    cancelMedicationOkAgain(key).catch(() => {});
    return;
  }
  const status = limitStatus(logs, name, limit, now);
  if (status.nextOkAt) scheduleMedicationOkAgain(key, name, status.nextOkAt).catch(() => {});
  else cancelMedicationOkAgain(key).catch(() => {});
}

/**
 * Turn a limit's notification on: ask for permission first, and say so when
 * it was refused, since a switch that quietly does nothing reads as broken.
 * Resolves whether it may be turned on.
 */
export async function allowOkAgainNotification(): Promise<boolean> {
  const granted = await requestNotificationPermissions().catch(() => false);
  if (!granted) {
    alertPermissionOff(
      'Notifications are off',
      'Turn on notifications for dundundun in Settings to be told when the next dose is within your limit.',
    );
  }
  return granted;
}

/**
 * Ask before recording a dose the limit you set says is too soon or too large.
 * Resolves true straight away when there is no limit or it allows the dose.
 * `planned` is the dose about to be recorded: a limit on a total asks whether
 * that much fits, so the same limit can allow 400 mg and refuse 800 mg, and a
 * limit on one dose reads its size. The person can always go ahead.
 */
export function confirmWithinLimit(
  name: string,
  now: Date = new Date(),
  planned: { amount: number | null; unit: string | null } | null = null,
): Promise<boolean> {
  const { logs, settings } = useMedicationStore.getState();
  const { limit, strength } = prefsFor(settings, name);
  // A counted dose is saved with the strength set now (`addLog`), so it is
  // measured with that strength here too, or "2 tablets" never reads as mg:
  // against the 24-hour total as much as against the one-dose cap.
  const measured = planned
    ? { ...planned, strength: planned.unit && isCountedUnit(planned.unit) && strength ? { ...strength } : null }
    : null;
  const status = limitStatus(logs, name, limit, now, measured);
  const over = measured && measured.amount !== null && measured.unit
    ? doseOverMax(limit, { amount: measured.amount, unit: measured.unit, strength: measured.strength })
    : null;
  if (!status.nextOkAt && !over) return Promise.resolve(true);
  const lines: string[] = [];
  if (over) lines.push(`That is ${formatCapAmount({ amount: over.amount, unit: over.max.unit })} in one dose.`);
  if (status.nextOkAt) lines.push(`The next dose is within it at ${format(status.nextOkAt, 'h:mm a')}.`);
  const message = `The limit you set is ${describeLimit(limit)!.toLowerCase()}. ${lines.join(' ')}`;
  return new Promise(resolve => {
    Alert.alert(`${name.trim()}: ${over && status.nextOkAt ? 'past your limit' : over ? 'more than your limit' : 'too soon'}`, message, [
      { text: BUTTON_LABEL.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: 'Record anyway', onPress: () => resolve(true) },
    ]);
  });
}

/** Offer a refill task, the moment a dose took the supply onto its threshold. */
function offerRefill(name: string, remaining: number, unit: string): void {
  Alert.alert(
    `${name} is running low`,
    `${describeSupplyLeft(remaining, unit)}. Add a task to refill it?`,
    [
      {
        text: 'Not now',
        style: 'cancel',
        onPress: () => useMedicationStore.getState().declineRefill(name),
      },
      {
        text: 'Add task',
        onPress: () => {
          const dueDate = getCurrentDayStart();
          dueDate.setHours(12, 0, 0, 0);
          useTaskStore.getState().addTask({ title: `Refill ${name}`, dueDate: dueDate.toISOString() });
        },
      },
    ],
  );
}

/**
 * Record a dose and run its follow-ups. `quiet` skips the refill offer (an
 * Alert), for a dose drained from a queue while the person is mid-way through
 * something else; the offer comes back the next time they record one, since
 * nothing was declined.
 */
export function recordDose(input: DoseInput, opts: { quiet?: boolean } = {}): MedicationLog | null {
  const store = useMedicationStore.getState();
  const { supply } = prefsFor(store.settings, input.name);
  const before = supplyRemaining(store.logs, input.name, supply);
  const log = store.addLog(input);
  if (!log) return null;
  syncOkAgainNotification(log.name);
  // A scheduled medicine's supply lives on its task and a completion spends
  // one; a dose recorded some other way spends one too.
  const supplyTask = taskSupplyFor(useTaskStore.getState().tasks, log.name);
  if (supplyTask && supplyTask.supplyCount !== null) {
    useTaskStore.getState().updateTask(supplyTask.id, { supplyCount: Math.max(0, supplyTask.supplyCount - 1) });
  }
  const after = supplyRemaining(useMedicationStore.getState().logs, log.name, supply);
  if (!opts.quiet && supply && after !== null && crossedRefill(before, after, supply)) {
    const unit = supply.unit;
    setTimeout(() => offerRefill(log.name, after, unit), REFILL_OFFER_DELAY_MS);
  }
  return log;
}

/**
 * Take a dose recorded by hand back (the undo bar, or deleting it), keeping the
 * notification honest. A dose from today also returns the one it took from its
 * task's supply. An older one doesn't: the task's count has been restocked and
 * spent since, and adding one back for a dose from last month would put a
 * number in it that no tablet in the box matches.
 */
export function unrecordDose(log: MedicationLog): void {
  useMedicationStore.getState().removeLog(log.id);
  syncOkAgainNotification(log.name);
  if (log.taskId !== null || log.dayKey !== dayKeyOf(getCurrentDayStart())) return;
  const supplyTask = taskSupplyFor(useTaskStore.getState().tasks, log.name);
  if (supplyTask && supplyTask.supplyCount !== null) {
    useTaskStore.getState().updateTask(supplyTask.id, { supplyCount: supplyTask.supplyCount + 1 });
  }
}

/**
 * Put back a dose `unrecordDose` took away, for an undo. Spends the one
 * `unrecordDose` returned to its task's supply, under the same conditions, so
 * delete then undo leaves the count where it started.
 */
export function restoreDose(log: MedicationLog): void {
  useMedicationStore.getState().restoreLog(log);
  syncOkAgainNotification(log.name);
  if (log.taskId !== null || log.dayKey !== dayKeyOf(getCurrentDayStart())) return;
  const supplyTask = taskSupplyFor(useTaskStore.getState().tasks, log.name);
  if (supplyTask && supplyTask.supplyCount !== null) {
    useTaskStore.getState().updateTask(supplyTask.id, { supplyCount: Math.max(0, supplyTask.supplyCount - 1) });
  }
}
