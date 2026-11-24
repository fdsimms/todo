import React from 'react';
import { PantryAnswerSheet, type PantryAnswerRow } from './PantryAnswerSheet';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** The one frozen thing the "Take X out of the freezer" task names. */
  kind: 'grocery' | 'leftover';
  sourceId: string;
  onClose: () => void;
}

type RowKey = 'thawed';

const ROWS: PantryAnswerRow<RowKey>[] = [
  {
    key: 'thawed',
    icon: 'snow-outline',
    tone: 'accent',
    label: 'Took it out',
    detail: 'Moves it out of the freezer and starts its use-by date again.',
    feedback: haptics.success,
  },
];

/**
 * The card a "Take X out of the freezer" task opens from its row's link button
 * when the task names exactly one frozen thing (`thawTargetOf`), in place of
 * the trip to the Pantry. "Took it out" is the write the Pantry's freezer pill
 * makes (`setFrozen(id, false)`), for a catalog row or a container alike, and
 * the task's own sweep then marks the row ready, run here so it shows now.
 * Dismissing writes nothing. A task naming several things still opens the
 * Pantry, whose Freezer section lists them.
 */
export function MealThawSheet({ visible, kind, sourceId, onClose }: Props) {
  const name = useGroceryStore(s => (kind === 'grocery' ? s.itemById(sourceId)?.name ?? null : null));
  const leftoverTitle = useLeftoverStore(s =>
    kind === 'leftover' ? s.leftovers.find(l => l.id === sourceId)?.title ?? null : null
  );
  const label = name ?? leftoverTitle;

  const answer = () => {
    if (kind === 'grocery') useGroceryStore.getState().setFrozen(sourceId, false);
    else useLeftoverStore.getState().setFrozen(sourceId, false);
    useTaskStore.getState().checkMealThawTasks();
  };

  return (
    <PantryAnswerSheet
      name="MealThawSheet"
      visible={visible}
      title={label ? `Take ${label.toLowerCase()} out of the freezer?` : 'Take it out of the freezer?'}
      rows={ROWS}
      onAnswer={answer}
      onClose={onClose}
    />
  );
}
