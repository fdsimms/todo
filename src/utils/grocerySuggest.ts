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
const FAVORITE_BOOST = 2.5;

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
  return frequency * recencyScore(item, now) * (item.favorite ? FAVORITE_BOOST : 1);
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

  const sections: GrocerySection[] = [];
  for (const aisle of aisleOrder) {
    const data = byAisle.get(aisle);
    if (!data || data.length === 0) continue;
    sections.push({ aisle, data: [...data].sort(bySortOrder) });
    byAisle.delete(aisle);
  }
  // An aisle the order has never heard of still has to render — dropping it
  // would make its items invisible rather than merely misplaced.
  for (const [aisle, data] of byAisle) {
    sections.push({ aisle, data: [...data].sort(bySortOrder) });
  }

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
      !i.favorite &&
      i.purchaseCount === 0 &&
      daysBetween(now, i.lastAddedAt ?? i.createdAt) >= staleDays
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
