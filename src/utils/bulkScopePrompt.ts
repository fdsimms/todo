import { Alert } from 'react-native';
import type { Difficulty, Priority, Task } from '../types';
import { BUTTON_LABEL } from '../copy/shared';
import { useTaskStore } from '../store/useTaskStore';
import { hasLaterRows } from './taskUpdate';

/**
 * Ask whether a bulk edit to a field applies to a repeating task's future
 * repeats, and go straight through when there's nothing to ask.
 *
 * `changing` is the selected tasks the edit would actually alter; only those
 * that repeat or fall on several dates are asked about, so a plain task or a
 * no-op never prompts. `what` completes "Apply ___ to this task only", e.g.
 * "the new priority". Cancel calls nothing. The task editor and the Today drag
 * ask the same question in the same words.
 */
export function confirmBulkScope(
  changing: Task[],
  what: string,
  proceed: (scope: 'occurrence' | 'series') => void,
): void {
  const asked = changing.filter(hasLaterRows);
  if (asked.length === 0) {
    proceed('series');
    return;
  }
  const one = asked.length === 1;
  const isSeries = one && !!asked[0].seriesId && asked[0].recurrenceType === 'none';
  Alert.alert(
    isSeries ? 'Update task on several dates' : 'Update recurring task',
    one
      ? isSeries
        ? `This task falls on more than one date. Apply ${what} to this date only, or to this and later dates?`
        : `This task repeats. Apply ${what} to this task only, or to it and all future repeats?`
      : `${asked.length} of these repeat. Apply ${what} to just these tasks, or to them and every future repeat?`,
    [
      { text: isSeries ? 'This date' : 'This task', onPress: () => proceed('occurrence') },
      { text: isSeries ? 'This and later dates' : 'This and future tasks', onPress: () => proceed('series') },
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
    ],
  );
}

const selectedTasks = (ids: string[]) => useTaskStore.getState().tasks.filter(t => ids.includes(t.id));

/** The bulk bar's Priority: asks about future repeats, sets it, then calls `onDone` (not on Cancel). */
export function bulkSetPriorityAsking(ids: string[], priority: Priority, onDone?: () => void): void {
  confirmBulkScope(selectedTasks(ids).filter(t => t.priority !== priority), 'the new priority', scope => {
    useTaskStore.getState().bulkSetPriority(ids, priority, { scope });
    onDone?.();
  });
}

/** The bulk bar's Difficulty: as above. */
export function bulkSetDifficultyAsking(ids: string[], difficulty: Difficulty | null, onDone?: () => void): void {
  confirmBulkScope(selectedTasks(ids).filter(t => (t.difficulty ?? null) !== difficulty), 'the new difficulty', scope => {
    useTaskStore.getState().bulkSetDifficulty(ids, difficulty, { scope });
    onDone?.();
  });
}

/** The bulk bar's Add tags: asks only about tasks that don't already carry all of them. */
export function bulkAddTagsAsking(ids: string[], tags: string[], onDone?: () => void): void {
  const changing = selectedTasks(ids).filter(t => tags.some(tag => !t.tags.includes(tag)));
  confirmBulkScope(changing, tags.length === 1 ? 'the new tag' : 'the new tags', scope => {
    useTaskStore.getState().bulkAddTags(ids, tags, { scope });
    onDone?.();
  });
}
