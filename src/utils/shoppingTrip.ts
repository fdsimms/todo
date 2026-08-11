import type { GroceryItem, ItemShopLink, Shop } from '../types';
import { OTHER_AISLE } from './groceryAisles';

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
 * **The counts here are a floor, never a verdict.** This is the one thing to
 * hold on to, because everything in the module is shaped by it. A link records
 * where you *bought* something, so an item with no link to a store is an item
 * the app has never seen there — which is not the same as an item the store
 * doesn't stock, and the difference is most of what a grocery shop is. Read
 * the absence as evidence and the sheet starts asserting that Trader Joe's has
 * no bread because you always buy bread elsewhere, and a store you've recorded
 * twice ranks below one you've recorded four hundred times for reasons that
 * have nothing to do with either shop. Hence:
 *
 * - Nothing here ever returns "this store does not have this item". The
 *   buckets are *seen here*, *likely*, and *no idea* — `unknownFor` is named
 *   for the app's ignorance rather than the store's stock, and every string in
 *   `describe*` is worded as a fact about the record.
 * - The rank is by what's *known*, because a lower bound is still the best
 *   estimate available — but it's reported as a lower bound ("at least"), and
 *   a store the app knows little about says so rather than reading as empty.
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

/**
 * The aisle guess, and the two numbers that keep it from being a fiction.
 *
 * A store with items on record in the Bakery aisle is a store that sells
 * bakery, and that is a real answer to "does it have bread?" — a much better
 * one than the silence a missing link otherwise leaves. It's the only way a
 * store can ever be credited with something you've never bought there, so
 * without it a shop you've used twice can never climb the ranking however
 * broad its range.
 *
 * It stays a guess, and it's fenced accordingly. A store makes no aisle claim
 * at all until the app has seen a few different things there
 * (`SHOP_RECORD_MIN`) — one purchase is a fact about a trip, not a range — and
 * then claims an aisle only once it's seen more than one item from it
 * (`AISLE_EVIDENCE_MIN`), so the cheese shop you once bought a stray tub of
 * yoghurt at doesn't claim the whole dairy aisle. It never merges into the
 * seen-here count, and it never outranks it.
 */
export const SHOP_RECORD_MIN = 3;
export const AISLE_EVIDENCE_MIN = 2;

export interface ShopCoverage {
  shop: Shop;
  /** On-list items seen at this store — bought or asserted — in list order. */
  itemIds: string[];
  /**
   * On-list items never seen here, in an aisle this store demonstrably
   * stocks. A guess, kept apart from `itemIds` everywhere.
   */
  likelyItemIds: string[];
  /** How many of `itemIds` are hand-assertions rather than observed purchases. */
  assertedCount: number;
  /** Total purchases behind the observed ones — a tiebreak, never rendered. */
  observedPurchases: number;
  /**
   * Distinct catalog items on record here, the whole catalog over — how much
   * the app knows about this store, as opposed to what the store sells. Under
   * `SHOP_RECORD_MIN` the sheet says so, because a low count is a fact about
   * the record and rendering it as coverage would be a slur on the shop.
   */
  recordedItems: number;
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
  /** On-list items a selected store probably carries, on aisle evidence. */
  likely: string[];
  /** On-list items some *other* store is known to carry — a second stop closes them. */
  gap: string[];
  /** On-list items no store is known to carry, but some other store probably does. */
  maybe: string[];
  /**
   * On-list items nothing is known or guessed about. Named for the app's
   * ignorance, not the shops': any of them might be at every store on the list.
   */
  unknown: string[];
  /**
   * The stores to add, greedily, to close as much of `gap` (then `maybe`) as
   * three stops allow. Empty when the selection already covers everything the
   * app has anything to say about.
   */
  suggestion: ShopCoverage[];
}

/**
 * A store's coverage of the list, ranked.
 *
 * Checked rows still count: something in the trolley is still on the list, and
 * this is planning a trip that hasn't happened yet — the alternative would
 * quietly re-rank the stores as you tick things off mid-shop.
 *
 * `items` is the whole catalog rather than just the list, because the aisle
 * evidence comes from everything ever recorded at a store, not from the twelve
 * things you happen to need today.
 */
