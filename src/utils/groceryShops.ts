import type { GroceryItem, ItemShopLink, Shop } from '../types';
import { groceryNameKey } from './groceryParse';

/**
 * Which stores have which items — the read side of the purchase links.
 *
 * Pure, so it's all pinned by groceryShops.test.ts, and so the one place that
 * knows the counting rules is testable. The rule that matters, restated from
 * ItemShopLink:
 *
 *   item.purchaseCount >= sum of its links' purchaseCount
 *
 * A trip finished before this feature existed, or finished without naming a
 * store, bumps the item and writes no link. So the per-store numbers are
 * partial and the item's is the total. Nothing here adds links up to produce a
 * total, and describeShops() is worded so a caller can't imply one.
 */

/**
 * The negative claim: the user said this store doesn't stock this item. Every
 * "where can I get it" read below drops such a link — an absent link means the
 * app has never seen the item there, which is ignorance; this one means the
 * user looked and it wasn't there, which is an answer.
 *
 * It outranks the purchase count on the same row rather than being contradicted
 * by it, because it's the *current* state and the count is history: a shop that
 * stocked it eleven times and then stopped is exactly the case this exists for.
 * A purchase does refute it — but by clearing the stamp when the trip is
 * recorded, not by out-arguing it at read time.
 */
export function isUnavailable(link: ItemShopLink): boolean {
  return link.unavailableAt !== null;
}

/**
 * A link with no purchases behind it — the user said "I get this here" rather
 * than the app having watched them buy it. Kept apart from an observed link
 * everywhere ranking or "usually" is involved, and nowhere else: for the
 * question "does this store have it", an assertion counts.
 *
 * A *negative* link also has no purchases behind it and is the opposite claim,
 * so it has to be excluded here explicitly — the count alone stopped being able
 * to tell the two apart the moment unavailableAt existed.
 */
export function isAsserted(link: ItemShopLink): boolean {
  return link.purchaseCount === 0 && !isUnavailable(link);
}

/**
 * The second negative, and the one this feature exists for: the user has said
 * this store hasn't got the brand they want. The store stocks the item — that's
 * what makes this a different claim from `isUnavailable` — it just hasn't got
 * yours.
 *
 * **Only an asserted claim counts, never an observed brand.** `ItemShopLink`
 * also records the brand you last got at a store, and it is tempting to read a
 * mismatch there as this: you got Lucerne at Safeway, so Safeway must not have
 * Good Culture. It mustn't, and the reason is simply that **a store carries
 * more than one brand of a thing**. Safeway stocking Lucerne is not evidence
 * about whether it also stocks Good Culture; it is evidence about one purchase.
 * Inferring the absence would drop stores that have exactly what you want, and
 * it is the same unfalsifiable move shoppingTrip.ts deleted `likelyItemIds` to
 * be rid of — an absence read off something that was never evidence of one.
 *
 * So this reads the stamped claim and nothing else. Unknown stays unknown, and
 * unknown always counts.
 *
 * Read only while the item is strict: a brand nobody made a rule of is a
 * preference, and a preference is not a reason to drop a store.
 */
export function lacksWantedBrand(link: ItemShopLink, item: GroceryItem): boolean {
  return item.brandStrict && !!item.brand && link.brandUnavailableAt !== null;
}

/**
 * The one gate every "where can I get this" read runs each link through.
 *
 * Two ways a store can fail it, and they're different claims: the user said the
 * store doesn't stock the item at all (`unavailableAt`), or that it hasn't got
 * the brand they want (`brandUnavailableAt`). Both mean "not a place to get
 * this"; only the first means "they haven't got it".
 *
 * Kept as one predicate rather than two filters at each call site because there
 * are seven such reads and a new one is exactly the kind of thing that ships
 * having remembered the first rule and forgotten the second.
 */
export function countsForItem(link: ItemShopLink, item: GroceryItem): boolean {
  return !isUnavailable(link) && !lacksWantedBrand(link, item);
}

