/**
 * Where a grocery row puts its quantity: in the pill beside the name, or on a
 * line of its own under it (#2946). RecipeToListSheet's lines ask the same
 * question about the same pill, so they use this too.
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
 * There are two halves to the rule, and a quantity moves when either says so.
 *
 * **The quantity's length.** More than ten characters always moves. How the
 * threshold was chosen, from the row's own numbers rather than measured in the
 * app (there is no way to measure SF Pro's rendering here):
 *
 * - The pill's 90pt cap, less its 8pt padding either side, leaves 74pt of text.
 * - Quantity text is font.sm (13pt) semibold, and a quantity is a mix of
 *   digits, spaces and lowercase letters, which runs about 7pt a character.
 * - So ten characters fill one line of the capped pill, and an eleventh is
 *   where it hits the cap and wraps onto a second line. That capped two-line
 *   pill is exactly the one the issue's width arithmetic measured.
 *
 * This half is the same with or without a trip. A long quantity overflows its
 * pill either way, and a rule that only applied during a trip would move every
 * long quantity on the list the moment a trip started.
 *
 * **The name's length.** A quantity short enough for one line of the pill can
 * still leave too little beside it for the name. In the tightest grocery row
 * (a trip running, so the price icon claims 36pt of it too) a ten-character
 * quantity leaves the name about 84pt, and "Fire-roasted diced tomatoes" came
 * out cut to two lines of "Fire-roasted / diced…". So when the name is given,
 * the quantity also moves if the name wouldn't fit in its lines beside the
 * pill. The same arithmetic, carried over to the name:
 *
 * - The pill is as wide as its text at the same 7pt a character, plus its
 *   16pt of padding, never past the 90pt cap.
 * - The name gets what the row leaves after the pill and the gap before it
 *   (`NameRowSpace`, worked out per surface below).
 * - A character of the name runs the same share of its font size as the
 *   quantity's does, 7/13, so about 9.2pt at the grocery row's font.lg (17pt)
 *   and about 8.1pt at the recipe sheet's font.md (15pt). Measured in the
 *   three sans fonts this sandbox has (Liberation Sans, which has Helvetica's
 *   widths, DejaVu Sans and FreeSans; there is no SF Pro here), a list of
 *   grocery names and a list of quantities came out within 1% of each other
 *   a character, so the name takes the quantity's own rate rather than one
 *   of its own. The same measurements put both at 0.46 to 0.54 of the font
 *   size, so 7/13 is at the wide end: it errs toward moving the quantity
 *   rather than cutting the name.
 * - The name is wrapped a word at a time into lines that many characters
 *   wide, breaking after a space or a hyphen the way iOS does, and a word
 *   longer than a whole line carried on across lines by character, which is
 *   also what iOS does with it. The name fits when that takes no more lines
 *   than the name is given (two, on both surfaces).
 *
 * At 390pt that puts nine characters on each of the name's two lines in the
 * tightest grocery row: "Greek yogurt" still fits beside "2 x 400 ml",
 * "Fire-roasted diced tomatoes" doesn't. With a quantity of seven characters
 * or fewer, which most rows carry, the name has eleven or more a line, so
 * short names with short quantities stay exactly as they were.
 *
 * Unlike the length half, this one depends on the row's state, because the
 * state really does change what the name gets: starting a trip adds the price
 * icon beside it. A row whose name fits without the icon and not with it is
 * exactly the one that would otherwise be cut. What would move a quantity for
 * no reason is kept out: see `groceryRowNameSpace`.
 *
 * Counted in characters of the text each row displays (after unit conversion,
 * so a "≈" the conversion adds counts), which is all a width estimate this
 * rough can honestly be based on. Larger accessibility text sizes widen every
 * character and aren't counted, the same as the 10-character threshold.
 */
export const QUANTITY_BESIDE_NAME_MAX_CHARS = 10;

// The width arithmetic both halves share, from the styles' own numbers: see
// above for where each comes from.

/** About 7pt a character at font.sm (13pt): 7/13 of a font size. */
const CHAR_WIDTH_PER_FONT_PT = 7 / 13;
/** The quantity's font size, font.sm. */
const QUANTITY_FONT_SIZE = 13;
/** The pill's 8pt (spacing.sm) of padding either side. */
const PILL_PADDING = 16;
/** The pill's cap, `maxWidth: 90` on both surfaces' `qtyPill`. */
const PILL_MAX_WIDTH = 90;

/**
 * What the name, the pill beside it and the gap between them share on one
 * surface in one state. Built by `groceryRowNameSpace` and
 * `recipeToListNameSpace` rather than by hand, so the arithmetic lives here
 * with the rest.
 */
export interface NameRowSpace {
  /** Points the name's column, the gap and the side pill share. */
  width: number;
  /** The gap between the name's column and the pill. */
  gap: number;
  /** The name's font size, which sets how wide a character of it runs. */
  nameFontSize: number;
  /** How many lines the name wraps to before it is cut (its numberOfLines). */
  nameLines: number;
}

