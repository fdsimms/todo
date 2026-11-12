import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSyncStore } from '../store/useSyncStore';
import { usePersonStore } from '../store/usePersonStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useJournalStore } from '../store/useJournalStore';
import { isJournalLocked } from '../store/useJournalLockStore';
import { useMoodStore } from '../store/useMoodStore';
import type { JournalKind } from '../types';
import { openEntries } from '../utils/journal';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { useNavMenuOptions } from './useNavMenuOptions';
import { menuDestinations } from '../utils/navHubs';
import { settingsGroup } from '../utils/settingsIndex';
import { searchableSettingsEntries } from '../utils/settingsActiveRows';
import { trolleyStateFor } from '../utils/groceryLists';
import { searchElsewhere, type ElsewhereSections } from '../utils/searchElsewhere';

const EMPTY: ElsewhereSections = { goTo: [], people: [], recipes: [], groceries: [], diary: [] };

/** The menu route that shows each kind of entry. A kind whose screen is off is not searched. */
const JOURNAL_ROUTE: Record<JournalKind, string> = { journal: 'Journal', dream: 'Dreams', note: 'Notes' };

/**
 * Everything a query finds that isn't a task, for the quick-search card and
 * the Search screen.
 *
 * What's searchable follows the side menu: people only while the People screen
 * is shown, recipes and groceries only while their screens are (the kitchen
 * switch, simplified mode). A result opening a screen the menu has taken away
 * would be a way back into a feature somebody switched off.
 *
 * Written text follows the same rule, and two more. A sealed note is not
 * searched (`openEntries`, the one rule every reader of the journal uses), and
 * nothing from the journal is searched while it is locked, so Search can't be
 * a way round Face ID. Mood notes need only the Mood screen to be on.
 *
 * The people, recipe, grocery, settings and sync stores are read when the
 * query changes rather than subscribed to, the same trade `useTasksWhileOpen`
 * makes for the card: both callers stay mounted behind other screens, and a
 * subscription would re-render them on every grocery tick and settings write
 * for a result list nobody is looking at.
 */
export function useElsewhereSearch(query: string, active: boolean): ElsewhereSections {
  const menuOptions = useNavMenuOptions();
  const destinations = useMemo(() => menuDestinations(menuOptions), [menuOptions]);

  return useMemo(() => {
    if (!active || query.trim().length === 0) return EMPTY;
    const routes = new Set(destinations.map(d => d.route));
    const grocery = useGroceryStore.getState();
    const groceriesShown = routes.has('Groceries');
    return searchElsewhere({
      destinations,
      settingsEntries: searchableSettingsEntries(
        Platform.OS, useSettingsStore.getState(), useSyncStore.getState()),
      settingsGroupTitle: id => settingsGroup(id)?.title ?? 'Settings',
      people: routes.has('People') ? usePersonStore.getState().people : [],
      recipes: routes.has('Recipes') ? useRecipeStore.getState().recipes : [],
      groceryItems: groceriesShown ? grocery.items : [],
      onListIds: groceriesShown
        ? new Set(trolleyStateFor(grocery.listEntries, grocery.activeListId).keys())
        : new Set(),
      journalEntries: isJournalLocked()
        ? []
        : openEntries(useJournalStore.getState().entries, dayKeyOf(getCurrentDayStart()))
          .filter(e => routes.has(JOURNAL_ROUTE[e.kind])),
      moodLogs: routes.has('Mood') ? useMoodStore.getState().logs : [],
      now: new Date(),
    }, query);
  }, [active, query, destinations]);
}
