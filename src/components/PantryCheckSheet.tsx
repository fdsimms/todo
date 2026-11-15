import React, { useMemo } from 'react';
import { PantryAnswerSheet, type PantryAnswerRow } from './PantryAnswerSheet';
import { useGroceryStore } from '../store/useGroceryStore';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from '../utils/haptics';
import { pantryBoughtCaption } from '../utils/pantryStanding';

interface Props {
  visible: boolean;
  /** The grocery item the "Check if you still have X" task is about. */
  itemId: string;
  onClose: () => void;
}

type RowKey = 'have' | 'new' | 'low' | 'low-list' | 'out' | 'out-list';

const ROWS: PantryAnswerRow<RowKey>[] = [
  {
    key: 'have',
    icon: 'checkmark-circle-outline',
    tone: 'accent',
    label: 'Still have it',
    detail: 'Keeps it in your pantry and starts its window over.',
    feedback: haptics.success,
  },
  {
    key: 'new',
    icon: 'bag-add-outline',
    tone: 'accent',
    label: 'Bought more',
    detail: 'You restocked, so the old package no longer counts. Keeps it in your pantry as a fresh one.',
    feedback: haptics.success,
  },
  {
    key: 'low',
    icon: 'contrast-outline',
    tone: 'accent',
    label: 'Running low',
    detail: 'Keeps it in your pantry as nearly out, without adding it to your grocery list.',
    feedback: haptics.tap,
  },
  {
    key: 'low-list',
    icon: 'cart-outline',
    tone: 'accent',
    label: 'Running low, add to list',
    detail: 'Keeps it in your pantry as nearly out and puts it on your grocery list.',
    feedback: haptics.tap,
  },
  {
    key: 'out',
    icon: 'close-circle-outline',
    tone: 'red',
    label: 'Out of it',
    detail: 'Takes it out of your pantry until you get more.',
    feedback: haptics.tap,
  },
  {
    key: 'out-list',
    icon: 'cart-outline',
    tone: 'accent',
    label: 'Out of it, add to list',
    detail: 'Takes it out of your pantry and puts it on your grocery list.',
    feedback: haptics.tap,
  },
];

/**
 * The card a "Check if you still have X" task opens from its row's link button
 * (`pantryCheckTasks.ts`). It asks the question the task is about and writes
 * the answer with the same call the pantry review deck uses
 * (`answerPantryReview`), so each button writes exactly what the matching pill
 * on the item's own sheet writes. "Out of it, add to list" is that same "out"
 * plus the row joining the home list, and "Running low" comes in the same two
 * forms (running low is the one answer that can reach the list itself, so its
 * rows pass `addToList` rather than following the setting). That answer is also what retires the task:
 * either one makes the item stop wanting a check, and `checkPantryCheckTasks`
 * drops the row, run here so it leaves now rather than at the next sweep.
 *
 * Dismissing the card writes nothing, and neither does ticking the task, so a
 * tick still never claims "yes I still have it".
 */
export function PantryCheckSheet({ visible, itemId, onClose }: Props) {
  const name = useGroceryStore(s => s.itemById(itemId)?.name ?? null);
  const lastPurchasedAt = useGroceryStore(s => s.itemById(itemId)?.lastPurchasedAt ?? null);
  const bought = useMemo(
    () => pantryBoughtCaption({ lastPurchasedAt }, new Date()),
    [lastPurchasedAt, visible],
  );

  const answer = (key: RowKey) => {
    const groceries = useGroceryStore.getState();
    if (key === 'low' || key === 'low-list') {
      // Says the list choice outright, so the "Running low adds to the list"
      // setting can't override the row that was tapped. Onto the home list,
      // which `answerPantryReview` does for 'low'.
      groceries.answerPantryReview(itemId, 'low', { addToList: key === 'low-list' });
    } else {
      groceries.answerPantryReview(itemId, key === 'have' ? 'have' : key === 'new' ? 'new' : 'out');
    }
    // The home list, not whichever one is open: this is answered from a task
    // row, and an away list is that trip's own.
    if (key === 'out-list') groceries.addExistingMany([itemId], { listId: null });
    useTaskStore.getState().checkPantryCheckTasks();
  };

  return (
    <PantryAnswerSheet
      name="PantryCheckSheet"
      visible={visible}
      title={name ? `Do you still have ${name}?` : 'Do you still have this?'}
      subtitle={bought}
      rows={ROWS}
      onAnswer={answer}
      onClose={onClose}
    />
  );
}
