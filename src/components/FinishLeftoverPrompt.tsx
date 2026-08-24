import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useLeftoverStore } from '../store/useLeftoverStore';

/**
 * Asks whether ticking off a leftover-backed meal task actually finished the
 * container.
 *
 * useTaskStore.completeTask points `pendingFinishLeftoverId` at the leftover
 * the moment that tick finishes the meal, and this is what watches it — the
 * peer of UseUpResolveSheet, but an Alert rather than a sheet: the question is
 * one yes/no ("was that the last of it?"), not the leftover's whole editor.
 *
 * **Mounted once, beside DemoBanner/UndoBar, not on any one screen** —
 * completion can land here from Today, Search, Waiting, the widget, or a
 * bulk-complete, not just the meal's own row. Unlike UseUpResolveSheet it
 * doesn't need NavigationContainer: it renders nothing and touches no
 * navigation hooks, only Alert.
 *
 * This used to be two near-identical `Alert.alert` calls, one on TodayScreen's
 * meal-row tick and one on MealPlanScreen's own — both bypassed the task list
 * entirely, so a task-list tick of the same "Eat X" step never asked. Centralizing
 * here covers all three the same way, so both screen-local copies were removed
 * rather than kept: left in place they'd have fired alongside this one, since
 * every one of those ticks completes the paired task too.
 */
export function FinishLeftoverPrompt() {
  const pendingId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  const setPendingFinishLeftover = useLeftoverStore(s => s.setPendingFinishLeftover);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));

  useEffect(() => {
    if (!pendingId) return;
    const leftover = leftovers.find(l => l.id === pendingId);
    if (!leftover) {
      setPendingFinishLeftover(null);
      return;
    }
    Alert.alert(
      'Finished the leftovers?',
      `Was that the last of the ${leftover.title}?`,
      [
        { text: 'Still some left', style: 'cancel', onPress: () => setPendingFinishLeftover(null) },
        {
          text: 'Finished it',
          onPress: () => {
            finishLeftover(leftover.id, 'eaten');
            setPendingFinishLeftover(null);
          },
        },
      ]
    );
    // Fires once per id, not on every render the list happens to update on —
    // the effect intentionally doesn't depend on `leftovers` or the two
    // setters, which are stable store actions anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId]);

  return null;
}
