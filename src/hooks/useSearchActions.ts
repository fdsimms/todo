import { useCallback, useEffect, useMemo, useState } from 'react';
import { haptics } from '../utils/haptics';
import { useMedicationStore } from '../store/useMedicationStore';
import { useMoodStore } from '../store/useMoodStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useNavMenuOptions } from './useNavMenuOptions';
import { menuDestinations } from '../utils/navHubs';
import { symptomVocabulary } from '../utils/moodLog';
import { listNameFor } from '../utils/groceryLists';
import {
  describeSearchAction,
  searchActions,
  type ActionDescription,
  type SearchAction,
  type SearchActionSources,
  type SearchActionsOutcome,
} from '../utils/searchActions';
import { runSearchAction, waterTodayMl, type SearchActionReceipt } from '../utils/searchActionRun';

export interface SearchActionsView extends SearchActionsOutcome {
  /** What each row says, by action key. */
  descriptions: ReadonlyMap<string, ActionDescription>;
}

const NONE: SearchActionsView = { actions: [], onSubmit: null, descriptions: new Map() };

/**
 * The actions a search query offers (see `searchActions.ts`), for the
 * quick-search card and the Search screen.
 *
 * Each kind follows the side menu, the rule `useElsewhereSearch` keeps for the
 * same reason: a dose only while Medications is shown, water while the Food
 * log is, the mood log while Mood is, and a grocery add while Groceries is. A
 * feature somebody hid shouldn't be one row away in search.
 *
 * The stores are read when the query changes rather than subscribed to, the
 * same trade `useElsewhereSearch` makes: both callers stay mounted behind
 * other screens, and a subscription would re-render them on every dose, glass
 * or grocery tick for a list nobody is looking at.
 */
export function useSearchActions(query: string, active: boolean, limit?: number): SearchActionsView {
  const menuOptions = useNavMenuOptions();
  const routes = useMemo(
    () => new Set(menuDestinations(menuOptions).map(d => d.route)),
    [menuOptions],
  );

  return useMemo(() => {
    if (!active || query.trim().length === 0) return NONE;
    const medication = useMedicationStore.getState();
    const settings = useSettingsStore.getState();
    const grocery = useGroceryStore.getState();
    const sources: SearchActionSources = {
      medications: routes.has('Medications') ? { logs: medication.logs, archived: medication.archived } : null,
      water: routes.has('FoodLog') ? { unit: settings.waterUnit } : null,
      mood: routes.has('Mood') ? { symptoms: symptomVocabulary(useMoodStore.getState().logs) } : null,
      // The list the grocery screen last had open: the one a person reaching
      // for "add milk" is shopping into, named explicitly so the add and its
      // undo both act on it.
      groceries: routes.has('Groceries')
        ? {
            items: grocery.items,
            listEntries: grocery.listEntries,
            listId: grocery.activeListId,
            listName: listNameFor(grocery.activeListId, grocery.lists),
          }
        : null,
    };
    const outcome = searchActions(query, sources, limit);
    if (outcome.actions.length === 0) return NONE;
    const now = new Date();
    const ctx = {
      medicationLogs: medication.logs,
      medicationSettings: medication.settings,
      waterUnit: settings.waterUnit,
      waterTodayMl: outcome.actions.some(a => a.kind === 'water') ? waterTodayMl(now) : 0,
      now,
    };
    return {
      ...outcome,
      descriptions: new Map(outcome.actions.map(a => [a.key, describeSearchAction(a, ctx)])),
    };
  }, [active, query, routes, limit]);
}

/**
 * What the rows ran while the results were on screen, so a row that wrote
 * something can say so and offer Undo in its place. Cleared whenever `resetKey`
 * (the query) moves on, the same way the quick-search card drops the tasks it
 * held: a new query is a new set of rows.
 */
export function useSearchActionReceipts(resetKey: string) {
  const [receipts, setReceipts] = useState<ReadonlyMap<string, SearchActionReceipt>>(new Map());
  useEffect(() => setReceipts(new Map()), [resetKey]);

  const run = useCallback(async (action: SearchAction) => {
    haptics.tap();
    if (receipts.has(action.key)) return;
    const receipt = await runSearchAction(action);
    if (!receipt) return;
    haptics.success();
    setReceipts(prev => new Map(prev).set(action.key, receipt));
  }, [receipts]);

  const undo = useCallback((action: SearchAction) => {
    const receipt = receipts.get(action.key);
    if (!receipt) return;
    haptics.tap();
    receipt.undo();
    setReceipts(prev => {
      const next = new Map(prev);
      next.delete(action.key);
      return next;
    });
  }, [receipts]);

  const clear = useCallback(() => setReceipts(new Map()), []);

  return { receipts, run, undo, clear };
}
