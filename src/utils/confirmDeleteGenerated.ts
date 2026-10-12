import { Alert } from 'react-native';
import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { stoppableGenerator } from './generatedTasks';
import { confirmDelete } from './confirmDelete';

/**
 * Delete one task, offering to turn off the generator that wrote it.
 *
 * A task the app wrote on its own gets a three-way answer: delete just this
 * one (what a plain delete has always done, including telling the source not
 * to ask again), delete it and turn the generator off in Settings, or cancel.
 * Anything else goes through `confirmDelete` as before. The prompt is shown
 * even when "Confirm before deleting" is off, because it is the only place
 * this choice is offered.
 *
 * `onDeleted` runs after either delete, for a caller that closes a sheet.
 */
export function confirmDeleteGenerated(task: Task, onDeleted?: () => void): void {
  const spec = stoppableGenerator(task, useSettingsStore.getState());
  const run = (stopGenerator: boolean) => {
    useTaskStore.getState().deleteTask(task.id, stopGenerator ? { stopGenerator } : undefined);
    onDeleted?.();
  };
  if (!spec) {
    confirmDelete({
      title: 'Delete task?',
      message: `Delete “${task.title}”?`,
      onConfirm: () => run(false),
    });
    return;
  }
  Alert.alert(
    'Delete task?',
    `“${task.title}” was added automatically by “${spec.label}”. Delete this one, or delete it and turn that off? You can turn it back on in Settings.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete this one', onPress: () => run(false) },
      { text: 'Delete and turn off', style: 'destructive', onPress: () => run(true) },
    ],
  );
}
