import type { GroceryItem, ItemShopLink, Shop } from '../types';

/**
 * Which store to shop the list you're actually holding.
 *
 * `groceryShops.ts` answers "where do I get this item"; this answers the
 * question one level up — "given these twelve things, where do I go" — which
 * is the only question the grocery-run task button was ever really asking. It
 * used to ask it as a bare alphabetical list of every store, so the answer was
 * the user's to work out from memory each time.
 *
 * Pure, and pinned by shoppingTrip.test.ts.
 *
 * Two rules carried over from ItemShopLink, because they decide the numbers:
 *
 * - **An assertion counts.** A link with `purchaseCount: 0` is the user having
 *   tapped a store in the item sheet to say "I can get this here", and
 *   availability is exactly what a trip plan is about. That's the same call
 *   `exclusiveShopFor` makes and the opposite of `primaryShopFor`'s, which is
 *   about habit rather than stock.
 * - **Never sum links to get a total.** The counts here are all "how many of
 *   the items on the list", never "how many purchases" — the per-store
 *   purchase counts are partial by construction, and `observedPurchases` below
 *   is a tiebreak, never a number anything renders.
 *
 * A store flagged `excludeFromSuggestions` is dropped before any of it, same
 * as everywhere else: "it has everything" is precisely the store that would
 * win a coverage ranking and precisely the one the user said not to send them
 * to.
 */

/**
 * Nobody plans a five-stop grocery run. The greedy fill stops here even when
 * more stores would each pick up another item, because past three the honest
 * answer is "you can't get everything this week", not a longer itinerary.
 */
export const MAX_TRIP_STOPS = 3;

export interface ShopCoverage {
  shop: Shop;
  /** The on-list items this store is known to carry, in list order. */
  itemIds: string[];
  /** How many of those are hand-assertions rather than observed purchases. */
  assertedCount: number;
  /** Total purchases behind the observed ones — a tiebreak, never rendered. */
  observedPurchases: number;
}

export interface TripPlan {
  /** Every item on the list right now, in list order. */
  itemIds: string[];
  /** Every suggestable store, best coverage first. Includes stores with none. */
  coverage: ShopCoverage[];
}

export interface TripSummary {
  /** On-list items the selected stores are known to carry. */
  covered: string[];
  /** On-list items some *other* store carries — the gap a second stop closes. */
  gap: string[];
  /** On-list items no suggestable store is known to carry at all. */
  unknown: string[];
  /**
   * The stores to add, greedily, to close as much of `gap` as three stops
   * allow. Empty when the selection already covers everything it can.
   */
  suggestion: ShopCoverage[];
}

/**
 * A store's coverage of the list, ranked.
 *
 * Checked rows still count: something in the trolley is still on the list, and
 * this is planning a trip that hasn't happened yet — the alternative would
 * quietly re-rank the stores as you tick things off mid-shop.
 */
export function planTrip(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): TripPlan {
  const onList = items.filter(i => i.onList);
  const rank = new Map(onList.map((item, i) => [item.id, i]));

  const byShop = new Map<string, ShopCoverage>(
    shops
      .filter(s => !s.excludeFromSuggestions)
      .map(shop => [shop.id, { shop, itemIds: [], assertedCount: 0, observedPurchases: 0 }])
  );

  for (const link of links) {
    if (!rank.has(link.itemId)) continue;
    const entry = byShop.get(link.shopId);
    // Resolve-or-shrug, like every cross-row pointer here: a link naming a
    // deleted (or excluded) store is skipped rather than counted blind.
    if (!entry) continue;
    entry.itemIds.push(link.itemId);
    if (link.purchaseCount > 0) entry.observedPurchases += link.purchaseCount;
    else entry.assertedCount += 1;
  }

  const coverage = [...byShop.values()];
  for (const entry of coverage) {
    entry.itemIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
  }
  coverage.sort((a, b) => {
    if (b.itemIds.length !== a.itemIds.length) return b.itemIds.length - a.itemIds.length;
    // A tie on "how many of these twelve" breaks toward the store you've
    // actually bought at more, then toward the user's own store order — never
    // toward whichever way the link rows happened to come out of SQLite.
    if (b.observedPurchases !== a.observedPurchases) return b.observedPurchases - a.observedPurchases;
    return a.shop.sortOrder - b.shop.sortOrder;
  });

  return { itemIds: onList.map(i => i.id), coverage };
}

/**
 * What a given set of stores covers, and what to add next.
 *
 * Called with an empty selection this *is* the recommendation — the greedy
 * walk starts from nothing and returns the best store followed by whatever
 * closes the gap behind it. So the sheet has one code path for "what should I
 * suggest" and "what's still missing now that you've picked".
 */
export function summarizeTrip(selectedShopIds: readonly string[], plan: TripPlan): TripSummary {
  const selected = new Set(selectedShopIds);
  const covered = new Set<string>();
  const carriedSomewhere = new Set<string>();

  for (const entry of plan.coverage) {
    const isSelected = selected.has(entry.shop.id);
    for (const id of entry.itemIds) {
      carriedSomewhere.add(id);
      if (isSelected) covered.add(id);
    }
  }

  const remaining = plan.itemIds.filter(id => !covered.has(id));
  const gap = remaining.filter(id => carriedSomewhere.has(id));
  const unknown = remaining.filter(id => !carriedSomewhere.has(id));

  const suggestion: ShopCoverage[] = [];
  const open = new Set(gap);
  const taken = new Set(selected);
  while (open.size > 0 && selected.size + suggestion.length < MAX_TRIP_STOPS) {
    let best: ShopCoverage | null = null;
    let bestGain = 0;
    for (const entry of plan.coverage) {
      if (taken.has(entry.shop.id)) continue;
      let gain = 0;
      for (const id of entry.itemIds) if (open.has(id)) gain++;
      // Strictly greater, so a tie falls to the better-ranked store — the
      // coverage list is already sorted, so the walk inherits that order.
      if (gain > bestGain) {
        best = entry;
        bestGain = gain;
      }
    }
    if (!best) break;
    suggestion.push(best);
    taken.add(best.shop.id);
    for (const id of best.itemIds) open.delete(id);
  }

  return { covered: plan.itemIds.filter(id => covered.has(id)), gap, unknown, suggestion };
}

/**
 * The coverage line under a store's name. Null when there's nothing on the
 * list to cover — a row reading "0 of 0 items" is noise, not information.
 */
export function describeShopCoverage(count: number, total: number): string | null {
  if (total === 0) return null;
  if (count === 0) return 'Nothing on your list';
  if (count === total) return total === 1 ? 'The 1 item on your list' : `All ${total} items`;
  return `${count} of ${total} items`;
}

/**
 * "bagels", "bagels and cilantro", "bagels, cilantro and tofu",
 * "bagels, cilantro, tofu and 2 more".
 *
 * Naming the items is most of the point of the gap line — "3 items aren't at
 * Trader Joe's" is a fact you can't act on, and the whole reason to name them
 * is that seeing "just cilantro" is what makes you skip the second stop.
 */
export function joinNames(names: readonly string[], max = 3): string {
  if (names.length === 0) return '';
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
