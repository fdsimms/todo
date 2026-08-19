import { Alert } from 'react-native';
import type { Task } from '../types';
import { isLiveRecurring } from '../utils/visibilityUtils';
import { useTaskStore } from '../store/useTaskStore';
import { useRowSelection } from './useRowSelection';
import { confirmDelete } from '../utils/confirmDelete';

// Bulk selection for a task list: the shared row-selection machinery
// (useRowSelection) plus the one thing that's specific to tasks — a delete
// that has to ask about recurrence.
export function useTaskSelection(allTasks: Task[]) {
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const markMissed = useTaskStore(s => s.markMissed);

  const selection = useRowSelection();
  const { selectedIds, exitSelection } = selection;

  // A live recurring task in the selection makes "delete" ambiguous — see
  // the matching prompt in TaskItem's single-task delete flow (now folded
  // into this same bulk path). For a mixed selection, "This Task(s)" marks
  // just the recurring ones missed — closing each out as not-done and moving
  // it to its next occurrence — and deletes the rest;
  // "This and Future Tasks" deletes everything, ending any series in the
  // selection.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const plural = count === 1 ? 'task' : 'tasks';
    const liveRecurringIds = ids.filter(id => {
      const t = allTasks.find(x => x.id === id);
      return t ? isLiveRecurring(t) : false;
    });
    if (liveRecurringIds.length === 0) {
      confirmDelete({
        title: `Delete ${count} ${plural}?`,
        message: `You're about to delete ${count} ${plural}. You can undo this by shaking your phone right after.`,
        onConfirm: () => {
          bulkDeleteTasks(ids);
          exitSelection();
        },
      });
      return;
    }
    const restIds = ids.filter(id => !liveRecurringIds.includes(id));
    Alert.alert(
      `Delete ${count} ${plural}?`,
      'Some selected tasks repeat. Mark just this occurrence missed for those, or delete everything and stop their series? You can undo this by shaking your phone right after.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'This Task(s)',
          onPress: () => {
            liveRecurringIds.forEach(id => markMissed(id));
            bulkDeleteTasks(restIds);
            exitSelection();
          },
        },
        {
          text: 'This and Future Tasks',
          style: 'destructive',
          onPress: () => {
            bulkDeleteTasks(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  return {
    ...selection,
    handleBulkDelete,
  };
}
