import { Alert } from 'react-native';
import type { Task } from '../types';
import { isLiveRecurring, isMissableMealPlanTask } from '../utils/visibilityUtils';
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
  // into this same bulk path). A meal-plan task whose day has come is the
  // same ambiguity for a different reason: it has no series to end, but
  // deleting it outright still loses the record a mark-missed would have
  // kept. For a mixed selection, "Mark Missed" marks just those tasks
  // missed and deletes the rest; "Delete Everything" deletes the whole
  // selection.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const plural = count === 1 ? 'task' : 'tasks';
    const missableIds = ids.filter(id => {
      const t = allTasks.find(x => x.id === id);
      return t ? (isLiveRecurring(t) || isMissableMealPlanTask(t)) : false;
    });
    if (missableIds.length === 0) {
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
    const restIds = ids.filter(id => !missableIds.includes(id));
    Alert.alert(
      `Delete ${count} ${plural}?`,
      'Some selected tasks repeat or came from your meal plan. Mark those missed instead of deleting them, or delete everything? You can undo this by shaking your phone right after.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark missed',
          onPress: () => {
            missableIds.forEach(id => markMissed(id));
            bulkDeleteTasks(restIds);
            exitSelection();
          },
        },
        {
          text: 'Delete Everything',
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
