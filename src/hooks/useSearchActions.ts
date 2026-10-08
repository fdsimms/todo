import { useMemo } from 'react';
import { useMedicationStore } from '../store/useMedicationStore';
import { useNavMenuOptions } from './useNavMenuOptions';
import { menuDestinations } from '../utils/navHubs';
import { searchActions, type SearchActionsOutcome } from '../utils/searchActions';

const NONE: SearchActionsOutcome = { actions: [], explicit: false };

/**
 * The actions a quick-search query offers (see `searchActions.ts`).
 *
 * Dose actions follow the side menu, the rule `useElsewhereSearch` keeps for
 * the same reason: offered only while the Medications screen is, so a feature
 * somebody hid isn't one row away in search.
 *
 * The medication store is read when the query changes rather than subscribed
 * to, the same trade `useElsewhereSearch` makes: the card stays mounted behind
 * every screen, and a subscription would re-render it on every dose recorded
 * anywhere for a list nobody is looking at.
 */
export function useSearchActions(query: string, active: boolean): SearchActionsOutcome {
  const menuOptions = useNavMenuOptions();
  const medicationsShown = useMemo(
    () => menuDestinations(menuOptions).some(d => d.route === 'Medications'),
    [menuOptions],
  );

  return useMemo(() => {
    if (!active || !medicationsShown || query.trim().length === 0) return NONE;
    const { logs, archived } = useMedicationStore.getState();
    return searchActions(query, logs, archived);
  }, [active, medicationsShown, query]);
}
