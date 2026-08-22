import type { GroceryItem, ItemProduct, ItemSubLink, ProductRating } from '../types';
import { groceryNameKey } from './groceryParse';
import { probablyHaveReason } from './grocerySuggest';
import { describeSubstitutes, substitutesFor } from './itemSubs';

/**
 * The normalised identity of one box, unique *within its item* — the product's
 * answer to `groceryNameKey`, and where "you can't have two Arnold's wheats"
 * actually lives (a UNIQUE index on `(item_id, product_key)`).
 *
 * Scoped to the item rather than the catalog on purpose: two items may both
 * have a "store brand" product, and those are two different boxes.
 *
 * Reuses `groceryNameKey` on each half rather than lowercasing inline, so a
 * product spelled "Arnold's" matches one spelled "arnolds" for exactly the
 * reasons an item's name does. The halves are joined by a character the
 * normaliser strips, so "Arnold's" + "wheat" can never collide with a
 * brandless variant literally called "arnolds wheat".
 */
export function productKeyFor(brand: string | null, variant: string | null): string {
  const b = groceryNameKey(brand ?? '');
  const v = groceryNameKey(variant ?? '');
  // Empty when both halves are — the caller's cue that this is the item
  // itself and not a product of it. `addProduct` refuses that outright.
  if (!b && !v) return '';
  return `${b}|${v}`;
}

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
  product: Pick<ItemProduct, 'brand' | 'variant'> | null | undefined
): string | null {
  // Null in, null out: an item with no preferred product has nothing to say
  // about which one to grab, and that's the common case rather than an error.
  if (!product) return null;
  const brand = product.brand?.trim() || null;
  const variant = product.variant?.trim() || null;

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
  products: readonly ItemProduct[],
  now: Date,
): string | null {
  const parts: string[] = [];

  const product = describeProduct(preferredProductOf(item, products));
  if (product) parts.push(product);

  if (item.onList) parts.push(item.checked ? 'in your cart' : 'on your list');

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

/**
 * The products of one item, in the order the item sheet lists them.
 *
 * The preferred one first, because it's the answer to the question the section
 * is asking ("which one?"), then the rest by what the record actually says:
 * ones you liked, then ones you've said nothing about, then ones you've marked
 * never again; ties broken by how often you've bought it and then by age, so
 * the order is stable between renders rather than shuffling as counts change.
 *
 * A rating sorts rather than filters. An "avoid" product stays on the list —
 * remembering that you hated it is the whole point, and hiding it would take
 * the memory away exactly when you're standing in front of the shelf about to
 * buy it again.
 */
export function productsForItem(
  itemId: string,
  products: readonly ItemProduct[],
  preferredId: string | null = null,
): ItemProduct[] {
  const rank = (p: ItemProduct): number => {
    if (p.id === preferredId) return 0;
    if (p.rating === 'loved') return 1;
    if (p.rating === null) return 2;
    return 3;
  };
  return products
    .filter(p => p.itemId === itemId)
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

/**
 * The box a barcode was last confirmed against, or null.
 *
 * The most specific answer a scan can get, and the reason `ItemProduct.gtin`
 * exists rather than only a GTIN alias onto the item: this names *which* box,
 * so a rescan can restore the brand and variant instead of re-deriving them
 * from the product name. `variantFor` can no longer do that once the item has
 * been renamed away from the source's wording, which is exactly the case
 * linking a barcode is for.
 *
 * A blank code answers nothing rather than matching every product with no
 * barcode, the same guard `aliasItemIdFor` puts on an empty key.
 */
export function productForGtin(
  products: readonly ItemProduct[],
  gtin: string | null,
): ItemProduct | null {
  if (!gtin) return null;
  return products.find(p => p.gtin === gtin) ?? null;
}

/**
 * The box this item's row is asking for, or null for the common "any of them
 * will do" case.
 *
 * Resolve-or-shrug, like `canBlock` and every other cross-row pointer here: an
 * id naming a product that no longer exists reads as no opinion rather than
 * throwing. Deleting a product clears the pointer, so this shouldn't happen —
 * but a reader that depends on a cascade having run is the kind that breaks on
 * a half-merged sync.
 */
export function preferredProductOf(
  item: Pick<GroceryItem, 'preferredProductId'>,
  products: readonly ItemProduct[],
): ItemProduct | null {
  if (!item.preferredProductId) return null;
  return products.find(p => p.id === item.preferredProductId) ?? null;
}

/**
 * The preferred product's own words, for the captions that used to read
 * `item.brand` directly. Null when there's no preference — see describeProduct.
 */
export function describePreferredProduct(
  item: Pick<GroceryItem, 'preferredProductId'>,
  products: readonly ItemProduct[],
): string | null {
  return describeProduct(preferredProductOf(item, products));
}

/**
 * What a rating says, in the app's own voice.
 *
 * Written out rather than left to each surface, for `describeProduct`'s
 * reason: the item sheet, the row caption and the product sheet's own control
 * have to say it the same way. "Never again" rather than "bad" or a thumb —
 * it's a note to yourself about what to do at the shelf, not a score.
 */
export const RATING_LABELS: Record<ProductRating, string> = {
  loved: 'Loved it',
  avoid: 'Never again',
};

/**
 * How often this exact box has come home, or null when it never has.
 *
 * Deliberately its own clause and never summed with the item's own count: a
 * product's counter only ever starts at the trip after it was named, so it is
 * a subset of `GroceryItem.purchaseCount` in exactly the way an ItemShopLink's
 * is. Saying "bought 3 times" under a product on an item bought 40 times is
 * true and useful; adding them up would be neither.
 */
export function describeProductPurchases(product: ItemProduct): string | null {
  if (product.purchaseCount <= 0) return null;
  return `bought ${product.purchaseCount} ${product.purchaseCount === 1 ? 'time' : 'times'}`;
}

/**
 * `ItemShopLink.unavailableProductIds` out of the JSON column it's stored in.
 *
 * Defensive in exactly `parsePriceHistory`'s way and for the same reason: this
 * column is written by this app but read after a sync merge, a restore from
 * someone's backup file, or an install that upgraded across the migration, and
 * a malformed blob must degrade to "no claims recorded" rather than take the
 * grocery list down. Unknown always counts, so an empty map is the safe answer.
 *
 * Entries whose value isn't a string are dropped rather than coerced: a claim
 * with no date is not the claim this field means (see the type's note on why
 * these are dates and not flags).
 */
export function parseUnavailableProductIds(
  raw: string | null | undefined
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (id && typeof at === 'string') out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Whether the user has said this store hasn't got the box this item is asking
 * for — the one claim a strict item filters stores on.
 *
 * Three things all have to hold, and the middle one is the point: the item
 * insists on a product, the claim on this link names *that* product, and the
 * item is strict. A claim about a product the item no longer prefers is
 * history, not a filter — which is what keeps switching your preference from
 * silently inheriting the last one's evidence.
 */
export function lacksPreferredProduct(
  item: Pick<GroceryItem, 'preferredProductId' | 'productStrict'>,
  link: { unavailableProductIds: Record<string, string> }
): boolean {
  if (!item.productStrict || !item.preferredProductId) return false;
  return link.unavailableProductIds[item.preferredProductId] !== undefined;
}
