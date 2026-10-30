import { Alert } from 'react-native';
import type { EventTaskRule, Task } from '../types';
import { leavePrepAlert, openLeavePrep } from './leavePrep';

/**
 * Asks before ticking a "Leave for X" row while its prep tasks are open, and
 * goes straight through when none are. Resolves true to carry on, false on Go back. Shared by the task row and the standalone
 * checkbox for `confirmSlip`'s reason: a confirmation on one tap target and not
 * the other is not a confirmation.
 *
 * Widget, Live Activity and bulk completions skip it. They complete without a
 * row on screen to ask from, and the Leave row's reminder has already named
 * what is open.
 */
export function confirmLeaveWithOpenPrep(
  task: Task,
  tasks: readonly Task[],
  rules: readonly EventTaskRule[],
): Promise<boolean> {
  const open = task.generatedKind === 'travel' ? openLeavePrep(task, tasks, rules) : [];
  if (open.length === 0) return Promise.resolve(true);
  const { title, message } = leavePrepAlert(open);
  return new Promise(resolve => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Go back', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Leave anyway', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
