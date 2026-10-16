import { Alert } from 'react-native';
import type { Task } from '../types';
import { BUTTON_LABEL } from '../copy/shared';
import { useTaskStore } from '../store/useTaskStore';
import {
  generatedCategoryOffer,
  writeCategoryToSource,
  type GeneratedCategoryOffer,
} from '../store/generatedCategoryWriteBack';

/**
 * After app-written tasks were filed under a new category, ask whether the
 * generator should file its future tasks there too. The move is already
 * applied, so "Just this task" does nothing. One question per generator (or
 * per rule), however many of its tasks the move touched. See
 * `generatedCategoryWriteBack.ts` for where the answer is written.
 *
 * Every path that changes a task's category by hand calls this after the write:
 * the Today drag, the editor's category row and the bulk Move.
 */
export function offerGeneratedCategoryWriteBack(moves: { id: string; category: string | null }[]): void {
  const { tasks } = useTaskStore.getState();
  const offers = new Map<string, GeneratedCategoryOffer>();
  for (const move of moves) {
    const task = tasks.find(t => t.id === move.id);
    const offer = task ? generatedCategoryOffer(task, move.category) : null;
    if (offer && !offers.has(offer.key)) offers.set(offer.key, offer);
  }
  if (offers.size === 0) return;
  const list = [...offers.values()];
  const first = list[0];
  const message = list.length > 1
    ? `Also file future tasks from these ${list.length} automations under the categories you moved them to?`
    : first.rule
      ? `Also file future tasks from the rule that wrote this one under ${first.category}?`
      : `Also file future “${first.label}” tasks under ${first.category}?`;
  Alert.alert('File future tasks here too?', message, [
    { text: 'Just this task', style: 'cancel' },
    { text: 'Future tasks too', onPress: () => list.forEach(o => writeCategoryToSource(o.task, o.category)) },
  ]);
}

/**
 * Ask whether a bulk category move applies to a repeating task's future repeats,
 * and go straight through when there's nothing to ask. Only a repeating task or
 * a dated series whose category actually changes counts. Cancel calls nothing.
 * The drag and the task editor ask the same question in the same words.
 */
export function confirmBulkCategoryScope(
  tasks: Task[],
  category: string | null,
  proceed: (scope: 'occurrence' | 'series') => void,
): void {
  const asked = tasks.filter(t => (t.recurrenceType !== 'none' || !!t.seriesId) && (t.category ?? null) !== category);
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
        ? 'This task falls on more than one date. Apply the new category to this date only, or to this and later dates?'
        : 'This task repeats. Apply the new category to this task only, or to it and all future repeats?'
      : `${asked.length} of these repeat. Apply the new category to just these tasks, or to them and every future repeat?`,
    [
      { text: isSeries ? 'This date' : 'This task', onPress: () => proceed('occurrence') },
      { text: isSeries ? 'This and later dates' : 'This and future tasks', onPress: () => proceed('series') },
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
    ],
  );
}

/**
 * The bulk bar's Move: ask about future repeats, set the category, then offer it
 * to any generator that wrote one of the rows. `onDone` runs after the move and
 * not on Cancel, so the selection survives a cancelled prompt.
 */
export function bulkSetCategoryOffering(ids: string[], category: string | null, onDone?: () => void): void {
  const store = useTaskStore.getState();
  const selected = store.tasks.filter(t => ids.includes(t.id));
  confirmBulkCategoryScope(selected, category, scope => {
    const changed = ids.filter(id => (useTaskStore.getState().tasks.find(t => t.id === id)?.category ?? null) !== category);
    useTaskStore.getState().bulkSetCategory(ids, category, { scope });
    offerGeneratedCategoryWriteBack(changed.map(id => ({ id, category })));
    onDone?.();
  });
}
