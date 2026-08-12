import { useEffect } from 'react';
import * as QuickActions from 'expo-quick-actions';
import {
  resetToGroceries,
  resetToSearch,
  resetToProjects,
  openQuickAddFromShortcut,
} from '../navigation/navigationRef';

/**
 * The Home Screen actions, and the one place their ids are matched back to a
 * destination.
 *
 * These are also declared in app.json's expo-quick-actions plugin config
 * (`iosActions`), which is what the icon offers before this app has ever run.
 * The two lists must stay in step — keep the ids, titles and icons identical
 * if either changes. This copy exists because the list isn't static any more:
 * `kitchenEnabled` can drop the Groceries action, and `setItems` replaces the
 * whole set rather than editing one entry, so the survivors have to be
 * nameable from JS.
 */
const ACTIONS: QuickActions.Action[] = [
  { id: 'add', title: 'Add Task', icon: 'symbol:square.and.pencil' },
  { id: 'groceries', title: 'Groceries', icon: 'symbol:cart' },
  { id: 'search', title: 'Search', icon: 'symbol:magnifyingglass' },
  { id: 'projects', title: 'Projects', icon: 'symbol:briefcase' },
];

/** Which ids belong to the groceries/recipes/meal plan area. */
const KITCHEN_ACTION_IDS = new Set(['groceries']);

/** The actions to offer right now. */
export function quickActionsFor(kitchenEnabled: boolean): QuickActions.Action[] {
  return kitchenEnabled ? ACTIONS : ACTIONS.filter(a => !KITCHEN_ACTION_IDS.has(a.id));
}

/**
 * Routes a pressed action to its destination, returning true when it did.
 *
 * `kitchenEnabled` is passed in rather than read from the settings store, so
 * this module stays loadable under the node test env (the store reaches
 * expo-sqlite) — the same shape `visibleSettingsEntries` uses for platformOS.
 * A groceries press with the area off is left unhandled rather than being
 * redirected somewhere else: the action should already have been removed from
 * the icon, so this only fires for one launched from a stale menu, and
 * quietly landing somewhere unasked-for is worse than doing nothing.
 */
export function handleQuickActionId(
  id: string | null | undefined,
  kitchenEnabled = true
): boolean {
  if (!kitchenEnabled && id && KITCHEN_ACTION_IDS.has(id)) return false;
  switch (id) {
    case 'groceries':
      resetToGroceries();
      return true;
    case 'search':
      resetToSearch();
      return true;
    case 'projects':
      resetToProjects();
      return true;
    case 'add':
      openQuickAddFromShortcut();
      return true;
    default:
      return false;
  }
}

// Wires up Home Screen quick actions: the cold-start action (the icon was
// long-pressed while the app wasn't running) via QuickActions.initial, and a
// warm invocation (app already running/backgrounded) via addListener. Call
// once from the root component, after the navigator has mounted — mirrors
// useTaskDeepLinks in shape, but there's no store write here to sequence
// against, only navigation.
//
// It also re-publishes the action list whenever `kitchenEnabled` changes, so
// the icon's menu stops offering a screen the app no longer shows. Publishing
// on every change rather than only when the area is off is deliberate: turning
// it back on has to put the action back, and setItems is idempotent.
export function useHomeScreenQuickActions(kitchenEnabled: boolean): void {
  useEffect(() => {
    if (QuickActions.initial) handleQuickActionId(QuickActions.initial.id, kitchenEnabled);
    const sub = QuickActions.addListener(action => handleQuickActionId(action.id, kitchenEnabled));
    return () => sub.remove();
  }, [kitchenEnabled]);

  useEffect(() => {
    // Fire and forget: an unsupported platform (or a device that won't take
    // the list) leaves whatever app.json declared, which is the old behavior.
    QuickActions.setItems(quickActionsFor(kitchenEnabled)).catch(() => {});
  }, [kitchenEnabled]);
}
