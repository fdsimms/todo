import { Alert } from 'react-native';
import type { Task } from '../types';
import { confirmBulkScope } from './bulkScopePrompt';
import { useTaskStore, writeEditToFollowUpSource } from '../store/useTaskStore';
import { followUpDraftFieldsChanged, hasFollowUpSource } from './followUpTask';
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
 * The bulk bar's Move: ask about future repeats, set the category, then offer it
 * to any generator that wrote one of the rows. `onDone` runs after the move and
 * not on Cancel, so the selection survives a cancelled prompt.
 */
export function bulkSetCategoryOffering(ids: string[], category: string | null, onDone?: () => void): void {
  const store = useTaskStore.getState();
  const selected = store.tasks.filter(t => ids.includes(t.id));
  confirmBulkScope(selected.filter(t => (t.category ?? null) !== category), 'the new category', scope => {
    const changed = ids.filter(id => (useTaskStore.getState().tasks.find(t => t.id === id)?.category ?? null) !== category);
    useTaskStore.getState().bulkSetCategory(ids, category, { scope });
    offerGeneratedCategoryWriteBack(changed.map(id => ({ id, category })));
    onDone?.();
  });
}

/**
 * After Backfill set fields on follow-up tasks, ask whether the ones the rule
 * adds later should start from them. `before` are the rows as they stood before
 * the write. The write is already applied, so "Just this task" does nothing. One
 * question however many were answered, since Backfill answers a card at a time
 * and a batch must not ask once per row. Generated tasks have their own offer
 * on that screen ("use this for new tasks"); a follow-up task had none.
 */
export function offerFollowUpWriteBack(before: Task[]): void {
  const { tasks } = useTaskStore.getState();
  const changed = before.flatMap(old => {
    const now = tasks.find(t => t.id === old.id);
    return now && hasFollowUpSource(now, tasks) && followUpDraftFieldsChanged(old, now) ? [{ old, now }] : [];
  });
  if (changed.length === 0) return;
  Alert.alert(
    'Use this for future tasks too?',
    changed.length === 1
      ? 'A repeating task adds this one. Start the ones added later from this answer as well?'
      : 'A repeating task adds each of these. Start the ones added later from these answers as well?',
    [
      { text: 'Just this task', style: 'cancel' },
      { text: 'Future tasks too', onPress: () => changed.forEach(({ old, now }) => writeEditToFollowUpSource(old, now)) },
    ],
  );
}
