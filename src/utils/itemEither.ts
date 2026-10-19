import type { GroceryItem, ItemPick, MealPlanEntry } from '../types';
import type { StandingSwap, StandingSwapMap } from './standingSwaps';
import type { FlatIngredient } from './recipeComponents';

/**
 * "Either one" — butter and vegan butter are interchangeable for this person,
 * and which went into a cooking is theirs to say each time.
 *
 * The relation is `ItemSubLink.either`, written on both rows of a pair and
 * resolved by `standingSwaps.applyStandingSwap` on the way out of
 * `flattenRecipeIngredients`, the one gate every shopping, cost, nutrition and
 * cook read already goes through. What this module owns is the answer itself
 * (`ItemPick`, kept on `MealPlanEntry.itemPicks`) and the reads a screen needs
 * about it.
 *
 * Three rules, each pinned by `itemEither.test.ts`:
 *
 * - **Undecided is not a default.** A pair nobody has answered reads as the
 *   recipe wrote it and is reported undecided, and a read that would put figures
 *   on a plate refuses (`recipeNutritionLines`). The two have different
 *   nutrition, so a guess logs the wrong one, which is the whole reason the
 *   relation exists. The pantry's contents are never used to guess: having both
 *   is the case where guessing is wrong.
 * - **One pick covers every recipe in the cooking.** It is keyed by the pair,
 *   not by a recipe line, so a loaf and the glaze on it are answered once.
 * - **A pick that names neither item of the pair is no answer.** Resolve-or-shrug,
 *   like every other stored pointer here: an item that was renamed or deleted
 *   leaves the pair undecided rather than rewriting lines to something stale.
 */

/**
 * A resolution for a read that has no cooking to take answers from but must not
 * put figures on a dish whose "either one" pair is open: the manual food log's
 * recipe list, the estimate panel's per-serving suggestion. It resolves nothing
 * and marks every pair undecided, so `recipeNutrition` returns null for a dish
 * that names one. A dish that names none is unaffected.
 */
export const UNANSWERED: { itemPicks: ItemPick[] } = { itemPicks: [] };

/** The same key whichever of the two items a line names. */
export function eitherPairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** Tolerant of anything a restored backup or an old row might hold. */
export function parseItemPicks(raw: unknown): ItemPick[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ItemPick[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const { pair, use } = row as Partial<ItemPick>;
    if (typeof pair !== 'string' || typeof use !== 'string' || !pair || !use) continue;
    if (!pair.split('|').includes(use)) continue;
    if (out.some(p => p.pair === pair)) continue;
    out.push({ pair, use });
  }
  return out;
}

/** The answer for one pair, or undefined while it is undecided. */
export function pickFor(picks: readonly ItemPick[] | undefined, pair: string): ItemPick | undefined {
  return picks?.find(p => p.pair === pair);
}

/** `picks` with `pair` answered, replacing any earlier answer for it. */
export function withItemPick(picks: readonly ItemPick[], pair: string, use: string): ItemPick[] {
  return [...picks.filter(p => p.pair !== pair), { pair, use }];
}

/** `picks` with `pair` back to undecided. */
export function withoutItemPick(picks: readonly ItemPick[], pair: string): ItemPick[] {
  return picks.filter(p => p.pair !== pair);
}

/** Whether any line of a flattened dish is waiting on an "either one" answer. */
export function hasUndecidedItem(flat: readonly FlatIngredient[]): boolean {
  return flat.some(line => line.either?.undecided);
}

/** One pair a cooking involves, with the lines that name it and the answer so far. */
export interface EitherPairInUse {
  pair: string;
  /** The two items, in a stable order (the pair key's). */
  items: [GroceryItem, GroceryItem];
  /** The recipe's own words for each line that names either item. */
  lines: { name: string; quantity: string }[];
  /** The `nameKey` picked, or null while undecided. */
  use: string | null;
}

/**
 * Every pair a flattened dish involves, in the order its lines first name them.
 *
 * Read off the flattened lines rather than the catalog so the list is exactly
 * the pairs this cooking has a line for: a pair whose items the dish never
 * mentions asks nothing. Lines are the recipe's own words (`swappedFrom` when a
 * pick rewrote one), because "1 tbsp butter in Glaze" is what the person can
 * find on the page.
 */
export function eitherPairsInUse(flat: readonly FlatIngredient[]): EitherPairInUse[] {
  const byPair = new Map<string, EitherPairInUse>();
  for (const line of flat) {
    const either = line.either;
    if (!either) continue;
    let entry = byPair.get(either.pair);
    if (!entry) {
      const [a, b] = orderedItems(either.swap);
      entry = { pair: either.pair, items: [a, b], lines: [], use: either.use };
      byPair.set(either.pair, entry);
    }
    entry.lines.push({
      name: line.swappedFrom ?? line.ingredient.name,
      quantity: line.ingredient.quantity,
    });
  }
  return [...byPair.values()];
}

function orderedItems(swap: StandingSwap): [GroceryItem, GroceryItem] {
  return swap.from.nameKey <= swap.to.nameKey ? [swap.from, swap.to] : [swap.to, swap.from];
}

/** "Butter or vegan butter". */
export function describeEitherPair(items: readonly [GroceryItem, GroceryItem]): string {
  return `${items[0].name} or ${items[1].name.toLowerCase()}`;
}

/**
 * Which item of `pair` the person used the last time they cooked something that
 * asked, from the cooked meals' own answers: the one-tap preselect on the prompt.
 *
 * Derived, never stored, so there is no second record to drift from the meals.
 * It only ever suggests; nothing treats it as an answer.
 */
export function lastUsedPick(entries: readonly MealPlanEntry[], pair: string): string | null {
  let best: { at: string; use: string } | null = null;
  for (const entry of entries) {
    const pick = pickFor(entry.itemPicks, pair);
    if (!pick) continue;
    const at = entry.cookedAt ?? entry.date;
    if (!best || at > best.at) best = { at, use: pick.use };
  }
  return best?.use ?? null;
}

/** The rule map restricted to "either one" rules, for a caller that lists them. */
export function eitherSwapsOf(swaps: StandingSwapMap): StandingSwap[] {
  const seen = new Set<string>();
  const out: StandingSwap[] = [];
  for (const swap of swaps.values()) {
    if (!swap.either) continue;
    const pair = eitherPairKey(swap.from.nameKey, swap.to.nameKey);
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push(swap);
  }
  return out;
}
