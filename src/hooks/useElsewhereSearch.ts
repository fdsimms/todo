import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSyncStore } from '../store/useSyncStore';
import { usePersonStore } from '../store/usePersonStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useNavMenuOptions } from './useNavMenuOptions';
import { menuDestinations } from '../utils/navHubs';
import { settingsGroup } from '../utils/settingsIndex';
import { searchableSettingsEntries } from '../utils/settingsActiveRows';
import { trolleyStateFor } from '../utils/groceryLists';
import { searchElsewhere, type ElsewhereSections } from '../utils/searchElsewhere';

const EMPTY: ElsewhereSections = { goTo: [], people: [], recipes: [], groceries: [] };

/**
 * Everything a query finds that isn't a task, for the quick-search card and
 * the Search screen.
 *
 * What's searchable follows the side menu: people only while the People screen
 * is shown, recipes and groceries only while their screens are (the kitchen
 * switch, simplified mode). A result opening a screen the menu has taken away
 * would be a way back into a feature somebody switched off.
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
      now: new Date(),
    }, query);
  }, [active, query, destinations]);
}
