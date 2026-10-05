import { Alert } from 'react-native';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useRowSelection } from './useRowSelection';
import { bulkDeletePrompt } from '../utils/bulkDelete';
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
  // kept. For a mixed selection, "Mark missed" marks just those tasks
  // missed and deletes the rest; the destructive button deletes the whole
  // selection. Which tasks are missable, and the words the question uses,
  // are `bulkDeletePrompt`'s (src/utils/bulkDelete.ts).
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const plural = count === 1 ? 'task' : 'tasks';
    const prompt = bulkDeletePrompt(ids, allTasks);
    if (prompt.kind === 'delete') {
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
    const { missableIds, restIds, message, deleteLabel } = prompt;

    Alert.alert(
      `Delete ${count} ${plural}?`,
      `${message} You can undo this by shaking your phone right after.`,
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
          text: deleteLabel,
          style: 'destructive',
          onPress: () => {
            bulkDeleteTasks(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  // How many of the selected tasks a bulk Complete would actually complete.
  // Negative habits are never completed (see the polarity guard in
  // completeTask), so a selection made entirely of them would otherwise offer a
  // green Complete button that does nothing at all — and the one thing it looks
  // like it would do is the opposite of what those tasks mean.
  //
  // A count rather than a boolean because a mixed selection is a real case and
  // completing the rest is the right behaviour there: the bar hides the action
  // only when there is nothing at all for it to do.
  const completableCount = Array.from(selectedIds).filter(id => {
    const t = allTasks.find(x => x.id === id);
    return t ? t.polarity !== 'negative' : false;
  }).length;

  return {
    ...selection,
    handleBulkDelete,
    completableCount,
  };
}
