import { format } from 'date-fns/format';
import type { GroceryItem } from '../types';
import { FROZEN_REASON, RUNNING_LOW_REASON } from '../types';
import { groceryNameKey } from './groceryParse';
import { OTHER_AISLE } from './groceryAisles';

/**
 * Ranking and sectioning — the part that makes the catalog feel like it knows
 * you. Pure, so it's all pinned by grocerySuggest.test.ts.
 */

export interface GrocerySuggestion {
  item: GroceryItem;
  /** Already on the list. The row still adds (it's a no-op-plus-refresh), but it says so. */
  onList: boolean;
}

export interface GrocerySection {
  aisle: string;
  data: GroceryItem[];
}

export interface GroceryRecipeSection {
  /** Null for the catch-all bucket — see NO_RECIPE_LABEL. */
  recipeId: string | null;
  recipeTitle: string;
  data: GroceryItem[];
}

/**
 * Where a hand-typed item, or one classifyPlanned merged from more than one
 * recipe in a week (GroceryItem.sourceRecipeId null in both cases), lands in
 * buildGroceryRecipeSections — always last, same convention OTHER_AISLE uses.
 */
export const NO_RECIPE_LABEL = 'No recipe';

const DAY_MS = 86_400_000;
/** Score halves every this many days since last purchase. */
const RECENCY_HALF_LIFE_DAYS = 30;

