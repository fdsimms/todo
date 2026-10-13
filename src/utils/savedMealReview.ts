import type { FoodLogEntry, FoodNutrition, SavedMeal, SavedMealItem } from '../types';
import {
  ESTIMATE_AMOUNTS,
  estimateAmountPatch,
  foodLogEntryEdit,
  remeasureEntry,
  savedMealCalories,
  wholeEstimate,
} from './foodLog';

/**
 * Looking over a saved meal before it is logged: change an amount, drop a food,
 * swap one for another, add one.
 *
 * Everything here is a rule about the *items*, never a write. The sheet that
 * stages these edits hands the result to `useSavedMealsStore.logMeal`, which
 * replays the ordinary `addEntry` once per item, so a reviewed meal reaches the
 * log by the same door an untouched one does.
 *
 * **An amount is changed by the same arithmetic "Edit" runs on a logged entry**
 * (`remeasureEntry`, `estimateAmountPatch`), never by multiplying the stored
 * figures. A `SavedMealItem` is one helping exactly as a `FoodLogEntry` is, so
 * an item is read as the entry it would become. Which items can't change is
 * `foodLogEntryEdit`'s answer, and it is given in words rather than hidden: an
 * amount field that silently kept the old amount would be an input the code
 * path drops.
 */

/** One row of the review: an item, and whether it was dropped. */
export interface ReviewLine {
  /** Stable for the life of the sheet, so a row keeps its place as others change. */
  key: string;
  item: SavedMealItem;
  /** Dropped from this log only. The saved meal itself is untouched. */
  removed: boolean;
  /**
   * Whether the item came from the saved meal as it was. False for a food just
   * added, which has nothing to be compared against or reset to.
   */
  fromMeal: boolean;
}

/** The saved meal's items as review rows, in order. */
export function reviewLinesFor(meal: SavedMeal): ReviewLine[] {
  return meal.items.map((item, i) => ({ key: `item-${i}`, item, removed: false, fromMeal: true }));
}

/** An item read as the entry logging it would write, for the rules that take an entry. */
function itemAsEntry(item: SavedMealItem): FoodLogEntry {
  return {
    id: 'review',
    dayKey: '',
    atISO: '',
    slot: null,
    label: item.label,
    recipeId: item.recipeId,
    itemId: item.itemId,
    productId: item.productId,
    mealPlanEntryId: null,
    quantity: item.quantity,
    grams: item.grams,
    nutrition: item.nutrition,
    sourcePanel: item.sourcePanel ?? null,
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '',
  };
}

/** How an item's amount can be changed before it is logged. */
export type ItemAmountEdit =
  /** A typed amount, measured against the food's own panel ("170 g", "2 servings"). */
  | { kind: 'measure'; amount: string }
  /** An estimate, changed to a multiple of the whole it described. */
  | { kind: 'estimate' }
  /** Neither, with the reason in words. */
  | { kind: 'none'; reason: string };

/** Which kind of change an item's amount takes, and what an amount field opens on. */
export function itemAmountEdit(item: SavedMealItem): ItemAmountEdit {
  const entry = itemAsEntry(item);
  if (wholeEstimate(entry)) return { kind: 'estimate' };
  if (item.recipeId) {
    return { kind: 'none', reason: 'A dish’s amount is rebuilt from its recipe. Remove it and add the dish again to change it.' };
  }
  const plan = foodLogEntryEdit(entry);
  if (plan) return { kind: 'measure', amount: plan.amount };
  return { kind: 'none', reason: 'This food has no record to measure a new amount against. Remove it or replace it.' };
}

/** The estimate multiples an estimated item offers, the closed set "Change amount" uses. */
export const ESTIMATE_CHOICES = ESTIMATE_AMOUNTS;

export type ItemChange =
  | { ok: true; item: SavedMealItem }
  | { ok: false; reason: string };

/**
 * The item at a typed amount. `panelFor` reads the catalog row or product an
 * item links to, since only the caller holds those; an item that kept its own
 * panel needs no lookup.
 */
export function itemAtAmount(
  item: SavedMealItem,
  amount: string,
  panelFor: (item: SavedMealItem) => FoodNutrition | null,
): ItemChange {
  const entry = itemAsEntry(item);
  const linked = !!(item.itemId || item.productId);
  const result = remeasureEntry(entry, linked ? panelFor(item) : null, amount);
  if (!result.ok) return { ok: false, reason: result.reason };
  const { quantity, grams, nutrition, sourcePanel } = result.fields;
  return { ok: true, item: withMeasurement(item, { quantity, grams, nutrition, sourcePanel }) };
}

