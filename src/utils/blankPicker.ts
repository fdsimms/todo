import type { KitchenEntry } from './kitchenInventory';
import type { GroceryItem, LeftoverFreshness, MealPlanEntry, RecipeBlank } from '../types';
import { foodKindsOf } from './foodKinds';
import { groceryNameKey } from './groceryParse';
import { isNonFoodAisle } from './groceryAisles';

/**
 * What the picker offers for one of a recipe's blanks (`RecipeBlank`).
 *
 * **The kitchen first, and only what it can vouch for.** A candidate "in your
 * kitchen" is a pantry entry (`kitchenInventory`), so the claim is exactly as
 * strong as `probablyHaveReason`'s and no stronger. The pantry knows least about
 * fresh produce, which is the reason the other two groups exist at all: a
 * vegetables blank offered only what the pantry vouches for would often offer
 * one thing, or nothing.
 *
 * - `kitchen`: in the pantry and still good, most urgent first, so what needs
 *   using is where the eye lands.
 * - `stale`: in the pantry but past its use-by. Not offered as a pick: the
 *   picker asks whether it's still there, which is a pantry answer, and a "Still
 *   have it" puts it back among the picks.
 * - `others`: what the recipe names (`options`, in the order written), then what
 *   the person usually buys of that kind (by purchase count). Picking one of
 *   these means buying it, which the shopping list then says.
 *
 * Leftovers never answer a blank: a leftover's name is free text with no kind,
 * and "use up last night's chilli" is the Fridge card's job, not a grain's.
 */

/**
 * Whether a catalog item can fill a blank: one of the blank's own suggestions,
 * or food of its kind (`foodKindsOf`, the person's filing over the name's
 * guess). Never anything in a non-food aisle. The one rule the picker and the
 * use-up suggestions (`useUpRecipes`) share, so the two can't disagree about
 * what a blank takes.
 */
export function blankFits(
  blank: RecipeBlank,
  item: Pick<GroceryItem, 'name' | 'nameKey' | 'aisle' | 'foodKinds'>,
  nonFoodAisles: readonly string[] = [],
): boolean {
  if (isNonFoodAisle(item.aisle, nonFoodAisles)) return false;
  if (blank.options.some(option => groceryNameKey(option) === item.nameKey)) return true;
  return blank.kind !== null && foodKindsOf(item).includes(blank.kind);
}

/** The catalog item a pantry entry is about: a box names it in `itemId`, a plain row is it, by `sourceId`. Null for a leftover. */
export function kitchenEntryItemId(entry: KitchenEntry): string | null {
  if (entry.kind === 'leftover') return null;
  return entry.kind === 'product' ? entry.itemId : entry.sourceId;
}

/** One thing that could fill a blank. */
export interface BlankCandidate {
  /** The catalog item's own name, or the recipe's option as written. What the fill line is called. */
  name: string;
  nameKey: string;
  /** The catalog row, when there is one. */
  itemId: string | null;
  source: 'kitchen' | 'stale' | 'option' | 'usual';
  /** From the pantry entry; null for anything not in the kitchen. */
  freshness: LeftoverFreshness | null;
  /** The pantry's own sentence about it ("3 days left", "11 days past use-by"). */
  caption: string | null;
}

export interface BlankChoices {
  kitchen: BlankCandidate[];
  stale: BlankCandidate[];
  others: BlankCandidate[];
}

/** How many "you usually buy" candidates a kind's blank offers past the recipe's own options. */
export const USUAL_CANDIDATE_LIMIT = 6;

/**
 * The three groups for `blank`, given the catalog and its kitchen entries.
 * `filled` names what this meal already picked, so a pick typed in by hand
 * ("frozen peas" from Other) still shows, selected, among the others.
 */
