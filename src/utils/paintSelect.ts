/**
 * Pure geometry for "paint" selection — dragging a finger down the column of
 * selection dots to select a run of rows instead of tapping each one.
 *
 * Kept out of the component (like reorder.ts is for drag-and-drop) so the
 * hit-testing can be reasoned about and tested without a running gesture.
 * Every coordinate here is window-space, because that's the one space a
 * PanResponder's pageX/pageY and a view's measureInWindow already agree on —
 * no scroll offsets or nesting depth to reconcile.
 */

/** A row's measured vertical band on screen. */
export interface PaintRowRect {
  id: string;
  /** Window-space Y of the row's top edge. */
  top: number;
  /** Window-space Y of the row's bottom edge (exclusive). */
  bottom: number;
}

/**
 * Width of the strip along the list's *trailing* edge where a touch starts
 * painting rather than scrolling. Sized to cover the card's outer margin plus
 * the whole selection dot (16 card margin + 16 row padding + 22 dot = 54) with
 * a little slack, and to stop short of the title text so a scroll started
 * anywhere over a row's content behaves exactly as it always has.
 *
 * It used to run along the leading edge, over the completion checkboxes, back
 * when selecting a row was shown by filling that checkbox in. The selection
 * control is now a dot at the other end of the row (see SelectionDot), and the
 * gesture has to be over the thing it changes — a drag down the checkboxes
 * completing nothing while a drag down the dots merely scrolled is exactly
 * backwards. It also no longer contends with the drawer's edge-swipe zone,
 * which claims the first 20px of the leading edge (see AppNavigator).
 */
export const PAINT_GUTTER_WIDTH = 64;

/**
 * Vertical slack when resolving a touch to a row. Cards are separated by a
 * 4px gutter (marginVertical: 2 on each), and without slack a finger crossing
 * that gap reports "no row" — enough of them in a row and a fast drag looks
 * like it skipped one. With it, the gap resolves to whichever neighbour is
 * closer.
 */
export const ROW_HIT_SLOP = 6;

/**
 * Whether a touch should start painting, given its distance from the list's
 * leading edge and the list's own width.
 *
 * A width of 0 means the container hasn't been measured yet, and answers false:
 * without a width there's no trailing edge to be near, and claiming the touch
 * on a guess would take a scroll away from a list that may not even be under
 * the finger.
 */
export function isInPaintGutter(
  x: number,
  containerWidth: number,
  gutterWidth: number = PAINT_GUTTER_WIDTH,
): boolean {
  if (!(containerWidth > 0)) return false;
  return x <= containerWidth && x >= containerWidth - gutterWidth;
}

/**
 * The row `y` falls in, or the nearest one within `slop` when it lands in the
 * gap between two cards. Returns null past the ends of the list, so painting
 * doesn't keep re-triggering the last row once the finger runs off it.
 */
export function rowIdAtY(
  rects: PaintRowRect[],
  y: number,
  slop: number = ROW_HIT_SLOP,
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const dist = Math.max(r.top - y, y - r.bottom, 0);
    if (dist === 0) return r.id;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = r.id;
    }
  }
  return bestDist <= slop ? bestId : null;
}

/**
 * Every row the finger passed through moving from `fromId` to `toId`, in
 * travel order and ending at `toId`. Pointer moves are sampled, not
 * continuous, so a quick flick can jump several rows between two events —
 * filling in the span is what keeps a fast drag from leaving gaps.
 *
 * `rects` must be sorted top to bottom. A null `fromId` (the touch that starts
 * the gesture) yields just the row under it.
 */
export function rowIdsBetween(
  rects: PaintRowRect[],
  fromId: string | null,
  toId: string,
): string[] {
  const to = rects.findIndex(r => r.id === toId);
  if (to < 0) return [];
  const from = fromId === null ? -1 : rects.findIndex(r => r.id === fromId);
  // Unknown origin (e.g. the row it named has since unmounted) is treated the
  // same as no origin: paint the destination only, rather than guessing a span.
  if (from < 0) return [rects[to]!.id];
  if (from === to) return [];
  const step = to > from ? 1 : -1;
  const ids: string[] = [];
  for (let i = from + step; ; i += step) {
    ids.push(rects[i]!.id);
    if (i === to) break;
  }
  return ids;
}
