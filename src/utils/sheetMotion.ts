/**
 * How far a bottom sheet's card travels to come on or go off screen.
 *
 * Every hand-built bottom sheet used to park its card a whole window height
 * below rest (`useSheetHiddenOffset`) and spring it from there. That clears any
 * card, which is why it was chosen, but a 300pt menu then spends most of its
 * entrance off screen: the tap seemed to do nothing for a beat, and the
 * dismissal, a spring that only reports done once it has settled to a
 * thousandth of a point over 844 of them, held the modal (and every touch
 * behind it) for over a second after the card had already gone.
 *
 * So the travel is the card's own measured height, which is exactly enough to
 * take it off screen, and only falls back to the window before the card has
 * reported a layout. A keyboard up at the time adds its height, since a card
 * lifted clear of the keyboard has that much further to go; overshooting by a
 * keyboard on a card that wasn't lifted only makes it leave a little faster.
 */

/** Extra distance past the card's own edge, so its shadow leaves too. */
export const SHEET_TRAVEL_SLACK = 24;

export function sheetTravel(
  cardHeight: number | null,
  windowHeight: number,
  keyboardHeight = 0,
): number {
  if (cardHeight === null || !(cardHeight > 0)) return windowHeight;
  return Math.min(windowHeight, cardHeight + Math.max(0, keyboardHeight) + SHEET_TRAVEL_SLACK);
}
