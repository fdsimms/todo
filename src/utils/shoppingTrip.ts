import type { GroceryItem, ItemShopLink, Shop } from '../types';
import { lacksWantedBrand } from './groceryShops';

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
 * - Nothing here ever *infers* anything about a store's stock, in either
 *   direction. The buckets are *seen here* and *no idea* — the second is named
 *   for the app's ignorance rather than the store's shelves, and every string
 *   in `describe*` is worded as a fact about the record.
 * - The rank is by what's *known*, because a lower bound is still the best
 *   estimate available — but it's reported as a lower bound ("at least",
 *   "likely has"), and a store the app knows little about says so rather than
 *   reading as empty.
 *
 * **There used to be a third bucket, and it's gone on purpose.** A store with
 * a couple of items on record from an aisle got credited with everything else
 * on the list from that aisle — "likely", rendered as its own faded half of
 * every count, bar and sentence. It was unfalsifiable (nothing the user does
 * confirms or denies an aisle guess, so it never got better or went away), it
 * doubled the width of every string in this module, and the number it produced
 * couldn't be acted on: knowing a store "probably" has 2 more of your list
 * tells you nothing you'd change a trip over. Ranking on what's actually been
 * bought or asserted is the whole feature. Don't reintroduce it — if a store's
 * count looks low, the fix is the correction flow ("Actually, it has more"),
 * which turns a guess into a fact the user owns.
 *
 * **The one exception is a claim the user made themselves.** A link carrying
 * `unavailableAt` is the user saying they looked and it wasn't there
 * (`ItemShopLink.unavailableAt`), and that is the only thing in this module
 * allowed to assert an absence — because it isn't the app asserting it. So a
 * marked item is dropped from `itemIds` and lands in its own
 * `unavailableItemIds` / `TripSummary.missing` so the sheet can say plainly
 * that the second stop is the one that closes it. It stays out of
 * `recordedItems` too: knowing a shop *lacks* three things is not knowing its
 * range, so it must never read as the app having learned something about the
 * store.
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
  /** On-list items seen at this store — bought or asserted — in list order. */
  itemIds: string[];
  /**
   * On-list items the user has said this store doesn't stock, in list order.
   * One of the module's two hard negatives.
   */
  unavailableItemIds: string[];
  /**
   * On-list items the user has said this store hasn't got their brand of, when
   * the item insists on one (GroceryItem.brandStrict). In list order.
   *
   * Its own bucket rather than folded into `unavailableItemIds`, for the same
   * reason `missing` is split from `gap` below: the copy differs in kind. This
   * store has the item and hasn't got the one you want, which is not the same
   * claim as not stocking it, and saying the latter would be false.
   */
  withoutBrandItemIds: string[];
  /** How many of `itemIds` are hand-assertions rather than observed purchases. */
  assertedCount: number;
  /** Total purchases behind the observed ones — a tiebreak, never rendered. */
  observedPurchases: number;
  /**
   * Distinct catalog items on record here, the whole catalog over — how much
   * the app knows about this store, as opposed to what the store sells. At
   * zero the sheet says so, because an empty record is a fact about the app
   * and rendering it as coverage would be a slur on the shop.
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
  /**
   * On-list items a selected store is known *not* to carry, because the user
   * said so — and that no selected store covers or probably covers. Split out
   * of `gap` because the copy differs in kind: a gap is "you've never got this
   * here", which the store may well disprove, and this is "it isn't there".
   */
  missing: string[];
  /**
   * On-list items a selected store has been said not to have the right brand
   * of, and that no selected store covers. The brand-level twin of `missing`:
   * the trip won't come back with these either, but the shelf isn't empty —
   * what's on it isn't what was asked for, so the sheet says so in its own
   * words.
   */
  withoutBrand: string[];
  /** On-list items some *other* store is known to carry — a second stop closes them. */
  gap: string[];
  /**
   * On-list items nothing is known about at any store. Named for the app's
   * ignorance, not the shops': any of them might be at every store on the list.
   */
  unknown: string[];
  /**
   * The stores to add, greedily, to close as much of `missing` and `gap` as
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
 * `items` is the whole catalog rather than just the list, because
 * `recordedItems` counts everything ever recorded at a store, not the twelve
 * things you happen to need today.
 */
