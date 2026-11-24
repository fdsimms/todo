import React, { useMemo } from 'react';
import { PantryAnswerSheet, type PantryAnswerRow } from './PantryAnswerSheet';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from '../utils/haptics';
import { standingSwapMap } from '../utils/standingSwaps';
import { thawTargetsForMeal, type ThawTarget } from '../utils/mealThawTasks';

interface Props {
  visible: boolean;
  /** The planned meal the "Take X out of the freezer" task is about. */
  entryId: string;
  onClose: () => void;
}

const ALL_KEY = 'all';

/**
 * What the card can offer for this meal right now, or null when there is
 * nothing it can answer for. Read from the stores' current state through the
 * function the task is created and cleared by, so a tap and the card agree.
 */
export function mealThawTargetsNow(entryId: string): ThawTarget[] | null {
  const entry = useMealPlanStore.getState().entryById(entryId);
  const recipesById = new Map(useRecipeStore.getState().recipes.map(r => [r.id, r]));
  const { leftovers } = useLeftoverStore.getState();
  const { items, itemSubs, itemProducts } = useGroceryStore.getState();
  return thawTargetsForMeal(
    entry, recipesById, leftovers, items, itemSubs, standingSwapMap(itemSubs, items), new Date(), itemProducts
  );
}

/**
 * The card a "Take X out of the freezer" task opens from its row's link button
 * in place of the trip to the Pantry, when every frozen thing in the meal is a
 * row one write can thaw (`FrozenForMeal.targets`). One thing is one row, "Took
 * it out"; several get a row each plus "Took them all out". Each is the
 * Pantry's own freezer pill (`setFrozen(id, false)`), so the use-by date
 * starts again, and the task's sweep then marks the row ready or updates its
 * title, run here so it shows now. Dismissing writes nothing.
 *
 * The rows are read when the card opens and kept while it is up, so a thaw
 * that changes the meal's list doesn't rewrite the card as it fades.
 */
export function MealThawSheet({ visible, entryId, onClose }: Props) {
  // Re-read on each opening only: `visible` is the dependency on purpose.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => (visible ? mealThawTargetsNow(entryId) : null), [visible, entryId]);
  const kept = useMemo(() => targets ?? [], [targets]);

  const rows = useMemo<PantryAnswerRow<string>[]>(() => {
    if (kept.length === 1) {
      return [{
        key: ALL_KEY,
        icon: 'snow-outline',
        tone: 'accent',
        label: 'Took it out',
        detail: 'Moves it out of the freezer and starts its use-by date again.',
        feedback: haptics.success,
      }];
    }
    return [
      ...kept.map((t, i): PantryAnswerRow<string> => ({
        key: String(i),
        icon: 'snow-outline',
        tone: 'accent',
        label: `Took out ${t.name.toLowerCase()}`,
        detail: 'Moves it out of the freezer and starts its use-by date again.',
        feedback: haptics.tap,
      })),
      {
        key: ALL_KEY,
        icon: 'checkmark-done-outline',
        tone: 'accent',
        label: 'Took them all out',
        detail: 'Moves each of them out of the freezer and starts their use-by dates again.',
        feedback: haptics.success,
      },
    ];
  }, [kept]);

  const answer = (key: string) => {
    const picked = key === ALL_KEY ? kept : [kept[Number(key)]].filter(Boolean);
    for (const t of picked) {
      if (t.kind === 'grocery') useGroceryStore.getState().setFrozen(t.sourceId, false);
      else useLeftoverStore.getState().setFrozen(t.sourceId, false);
    }
    useTaskStore.getState().checkMealThawTasks();
  };

  const title =
    kept.length === 1
      ? `Take ${kept[0].name.toLowerCase()} out of the freezer?`
      : 'Take these out of the freezer?';

  return (
    <PantryAnswerSheet
      name="MealThawSheet"
      visible={visible && kept.length > 0}
      title={title}
      rows={rows}
      onAnswer={answer}
      onClose={onClose}
    />
  );
}
