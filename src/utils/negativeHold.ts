import { Alert } from 'react-native';
import type { Task } from '../types';
import { displayTitleFor, effectiveWindowEnd } from './visibilityUtils';
import { onLogicalDay } from './clockTime';
import { negativeHoldFor } from './negativeHabits';
import { haptics } from './haptics';

export interface NegativeHoldActions {
  undoSlip: (id: string) => void;
  closeDay: (id: string) => void;
  reopenDay: (id: string) => void;
}

/** Whether a long press on this avoid-task's box has anything to do right now. */
export function negativeHoldOffered(task: Task, todayStart: Date, now = new Date()): boolean {
  return negativeHoldFor(task, todayStart, { windowClosed: windowHasClosed(task, todayStart, now) }) !== null;
}

function windowHasClosed(task: Task, todayStart: Date, now: Date): boolean {
  const end = effectiveWindowEnd(task);
  return !!end && now >= onLogicalDay(todayStart, end);
}

/**
 * What a long press on an avoid-task's box does, shared by the task row and the
 * Search checkbox for the reason `confirmSlip` is: two tap targets, one answer.
 *
 * Closing a clean day goes straight through, because the undo bar takes it back
 * and a long press is already deliberate. The two that change the record the
 * other way (taking back a slip, reopening a day) ask first, as the slip undo
 * always has.
 */
export async function runNegativeHold(task: Task, todayStart: Date, actions: NegativeHoldActions): Promise<void> {
  const hold = negativeHoldFor(task, todayStart, { windowClosed: windowHasClosed(task, todayStart, new Date()) });
  if (!hold) return;
  const title = displayTitleFor(task);
  const takeBack = {
    text: 'Take back a slip',
    style: 'destructive' as const,
    onPress: () => actions.undoSlip(task.id),
  };
  switch (hold) {
    case 'close':
      await haptics.success();
      actions.closeDay(task.id);
      return;
    case 'reopen':
      await haptics.tap();
      Alert.alert('You counted today early', `Take that back for "${title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take back', style: 'destructive', onPress: () => actions.reopenDay(task.id) },
      ]);
      return;
    case 'undo-slip':
      await haptics.tap();
      Alert.alert('Take back a slip?', `Remove the most recent slip logged for "${title}" today?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take back', style: 'destructive', onPress: () => actions.undoSlip(task.id) },
      ]);
      return;
    case 'undo-or-close':
      await haptics.tap();
      Alert.alert(title, 'Slips so far are inside what you allow.', [
        { text: 'Cancel', style: 'cancel' },
        takeBack,
        { text: 'Count today as clean', onPress: () => actions.closeDay(task.id) },
      ]);
      return;
  }
}
