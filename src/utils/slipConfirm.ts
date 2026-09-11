import { Alert } from 'react-native';
import type { Task } from '../types';
import { formatDuration } from './effort';

/**
 * Ask before logging a slip that costs something, and go straight through when
 * it doesn't.
 *
 * Shared because a negative task has two tap targets that both report a slip —
 * the row's own leading gutter (`TaskItem`) and the standalone `TaskCheckbox`
 * used everywhere else — and a confirmation on one of them is not a
 * confirmation. Whichever grows third gets it by calling this rather than by
 * copying the wording.
 *
 * The prompt exists because this is the one mis-tap in the app that cannot be
 * taken back: `undoSlip` restores the run but deliberately leaves the block
 * standing, since retracting it would also be a way to retract a block earned
 * by something else entirely (see `slipPenaltyUntil`). Asking first is the
 * cheaper half of that trade — one extra tap, and only for the tasks somebody
 * has actually attached a cost to.
 */
export function confirmSlip(task: Task, penaltyEnabled: boolean, onConfirm: () => void): void {
  if (!penaltyEnabled || task.penaltyMinutes === null) {
    onConfirm();
    return;
  }
  Alert.alert(
    'Log a slip?',
    `This blocks the apps you picked for ${formatDuration(task.penaltyMinutes)}. It can’t be undone.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log it', style: 'destructive', onPress: onConfirm },
    ],
  );
}