/**
 * The grocery row (GroceryRow.tsx) on a screen `screenWidth` wide, taking off
 * everything on the row that isn't the name or the pill:
 *
 * - The card's 16pt inset either side (itemWrapper) and the row's 16pt
 *   padding either side (row): 64.
 * - The checkbox (24), the ellipsis icon (16) and, when the row offers
 *   substitutes, the swap icon (16), each with one of the row's 16pt gaps: 80,
 *   or 48 without the swap icon.
 * - During a trip, the price icon's 20pt box and the 16pt gap before it: 36.
 *
 * At 390pt that leaves 222 for the name, the gap and the pill, and 186 during
 * a trip, which are the issue's own numbers.
 *
 * Counted as the row stands outside selection mode, even while selecting,
 * where the selection dot takes the swap and ellipsis icons' slot and the
 * price icon hides. And the price icon is counted for the whole trip, even
 * once a price is recorded and the icon gives way to the price's own line
 * under the name. Read literally, either one would move a quantity back beside
 * the name the moment the user started selecting or typed a price, and a row
 * rearranging itself under the finger is worse than a name with a little room
 * to spare.
 */
export function groceryRowNameSpace(
  screenWidth: number,
  row: { tripRunning: boolean; substitutesIcon: boolean },
): NameRowSpace {
  const chrome =
    64 + // card inset and row padding
    (24 + 16) + // checkbox
    (16 + 16) + // ellipsis
    (row.substitutesIcon ? 16 + 16 : 0) +
    (row.tripRunning ? 20 + 16 : 0);
  return { width: screenWidth - chrome, gap: 16, nameFontSize: 17, nameLines: 2 };
}

/**
 * A line of RecipeToListSheet on a screen `screenWidth` wide (the sheet is a
 * page sheet, full width on a phone), taking off everything on the line that
 * isn't the name or the pill:
 *
 * - The list's 16pt padding either side and the row's 16pt either side: 64.
 * - The checkbox (22) and the 16pt gap after it: 38.
 * - The trailing buttons, each after the row's 8pt gap. The substitutes
 *   button is a 16pt icon with 8pt padding either side (32), plus a count past
 *   one substitute (a 2pt gap and its digits at font.xs, 12pt, at the same 7/13
 *   of a font size a character). On a Need to buy line, the pantry button is
 *   InlineAction's icon-only pill, a 14pt icon with 8pt either side (30).
 *
 * At 390pt that leaves 288 with neither button, 250 with the pantry button,
 * and 210 with it and one substitute.
 */
export function recipeToListNameSpace(
  screenWidth: number,
  row: { substitutes: number; pantryButton: boolean },
): NameRowSpace {
  const countWidth =
    row.substitutes > 1 ? 2 + String(row.substitutes).length * 12 * CHAR_WIDTH_PER_FONT_PT : 0;
  const chrome =
    64 + // list and row padding
    (22 + 16) + // checkbox
    (row.substitutes > 0 ? 8 + 32 + countWidth : 0) +
    (row.pantryButton ? 8 + 30 : 0);
  return { width: screenWidth - chrome, gap: 16, nameFontSize: 15, nameLines: 2 };
}

/**
 * How many lines `text` takes wrapped into lines `lineChars` characters wide:
 * a word at a time, breaking after a space or a hyphen, and a word longer than
 * a whole line carried on across lines by character.
 */
function wrappedLineCount(text: string, lineChars: number): number {
  if (lineChars < 1) return Infinity;
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    // "Fire-roasted" can break as "Fire-" / "roasted". The pieces of one word
    // join with no space between them; a new word joins with one.
    const pieces = word.match(/[^-]*-+|[^-]+/g) ?? [word];
    pieces.forEach((piece, i) => {
      let len = Array.from(piece).length;
      const joined = used === 0 ? len : used + (i === 0 ? 1 : 0) + len;
      if (joined <= lineChars) {
        used = joined;
        return;
      }
      if (used > 0) lines += 1;
      while (len > lineChars) {
        lines += 1;
        len -= lineChars;
      }
      used = len;
    });
  }
  return lines;
}

/** The side pill's width for a quantity `chars` characters long. */
function sidePillWidth(chars: number): number {
  return Math.min(PILL_MAX_WIDTH, chars * QUANTITY_FONT_SIZE * CHAR_WIDTH_PER_FONT_PT + PILL_PADDING);
}

/**
 * True when `shownQuantity` can sit in the pill beside the name, false when
 * the row should put it on its own line under the name.
 *
 * With only the quantity, that's the length half of the rule. Pass `beside`
 * (the name as the row shows it, and the space the row has in its current
 * state) for the name half too.
 *
 * An empty quantity has nothing to move and reads as fitting.
 */
export function quantityFitsBesideName(
  shownQuantity: string,
  beside?: { name: string; space: NameRowSpace },
): boolean {
  // By code point rather than UTF-16 unit, so a character outside the basic
  // plane still counts once.
  const chars = Array.from(shownQuantity.trim()).length;
  if (chars > QUANTITY_BESIDE_NAME_MAX_CHARS) return false;
  if (chars === 0 || !beside) return true;
  const { name, space } = beside;
  const nameWidth = space.width - space.gap - sidePillWidth(chars);
  const lineChars = Math.floor(nameWidth / (space.nameFontSize * CHAR_WIDTH_PER_FONT_PT));
  return wrappedLineCount(name.trim(), lineChars) <= space.nameLines;
}
