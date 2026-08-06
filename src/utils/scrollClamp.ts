/**
 * Where a vertical list is allowed to come to rest.
 *
 * A scroll view's scrollable range is its content PLUS its content inset, and
 * iOS never re-clamps `contentOffset` when that inset shrinks. A list parked
 * inside an inset that then disappears is left below its own content: it
 * renders blank, and there is no scroll range left to pull it back up. See
 * `useKeyboardInsetScroll` for where such an inset comes from and when this
 * math gets applied.
 */

/**
 * Last offset that still shows the bottom of the content. Content shorter than
 * the viewport rests at the top.
 */
export function maxRestingOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight);
}

/**
 * The offset to snap back to when the list has been left below its content, or
 * null when it is fine where it is.
 *
 * A list that hasn't been measured yet (either dimension still zero) is left
 * alone — there is nothing to compare against. Overshoot within `tolerance` is
 * ignored so sub-pixel layout rounding can't set off a correction.
 */
export function strandedScrollOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number,
  tolerance = 1,
): number | null {
  if (!Number.isFinite(offset) || !Number.isFinite(contentHeight) || !Number.isFinite(viewportHeight)) {
    return null;
  }
  if (contentHeight <= 0 || viewportHeight <= 0) return null;
  const max = maxRestingOffset(contentHeight, viewportHeight);
  return offset > max + tolerance ? max : null;
}
