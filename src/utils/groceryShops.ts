import type { GroceryItem, ItemShopLink, Shop } from '../types';

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
 * A link with no purchases behind it — the user said "I get this here" rather
 * than the app having watched them buy it. Kept apart from an observed link
 * everywhere ranking or "usually" is involved, and nowhere else: for the
 * question "does this store have it", an assertion counts.
 */
export function isAsserted(link: ItemShopLink): boolean {
  return link.purchaseCount === 0;
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
 * A link naming a store that no longer exists is dropped rather than rendered
 * as a blank chip. That shouldn't happen — dbDeleteGroceryShop cascades — but
 * a resolve-or-shrug reader is what the rest of this codebase does with every
 * cross-row pointer (canBlock, the previousOccurrenceId walks), and it's the
 * difference between a stale row and a crash.
 */
export function shopsForItem(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): ShopWithCount[] {
  const byId = new Map(shops.map(s => [s.id, s]));
  return links
    .filter(l => l.itemId === itemId && byId.has(l.shopId))
    .sort(byPurchasesThenRecency)
    .map(l => ({
      shop: byId.get(l.shopId)!,
      purchaseCount: l.purchaseCount,
      lastPurchasedAt: l.lastPurchasedAt,
    }));
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
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  const ranked = shopsForItem(itemId, links, shops)
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
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  const all = shopsForItem(itemId, links, shops).filter(s => !s.shop.excludeFromSuggestions);
  return all.length === 1 ? all[0].shop : null;
}

/** The item ids linked to a store — the set behind the Buy again filter. */
export function itemIdsForShop(shopId: string, links: readonly ItemShopLink[]): Set<string> {
  const out = new Set<string>();
  for (const link of links) {
    if (link.shopId === shopId) out.add(link.itemId);
  }
  return out;
}

/**
 * How many catalog rows each store has, for the filter chips. Counts only
 * links whose item still exists, so a chip never promises rows the filtered
 * list can't produce.
 */
export function itemCountsByShop(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[]
): Map<string, number> {
  const live = new Set(items.map(i => i.id));
  const counts = new Map<string, number>();
  for (const link of links) {
    if (!live.has(link.itemId)) continue;
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

  const ranked = shopsForItem(item.id, links, shops);
  if (ranked.length === 0) return bought;

  const observed = ranked.filter(s => s.purchaseCount > 0);
  if (observed.length === 0) {
    // Every link here is a hand-assertion, so say so rather than dressing it
    // up as history the app collected.
    const names = ranked.map(s => s.shop.name).join(', ');
    return bought ? `${bought} · you get it at ${names}` : `You get it at ${names}`;
  }

  // "only at" needs *every* link to be that one store, not just every observed
  // one: with Costco bought 6× and Safeway asserted by hand, the item is known
  // to be in two places and "only at Costco" contradicts what the user said.
  const where = ranked.length === 1
    ? `only at ${observed[0].shop.name}`
    : `usually ${observed[0].shop.name}`;
  return bought ? `${bought} · ${where}` : where;
}
