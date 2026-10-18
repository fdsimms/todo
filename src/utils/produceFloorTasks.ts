import type { GroceryItem } from '../types';
import type { KitchenEntry } from './kitchenInventory';
import { produceKindOf } from './produceServings';
import { OUT_OF_IT_UNTIL } from './grocerySuggest';

/**
 * `produceFloor`: a weekly task to restock vegetables and fruit when the pantry
 * lists fewer than a number the person set.
 *
 * See `docs/arch/generated-tasks.md` for the mechanism it shares. What is worth
 * reading here is what the count is allowed to claim.
 *
 * **The count is what the pantry vouches for, so it can only be low by the
 * pantry's own account.** `kitchenInventory` lists an item when a purchase, a
 * "Got it" or a freezer date says it is on hand; a thing in the cupboard nobody
 * bought through the app is not in it. The title names the figure ("1 of 4 on
 * hand") so a person who knows better can see what it was judged by and dismiss
 * it. It never writes to the grocery list: a shopping list that fills itself is
 * a different feature, and the notes only name what could go on it.
 *
 * **Fresh, frozen and canned all count; only produce past its use-by day does
 * not.** A bag of frozen peas is stock, and so is spinach with days left, but
 * spinach 27 days over is not (`over` freshness), so the floor does not paper
 * over the pantry hygiene card. Items are counted by catalog key, so a bag and
 * a box of one thing are one thing. Whether a name is produce is
 * `produceKindOf`, with its limits: a name it does not know counts as none.
 *
 * **At most one a week**, keyed by the week's first day, with a completed or
 * deleted one blocking the next that week (`blocksOnFinished`,
 * `produceFloorDeclinedWeekKey`). Restocking is a trip, not a daily chore.
 */

export const DEFAULT_PRODUCE_FLOOR = 4;
export const PRODUCE_FLOOR_MIN = 1;
export const PRODUCE_FLOOR_MAX = 20;

export function clampProduceFloor(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PRODUCE_FLOOR;
  return Math.min(PRODUCE_FLOOR_MAX, Math.max(PRODUCE_FLOOR_MIN, Math.round(n)));
}

/** The distinct produce items the pantry lists as on hand and not past their use-by day. */
export function stockedProduce(entries: readonly KitchenEntry[]): string[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'leftover' || !entry.matchKey) continue;
    if (entry.freshness === 'over') continue;
    const kind = produceKindOf(entry.title);
    if (kind === null || kind === 'mixed') continue;
    keys.add(entry.matchKey);
  }
  return [...keys];
}

/** The names behind `stockedProduce`'s count, one per catalog key, in the order the pantry lists them. */
export function stockedProduceNames(entries: readonly KitchenEntry[]): string[] {
  const names = new Map<string, string>();
  for (const key of stockedProduce(entries)) {
    const entry = entries.find(e => e.kind !== 'leftover' && e.matchKey === key && e.freshness !== 'over');
    if (entry) names.set(key, entry.title.toLowerCase());
  }
  return [...names.values()];
}

/** Whether the pantry is under the floor. */
export function produceFloorApplies(stockedCount: number, floor: number): boolean {
  return stockedCount < clampProduceFloor(floor);
}

export function produceFloorTitle(stockedCount: number, floor: number): string {
  return `Restock vegetables and fruit (${stockedCount} of ${clampProduceFloor(floor)} on hand)`;
}

/** How many names the notes list. */
export const PRODUCE_FLOOR_SUGGESTIONS_SHOWN = 5;

/**
 * Produce already in the catalog that is not on hand, most useful first: frozen
 * and canned ones (they keep, so they are what a floor is for), then the ones
 * bought most often, then by name. Rows marked "Out of it" are included, since
 * that is exactly what needs buying; staples are not produce and never reach
 * here.
 */
export function restockSuggestions(
  items: readonly GroceryItem[],
  stockedKeys: readonly string[],
): GroceryItem[] {
  const stocked = new Set(stockedKeys);
  const keeps = (name: string) => /\b(frozen|canned|dried)\b/i.test(name);
  return items
    .filter(item => {
      if (stocked.has(item.nameKey)) return false;
      if (item.purchaseCount < 1 && item.onHandUntil !== OUT_OF_IT_UNTIL) return false;
      const kind = produceKindOf(item.name);
      return kind !== null && kind !== 'mixed';
    })
    .sort(
      (a, b) =>
        Number(keeps(b.name)) - Number(keeps(a.name)) ||
        b.purchaseCount - a.purchaseCount ||
        a.name.localeCompare(b.name),
    );
}

export function produceFloorNotes(
  suggestions: readonly GroceryItem[],
  onHand: readonly string[] = [],
): string {
  const parts = ['Counted from what the pantry lists as on hand. Dismiss it if you already have enough.'];
  // The whole list: it is shorter than the floor, which is capped at 20.
  if (onHand.length > 0) parts.push(`On hand: ${onHand.join(', ')}.`);
  if (suggestions.length > 0) {
    const names = suggestions.slice(0, PRODUCE_FLOOR_SUGGESTIONS_SHOWN).map(i => i.name.toLowerCase());
    const more = suggestions.length - names.length;
    parts.push(`Bought before, not on hand: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`);
  }
  return parts.join('\n\n');
}
