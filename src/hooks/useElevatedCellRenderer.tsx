import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { View, type ViewProps } from 'react-native';

// Same zIndex/elevation pair ReorderableList's own `rowElevated` style reaches
// for — see that component's doc comment.
const ELEVATED_STYLE = { zIndex: 10, elevation: 10 } as const;

/**
 * A `FlatList` `CellRendererComponent` that lifts one row (by key) above its
 * neighbours — the `FlatList` half of the trick `ReorderableList`'s
 * `rowElevated` prop already does for its own, non-virtualized lists. That one
 * sets the style directly on each row's wrapper `View`, which works because
 * every row there is a plain sibling in a `ScrollView` and paints in DOM
 * order. A genuine `FlatList` wraps every row in its own internal cell
 * instead, and cells paint in list order regardless of content height — so an
 * expanded row's shadow or any other overflow is clipped by the *next* cell
 * down unless that cell's own zIndex is raised, which only
 * `CellRendererComponent` can reach.
 *
 * **The returned component's identity never changes.** `CellRendererComponent`
 * is compared by identity, so building one inline in render (a fresh arrow
 * function every time) makes `FlatList` remount every cell on every render —
 * discarding whatever state each row's own subtree was holding (an in-progress
 * edit, a subtask's expanded state, a focused field). This hook builds it
 * once and threads the elevated key through a tiny external store instead, so
 * only the cell whose elevated-ness actually flips ever re-renders, and no
 * cell is ever remounted because of it.
 *
 * `getKey` is only ever read from the render that first mounts the calling
 * component — pass a pure, stable extraction (`item => item.id`), never one
 * that closes over changing outer state.
 */
export function useElevatedCellRenderer<T>(
  getKey: (item: T) => string,
  elevatedKey: string | null
) {
  const store = useRef({ key: elevatedKey, listeners: new Set<() => void>() }).current;

  // Synced after commit, not during render, so a store write can never race
  // React's own render pass — same reasoning any external-store bridge needs.
  useEffect(() => {
    store.key = elevatedKey;
    store.listeners.forEach(l => l());
  }, [store, elevatedKey]);

  return useMemo(() => {
    function ElevatedCellRenderer({ item, style, children, ...rest }: ViewProps & { item: T }) {
      const key = getKey(item);
      const elevated = useSyncExternalStore(
        listener => {
          store.listeners.add(listener);
          return () => store.listeners.delete(listener);
        },
        () => store.key === key
      );
      return (
        <View style={[style, elevated && ELEVATED_STYLE]} {...rest}>
          {children}
        </View>
      );
    }
    return ElevatedCellRenderer;
    // Deliberately empty — see the doc comment above. `store` is a ref and
    // `getKey` is assumed stable, so nothing here should ever change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
