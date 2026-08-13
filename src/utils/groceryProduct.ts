import type { GroceryItem } from '../types';

/**
 * What names the product beyond the item's own name — the brand and the variant
 * composed into the one clause that captions a row.
 *
 * Its own module rather than a helper beside `describeShops`, which is where
 * #1556 first suggested putting it: groceryShops.ts exists to hold the rules
 * about what a *store* is on record with, and neither of these fields reaches
 * store availability by design (see GroceryItem.variant). A caption living
 * there would read as one that does.
 *
 * One function, because the wording is the whole point: the row, the item sheet
 * and anything later that wants to say which one to grab have to say it the
 * same way, and two call sites spelling it out inline is how they'd drift.
 */
export function describeProduct(
  item: Pick<GroceryItem, 'brand' | 'variant'>
): string | null {
  const brand = item.brand?.trim() || null;
  const variant = item.variant?.trim() || null;

  // A space, not a separator. Together these name a single product — "Good
  // Culture low fat" is what's written on the tub — and that's exactly what a
  // "·" would deny: it's the app's own word for "and here is a second,
  // unrelated fact", used on this very row to hang "not at Safeway" off a
  // purchase count (describeShops) precisely because those must not be read as
  // one statement. Two facts is what these are in the database and what makes
  // them two fields in the sheet; on the shelf they're one box.
  if (brand && variant) return `${brand} ${variant}`;

  // A variant with no brand stands alone, verbatim, in the same treatment —
  // "low fat" when you care about the milk fat and not the dairy is an ordinary
  // state, not half of an unfinished brand. It's tempting to mark it as a
  // variant somehow ("any brand, low fat"), and that's the wrong instinct: it
  // would invent a fact about brands the user never expressed, to answer a
  // question the words already answer. The row's name is directly above it, so
  // the line reads as qualifying that name — the same trust in the words that
  // lets "Not at Safeway" and "Usually Trader Joe's" share one treatment.
  return brand ?? variant;
}
