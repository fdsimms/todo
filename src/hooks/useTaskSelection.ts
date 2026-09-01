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
    // A single missable task (the common case — this same path now handles
    // a lone task's delete too) knows definitively which kind it is, and a
    // uniform multi-select does too once nothing outside the missable set
    // is along for the ride. Only a genuinely mixed selection still needs
    // the "or" — see TaskEditor's own single-task delete prompts, which
    // this mirrors rather than hedging the way this one used to.
    const missableTasks = missableIds
      .map(id => allTasks.find(t => t.id === id))
      .filter((t): t is Task => !!t);
    const wholeSelectionMissable = restIds.length === 0;
    const allRecurring = wholeSelectionMissable && missableTasks.every(isLiveRecurring);
    const allMealPlan = wholeSelectionMissable && !allRecurring && missableTasks.every(isMissableMealPlanTask);

    let message: string;
    let deleteLabel: string;
    if (allRecurring) {
      message = count === 1
        ? 'This task repeats. Mark just this occurrence missed, or delete it and stop the series?'
        : 'These tasks repeat. Mark them missed instead, or delete them and stop their series?';
      deleteLabel = 'Delete and Stop Series';
    } else if (allMealPlan) {
      message = count === 1
        ? 'This came from your meal plan. Mark it missed to keep a record, or delete it outright?'
        : 'These came from your meal plan. Mark them missed to keep a record, or delete them outright?';
      deleteLabel = 'Delete';
    } else {
      message = 'Some selected tasks repeat or came from your meal plan. Mark those missed, or delete your whole selection anyway?';
      deleteLabel = 'Delete anyway';
    }

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
