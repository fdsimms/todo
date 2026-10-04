import type { ElsewhereResult } from '../utils/searchElsewhere';
import { navigateToSettingsEntry } from './openSettings';
import { navigateToTab } from './navigationRef';

interface Navigator {
  navigate: (...args: any[]) => void;
}

/**
 * Where a non-task search result opens, for the quick-search card and the
 * Search screen alike, so a recipe found in one can't open somewhere different
 * from the same recipe found in the other.
 *
 * Both callers are tabs, so a card (a recipe, a person, a setting) is pushed
 * on top of the search and back returns to it. A grocery item opens its sheet
 * on the Groceries tab, since a catalog item has no page of its own.
 */
export function openElsewhereResult(navigation: Navigator, result: ElsewhereResult): void {
  switch (result.kind) {
    case 'screen':
      navigation.navigate(result.destination.route);
      return;
    case 'setting':
      navigateToSettingsEntry(navigation, result.entry.id);
      return;
    case 'person':
      navigation.navigate('PersonDetail', { personId: result.person.id });
      return;
    case 'recipe':
      navigation.navigate('RecipeDetail', { recipeId: result.recipe.id });
      return;
    case 'grocery':
      navigateToTab('Groceries', { openItem: result.item.id, openItemStamp: Date.now() });
      return;
  }
}