function byPurchasesThenRecency(a: ItemShopLink, b: ItemShopLink): number {
  if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
  const at = a.lastPurchasedAt ? Date.parse(a.lastPurchasedAt) : 0;
  const bt = b.lastPurchasedAt ? Date.parse(b.lastPurchasedAt) : 0;
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

export interface ShopWithCount {
  shop: Shop;
  purchaseCount: number;
  lastPurchasedAt: string | null;
}

/**
 * The stores one item has been bought at (or been asserted to live at), most
 * bought first.
 *
 * **A store marked as not stocking it is not one of them**, whatever its
 * purchase history — this is the "where can I get this" read, and the whole
 * point of the negative claim is that the answer is "not here any more".
 * `unavailableShopsFor` is the other half, for the one caller that shows and
 * undoes those claims. **Nor is a store the user has said hasn't got their
 * brand**, when the item insists on one — `withoutBrandShopsFor` is that half,
 * and `countsForItem` is the gate both go through.
 *
 * Takes the whole item rather than an id because the brand rule is a fact about
 * the item, not about the link — the id alone can't answer it.
 *
 * A link naming a store that no longer exists is dropped rather than rendered
 * as a blank chip. That shouldn't happen — dbDeleteGroceryShop cascades — but
 * a resolve-or-shrug reader is what the rest of this codebase does with every
 * cross-row pointer (canBlock, the previousOccurrenceId walks), and it's the
 * difference between a stale row and a crash.
 */
export function shopsForItem(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): ShopWithCount[] {
  const byId = new Map(shops.map(s => [s.id, s]));
  return links
    .filter(l => l.itemId === item.id && byId.has(l.shopId) && countsForItem(l, item))
    .sort(byPurchasesThenRecency)
    .map(l => ({
      shop: byId.get(l.shopId)!,
      purchaseCount: l.purchaseCount,
      lastPurchasedAt: l.lastPurchasedAt,
    }));
}

/**
 * The stores the user has said don't stock this item, in the store list's own
 * order — there's nothing to rank them by, and a claim isn't stronger for being
 * older.
 *
 * Deliberately a separate call rather than a flag on `ShopWithCount`: the
 * default read of "which stores have this" must not have to remember to filter,
 * and every caller that wants the negatives is asking a different question.
 */
export function unavailableShopsFor(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop[] {
  const marked = new Set(
    links.filter(l => l.itemId === itemId && isUnavailable(l)).map(l => l.shopId)
  );
  return shops.filter(s => marked.has(s.id));
}

/**
 * The stores the user has said haven't got their brand — the parallel of
 * `unavailableShopsFor`, and for the same reason: the default read must not
 * have to remember to filter, and the one surface that shows and undoes these
 * claims is asking a different question.
 *
 * In the store list's own order, like `unavailableShopsFor`: there is nothing
 * to rank claims by, and one isn't stronger for being older.
 *
 * Empty whenever the item isn't strict, so a caller can render it unguarded:
 * with the switch off there are no claims in force, only a preference.
 */
export function withoutBrandShopsFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop[] {
  const marked = new Set(
    links.filter(l => l.itemId === item.id && lacksWantedBrand(l, item)).map(l => l.shopId)
  );
  return shops.filter(s => marked.has(s.id));
}

/**
 * Where you usually get this, or null.
 *
 * Only an *observed* link qualifies: "usually Costco" off the back of a
 * checkbox somebody ticked once would be the app inventing a habit. A tie on
 * count falls through to recency via the sort, so the store you were at most
 * recently wins — which is the more useful answer when both are 3.
 *
 * A store flagged `excludeFromSuggestions` never wins here even if it's the
 * most-bought-at — that flag exists precisely to keep a record-keeping-only
 * store (Amazon: "it has everything") from being actively recommended.
 * `shopsForItem` itself stays unfiltered, so the item sheet's full history
 * still lists it.
 */
export function primaryShopFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  const ranked = shopsForItem(item, links, shops)
    .filter(s => s.purchaseCount > 0 && !s.shop.excludeFromSuggestions);
  return ranked.length > 0 ? ranked[0].shop : null;
}

/**
 * The one store this item is tied to, or null if it's tied to none or several.
 * An assertion counts here — "only at Costco" is a claim about availability,
 * and the user making it by hand is as good an answer as a trip.
 *
 * Same exclusion as primaryShopFor: a store flagged `excludeFromSuggestions`
 * is dropped before the "is there exactly one" count, so an item otherwise
 * only linked to Amazon reads as tied to none, not "exclusively Amazon".
 */
export function exclusiveShopFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  const all = shopsForItem(item, links, shops).filter(s => !s.shop.excludeFromSuggestions);
  return all.length === 1 ? all[0].shop : null;
}

