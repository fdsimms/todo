/**
 * Where to scroll a Settings group so a searched-for row is on screen.
 *
 * The whole of the arithmetic behind "search takes you to the row", which is
 * otherwise a measurement and a `scrollTo` with nothing in between worth
 * testing. Kept separate because the two edge cases are easy to get wrong and
 * impossible to notice in review: a row near the top of a screen that doesn't
 * scroll, and a row near the bottom of one that does.
 */

/**
 * How much of the screen to leave above the row.
 *
 * Not zero: a row flush against the header reads as the top of the list rather
 * than as the thing that was found, and the section label that says which group
 * it belongs to sits directly above it. Roughly one row's worth.
 */
export const SETTINGS_FOCUS_PADDING = 72;

/**
 * The offset to scroll to, given the row's position in the scroll content.
 *
 * `contentHeight` and `viewportHeight` are optional because they aren't always
 * known by the time the row reports in: without them this only clamps at the
 * top, which is the half that matters. With them it also refuses to scroll
 * past the end, since asking a scroll view for an offset beyond its content
 * leaves it rubber-banded and then settling somewhere the caller didn't ask
 * for — the row ends up higher on screen than intended, or the list bounces.
 */
export function settingsFocusScrollTarget(
  rowY: number,
  contentHeight?: number,
  viewportHeight?: number,
): number {
  if (!Number.isFinite(rowY)) return 0;
  const target = rowY - SETTINGS_FOCUS_PADDING;
  const maxOffset =
    contentHeight !== undefined && viewportHeight !== undefined
      // A content shorter than its viewport doesn't scroll at all, so the
      // ceiling is 0 rather than a negative number.
      ? Math.max(0, contentHeight - viewportHeight)
      : Infinity;
  return Math.max(0, Math.min(target, maxOffset));
}
