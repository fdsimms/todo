import { useEffect } from 'react';
import * as QuickActions from 'expo-quick-actions';
import { resetToSearch, openQuickAddFromShortcut } from '../navigation/navigationRef';
import { openScreenByName } from '../navigation/openScreen';
import { isDemoModeActive } from './demoState';
import { screenSymbol } from './screenLinks';

/**
 * The Home Screen actions, and the one place their ids are matched back to a
 * destination.
 *
 * Two lists, because iOS shows an app's static actions first and only then
 * as many dynamic ones as still fit. `STATIC_ACTIONS` is app.json's
 * expo-quick-actions `iosActions`, the only thing the icon offers before the
 * app has ever run, and it is kept to Add Task: four static actions filled
 * every slot, so the dynamic list (and the kitchen switch dropping Groceries
 * from it) never reached the icon. The dynamic half is `quickActionsFor`:
 * the screens you went to last, then your tabs, then Search.
 */
export const STATIC_ACTIONS: QuickActions.Action[] = [
  { id: 'add', title: 'Add Task', icon: 'symbol:square.and.pencil' },
];

const SEARCH_ACTION: QuickActions.Action = { id: 'search', title: 'Search', icon: 'symbol:magnifyingglass' };

/** A screen the icon offers, by route and the label the menu gives it. */
export interface QuickActionScreen {
  route: string;
  label: string;
}

const SCREEN_ID_PREFIX = 'screen:';

/** The dynamic actions: the screens `quickActionScreens` picked, then Search. */
export function quickActionsFor(screens: readonly QuickActionScreen[]): QuickActions.Action[] {
  return [
    ...screens.map(screen => ({
      id: `${SCREEN_ID_PREFIX}${screen.route}`,
      title: screen.label,
      icon: `symbol:${screenSymbol(screen.route)}`,
    })),
    SEARCH_ACTION,
  ];
}

/**
 * Routes a pressed action to its destination, returning true when it did.
 *
 * A screen goes through `openScreenByName`, which lands only on a screen the
 * menu offers right now, so an action left on the icon from before a switch
 * took its screen away does nothing rather than reopening it. `groceries` and
 * `projects` are the old fixed actions, still answered for an icon that
 * hasn't been republished since the update.
 */
export function handleQuickActionId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id.startsWith(SCREEN_ID_PREFIX)) return openScreenByName(id.slice(SCREEN_ID_PREFIX.length));
  switch (id) {
    case 'groceries':
      return openScreenByName('Groceries');
    case 'projects':
      return openScreenByName('Projects');
    case 'search':
      resetToSearch();
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
// It also re-publishes the action list whenever the screens it offers change
// (a new recent screen, a tab swapped, a switch taking a screen away), keyed
// on the routes so a visit that leaves the picks alone writes nothing.
export function useHomeScreenQuickActions(screens: readonly QuickActionScreen[]): void {
  useEffect(() => {
    if (QuickActions.initial) handleQuickActionId(QuickActions.initial.id);
    const sub = QuickActions.addListener(action => handleQuickActionId(action.id));
    return () => sub.remove();
  }, []);

  const key = screens.map(s => `${s.route}:${s.label}`).join('|');
  useEffect(() => {
    publishQuickActions(screens);
  }, [key]);
}

/**
 * Writes the dynamic actions to the Home Screen icon. Fire and forget: an
 * unsupported platform (or a device that won't take the list) leaves the
 * static Add Task alone.
 *
 * Not in demo mode: the icon's menu lives outside the app's database, and the
 * screens are then read off the demo's history and settings, so the real icon
 * would be rewritten to match a throwaway configuration. The real list
 * publishes again when demo mode ends and the stores reload, if it differs.
 */
export function publishQuickActions(screens: readonly QuickActionScreen[]): void {
  if (isDemoModeActive()) return;
  QuickActions.setItems(quickActionsFor(screens)).catch(() => {});
}
