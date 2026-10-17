// The rules for closing a floating card by pulling it down (quick search). Kept
// apart from the component so the thresholds can be tested; the component owns
// only the gesture plumbing.

/** How far a downward drag has to travel before letting go closes the card. */
export const SWIPE_DISMISS_DISTANCE = 60;
/** A shorter flick still closes it when it is fast enough (points per ms). */
export const SWIPE_DISMISS_VELOCITY = 0.6;
const SWIPE_DISMISS_MIN_FLICK = 20;
/** How far past the top of the results a pull has to reach to close the card. */
export const OVERSCROLL_DISMISS_DISTANCE = 70;

/** A drag counts as a swipe only once it is clearly more down than sideways. */
export function isDownwardDrag(dx: number, dy: number): boolean {
  return dy > 8 && dy > Math.abs(dx) * 1.5;
}

/** Whether releasing a drag of `dy` points at `vy` points per ms should close the card. */
export function shouldDismissOnSwipe(dy: number, vy: number): boolean {
  return dy >= SWIPE_DISMISS_DISTANCE || (dy >= SWIPE_DISMISS_MIN_FLICK && vy >= SWIPE_DISMISS_VELOCITY);
}

/** How far the card travels with the finger: damped, and never upward. */
export function swipeFollowOffset(dy: number): number {
  return dy > 0 ? dy * 0.6 : 0;
}

/** A results list released while pulled past its top by this much (a negative offset) closes the card. */
export function overscrollDismisses(offsetY: number): boolean {
  return offsetY <= -OVERSCROLL_DISMISS_DISTANCE;
}

/** Room for the card: everything between the top inset and the keyboard (or bottom inset), less a gutter. */
export function quickSearchMaxHeight(screenHeight: number, topPad: number, keyboardHeight: number, bottomInset: number, gutter: number): number {
  return Math.max(160, screenHeight - topPad - (keyboardHeight > 0 ? keyboardHeight : bottomInset) - gutter);
}