function daysBetween(later: Date, earlierIso: string | null): number {
  if (!earlierIso) return Infinity;
  const then = new Date(earlierIso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return Math.max(0, (later.getTime() - then) / DAY_MS);
}

/**
 * How well a stored name matches what's been typed so far. 3/2/1 rather than
 * a fuzzy score because a grocery query is two or three characters and the
 * ranking below (frequency × recency) is what actually needs to decide — an
 * elaborate match score would drown it.
 */
export function matchWeight(nameKey: string, queryKey: string): number {
  if (!queryKey) return 0;
  if (nameKey.startsWith(queryKey)) return 3;
  // Word-start: "goat cheese" for a "ch" query.
  if (nameKey.includes(` ${queryKey}`)) return 2;
  if (nameKey.includes(queryKey)) return 1;
  // Plural tolerance lives HERE and not in groceryNameKey, where merging two
  // shelf items would be permanent. Typing "banana" should still find
  // "bananas"; getting it wrong here costs one keystroke.
  // The length guard is load-bearing: a bare "s" has an empty stem, and
  // `startsWith('')` is true of every name in the catalog — so typing the first
  // letter of "spinach" offered bread, eggs and everything else at weight 2,
  // ranked purely by familiarity. A one-character query has no plural to be
  // tolerant of.
  if (queryKey.length > 1 && queryKey.endsWith('s') && nameKey.startsWith(queryKey.slice(0, -1))) return 2;
  if (nameKey.startsWith(`${queryKey}s`)) return 3;
  return 0;
}

function recencyScore(item: GroceryItem, now: Date): number {
  const days = daysBetween(now, item.lastPurchasedAt ?? item.lastAddedAt);
  if (days === Infinity) return 0.5; // never bought and never re-added
  return 0.5 ** (days / RECENCY_HALF_LIFE_DAYS);
}

function familiarity(item: GroceryItem, now: Date): number {
  const frequency = 1 + Math.log1p(item.purchaseCount);
  return frequency * recencyScore(item, now);
}

/**
 * Autocomplete. Frequency × recency, halving monthly — what puts milk above
 * the mustard you bought once in March.
 *
 * Items already on the list rank normally rather than being filtered out:
 * seeing "Milk — On list" is the answer to "did I already add that?", and
 * hiding it just makes you type the whole word to find out.
 */
export function rankGrocerySuggestions(
  query: string,
  items: readonly GroceryItem[],
  now: Date,
  limit = 5
): GrocerySuggestion[] {
  const queryKey = groceryNameKey(query);
  if (!queryKey) return [];

  return items
    .map(item => ({ item, weight: matchWeight(item.nameKey, queryKey) }))
    .filter(x => x.weight > 0)
    .map(x => ({ item: x.item, score: x.weight * familiarity(x.item, now) }))
    .sort((a, b) =>
      b.score - a.score ||
      a.item.name.length - b.item.name.length ||
      a.item.name.localeCompare(b.item.name)
    )
    .slice(0, limit)
    .map(x => ({ item: x.item, onList: x.item.onList }));
}

/**
 * The "you buy this every week" shelf. Only things not currently on the list —
 * offering to add what's already there is the one thing this sheet must not do.
 */
export function buyAgainItems(items: readonly GroceryItem[], now: Date, limit = 40): GroceryItem[] {
  return items
    .filter(i => !i.onList)
    .map(item => ({ item, score: familiarity(item, now) }))
    .sort((a, b) =>
      b.score - a.score ||
      a.item.name.localeCompare(b.item.name)
    )
    .slice(0, limit)
    .map(x => x.item);
}

/**
 * Buckets already keyed by aisle, emitted in walk order — the shopping list's
 * rule, shared with `kitchenInventory.buildKitchenSections` so the two can't
 * come to disagree about where an unplaced aisle goes.
 */
export function sectionsInAisleOrder<T>(
  byAisle: Map<string, T[]>,
  aisleOrder: readonly string[],
  compare: (a: T, b: T) => number
): { aisle: string; data: T[] }[] {
  const remaining = new Map(byAisle);
  const sections: { aisle: string; data: T[] }[] = [];
  for (const aisle of aisleOrder) {
    const data = remaining.get(aisle);
    if (!data || data.length === 0) continue;
    sections.push({ aisle, data: [...data].sort(compare) });
    remaining.delete(aisle);
  }
  // An aisle the order has never heard of still has to render — dropping it
  // would make its items invisible rather than merely misplaced.
  for (const [aisle, data] of remaining) {
    sections.push({ aisle, data: [...data].sort(compare) });
  }
  return sections;
}

/**
 * The shopping list, cut into aisles in walk order.
 *
 * `cartHoldIds` is where the in-cart hold resolves: a just-checked row stays
 * struck-through in its own aisle for the length of the hold, so the tap is
 * visibly acknowledged where your eye already is, and only then sinks into the
 * "In cart" section. Same reasoning as completionHoldIds on Today — a row that
 * vanishes the instant you tap it reads as "did that work?".
 */
export function buildGrocerySections(
  items: readonly GroceryItem[],
  aisleOrder: readonly string[],
  cartHoldIds: readonly string[] = []
): { sections: GrocerySection[]; inCart: GroceryItem[]; remaining: number } {
  const held = new Set(cartHoldIds);
  const onList = items.filter(i => i.onList);

  const byAisle = new Map<string, GroceryItem[]>();
  const inCart: GroceryItem[] = [];

  for (const item of onList) {
    if (item.checked && !held.has(item.id)) {
      inCart.push(item);
      continue;
    }
    const aisle = item.aisle || OTHER_AISLE;
    const bucket = byAisle.get(aisle);
    if (bucket) bucket.push(item);
    else byAisle.set(aisle, [item]);
  }

  const bySortOrder = (a: GroceryItem, b: GroceryItem) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  const sections = sectionsInAisleOrder(byAisle, aisleOrder, bySortOrder);

  inCart.sort(bySortOrder);

  return {
    sections,
    inCart,
    remaining: onList.filter(i => !i.checked).length,
  };
}

/**
 * The other lens on the same list: cut into recipes instead of aisles, off
 * GroceryItem.sourceRecipeId/sourceRecipeTitle — a snapshot stamped once at
 * creation (see useGroceryStore.newItemRow), not a live lookup, so a section
 * still names its recipe correctly even after that recipe is renamed or
 * deleted. Sections are sorted by title, with the no-recipe bucket always
 * last; within a section, still the list's own sortOrder walk.
 */
export function buildGroceryRecipeSections(
  items: readonly GroceryItem[],
  cartHoldIds: readonly string[] = []
): { sections: GroceryRecipeSection[]; inCart: GroceryItem[]; remaining: number } {
  const held = new Set(cartHoldIds);
  const onList = items.filter(i => i.onList);

  const byRecipe = new Map<string, { title: string; data: GroceryItem[] }>();
  const inCart: GroceryItem[] = [];

  for (const item of onList) {
    if (item.checked && !held.has(item.id)) {
      inCart.push(item);
      continue;
    }
    const key = item.sourceRecipeId ?? '';
    const title = item.sourceRecipeId ? item.sourceRecipeTitle || NO_RECIPE_LABEL : NO_RECIPE_LABEL;
    const bucket = byRecipe.get(key);
    if (bucket) bucket.data.push(item);
    else byRecipe.set(key, { title, data: [item] });
  }

  const bySortOrder = (a: GroceryItem, b: GroceryItem) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  const sections: GroceryRecipeSection[] = Array.from(byRecipe.entries())
    .map(([recipeId, { title, data }]) => ({
      recipeId: recipeId || null,
      recipeTitle: title,
      data: [...data].sort(bySortOrder),
    }))
    .sort((a, b) => {
      if (a.recipeId === null) return b.recipeId === null ? 0 : 1;
      if (b.recipeId === null) return -1;
      return a.recipeTitle.localeCompare(b.recipeTitle);
    });

  inCart.sort(bySortOrder);

  return {
    sections,
    inCart,
    remaining: onList.filter(i => !i.checked).length,
  };
}

/**
 * Catalog rows that look like typos or one-offs: never bought, not favourited,
 * off the list, and untouched for a while.
 *
 * Surfaced as an *offer* inside Buy again, never swept automatically. The task
 * side gets away with an automatic purge because shake-to-undo exists;
 * groceries have no undo at all, so an automatic delete here is unrecoverable.
 */
export function catalogPruneCandidates(
  items: readonly GroceryItem[],
  now: Date,
  staleDays = 60
): GroceryItem[] {
  return items
    .filter(i =>
      !i.onList &&
      i.purchaseCount === 0 &&
      daysBetween(now, i.lastAddedAt ?? i.createdAt) >= staleDays
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── The pantry ─────────────────────────────────────────────────────────────
//
// "Probably have" — an item off the list that purchase history says is still
// around the kitchen. This is recencyScore turned around: instead of a smooth
// decay that ranks suggestions, it asks a binary question — has the time
// since the last purchase already passed how often *this specific item*
// usually gets bought again? A per-item cadence rather than one global window
// is the whole trick, and it's the one behaviour here that genuinely needs
// purchase history: milk and soy sauce can't share a number.

/**
 * Bought at least this many times before the item's *own* cadence is trusted
 * over the flat default below. One purchase on a year-old row divides out to a
 * 365-day cadence, which is not a number to assert anything from.
 */
const MIN_PURCHASES_FOR_CADENCE = 3;
/** The window for an item with no cadence worth trusting yet. */
const DEFAULT_ON_HAND_DAYS = 14;

/**
 * "Out of it" — any definitively-past timestamp suppresses probablyHaveReason's
 * guess below, so the exact value doesn't matter; a named constant beats a
 * bare `new Date(0)` re-typed at each call site and says why it's there.
 */
export const OUT_OF_IT_UNTIL = new Date(0).toISOString();

/**
 * How many days apart this item's purchases have averaged, or null when
 * there isn't enough to go on. Deliberately crude — `(now - createdAt) /
 * purchaseCount` rather than a real inter-purchase average — because the
 * catalog doesn't keep a purchase log to average over; the row's age and its
 * running count are all there is, and that's already enough to tell milk
 * from soy sauce.
 */
export function estimatedPurchaseCadenceDays(item: GroceryItem, now: Date): number | null {
  if (item.purchaseCount < 1) return null;
  const ageDays = daysBetween(now, item.createdAt);
  if (ageDays <= 0) return null;
  return ageDays / item.purchaseCount;
}

/**
 * What `onHandUntil` currently asserts: `true` for an active "Got it", `false`
 * for "Out of it", `null` when there's no usable assertion and the cadence
 * guess gets to decide. One reading of the column, so `probablyHaveReason`
 * and the pantry list below can't drift on what a past or unparseable
 * timestamp means.
 */
function onHandAssertion(item: GroceryItem, now: Date): boolean | null {
  if (!item.onHandUntil) return null;
  const until = new Date(item.onHandUntil).getTime();
  if (Number.isNaN(until)) return null;
  if (until >= now.getTime()) return true;
  // A past stamp is only an answer when it's the "Out of it" sentinel. A
  // *lapsed* "Got it" is an assertion that has run out, not a claim to be out
  // of something — so it hands the question back to the purchase reading below
  // rather than suppressing it. Reading every past stamp as a negative is what
  // made a row whose window quietly expired show the "Out of it" pill lit, and
  // it's why GroceryItemSheet's "always OUT_OF_IT_UNTIL in practice" note had
  // stopped being true.
  return item.onHandUntil === OUT_OF_IT_UNTIL ? false : null;
}

/**
 * How long one purchase of this item is worth believing in — its own cadence
 * once there's enough history to trust one, a flat two weeks before that.
 *
 * The single window behind both halves of the pantry: how long a "Got it"
 * lasts (`defaultOnHandUntil`, measured from the tap) and how long a purchase
 * reads as on hand (`probablyHaveReason`, measured from the till). Two
 * anchors, deliberately — a tap and a purchase are different moments — but one
 * length, because "how long does this last" is one question, and answering it
 * in two places is how the two came to disagree: the guess wanted three
 * purchases before trusting a cadence and the assertion was happy with one.
 */
function onHandWindowDays(item: GroceryItem, now: Date): number {
  if (item.purchaseCount < MIN_PURCHASES_FOR_CADENCE) return DEFAULT_ON_HAND_DAYS;
  const cadence = estimatedPurchaseCadenceDays(item, now);
  return cadence !== null && cadence >= 1 ? cadence : DEFAULT_ON_HAND_DAYS;
}

/**
 * "bought 6× · last on 12 Jul" — why an item off the list is treated as
 * probably still in the kitchen, or null when there's no such reason.
 *
 * `item.onHandUntil` is an explicit assertion and is checked first, because
 * it's a fact the user handed over rather than a guess: a future value wins
 * regardless of what the purchase reading below would say, and `markOutOfIt`
 * *suppresses* it rather than letting stale purchase history overrule "I just
 * told you I'm out." Only when there's no live assertion does the purchase
 * reading run: bought at least once, and the time since still inside this
 * item's own window.
 *
 * **The purchase reading is why nothing stamps `onHandUntil` on a purchase.**
 * It used to: `finishShopping` wrote a computed window onto every row it
 * bought, which meant this function's assertion branch was taken for anything
 * ever bought and the purchase branch below could not be reached at all (see
 * #1770). The timing was right and everything else about it was wrong — the
 * evidence never rendered, and the app told people they had marked something
 * on hand when a till had. A purchase is evidence to read, not a claim to
 * store; the only thing a trip writes here now is a `null`, clearing an "Out
 * of it" the purchase refutes.
 */
export function probablyHaveReason(item: GroceryItem, now: Date): string | null {
  // A staple outranks everything below: it's a standing fact ("I always have
  // salt"), not a guess, and it doesn't need purchase history or an
  // onHandUntil assertion to be true. This is also why KitchenScreen — every
  // name this function answers for — reads a staple as on hand with no
  // purchases ever recorded.
  if (item.isStaple) return 'always have it';

  const asserted = onHandAssertion(item, now);

  // An explicit "Out of it" beats everything below, the freezer included. It
  // has to be the ✕ on a Pantry row: that button writes exactly this bit, so if
  // the freezer outranked it, tapping ✕ on a frozen row would leave the row
  // sitting there and read as a dead control. "I'm out of it" is also simply a
  // later and better-informed statement than "I put some in the freezer".
  if (asserted === false) return null;

  // Nearly out, and so on this week's list — but still *had*, which is the
  // whole distinction from "Out of it" above and the reason this reads as a
  // pantry entry at all rather than as an absence. Above the freezer because a
  // frozen thing you're nearly out of is a thing to buy, and that's the more
  // actionable half; below "Out of it" because being out beats being low.
  if (item.runningLowAt) return RUNNING_LOW_REASON;

  // The freezer then outranks the purchase reading below, for the reason the
  // staple line above does: it's a fact the user handed over, not a guess. It
  // has to, or the feature would defeat itself — the whole point of a freezer
  // is that food outlives the window this function reasons in, so a bag of
  // chicken frozen in July would drop out of the pantry in August while sitting
  // in the freezer, and the app would offer to add it to the list.
  //
  // A standing fact with no date, exactly like the staple line: *when* it was
  // frozen is a clock question, and the clock is `freshness`'s to describe —
  // see `describeFrozenSince`, which the kitchen row pairs with this.
  if (item.frozenAt) return FROZEN_REASON;

  if (asserted === true) return 'marked as on hand';

  if (item.purchaseCount < 1 || !item.lastPurchasedAt) return null;
  if (daysBetween(now, item.lastPurchasedAt) >= onHandWindowDays(item, now)) return null;

  // "once" rather than "1×", mirroring describeCookHistory — the two lines sit
  // in the same kind of caption and already share their halving.
  const times = item.purchaseCount === 1 ? 'once' : `${item.purchaseCount}×`;
  return `bought ${times} · last on ${format(new Date(item.lastPurchasedAt), 'd MMM')}`;
}

/**
 * How far out a fresh "Got it" should assert on-hand, measured from the tap:
 * `onHandWindowDays`, the same length a purchase reads as on hand for.
 *
 * Deliberately *not* called by `finishShopping` any more — a purchase is read,
 * not asserted (see `probablyHaveReason`). Its callers are the three places
 * someone says "I have this" by hand: GroceryItemSheet's "Got it" pill,
 * RecipeToListSheet's equivalent, and KitchenScreen's add field via
 * `addToPantry`.
 */
export function defaultOnHandUntil(item: GroceryItem, now: Date): string {
  return new Date(now.getTime() + onHandWindowDays(item, now) * DAY_MS).toISOString();
}

export interface PantryEntry {
  item: GroceryItem;
  /**
   * `probablyHaveReason`'s own words. That function owns this wording — it's
   * the same line the item sheet and a week plan already show, and a second
   * phrasing here would be a second thing to keep true.
   */
  reason: string;
  /**
   * An explicit live `onHandUntil` rather than the purchase reading. Genuinely
   * discriminating again since #1770 — while a trip stamped an assertion onto
   * everything it bought, this was true of every entry there could be.
   */
  asserted: boolean;
}

/**
 * Everything the app currently treats as "have it", which is exactly the set
 * `probablyHaveReason` answers for — nothing is computed here that a week plan
 * wasn't already computing one item at a time.
 *
 * Rows on the list are deliberately included. An item can be both bought
 * recently and back on the list, and dropping it would mean an item marked
 * "Got it" disappeared from the pantry the moment it was added to a list —
 * which reads as the assertion having been forgotten. The caller says so on
 * the row instead.
 */
export function pantryEntries(items: readonly GroceryItem[], now: Date): PantryEntry[] {
  const entries: PantryEntry[] = [];
  for (const item of items) {
    const reason = probablyHaveReason(item, now);
    if (!reason) continue;
    entries.push({ item, reason, asserted: onHandAssertion(item, now) === true });
  }
  return entries.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

