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
 * Last offset the scroll view is allowed to come to rest at — the same limit
 * UIKit bounces back to, which is why `insetBottom` belongs in it: a bottom
 * content inset extends the scrollable range past the end of the content, and
 * resting inside it is legitimate rather than stranded. Content shorter than
 * the viewport (with no inset) rests at the top.
 */
export function maxRestingOffset(
  contentHeight: number,
  viewportHeight: number,
  insetBottom = 0,
): number {
  return Math.max(0, contentHeight + insetBottom - viewportHeight);
}

/**
 * The offset to snap back to when the list has been left below its content, or
 * null when it is fine where it is.
 *
 * `insetBottom` is the bottom content inset the list is entitled to *right
 * now* — pass the live one to judge a settled scroll, and 0 when the inset is
 * on its way out (a keyboard dismissal), which is the moment stranding
 * actually happens.
 *
 * A list that hasn't been measured yet (either dimension still zero) is left
 * alone — there is nothing to compare against. Overshoot within `tolerance` is
 * ignored so sub-pixel layout rounding can't set off a correction.
 */
export function strandedScrollOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number,
  insetBottom = 0,
  tolerance = 1,
): number | null {
  if (!Number.isFinite(offset) || !Number.isFinite(contentHeight) || !Number.isFinite(viewportHeight)) {
    return null;
  }
  if (!Number.isFinite(insetBottom)) return null;
  if (contentHeight <= 0 || viewportHeight <= 0) return null;
  const max = maxRestingOffset(contentHeight, viewportHeight, insetBottom);
  return offset > max + tolerance ? max : null;
}

/**
 * The two values a list alternates between to assert "I impose no bottom inset
 * of my own".
 *
 * Both mean the same thing, and that is the point. `contentInset` is the only
 * lever JS has over an inset the native side has already applied — it assigns
 * the scroll view's inset wholesale — but it does so ONLY when the prop's value
 * *changes* (`RCTScrollViewComponentView.mm`: `oldProps.contentInset !=
 * newProps.contentInset`). So "set it back to zero" cannot be written as a
 * constant: a list already reporting zero would go on carrying whatever the
 * keyboard handler last left on it. Alternating is what makes the assignment
 * happen at all.
 *
 * The alternate is far below one device pixel even at 3x (1/3 pt), so the
 * scroll range it opens is invisible, and it sits well inside
 * `strandedScrollOffset`'s tolerance so it can never read as an overshoot. The
 * native keyboard handler takes the prop as a floor (`MAX(computed, prop)`),
 * which neither value can raise.
 */
export const NO_INSET = 0;
export const NO_INSET_ALT = 0.01;

/** The other one — never the value passed in, whatever that was. */
export function pulseNoInset(previous: number): number {
  return previous === NO_INSET ? NO_INSET_ALT : NO_INSET;
}
