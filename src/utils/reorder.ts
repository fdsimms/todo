/**
 * Pure helpers for variable-height drag reordering, kept separate from the
 * component so the fiddly index math can be unit-tested without a device.
 */

/** Move the item at `from` to `to`, returning a new array. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  if (from < 0 || from >= copy.length || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item);
  return copy;
}

/**
 * Given the (original-order) heights of every row, the index of the row being
 * dragged, and how far the finger has moved vertically, return the index the
 * dragged row should move to.
 *
 * Works with arbitrary per-row heights (task cards, short section headers) by
 * walking real neighbour heights and crossing a neighbour only once the finger
 * passes its midpoint. Purely a function of the drag delta, so it's independent
 * of scroll position and of any intermediate reordering.
 *
 * **A zero-height row is walked past but never landed on.** Rows a caller has
 * rendered as nothing still sit in the data (the Today list hides every task
 * under a category header for the duration of a category drag, render-only, so
 * `onReorder` still gets the whole list back), and a slot with no height is
 * indistinguishable on screen from its neighbour's: dropping either side of it
 * lays the rows out identically. Landing on one is therefore a hover change the
 * user cannot see — which is exactly what the drag tick fires on, so crossing
 * one collapsed header used to buzz twice, once at its midpoint and again at
 * its far edge.
 */
export function dropIndexFromTranslation(
  heights: number[],
  fromIndex: number,
  translationY: number,
): number {
  let index = fromIndex;
  if (translationY < 0) {
    // Moving up: cross rows above as the finger passes their midpoints.
    let boundary = 0;
    for (let i = fromIndex - 1; i >= 0; i--) {
      boundary -= heights[i];
      if (translationY <= boundary + heights[i] / 2) {
        if (heights[i] > 0) index = i;
      } else {
        break;
      }
    }
  } else if (translationY > 0) {
    // Moving down.
    let boundary = 0;
    for (let i = fromIndex + 1; i < heights.length; i++) {
      boundary += heights[i];
      if (translationY >= boundary - heights[i] / 2) {
        if (heights[i] > 0) index = i;
      } else {
        break;
      }
    }
  }
  return index;
}

/** Cumulative top offset of each row, given their heights in order. */
export function cumulativeOffsets(heights: number[]): number[] {
  const offsets: number[] = [];
  let y = 0;
  for (const h of heights) {
    offsets.push(y);
    y += h;
  }
  return offsets;
}

/**
 * Vertical shift to apply to the row at `index` while a drag is in progress,
 * so the resting rows open a gap for the dragged item at `hoverIndex`.
 *
 * Rows are rendered in their original order (which keeps the scroll layout
 * stable so transforms animate reliably); only the rows between the dragged
 * item's origin and its hover target move, each by one dragged-item height.
 */
export function rowDragOffset(
  index: number,
  activeIndex: number,
  hoverIndex: number,
  activeHeight: number,
): number {
  if (index === activeIndex) return 0;
  if (hoverIndex > activeIndex && index > activeIndex && index <= hoverIndex) {
    return -activeHeight;
  }
  if (hoverIndex < activeIndex && index >= hoverIndex && index < activeIndex) {
    return activeHeight;
  }
  return 0;
}

/**
 * Index of the row whose resting bounds contain `y` (content coordinates),
 * or null if `y` falls outside every row.
 *
 * Unlike dropIndexFromTranslation — which answers "which slot would this drop
 * into", walking midpoints — this answers "which row is the floating card
 * physically on top of right now". Callers use it for drop targets that are a
 * whole row rather than a gap between rows (e.g. dropping a task onto a group
 * to join it), where the natural hit area is the row itself.
 */
export function rowIndexAtContentY(tops: number[], heights: number[], y: number): number | null {
  for (let i = 0; i < tops.length; i++) {
    const top = tops[i] ?? 0;
    if (y >= top && y < top + (heights[i] ?? 0)) return i;
  }
  return null;
}

/**
 * Inclusive [min, max] index range the row at `activeIndex` may move to
 * without crossing a "boundary" row (e.g. a section header) on either side.
 * Used to keep drags confined to their own section.
 */
export function dragRange<T>(data: T[], activeIndex: number, isBoundary: (item: T) => boolean): [number, number] {
  let lo = activeIndex;
  while (lo > 0 && !isBoundary(data[lo - 1])) lo--;
  let hi = activeIndex;
  while (hi < data.length - 1 && !isBoundary(data[hi + 1])) hi++;
  return [lo, hi];
}