export function blankChoices(
  blank: RecipeBlank,
  items: readonly GroceryItem[],
  kitchen: readonly KitchenEntry[],
  nonFoodAisles: readonly string[] = [],
  filled: readonly string[] = [],
): BlankChoices {
  const itemsById = new Map(items.map(i => [i.id, i]));
  const fits = (item: GroceryItem): boolean => blankFits(blank, item, nonFoodAisles);

  const seen = new Set<string>();
  const kitchenOut: BlankCandidate[] = [];
  const staleOut: BlankCandidate[] = [];
  // Most urgent first is the order kitchenInventory already returns, and an
  // item and its boxes share a key, so the first of them is the one to show.
  for (const entry of kitchen) {
    const itemId = kitchenEntryItemId(entry);
    const item = itemId ? itemsById.get(itemId) : undefined;
    if (!item || seen.has(item.nameKey) || !fits(item)) continue;
    seen.add(item.nameKey);
    const candidate: BlankCandidate = {
      name: item.name,
      nameKey: item.nameKey,
      itemId: item.id,
      source: entry.freshness === 'over' ? 'stale' : 'kitchen',
      freshness: entry.freshness,
      caption: entry.useByCaption || null,
    };
    (candidate.source === 'stale' ? staleOut : kitchenOut).push(candidate);
  }

  const others: BlankCandidate[] = [];
  const byKey = new Map(items.map(i => [i.nameKey, i]));
  for (const option of blank.options) {
    const key = groceryNameKey(option);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const item = byKey.get(key);
    others.push({ name: item?.name ?? option, nameKey: key, itemId: item?.id ?? null, source: 'option', freshness: null, caption: null });
  }
  if (blank.kind !== null) {
    const usual = items
      .filter(i => i.purchaseCount > 0 && !seen.has(i.nameKey) && fits(i))
      .sort((a, b) => b.purchaseCount - a.purchaseCount || a.name.localeCompare(b.name))
      .slice(0, USUAL_CANDIDATE_LIMIT);
    for (const item of usual) {
      seen.add(item.nameKey);
      others.push({ name: item.name, nameKey: item.nameKey, itemId: item.id, source: 'usual', freshness: null, caption: null });
    }
  }
  for (const name of filled) {
    const key = groceryNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const item = byKey.get(key);
    others.push({ name, nameKey: key, itemId: item?.id ?? null, source: 'usual', freshness: null, caption: null });
  }
  return { kitchen: kitchenOut, stale: staleOut, others };
}

/** Whether a kitchen candidate is the kind to use first: due today or close to it. */
export function needsUsing(candidate: BlankCandidate): boolean {
  return candidate.freshness === 'due' || candidate.freshness === 'soon';
}

/**
 * What the picker starts with for a blank this meal hasn't filled. Only ever a
 * starting point the person sees before anything is saved: nothing is written
 * until they press Done.
 *
 * What needs using goes in first, up to the blank's limit. With nothing
 * urgent, a pick-one blank starts on the first thing in the kitchen and a
 * pick-any blank starts empty, since "everything you have" is never the
 * answer to "which vegetables tonight".
 */
export function defaultBlankPicks(blank: RecipeBlank, choices: BlankChoices): string[] {
  const limit = blank.max ?? Infinity;
  const urgent = choices.kitchen.filter(needsUsing).slice(0, limit).map(c => c.name);
  if (urgent.length > 0) return urgent;
  if (blank.max === 1 && choices.kitchen.length > 0) return [choices.kitchen[0].name];
  return [];
}

/**
 * `picked` with `name` toggled. A pick-one blank swaps rather than adds, the way
 * a segmented control does; a blank with a limit refuses a pick past it, so the
 * caller can say why rather than quietly dropping the oldest.
 */
export function togglePick(blank: RecipeBlank, picked: readonly string[], name: string): { picks: string[]; refused: boolean } {
  const key = groceryNameKey(name);
  if (picked.some(p => groceryNameKey(p) === key)) {
    return { picks: picked.filter(p => groceryNameKey(p) !== key), refused: false };
  }
  if (blank.max === 1) return { picks: [name], refused: false };
  if (blank.max !== null && picked.length >= blank.max) return { picks: [...picked], refused: true };
  return { picks: [...picked, name], refused: false };
}

/**
 * The most recent other cooking of the same recipe that filled a blank, on or
 * before this meal's day, for the picker's "Last time" row. Null when there is
 * none. Read off the meal plan itself, so it reaches back as far as the plan
 * is kept (`MEAL_PLAN_RETENTION_DAYS`) and no further.
 */
export function lastBlankFill(
  entries: readonly MealPlanEntry[],
  entry: Pick<MealPlanEntry, 'id' | 'recipeId' | 'date'>,
): MealPlanEntry | null {
  if (!entry.recipeId) return null;
  let best: MealPlanEntry | null = null;
  for (const other of entries) {
    if (other.id === entry.id || other.recipeId !== entry.recipeId || other.date > entry.date) continue;
    if (!other.recipeOverrides.some(o => o.fill && o.fill.length > 0)) continue;
    if (!best || other.date > best.date || (other.date === best.date && other.createdAt > best.createdAt)) best = other;
  }
  return best;
}
