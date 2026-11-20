import React, { useEffect, useState } from 'react';
import { useSheetMount } from '../hooks/useSheetMount';
import { runAfterTransition } from '../utils/afterPaint';

/** How long the JS thread is left free between one warmed sheet's build and the next. */
const WARM_UP_GAP_MS = 250;

const warmUps: (() => void)[] = [];
let warming = false;

function buildNextWarmUp(): void {
  const build = warmUps.shift();
  if (!build) {
    warming = false;
    return;
  }
  build();
  setTimeout(buildNextWarmUp, WARM_UP_GAP_MS);
}

/** Queues one sheet's build behind any already waiting. Returns the call that takes it back out. */
function queueWarmUp(build: () => void): () => void {
  warmUps.push(build);
  if (!warming) {
    warming = true;
    buildNextWarmUp();
  }
  return () => {
    const at = warmUps.indexOf(build);
    if (at >= 0) warmUps.splice(at, 1);
  };
}

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
 * **A closed sheet is not rendered again until it opens.** Once mounted, a
 * sheet was re-rendered by every render of its screen, with most of them
 * handed new closures as props so no memo of their own could help: on Today
 * that was every sheet opened so far in the session, on each render of the
 * screen. While `open` was false last render and is false now, this hands
 * back what it rendered then. The render that closes a sheet still reaches it
 * (it carries `visible={false}`), and so does the one that opens it, with the
 * props as they then stand, so a prop that changed while it sat closed is
 * picked up on opening. The sheet's own state, stores and effects are not
 * affected. This is why `open` must be true whenever the sheet's own
 * `visible` is: a sheet showing while `open` is false would stop following
 * its screen.
 *
 * **`warm` is for a sheet that is opened often and costs a lot to build**
 * (the task editor). Mounted only on first open, its whole first render lands
 * on the tap that asked for it. `warm` builds it once the screen's own
 * animations and first paint are done instead, so the screen opens without it
 * and the first tap still finds it ready. It changes only when the sheet is
 * built; a sheet that is warmed stays mounted exactly as an opened one does.
 *
 * Warmed sheets are built one at a time, `WARM_UP_GAP_MS` apart, in the order
 * they sit on the screen. A screen with two (the task editor and quick add on
 * every detail page) used to build both back to back the moment the
 * transition settled: two long renders with nothing between them, exactly when
 * someone who has just arrived makes their first tap. The gap lets that tap in.
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
    let leaveQueue: (() => void) | null = null;
    const handle = runAfterTransition(() => {
      leaveQueue = queueWarmUp(() => setWarmed(true));
    });
    return () => {
      handle.cancel();
      leaveQueue?.();
    };
  }, [warm, warmed]);
  return opened || warmed ? <HeldWhileClosed open={open}>{children}</HeldWhileClosed> : null;
}

/** Renders its children, except from closed to closed, when it keeps the last render. */
const HeldWhileClosed = React.memo(
  function HeldWhileClosed({ children }: { open: boolean; children: React.ReactNode }) {
    return <>{children}</>;
  },
  (prev, next) => !prev.open && !next.open,
);
