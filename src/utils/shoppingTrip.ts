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
 * - Nothing here ever *infers* "this store does not have this item". The
 *   buckets are *seen here*, *likely*, and *no idea* — `unknownFor` is named
 *   for the app's ignorance rather than the store's stock, and every string in
 *   `describe*` is worded as a fact about the record.
 * - The rank is by what's *known*, because a lower bound is still the best
 *   estimate available — but it's reported as a lower bound ("at least"), and
 *   a store the app knows little about says so rather than reading as empty.
 *
 * **The one exception is a claim the user made themselves.** A link carrying
 * `unavailableAt` is the user saying they looked and it wasn't there
 * (`ItemShopLink.unavailableAt`), and that is the only thing in this module
 * allowed to assert an absence — because it isn't the app asserting it. So a
 * marked item is dropped from `itemIds`, is never guessed into `likelyItemIds`
 * (an explicit no outranks an aisle inference, always), and lands in its own
 * `unavailableItemIds` / `TripSummary.missing` so the sheet can say plainly
 * that the second stop is the one that closes it. It stays out of
 * `recordedItems` too: knowing a shop *lacks* three things is not knowing its
 * range, and letting it clear `SHOP_RECORD_MIN` would license aisle guesses off
 * the back of what the store doesn't stock.
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
  /**
   * On-list items the user has said this store doesn't stock, in list order.
   * The only hard negative in the module, and the only thing that overrides
   * the aisle guess.
   */
  unavailableItemIds: string[];
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
  /**
   * On-list items a selected store is known *not* to carry, because the user
   * said so — and that no selected store covers or probably covers. Split out
   * of `gap` because the copy differs in kind: a gap is "you've never got this
   * here", which the store may well disprove, and this is "it isn't there".
   */
  missing: string[];
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
          unavailableItemIds: [],
          assertedCount: 0,
          observedPurchases: 0,
          recordedItems: 0,
        },
      ])
  );

  // shopId → aisle → how many distinct catalog items are on record from it.
  const aisleEvidence = new Map<string, Map<string, number>>();
  const seen = new Map<string, Set<string>>();
  // shopId → items the user has said aren't there. Held apart from `seen`
  // because the two do opposite jobs downstream: `seen` suppresses a guess it
  // already knows the answer to, this one forbids the guess outright.
  const absent = new Map<string, Set<string>>();

  for (const link of links) {
    const entry = byShop.get(link.shopId);
    // Resolve-or-shrug, like every cross-row pointer here: a link naming a
    // deleted (or excluded) store is skipped rather than counted blind.
    if (!entry) continue;
    const item = itemById.get(link.itemId);
    if (!item) continue;

    if (link.unavailableAt !== null) {
      let marked = absent.get(link.shopId);
      if (!marked) absent.set(link.shopId, (marked = new Set()));
      marked.add(link.itemId);
      if (rank.has(link.itemId)) entry.unavailableItemIds.push(link.itemId);
      // No recordedItems, no aisle evidence, no coverage: a store that lacks
      // something is not thereby a store the app knows the range of.
      continue;
    }

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
    entry.unavailableItemIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
    if (entry.recordedItems < SHOP_RECORD_MIN) continue;
    const aisles = aisleEvidence.get(entry.shop.id);
    if (!aisles) continue;
    const shopSeen = seen.get(entry.shop.id) ?? new Set<string>();
    const shopAbsent = absent.get(entry.shop.id) ?? new Set<string>();
    for (const item of onList) {
      if (shopSeen.has(item.id)) continue;
      // The aisle guess is the app inferring; this is the user reporting. It
      // never gets to overrule them, however well the aisle fits.
      if (shopAbsent.has(item.id)) continue;
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
  const absentHere = new Set<string>();
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
    // Only the selected stores' negatives matter: "Safeway doesn't have it" is
    // no reason to change a trip to Costco, and it's already why Safeway isn't
    // being credited with it above.
    if (isSelected) for (const id of entry.unavailableItemIds) absentHere.add(id);
  }

  const rest = plan.itemIds.filter(id => !covered.has(id));
  // `likely` first: with two stores picked, one saying no and the other's
  // aisles saying probably, "probably" is the more useful answer and the
  // negative has already done its job by keeping that store out of the count.
  const likely = rest.filter(id => likelyHere.has(id));
  const missing = rest.filter(id => !likelyHere.has(id) && absentHere.has(id));
  const open = rest.filter(id => !likelyHere.has(id) && !absentHere.has(id));
  const gap = open.filter(id => knownSomewhere.has(id));
  const maybe = open.filter(id => !knownSomewhere.has(id) && likelySomewhere.has(id));
  const unknown = open.filter(id => !knownSomewhere.has(id) && !likelySomewhere.has(id));

  const suggestion: ShopCoverage[] = [];
  // A missing item is the strongest possible reason for a second stop — it's
  // the one thing on the list the trip definitely won't come back with — so it
  // joins the greedy walk's target set alongside the softer two.
  const openSet = new Set([...missing, ...gap, ...maybe]);
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
    missing,
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
 *
 * The exception, again, is the user's own claim: "2 they don't have" is the one
 * clause here that states an absence, and it can say so flatly because it's
 * quoting the person reading it. It comes last and stays its own clause for the
 * same reason the likely one does — three counts of three different kinds.
 */
export function describeShopCoverage(entry: ShopCoverage, total: number): string | null {
  if (total === 0) return null;
  const known = entry.itemIds.length;
  const likely = entry.likelyItemIds.length;
  const absent = entry.unavailableItemIds.length;

  const head =
    known === 0
      ? entry.recordedItems === 0
        ? absent > 0
          ? 'Nothing on record here to go on'
          : 'Nothing on record here yet'
        : 'None of your list seen here'
      : known === total
        ? `All ${total} seen here`
        : `${known} of ${total} seen here`;

  const parts = [head];
  if (likely > 0) parts.push(`${likely} more likely`);
  if (absent > 0) parts.push(`${absent} they don’t have`);
  return parts.join(' · ');
}

export interface TripSuggestionCopy {
  /** The stores to visit, best first — "Costco, then Trader Joe's". */
  stores: string;
  /** What the record says they account for between them. */
  detail: string;
}

/**
 * The recommendation in two lines, for somewhere that isn't the trip sheet —
 * the card at the top of the shopping list. `summarizeTrip([], plan)` is the
 * fewest stores the greedy walk can cover the list with, and this is the one
 * place that turns it into a sentence, so the list screen and anywhere else
 * that surfaces it can't word it two ways.
 *
 * The same rule as everywhere else in this module: the numbers are a floor and
 * the copy says so. "You've got 8 of these 12 there before" is a fact about
 * what you've bought, not a stock check — and the likely half stays its own
 * clause rather than being added into the count.
 *
 * Null when there's nothing to say, which is the card's own "don't render":
 * an empty list, no suggestion, or a suggestion carrying neither a known nor a
 * likely item.
 */
export function describeTripSuggestion(
  suggestion: readonly ShopCoverage[],
  total: number
): TripSuggestionCopy | null {
  if (total === 0 || suggestion.length === 0) return null;

  const known = new Set<string>();
  for (const entry of suggestion) for (const id of entry.itemIds) known.add(id);
  // Second pass, not folded into the first: an item one suggested store is
  // known to carry must not also be counted as another's guess, whichever
  // order the two happen to sit in.
  const likely = new Set<string>();
  for (const entry of suggestion) {
    for (const id of entry.likelyItemIds) if (!known.has(id)) likely.add(id);
  }
  if (known.size === 0 && likely.size === 0) return null;

  const names = suggestion.map(s => s.shop.name);
  const stores =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')}, then ${names[names.length - 1]}`;

  const one = suggestion.length === 1;
  if (known.size === 0) {
    // Nothing on record, so the aisle guess is the whole answer and has to be
    // labelled as one — it's the only claim here the app made up itself.
    return {
      stores,
      detail: `${likely.size} of these ${total} likely, on the aisles ${
        one ? 'it stocks' : 'they stock'
      }`,
    };
  }

  const head = one
    ? known.size === total
      ? `You’ve got all ${total} items there before`
      : `You’ve got ${known.size} of these ${total} there before`
    : known.size === total
      ? `Between them, you’ve got all ${total} items there before`
      : `Between them, you’ve got ${known.size} of these ${total} before`;

  return { stores, detail: likely.size > 0 ? `${head} · ${likely.size} more likely` : head };
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
