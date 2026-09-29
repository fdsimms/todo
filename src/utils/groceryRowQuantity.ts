/**
 * Where a grocery row puts its quantity: in the pill beside the name, or on a
 * line of its own under it (#2946).
 *
 * The pill beside the name is capped at 90pt and wraps to two lines inside
 * that cap. For a quantity carrying a recipe's prep instructions ("2 x 14 oz
 * cans, drained", "2 lb, cut into 1-inch pieces") that cap is where the row
 * went wrong twice over: the pill held the full 90pt and the name got what was
 * left, about 80pt during a trip (beside the price icon) and about 116pt
 * without one, while the quantity itself was cut off at the end of its second
 * line. Under the name it has the whole width of the text column, so a long
 * quantity reads in full and the name gets the row back.
 *
 * A short quantity ("1 lb", "500 g", "1 dozen") stays beside the name, so only
 * the rows that need it get taller.
 *
 * How the threshold was chosen, from the row's own numbers rather than
 * measured in the app (there is no way to measure SF Pro's rendering here):
 *
 * - The pill's 90pt cap, less its 8pt padding either side, leaves 74pt of text.
 * - Quantity text is font.sm (13pt) semibold, and a quantity is a mix of
 *   digits, spaces and lowercase letters, which runs about 7pt a character.
 * - So ten characters fill one line of the capped pill, and an eleventh is
 *   where it hits the cap and wraps onto a second line. That capped two-line
 *   pill is exactly the one the issue's width arithmetic measured.
 *
 * Kept beside the name, then, a quantity always fits on one line of a pill no
 * wider than about 86pt. In the tightest row (a trip running, so the price
 * icon sits beside it too) that leaves the name at least about 84pt, and
 * 100-130pt for the short quantities most rows carry. Outside a trip it is
 * never under about 120pt.
 *
 * The rule is the same with or without a trip. A long quantity overflows its
 * pill either way, and a rule that only applied during a trip would move every
 * long quantity on the list the moment a trip started.
 *
 * Counted in characters of the text the row displays (after unit conversion,
 * so a "≈" the conversion adds counts), which is all a width estimate this
 * rough can honestly be based on.
 */
export const QUANTITY_BESIDE_NAME_MAX_CHARS = 10;

/**
 * True when `shownQuantity` is short enough to sit in the pill beside the
 * name, false when the row should put it on its own line under the name.
 * An empty quantity has nothing to move and reads as fitting.
 */
export function quantityFitsBesideName(shownQuantity: string): boolean {
  // By code point rather than UTF-16 unit, so a character outside the basic
  // plane still counts once.
  return Array.from(shownQuantity.trim()).length <= QUANTITY_BESIDE_NAME_MAX_CHARS;
}