/** An estimated item at a multiple of the whole it described. */
export function itemAtEstimateFactor(item: SavedMealItem, factor: number): ItemChange {
  const patch = estimateAmountPatch(itemAsEntry(item), factor);
  if (!patch) return { ok: false, reason: 'That amount can’t be applied to this food.' };
  return {
    ok: true,
    item: withMeasurement(item, {
      quantity: patch.quantity,
      grams: patch.grams,
      nutrition: patch.nutrition,
      sourcePanel: patch.sourcePanel,
    }),
  };
}

function withMeasurement(
  item: SavedMealItem,
  m: { quantity: string; grams: number | null; nutrition: FoodNutrition; sourcePanel: FoodNutrition | null },
): SavedMealItem {
  const { sourcePanel: _drop, ...rest } = item;
  return {
    ...rest,
    quantity: m.quantity,
    grams: m.grams,
    nutrition: m.nutrition,
    // Written only when there is one, which leaves an ordinary item's stored
    // JSON exactly as it was (the `addFromEntries` rule).
    ...(m.sourcePanel ? { sourcePanel: m.sourcePanel } : {}),
  };
}

/** A line with its food swapped for another, which comes in as its own new row. */
export function replaceLine(lines: ReviewLine[], key: string, item: SavedMealItem, newKey: string): ReviewLine[] {
  return lines.map(l => (l.key === key ? { key: newKey, item, removed: false, fromMeal: false } : l));
}

/** A food added to the end. */
export function appendLine(lines: ReviewLine[], item: SavedMealItem, newKey: string): ReviewLine[] {
  return [...lines, { key: newKey, item, removed: false, fromMeal: false }];
}

/**
 * Drop a line from this log, or bring it back. A food that was added during the
 * review is deleted outright instead: there is nothing to bring back to.
 */
export function toggleRemoved(lines: ReviewLine[], key: string): ReviewLine[] {
  const line = lines.find(l => l.key === key);
  if (!line) return lines;
  if (!line.fromMeal) return lines.filter(l => l.key !== key);
  return lines.map(l => (l.key === key ? { ...l, removed: !l.removed } : l));
}

/** The items that will be logged. */
export function reviewedItems(lines: readonly ReviewLine[]): SavedMealItem[] {
  return lines.filter(l => !l.removed).map(l => l.item);
}

/** The calories of what will be logged, or null when no kept item states any. */
export function reviewedCalories(lines: readonly ReviewLine[]): number | null {
  return savedMealCalories(reviewedItems(lines));
}

/**
 * Whether the items are the same helpings in the same order. Compared on what
 * a log would write (label, links, amount, weight, figures), so it answers
 * "would this log differ from the saved meal".
 */
export function sameItems(a: readonly SavedMealItem[], b: readonly SavedMealItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => sameItem(item, b[i]));
}

function sameItem(a: SavedMealItem, b: SavedMealItem): boolean {
  return a.label === b.label
    && a.recipeId === b.recipeId
    && a.itemId === b.itemId
    && a.productId === b.productId
    && a.quantity === b.quantity
    && a.grams === b.grams
    && JSON.stringify(a.nutrition) === JSON.stringify(b.nutrition)
    && JSON.stringify(a.sourcePanel ?? null) === JSON.stringify(b.sourcePanel ?? null);
}

/** Whether the review differs from the saved meal, so there is something to discard or to save back. */
export function reviewChanged(meal: SavedMeal, lines: readonly ReviewLine[]): boolean {
  return !sameItems(meal.items, reviewedItems(lines));
}

/** What a picked food becomes as an item: the entry fields a pick would have logged. */
export function itemFromPick(pick: {
  label: string;
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  sourcePanel?: FoodNutrition | null;
  recipeId?: string | null;
  itemId?: string | null;
  productId?: string | null;
}): SavedMealItem {
  return {
    label: pick.label,
    recipeId: pick.recipeId ?? null,
    itemId: pick.itemId ?? null,
    productId: pick.productId ?? null,
    quantity: pick.quantity,
    grams: pick.grams,
    nutrition: pick.nutrition,
    ...(pick.sourcePanel ? { sourcePanel: pick.sourcePanel } : {}),
  };
}