export function planTrip(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): TripPlan {
  const itemById = new Map(items.map(i => [i.id, i]));
  const onList = items.filter(i => i.onList);
  const rank = new Map(onList.map((item, i) => [item.id, i]));

  const byShop = new Map<string, ShopCoverage>(
    shops
      .filter(s => !s.excludeFromSuggestions)
      .map(shop => [
        shop.id,
        {
          shop,
          itemIds: [],
          likelyItemIds: [],
          assertedCount: 0,
          observedPurchases: 0,
          recordedItems: 0,
        },
      ])
  );

  // shopId → aisle → how many distinct catalog items are on record from it.
  const aisleEvidence = new Map<string, Map<string, number>>();
  const seen = new Map<string, Set<string>>();

  for (const link of links) {
    const entry = byShop.get(link.shopId);
    // Resolve-or-shrug, like every cross-row pointer here: a link naming a
    // deleted (or excluded) store is skipped rather than counted blind.
    if (!entry) continue;
    const item = itemById.get(link.itemId);
    if (!item) continue;

    entry.recordedItems++;
    let shopSeen = seen.get(link.shopId);
    if (!shopSeen) seen.set(link.shopId, (shopSeen = new Set()));
    shopSeen.add(link.itemId);

    // `Other` is the fallback bucket every unrecognised name lands in, so it
    // isn't a section of a shop and can't be evidence of one.
    if (item.aisle !== OTHER_AISLE) {
      let aisles = aisleEvidence.get(link.shopId);
      if (!aisles) aisleEvidence.set(link.shopId, (aisles = new Map()));
      aisles.set(item.aisle, (aisles.get(item.aisle) ?? 0) + 1);
    }

    if (!rank.has(link.itemId)) continue;
    entry.itemIds.push(link.itemId);
    if (link.purchaseCount > 0) entry.observedPurchases += link.purchaseCount;
    else entry.assertedCount += 1;
  }

  for (const entry of byShop.values()) {
    entry.itemIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
    if (entry.recordedItems < SHOP_RECORD_MIN) continue;
    const aisles = aisleEvidence.get(entry.shop.id);
    if (!aisles) continue;
    const shopSeen = seen.get(entry.shop.id) ?? new Set<string>();
    for (const item of onList) {
      if (shopSeen.has(item.id)) continue;
      if (item.aisle === OTHER_AISLE) continue;
      if ((aisles.get(item.aisle) ?? 0) < AISLE_EVIDENCE_MIN) continue;
      entry.likelyItemIds.push(item.id);
    }
  }

  const coverage = [...byShop.values()];
  coverage.sort((a, b) => {
    if (b.itemIds.length !== a.itemIds.length) return b.itemIds.length - a.itemIds.length;
    // What's known outranks what's guessed, always — but between two stores
    // the app knows equally little about, the one whose aisles fit the list is
    // the better guess, and saying so is the only way a thinly-recorded store
    // ever surfaces at all.
    if (b.likelyItemIds.length !== a.likelyItemIds.length) {
      return b.likelyItemIds.length - a.likelyItemIds.length;
    }
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
  const likelyHere = new Set<string>();
  const knownSomewhere = new Set<string>();
  const likelySomewhere = new Set<string>();

  for (const entry of plan.coverage) {
    const isSelected = selected.has(entry.shop.id);
    for (const id of entry.itemIds) {
      knownSomewhere.add(id);
      if (isSelected) covered.add(id);
    }
    for (const id of entry.likelyItemIds) {
      likelySomewhere.add(id);
      if (isSelected) likelyHere.add(id);
    }
  }

  const rest = plan.itemIds.filter(id => !covered.has(id));
  const likely = rest.filter(id => likelyHere.has(id));
  const open = rest.filter(id => !likelyHere.has(id));
  const gap = open.filter(id => knownSomewhere.has(id));
  const maybe = open.filter(id => !knownSomewhere.has(id) && likelySomewhere.has(id));
  const unknown = open.filter(id => !knownSomewhere.has(id) && !likelySomewhere.has(id));

  const suggestion: ShopCoverage[] = [];
  const openSet = new Set([...gap, ...maybe]);
  const taken = new Set(selected);
  while (openSet.size > 0 && selected.size + suggestion.length < MAX_TRIP_STOPS) {
    let best: ShopCoverage | null = null;
    let bestKnown = 0;
    let bestLikely = 0;
    for (const entry of plan.coverage) {
      if (taken.has(entry.shop.id)) continue;
      const known = countIn(entry.itemIds, openSet);
      const guessed = countIn(entry.likelyItemIds, openSet);
      // Lexicographic: a store that definitely has two beats one that probably
      // has five. Strictly greater, so a tie falls to the better-ranked store —
      // the coverage list is already sorted, so the walk inherits that order.
      if (known > bestKnown || (known === bestKnown && guessed > bestLikely)) {
        best = entry;
        bestKnown = known;
        bestLikely = guessed;
      }
    }
    if (!best || (bestKnown === 0 && bestLikely === 0)) break;
    suggestion.push(best);
    taken.add(best.shop.id);
    for (const id of best.itemIds) openSet.delete(id);
    for (const id of best.likelyItemIds) openSet.delete(id);
  }

  return {
    covered: plan.itemIds.filter(id => covered.has(id)),
    likely,
    gap,
    maybe,
    unknown,
    suggestion,
  };
}

function countIn(ids: readonly string[], within: ReadonlySet<string>): number {
  let n = 0;
  for (const id of ids) if (within.has(id)) n++;
  return n;
}

/**
 * The coverage line under a store's name. Null when there's nothing on the
 * list to cover — a row reading "0 of 0 items" is noise, not information.
 *
 * Every phrasing here is about the record rather than the shop: "none seen
 * here" is a true statement that leaves the store its dignity, where "nothing
 * on your list" would be the app announcing a stock check it never ran. The
 * likely clause is always a separate, softer half — the two numbers must never
 * add up into one.
 */
export function describeShopCoverage(entry: ShopCoverage, total: number): string | null {
  if (total === 0) return null;
  const known = entry.itemIds.length;
  const likely = entry.likelyItemIds.length;

  const head =
    known === 0
      ? entry.recordedItems === 0
        ? 'Nothing on record here yet'
        : 'None of your list seen here'
      : known === total
        ? `All ${total} seen here`
        : `${known} of ${total} seen here`;

  return likely > 0 ? `${head} · ${likely} more likely` : head;
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
