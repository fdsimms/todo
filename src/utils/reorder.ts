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
        index = i;
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
        index = i;
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
 * Distance between a scroll view's content coordinate space and the coordinate
 * space an absolutely-positioned sibling overlay uses.
 *
 * A row's content-Y (what `onLayout` reports inside the scroll content) maps to
 * an on-screen position of `contentY - scrollOffset` ONLY when the content
 * starts flush with the top of the overlay's container. A top content inset —
 * iOS keyboard-inset adjustment, safe-area inset adjustment, a scroll view that
 * doesn't start at the container's top edge — shifts everything down by a
 * constant the JS side never sees. Measuring one row's real on-screen position
 * recovers that constant, so the floating drag card and the drop slot stay in
 * the same coordinate space instead of drifting apart by the inset.
 */
export function contentOriginOffset(
  measuredOnScreenTop: number,
  rowContentY: number,
  scrollOffset: number,
): number {
  return measuredOnScreenTop - (rowContentY - scrollOffset);
}

/**
 * Top offset (in content coordinates) of the gap that opens for the dragged
 * item — i.e. where its placeholder slot should be drawn and where the
 * floating card should glide to on drop.
 */
export function dropSlotY(heights: number[], activeIndex: number, hoverIndex: number): number {
  const offsets = cumulativeOffsets(heights);
  const activeHeight = heights[activeIndex] ?? 0;
  if (hoverIndex >= activeIndex) {
    return (offsets[hoverIndex] ?? 0) + (heights[hoverIndex] ?? 0) - activeHeight;
  }
  return offsets[hoverIndex] ?? 0;
}