export function planTrip(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): TripPlan {
  const itemIdsInCatalog = new Set(items.map(i => i.id));
  // The brand rule is a fact about the item, so a link can't be judged without
  // it — see groceryShops.hasWrongBrand.
  const itemsById = new Map(items.map(i => [i.id, i]));
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
          unavailableItemIds: [],
          withoutBrandItemIds: [],
          assertedCount: 0,
          observedPurchases: 0,
          recordedItems: 0,
        },
      ])
  );

  for (const link of links) {
    const entry = byShop.get(link.shopId);
    // Resolve-or-shrug, like every cross-row pointer here: a link naming a
    // deleted (or excluded) store is skipped rather than counted blind.
    if (!entry) continue;
    if (!itemIdsInCatalog.has(link.itemId)) continue;

    if (link.unavailableAt !== null) {
      if (rank.has(link.itemId)) entry.unavailableItemIds.push(link.itemId);
      // No recordedItems, no coverage: a store that lacks something is not
      // thereby a store the app knows the range of.
      continue;
    }

    // The store has the item, so it stays a store the app knows something
    // about — recordedItems is a measure of the record, not of this list. What
    // it doesn't get is coverage of *this* row, because the user has said this
    // store hasn't got the brand the row asks for.
    const item = itemsById.get(link.itemId);
    if (item && lacksWantedBrand(link, item)) {
      entry.recordedItems++;
      if (rank.has(link.itemId)) entry.withoutBrandItemIds.push(link.itemId);
      continue;
    }

    entry.recordedItems++;

    if (!rank.has(link.itemId)) continue;
    entry.itemIds.push(link.itemId);
    if (link.purchaseCount > 0) entry.observedPurchases += link.purchaseCount;
    else entry.assertedCount += 1;
  }

  for (const entry of byShop.values()) {
    entry.itemIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
    entry.unavailableItemIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
    entry.withoutBrandItemIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
  }

  const coverage = [...byShop.values()];
  coverage.sort((a, b) => {
    if (b.itemIds.length !== a.itemIds.length) return b.itemIds.length - a.itemIds.length;
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
  const absentHere = new Set<string>();
  const withoutBrandHere = new Set<string>();
  const knownSomewhere = new Set<string>();

  for (const entry of plan.coverage) {
    const isSelected = selected.has(entry.shop.id);
    for (const id of entry.itemIds) {
      knownSomewhere.add(id);
      if (isSelected) covered.add(id);
    }
    // Only the selected stores' negatives matter: "Safeway doesn't have it" is
    // no reason to change a trip to Costco, and it's already why Safeway isn't
    // being credited with it above.
    if (isSelected) {
      for (const id of entry.unavailableItemIds) absentHere.add(id);
      for (const id of entry.withoutBrandItemIds) withoutBrandHere.add(id);
    }
  }

  const rest = plan.itemIds.filter(id => !covered.has(id));
  const missing = rest.filter(id => absentHere.has(id));
  // An outright "they don't stock it" outranks "they haven't got your brand" when
  // two selected stores disagree — it's the stronger claim about the trip, and
  // an item must land in exactly one bucket or the sheet counts it twice.
  const withoutBrand = rest.filter(id => !absentHere.has(id) && withoutBrandHere.has(id));
  const open = rest.filter(id => !absentHere.has(id) && !withoutBrandHere.has(id));
  const gap = open.filter(id => knownSomewhere.has(id));
  const unknown = open.filter(id => !knownSomewhere.has(id));

  const suggestion: ShopCoverage[] = [];
  // A missing item is the strongest possible reason for a second stop — it's
  // the one thing on the list the trip definitely won't come back with — so it
  // joins the greedy walk's target set alongside the gap.
  const openSet = new Set([...missing, ...withoutBrand, ...gap]);
  const taken = new Set(selected);
  while (openSet.size > 0 && selected.size + suggestion.length < MAX_TRIP_STOPS) {
    let best: ShopCoverage | null = null;
    let bestKnown = 0;
    for (const entry of plan.coverage) {
      if (taken.has(entry.shop.id)) continue;
      // Strictly greater, so a tie falls to the better-ranked store — the
      // coverage list is already sorted, so the walk inherits that order.
      const known = countIn(entry.itemIds, openSet);
      if (known > bestKnown) {
        best = entry;
        bestKnown = known;
      }
    }
    if (!best) break;
    suggestion.push(best);
    taken.add(best.shop.id);
    for (const id of best.itemIds) openSet.delete(id);
  }

  return {
    covered: plan.itemIds.filter(id => covered.has(id)),
    missing,
    withoutBrand,
    gap,
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
 * on your list" would be the app announcing a stock check it never ran.
 *
 * The exception, again, is the user's own claim: "2 they don't have" is the one
 * clause here that states an absence, and it can say so flatly because it's
 * quoting the person reading it. It comes last and stays its own clause —
 * two counts of two different kinds.
 */
export function describeShopCoverage(entry: ShopCoverage, total: number): string | null {
  if (total === 0) return null;
  const known = entry.itemIds.length;
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
  if (absent > 0) parts.push(`${absent} they don’t have`);
  return parts.join(' · ');
}

export interface TripSuggestionCopy {
  /** The one store to go to — the walk's best. */
  store: string;
  /** What the record says it accounts for, and which items those are. */
  detail: string;
  /**
   * "Add Ballard Pharmacy for shampoo and kale" — the second stop and exactly
   * what it buys you, when it's worth the detour. Null when one store is the
   * whole answer, or when the next one doesn't clear `extraStopThreshold`.
   */
  offer: string | null;
}

/**
 * How many items a store the user didn't ask about has to add before the card
 * puts its name on the screen.
 *
 * A stop costs something — time, and often a drive in the wrong direction —
 * and until this the walk priced it at zero: `summarizeTrip` takes any store
 * closing even one item, so a list of five could produce a two-store itinerary
 * for the sake of a single tub of yoghurt. That's the right answer for
 * `summarizeTrip` itself, which is exhaustive on purpose — the trip sheet is
 * somewhere you're *actively planning*, and "one more stop gets you the last
 * thing" is exactly what you opened it to find out. It's the wrong answer for
 * an unsolicited suggestion at the top of the list, so the threshold lives
 * here, with the copy, and the walk stays honest.
 *
 * Two items or a fifth of the list, whichever is more: a floor, because one
 * item is never worth a second shop, and a share, because on a thirty-item
 * list two more is still noise.
 *
 * **It is not a model of distance, and it can't become one.** The app has
 * never known where a shop is or which of them are on one road, so this prices
 * every second stop the same. What it does is stop the card asserting a plan
 * that has to earn nothing — the store's own "don't send me there" is
 * `excludeFromSuggestions`, and anything finer wants a fact the user has told
 * us, not a sharper guess.
 */
export const MIN_EXTRA_STOP_ITEMS = 2;
export const EXTRA_STOP_SHARE = 0.2;

export function extraStopThreshold(total: number): number {
  return Math.max(MIN_EXTRA_STOP_ITEMS, Math.ceil(total * EXTRA_STOP_SHARE));
}

/**
 * The recommendation, for somewhere that isn't the trip sheet — the card at
 * the top of the shopping list. `summarizeTrip([], plan)` is the fewest stores
 * the greedy walk can cover the list with, and this is the one place that
 * turns it into a sentence, so the list screen and anywhere else that surfaces
 * it can't word it two ways.
 *
 * The same rule as everywhere else in this module: the number is a floor and
 * the copy says so. "Likely has 1/4 items on your list" is a fact about what
 * you've bought there, hedged because a shop's shelves are not something this
 * app has ever seen — "has 1/4" would be a stock check it never ran.
 *
 * **It names the items, and that's the half worth keeping.** "3/5" is a score,
 * not an answer: whether that trip is worth making depends entirely on whether
 * the 3 includes the thing you actually need, and a count can't say. So the
 * covered items are listed — capped by `joinNames`, in list order, from the
 * `names` map the caller already has — and the number is there to say how much
 * the naming leaves out.
 *
 * **One store is the recommendation; a second is an offer with a price on it.**
 * It used to headline the whole itinerary — "The Bad Wife, then Mr. Kiwi" over
 * a *joint* "likely have 2/5" — and both halves of that were wrong. The count
 * was unsplittable, so the one number that decides whether the detour is worth
 * making (what the second shop adds that the first hasn't) was the one number
 * you couldn't get; and "then" asserted a route, when the order is coverage
 * rank and this app has never known where a shop is. Now the headline store's
 * own coverage is the detail, and the extra stop is named with exactly what it
 * adds — so declining it is a decision you can make from the card.
 *
 * **At most one extra is offered**, however far `MAX_TRIP_STOPS` lets the walk
 * run: a third store is an itinerary again, and the sheet is where an itinerary
 * belongs. It's the walk's own next stop rather than a fresh scan of the rest —
 * the greedy pick already maximises what's added on top of the headline, and
 * re-ranking here would be a second walk to disagree with the sheet's.
 *
 * Null when there's nothing to say, which is the card's own "don't render": an
 * empty list, no suggestion, or a suggestion covering nothing on record.
 */
export function describeTripSuggestion(
  suggestion: readonly ShopCoverage[],
  total: number,
  names: ReadonlyMap<string, string>
): TripSuggestionCopy | null {
  if (total === 0 || suggestion.length === 0) return null;

  const [head, ...rest] = suggestion;
  // A store's own coverage is already one row per item — no dedupe needed, and
  // no union across stops any more, which is the point.
  const covered = head.itemIds;
  if (covered.length === 0) return null;

  const store = head.shop.name;
  const offer = describeExtraStop(rest[0], covered, total, names);

  if (covered.length === total) {
    return {
      store,
      detail:
        total === 1
          ? 'Likely has the one item on your list'
          : `Likely has all ${total} items on your list`,
      offer,
    };
  }

  const named = joinNames(covered.map(id => names.get(id) ?? 'an item'));
  const line = `Likely has ${covered.length}/${total} items on your list`;
  return { store, detail: named ? `${line}: ${named}` : line, offer };
}

/**
 * `TripSuggestionCard`'s own copy, but reachable from raw store state rather
 * than only from inside that component — so `GroceryScreen` can ask the same
 * question the card asks ("do I have something to say?") to decide whether to
 * render the card at all, or fall back to `StartTripPrompt` when the answer is
 * no. One function rather than two call sites re-deriving `plan.coverage.length
 * < 2`, which is exactly the kind of rule this module's own header warns
 * about duplicating.
 */
export function tripSuggestionCopy(
  items: readonly GroceryItem[],
  itemShops: readonly ItemShopLink[],
  shops: readonly Shop[]
): TripSuggestionCopy | null {
  const plan = planTrip(items, itemShops, shops);
  // Two suggestable stores is the floor — see TripSuggestionCard's own doc
  // comment for why one can't produce a suggestion worth naming.
  if (plan.coverage.length < 2) return null;
  const nameOf = new Map(items.map(i => [i.id, i.name]));
  return describeTripSuggestion(summarizeTrip([], plan).suggestion, plan.itemIds.length, nameOf);
}

/**
 * "Add Ballard Pharmacy for shampoo" — the second stop priced in the only
 * currency that matters, which is what it adds that the first one hasn't.
 *
 * Null below `extraStopThreshold`: a stop that closes one item is a stop most
 * people won't make, and offering it every week is how the card would come to
 * be ignored. Silence is the right answer there — the store is still in the
 * sheet, one tap away, for the week you do want it.
 */
function describeExtraStop(
  next: ShopCoverage | undefined,
  coveredByHead: readonly string[],
  total: number,
  names: ReadonlyMap<string, string>
): string | null {
  if (!next) return null;
  const already = new Set(coveredByHead);
  const adds = next.itemIds.filter(id => !already.has(id));
  if (adds.length < extraStopThreshold(total)) return null;
  return `Add ${next.shop.name} for ${joinNames(adds.map(id => names.get(id) ?? 'an item'))}`;
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
