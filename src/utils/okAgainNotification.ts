import { useMedicationStore } from '../store/useMedicationStore';
import { medicationKey } from './medicationLog';
import { limitStatus, prefsFor } from './medicationSettings';
import { cancelMedicationOkAgain, scheduleMedicationOkAgain } from './notifications';

/**
 * Move a medication's "OK again" notification to match its doses now.
 *
 * Its own module, not part of `doseRecording.ts`, because the task store has to
 * call it and `doseRecording.ts` imports the task store. A dose recorded by
 * ticking a task, or taken back by unticking one, moves the next-allowed time
 * exactly as one recorded by hand does; without this the old notice kept firing
 * for a time the new dose had pushed back, and a limit with no hand-recorded
 * dose never got one.
 */
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