/**
 * The item ids linked to a store — the set behind the Buy again filter. A
 * negative link isn't one: "what does Costco carry" must not answer with the
 * thing you noted Costco doesn't.
 */
export function itemIdsForShop(
  shopId: string,
  links: readonly ItemShopLink[],
  items: readonly GroceryItem[]
): Set<string> {
  const byId = new Map(items.map(i => [i.id, i]));
  const out = new Set<string>();
  for (const link of links) {
    if (link.shopId !== shopId) continue;
    const item = byId.get(link.itemId);
    // Resolve-or-shrug on a link whose item is gone, same as shopsForItem does
    // for a missing shop — and it can't be brand-judged without the item
    // anyway.
    if (!item || !countsForItem(link, item)) continue;
    out.add(link.itemId);
  }
  return out;
}

/**
 * How many catalog rows each store has, for the filter chips. Counts only
 * links whose item still exists, so a chip never promises rows the filtered
 * list can't produce — and only positive ones, so the count agrees with what
 * `itemIdsForShop` will actually show.
 */
export function itemCountsByShop(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[]
): Map<string, number> {
  const byId = new Map(items.map(i => [i.id, i]));
  const counts = new Map<string, number>();
  for (const link of links) {
    const item = byId.get(link.itemId);
    if (!item || !countsForItem(link, item)) continue;
    counts.set(link.shopId, (counts.get(link.shopId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The item sheet's footnote. One sentence, and deliberately never arithmetic
 * across the two numbers: "Bought 7 times · usually Costco" is true even when
 * only 6 of those 7 have a store on them, whereas anything of the form "6 of 7"
 * would be claiming the app knows where the seventh happened.
 */
export function describeShops(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): string | null {
  const bought = item.purchaseCount > 0
    ? `Bought ${item.purchaseCount} ${item.purchaseCount === 1 ? 'time' : 'times'}`
    : null;

  // The negative claims ride as a trailing clause on whatever the positive
  // record says, because they're a different kind of fact and must never be
  // read as qualifying the count in front of them. An item bought 7 times that
  // Safeway has stopped stocking is both of those things at once.
  const notAt = unavailableShopsFor(item.id, links, shops);
  // The brand-level negatives ride as their own trailing clause, after the
  // not-stocked one and worded differently on purpose: "not at Safeway" and
  // "no Good Culture at Safeway" are different facts, and collapsing them would
  // tell the user a shop had nothing when it had the item and not their brand.
  const withoutBrand = withoutBrandShopsFor(item, links, shops);
  const withClauses = (head: string | null): string | null => {
    let out = head;
    if (notAt.length > 0) {
      const names = notAt.map(s => s.name).join(', ');
      out = out ? `${out} · not at ${names}` : `Not at ${names}`;
    }
    if (withoutBrand.length > 0) {
      const names = withoutBrand.map(s => s.name).join(', ');
      const clause = `no ${item.brand} at ${names}`;
      out = out ? `${out} · ${clause}` : `No ${item.brand} at ${names}`;
    }
    return out;
  };

  const ranked = shopsForItem(item, links, shops);
  if (ranked.length === 0) return withClauses(bought);

  const observed = ranked.filter(s => s.purchaseCount > 0);
  if (observed.length === 0) {
    // Every link here is a hand-assertion, so say so rather than dressing it
    // up as history the app collected.
    const names = ranked.map(s => s.shop.name).join(', ');
    return withClauses(bought ? `${bought} · you get it at ${names}` : `You get it at ${names}`);
  }

  // "only at" needs *every* positive link to be that one store, not just every
  // observed one: with Costco bought 6× and Safeway asserted by hand, the item
  // is known to be in two places and "only at Costco" contradicts what the user
  // said. A store marked as *not* stocking it isn't a second place and doesn't
  // spoil "only at" — it's the clause after it.
  const where = ranked.length === 1
    ? `only at ${observed[0].shop.name}`
    : `usually ${observed[0].shop.name}`;
  return withClauses(bought ? `${bought} · ${where}` : where);
}
