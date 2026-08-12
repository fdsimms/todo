import { format } from 'date-fns/format';
import type { GroceryItem } from '../types';
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
function matchWeight(nameKey: string, queryKey: string): number {
  if (!queryKey) return 0;
  if (nameKey.startsWith(queryKey)) return 3;
  // Word-start: "goat cheese" for a "ch" query.
  if (nameKey.includes(` ${queryKey}`)) return 2;
  if (nameKey.includes(queryKey)) return 1;
  // Plural tolerance lives HERE and not in groceryNameKey, where merging two
  // shelf items would be permanent. Typing "banana" should still find
  // "bananas"; getting it wrong here costs one keystroke.
  if (queryKey.endsWith('s') && nameKey.startsWith(queryKey.slice(0, -1))) return 2;
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
 * rule, shared with the pantry below so the two can't come to disagree about
 * where an unplaced aisle goes.
 */
function sectionsInAisleOrder<T>(
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

/** Bought at least this many times before its own cadence is trusted. */
const MIN_PURCHASES_FOR_PANTRY_GUESS = 3;
/** "Got it" without enough purchase history to compute a cadence of its own. */
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
  return until >= now.getTime();
}

/**
 * "bought 6× · last on 12 Jul" — why an item off the list is treated as
 * probably still in the kitchen, or null when there's no such reason.
 *
 * `item.onHandUntil` is an explicit assertion and is checked first, because
 * it's a fact the user handed over rather than a guess: a future value wins
 * regardless of what the cadence math below would say, and a past one
 * (`markOutOfIt`) *suppresses* the guess rather than letting stale purchase
 * history overrule "I just told you I'm out." Only when there's no assertion
 * at all does the guess run: enough purchases to trust a cadence, and the
 * time since the last one still inside it.
 */
export function probablyHaveReason(item: GroceryItem, now: Date): string | null {
  const asserted = onHandAssertion(item, now);
  if (asserted !== null) return asserted ? 'marked as on hand' : null;

  if (item.purchaseCount < MIN_PURCHASES_FOR_PANTRY_GUESS || !item.lastPurchasedAt) return null;
  const cadenceDays = estimatedPurchaseCadenceDays(item, now);
  if (cadenceDays === null) return null;
  if (daysBetween(now, item.lastPurchasedAt) >= cadenceDays) return null;

  return `bought ${item.purchaseCount}× · last on ${format(new Date(item.lastPurchasedAt), 'd MMM')}`;
}

/**
 * How far out a fresh "Got it" (or a just-recorded purchase) should assert
 * on-hand: this item's own cadence once there's enough history to trust one,
 * the same two-week guess `probablyHaveReason` implicitly falls back to
 * otherwise. Shared by finishShopping (every purchased item gets this
 * automatically) and GroceryItemSheet's "Got it" button, so the two don't
 * quietly drift to different defaults.
 */
export function defaultOnHandUntil(item: GroceryItem, now: Date): string {
  const cadenceDays = estimatedPurchaseCadenceDays(item, now);
  const days = cadenceDays !== null && cadenceDays >= 1 ? cadenceDays : DEFAULT_ON_HAND_DAYS;
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

export interface PantryEntry {
  item: GroceryItem;
  /**
   * `probablyHaveReason`'s own words. That function owns this wording — it's
   * the same line the item sheet and a week plan already show, and a second
   * phrasing here would be a second thing to keep true.
   */
  reason: string;
  /** An explicit `onHandUntil` rather than the purchase-cadence guess. */
  asserted: boolean;
}

export interface PantrySection {
  aisle: string;
  data: PantryEntry[];
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

/**
 * The pantry cut into aisles, in the same walk order the shopping list uses —
 * a kitchen isn't laid out like a shop, but the aisle is the filing the user
 * has already done, and a flat A–Z list of forty things answers nothing.
 *
 * `query` filters by name with autocomplete's own matcher, so "do I have
 * flour" is one field away rather than a scroll.
 */
export function buildPantrySections(
  items: readonly GroceryItem[],
  aisleOrder: readonly string[],
  now: Date,
  query = ''
): PantrySection[] {
  const queryKey = groceryNameKey(query);
  const entries = pantryEntries(items, now).filter(
    e => !queryKey || matchWeight(e.item.nameKey, queryKey) > 0
  );

  const byAisle = new Map<string, PantryEntry[]>();
  for (const entry of entries) {
    const aisle = entry.item.aisle || OTHER_AISLE;
    const bucket = byAisle.get(aisle);
    if (bucket) bucket.push(entry);
    else byAisle.set(aisle, [entry]);
  }

  return sectionsInAisleOrder(byAisle, aisleOrder, (a, b) =>
    a.item.name.localeCompare(b.item.name)
  );
}
