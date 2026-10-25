import React, { useEffect, useState } from 'react';
import { useSheetMount } from '../hooks/useSheetMount';
import { runAfterTransition } from '../utils/afterPaint';

/**
 * Mounts a sheet the first time it opens, and keeps it from then on.
 *
 * `useSheetMount` as a wrapper, for a screen holding many sheets at once. A
 * sheet mounted for the life of its screen is not free while it sits closed:
 * its hooks subscribe to their stores and re-render on every write to them,
 * and on a tab screen every one of its effects runs again each time the tab
 * is shown (see `FreezeWhenBlurred`). Groceries carried a dozen such sheets,
 * most of which a given visit never opens.
 *
 * Kept once opened rather than unmounted on close, for the reason
 * `useSheetMount` gives: a sheet torn out of the tree can't hold its own close
 * back. The sheet inside still takes `visible` as its own expression, the same
 * one passed here as `open`.
 *
 * ```tsx
 * <LazySheet open={catalogOpen}>
 *   <GroceryCatalogSheet visible={catalogOpen} onClose={closeCatalog} />
 * </LazySheet>
 * ```
 *
 * **`warm` is for a sheet that is opened often and costs a lot to build**
 * (the task editor). Mounted only on first open, its whole first render lands
 * on the tap that asked for it. `warm` builds it once the screen's own
 * animations and first paint are done instead, so the screen opens without it
 * and the first tap still finds it ready. It changes only when the sheet is
 * built; a sheet that is warmed stays mounted exactly as an opened one does.
 */
export function LazySheet({
  open,
  warm = false,
  children,
}: {
  open: boolean;
  warm?: boolean;
  children: React.ReactNode;
}) {
  const opened = useSheetMount(open);
  const [warmed, setWarmed] = useState(false);
  useEffect(() => {
    // Effects run again each time a frozen tab comes back; once warmed there
    // is nothing left to schedule.
    if (!warm || warmed) return;
    const handle = runAfterTransition(() => setWarmed(true));
    return () => handle.cancel();
  }, [warm, warmed]);
  return opened || warmed ? <>{children}</> : null;
}
