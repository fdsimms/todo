import { useRef } from 'react';

type Viewable = { index: number | null };

/**
 * Which rows of a `FlatList` are on screen, for a caller that wants to scroll
 * one into view only when it isn't. `scrollToIndex` always moves the list, which
 * is right for a jump and jumpy for a key stepping down it a row at a time.
 *
 * Both props have to keep their identity for the life of the list (a FlatList
 * refuses a changed `onViewableItemsChanged`), so they are made once and spread
 * onto it: `<FlatList {...viewable.props} />`.
 */
export function useViewableRange() {
  const range = useRef<{ first: number; last: number } | null>(null);
  const props = useRef({
    onViewableItemsChanged: ({ viewableItems }: { viewableItems: Viewable[] }) => {
      const indexes = viewableItems.map(v => v.index).filter((i): i is number => i !== null);
      range.current = indexes.length > 0 ? { first: Math.min(...indexes), last: Math.max(...indexes) } : null;
    },
    // A row counts as in view once most of it is, so one cut off at the edge is scrolled to.
    viewabilityConfig: { itemVisiblePercentThreshold: 80 },
  }).current;
  /** True while the row at `index` is on screen, or while nothing has been measured to say it isn't. */
  const isInView = (index: number): boolean => range.current === null || (index >= range.current.first && index <= range.current.last);
  return { props, isInView };
}