/**
 * How far the floating drag card has moved from the dragged row's resting slot
 * — the translation `dropIndexFromTranslation` wants.
 *
 * Derived from where the card actually is (`cardTop`, on-screen) against the
 * row's CURRENT content-Y, rather than from how far the finger has travelled
 * since the drag began. The two agree exactly — this is `fingerDelta +
 * scrollDelta` — for as long as the list holds still, because the card's
 * anchor was pinned to `rowContentY - scrollOffset` at drag start. They stop
 * agreeing the moment the list re-lays out underneath a live drag: a category
 * header's drag auto-collapses every section, so the row it started from moves
 * up by however many task rows were above it, and a finger delta measured from
 * the old layout then describes a slot that no longer exists. Re-deriving each
 * move keeps the drop gap under the card — and so under the finger the card is
 * anchored to — however far the layout shifts.
 *
 * **`rowContentY` has to be the row's live position, and it is the one input
 * here that JS can be wrong about.** It comes from `onLayout` bookkeeping, and
 * the auto-collapse that makes this function necessary is exactly the event
 * that outruns those callbacks. A stale value aims the whole drag at a slot
 * that no longer exists — the gap opens a screenful from the card. That is why
 * the caller overwrites it with `measureLayout`, which reports the row's
 * position in the layout tree and so answers the same question from the shadow
 * tree itself.
 *
 * There is deliberately no "content origin" term. `measureLayout` and
 * `onLayout` report in the same layout space, and the scroll view's content
 * starts at the drag container's own origin, so a row's content-Y needs only
 * the scroll offset to become an on-screen position. A `contentInset` (the iOS
 * keyboard adjustment) does NOT change that: it lives in native scroll
 * geometry, where it moves `contentOffset` — which `onScroll` already reports,
 * negative and all — and never touches the layout tree. An earlier version
 * solved for an inset term out of one row's measurement, which could only ever
 * come back non-zero when that row's content-Y was stale, then applied that
 * staleness to every other row and kept it for the next drag.
 */
export function dragTranslation(
  cardTop: number,
  rowContentY: number,
  scrollOffset: number,
): number {
  return cardTop - (rowContentY - scrollOffset);
}

/**
 * How far a list has to move for the slot a drag is aimed at to sit back under
 * the floating card, split into the part scrolling can do and the part it
 * can't.
 *
 * The card is anchored to the finger, which is right up until the list re-lays
 * out underneath it: a category header's drag collapses every section away, so
 * the rows it can move among close up to a short run at the top of the screen
 * while the finger stays wherever it grabbed from — a screenful below, if the
 * header was dragged from far down a scrolled list. The card can't be the thing
 * that gives way (see alignListToCard), so the list moves back under it.
 *
 * Scrolling is free — it moves the content without re-laying anything out — so
 * it goes first, bounded by the offsets that exist. `pad` is the rest: pushing
 * content *down* past a scroll offset of zero takes empty space above the first
 * row, and a collapse that shortens a list is exactly what pins it to the top.
 *
 * `drop` is positive when the content has to move down the screen, which is a
 * scroll toward zero — hence the sign flip on `scrollTo`.
 */
export function alignmentMove(
  drop: number,
  scrollOffset: number,
  maxScrollOffset: number,
): { scrollTo: number; pad: number } {
  const scrollTo = Math.max(0, Math.min(Math.max(0, maxScrollOffset), scrollOffset - drop));
  return { scrollTo, pad: drop - (scrollOffset - scrollTo) };
}

/**
 * Fold a reordering of *some* of a list's ids back into the full order.
 *
 * A list that only shows part of a set can still be dragged — a stack on Today
 * renders just the members due today, not the whole roster — and renumbering
 * only what was on screen (1..n over the visible rows) throws away where the
 * rows nobody could see were sitting. `ordered` is laid back into the exact
 * slots those ids already occupied in `all`, so every other id keeps its
 * neighbours.
 *
 * Ids in `ordered` that aren't in `all` are ignored; ids in `all` that aren't
 * in `ordered` don't move.
 */
export function reorderSubset(all: string[], ordered: string[]): string[] {
  const moving = ordered.filter(id => all.includes(id));
  const slots = new Set(moving);
  let next = 0;
  return all.map(id => (slots.has(id) ? moving[next++]! : id));
}


