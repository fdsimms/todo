import { useCallback, useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

interface MountBudget {
  /** Initial cap, i.e. what a switch into this list has to mount before it paints. */
  initial: number;
  /** Cap to grow to once that first commit has settled. */
  settled: number;
  /** How much each loadMore() adds. */
  page: number;
}

/**
 * A growing cap on how many rows an unvirtualized list may mount.
 *
 * Both of TodayScreen's drag-reorderable lists render every row they're handed
 * — ReorderableList is a plain ScrollView by design, so the drag can measure
 * real resting layouts — and a TaskItem is not a cheap row (four store
 * subscriptions, a PanResponder and several animated values each). Handing the
 * whole list over at once puts all of that in the same blocking commit as the
 * tab switch, which is a visible stall between the tap and the view changing.
 *
 * So: mount about a screenful, then top up to the settled size as soon as that
 * commit is done, so the rest is already there by the time anyone can scroll to
 * it. `active` going false resets the budget — these lists unmount when their
 * sub-view is switched away from and come back scrolled to the top, so anything
 * paged in is just rows the next switch would pay to mount off-screen.
 */
export function useMountBudget(active: boolean, { initial, settled, page }: MountBudget) {
  const [limit, setLimit] = useState(initial);

  useEffect(() => {
    if (!active) {
      setLimit(initial);
      return;
    }
    const handle = InteractionManager.runAfterInteractions(() => {
      setLimit(current => Math.max(current, settled));
    });
    return () => handle.cancel();
  }, [active, initial, settled]);

  const loadMore = useCallback(() => setLimit(current => current + page), [page]);

  return { limit, loadMore };
}
