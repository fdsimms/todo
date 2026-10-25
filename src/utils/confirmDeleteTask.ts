import { Alert } from 'react-native';
import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { stoppableGenerator } from './generatedTasks';
import { isMissableMealPlanTask } from './visibilityUtils';
import { isMissableOneOff } from './bulkDelete';
import { confirmDelete } from './confirmDelete';
import { confirmDeleteGenerated } from './confirmDeleteGenerated';
import { animateLayout } from './layoutAnimation';
import { haptics } from './haptics';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * Deleting one task by hand, with the question its kind needs asked first: a
 * repeating task, a meal-plan task or an open one-off can be marked missed
 * instead (a one-off keeps its Logbook row that way), a task on
 * several dates asks whether to delete just this date, and a generated one
 * offers to turn its generator off. Anything else is deleted at once, with
 * the undo bar as the way back.
 *
 * The task editor's Delete and a row's trash both call this, so the two can't
 * ask different questions about the same task. `onDone` runs after a delete or
 * a mark-missed, never after Cancel, for a caller that closes a sheet.
 */
export function confirmDeleteTask(task: Task, onDone?: () => void): void {
  const store = () => useTaskStore.getState();
  const finish = (write: () => void, success = true) => {
    if (success) haptics.success();
    animateLayout();
    write();
    onDone?.();
  };

  if (task.recurrenceType !== 'none') {
    Alert.alert(
      'Delete recurring task',
      'This task repeats. Mark this one missed, or delete it and stop it repeating?',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Mark missed', onPress: () => finish(() => store().markMissed(task.id), false) },
        {
          text: 'Delete and stop repeating',
          style: 'destructive',
          onPress: () => finish(() => store().deleteTask(task.id)),
        },
      ],
    );
    return;
  }
  // A meal-plan task has the same choice a recurring one does, just no
  // series to stop — tomorrow's row already exists on its own, so there's
  // nothing "and stop" would mean here.
  if (isMissableMealPlanTask(task)) {
    Alert.alert(
      'Delete meal task',
      'This came from your meal plan. Mark it missed to keep a record, or delete it?',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        // Later steps of a meal-plan chain depend on this one.
        { text: 'Mark missed', onPress: () => finish(() => store().markMissed(task.id, { wholeChain: true }), false) },
        { text: BUTTON_LABEL.delete, style: 'destructive', onPress: () => finish(() => store().deleteTask(task.id)) },
        ...(stoppableGenerator(task, useSettingsStore.getState()) ? [{
          text: 'Delete and turn off',
          style: 'destructive' as const,
          onPress: () => finish(() => store().deleteTask(task.id, { stopGenerator: true })),
        }] : []),
      ],
    );
    return;
  }
  // A dated series has real rows for its other dates, so deleting is
  // ambiguous the same way it is for a recurrence — this date, or the lot.
  // Either way the set's completed dates stay in the Logbook.
  const seriesId = task.seriesId;
  const remaining = seriesId ? store().seriesRowsOf(seriesId).filter(t => !t.completed).length : 0;
  if (seriesId && remaining > 1) {
    Alert.alert(
      'Delete task on several dates',
      `This task has ${remaining} dates left. Delete this date only, or all of them?`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Just this date', onPress: () => finish(() => store().deleteTask(task.id)) },
        { text: 'All dates', style: 'destructive', onPress: () => finish(() => store().deleteSeries(seriesId)) },
      ],
    );
    return;
  }
  if (task.generatedKind) {
    // It deletes the task itself; this only says so afterwards.
    confirmDeleteGenerated(task, () => {
      haptics.success();
      onDone?.();
    });
    return;
  }
  if (isMissableOneOff(task)) {
    Alert.alert(
      'Delete task',
      'Mark it missed to keep a record, or delete it?',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Mark missed', onPress: () => finish(() => store().markMissed(task.id), false) },
        { text: BUTTON_LABEL.delete, style: 'destructive', onPress: () => finish(() => store().deleteTask(task.id)) },
      ],
    );
    return;
  }
  confirmDelete({
    title: 'Delete task?',
    message: `Delete “${task.title}”?`,
    // deleteTask files "Task deleted" on the undo bar.
    undoable: true,
    onConfirm: () => finish(() => store().deleteTask(task.id)),
  });
}
