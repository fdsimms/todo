import { useEffect } from 'react';
import * as QuickActions from 'expo-quick-actions';
import {
  resetToGroceries,
  resetToSearch,
  resetToProjects,
  openQuickAddFromShortcut,
} from '../navigation/navigationRef';

// The four static actions declared in app.json's expo-quick-actions plugin
// config (`iosActions`) — this is the one place their ids are matched back
// to a destination. Keep the id list in sync with app.json if either changes.
export function handleQuickActionId(id: string | null | undefined): boolean {
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
export function useHomeScreenQuickActions(): void {
  useEffect(() => {
    if (QuickActions.initial) handleQuickActionId(QuickActions.initial.id);
    const sub = QuickActions.addListener(action => handleQuickActionId(action.id));
    return () => sub.remove();
  }, []);
}
