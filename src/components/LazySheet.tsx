import React from 'react';
import { useSheetMount } from '../hooks/useSheetMount';

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
 */
export function LazySheet({ open, children }: { open: boolean; children: React.ReactNode }) {
  return useSheetMount(open) ? <>{children}</> : null;
}
