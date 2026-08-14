import type { GroceryItem, ItemSubLink } from '../types';
import { probablyHaveReason } from './grocerySuggest';
import { describeSubstitutes, substitutesFor } from './itemSubs';

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

/**
 * What the app already knows about a catalog row, in one line — the answer to
 * "is this the same thing as the item on my list?" asked from the recipe side.
 *
 * Written for `RecipeIngredientSheet`'s catalog card, which exists because an
 * ingredient *is* a grocery item that isn't on a list yet (`nameKey` is the
 * bridge) and nothing had ever shown what was on the other side of it.
 *
 * Every clause is a fact the user's own record backs, and each is separated by
 * "·" precisely because they must not be read as one statement — the same call
 * `describeShops` makes about a trailing negative. Stores are deliberately not
 * among them: that read needs the shop rows and the links, and the item sheet
 * one tap away says it properly rather than in a fragment.
 *
 * Null when there is genuinely nothing to say, which is the honest answer for a
 * row that has only ever been typed once. The caller renders the name alone.
 */
export function describeCatalogItem(
  item: GroceryItem,
  subs: readonly ItemSubLink[],
  items: readonly GroceryItem[],
  now: Date,
): string | null {
  const parts: string[] = [];

  const product = describeProduct(item);
  if (product) parts.push(product);

  if (item.onList) parts.push(item.checked ? 'in your trolley' : 'on your list');

  // The pantry's own words, verbatim — the same line the item sheet and a week
  // plan show. A second phrasing here is a second thing to keep true.
  const pantry = probablyHaveReason(item, now);
  if (pantry) parts.push(pantry);
  else if (item.purchaseCount > 0) {
    parts.push(`bought ${item.purchaseCount} ${item.purchaseCount === 1 ? 'time' : 'times'}`);
  }

  const substitutes = describeSubstitutes(substitutesFor(item.id, subs, items));
  if (substitutes) parts.push(`or ${substitutes}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}
