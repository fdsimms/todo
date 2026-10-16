import type { GroceryItem, ItemProduct, MealPlanEntry, MealSlot, Recipe } from '../types';
import { slotLabel } from './mealPlan';
import { FREEZER_SECTION, type KitchenEntry } from './kitchenInventory';
import { produceKindOf } from './produceServings';
import { recipeProduceGrams } from './recipeProduce';
import { entryResolution, flattenRecipeIngredients } from './recipeComponents';
import type { StandingSwapMap } from './standingSwaps';
import { NO_STANDING_SWAPS } from './standingSwaps';

/**
 * The line under a planned day on the meal plan: which lunches and dinners list
 * no vegetables or fruit, and what produce is on hand to add.
 *
 * **It is a read of the recipe's ingredient list and says exactly that.** The
 * wording is "lists no vegetables or fruit", never "has none": a recipe whose
 * produce is named something `produceKindOf` does not know reads as having
 * none. The refusals err toward silence, the same posture `recipeProduce.ts`
 * takes: a recipe it could not weigh (`recipeProduceGrams` returns null), one
 * with no recipe behind the meal, and one that names a mixed dish ("stir fry
 * vegetables", "side salad") are all skipped rather than flagged.
 *
 * **Lunch and dinner only.** A breakfast without produce is ordinary, and a
 * line on every morning would be the noise a check like this dies of.
 *
 * **The suggestion is what the pantry lists**, frozen first (the low-effort
 * side), and is a read like `useUpRecipes`: it cannot know that a cupboard item
 * missing from the pantry is absent. It writes nothing and plans nothing.
 */

export const PRODUCE_CHECK_SLOTS: readonly MealSlot[] = ['lunch', 'dinner'];

/** How many on-hand names the line shows. */
export const PRODUCE_SIDES_SHOWN = 3;

export interface MealWithoutProduce {
  slot: MealSlot;
  recipeName: string;
}

/** Whether one planned meal's recipe is known to list no vegetables or fruit. */
export function listsNoProduce(
  entry: MealPlanEntry,
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): boolean {
  if (!entry.recipeId) return false;
  const recipe = recipesById.get(entry.recipeId);
  if (!recipe) return false;

  const lines = flattenRecipeIngredients(recipe, recipesById, entryResolution(entry));
  if (lines.length === 0) return false;
  // A mixed dish's own name hides its split, so the check cannot say.
  if (lines.some(({ ingredient }) => hidesProduce(ingredient.name))) return false;

  const grams = recipeProduceGrams(recipe, items, products, recipesById, swaps);
  if (grams === null) return false;
  return grams.vegetable + grams.fruit + grams.dried + grams.legume === 0;
}

/**
 * Whether an ingredient line names a dish whose vegetables the name hides
 * ("stir fry vegetables", "side salad"). `produceKindOf` calls "pasta" mixed
 * because a *logged* pasta is a meal, but dried pasta on an ingredient list is a
 * plain ingredient, so a name ending in it is not one.
 */
function hidesProduce(name: string): boolean {
  if (/\bpasta$/i.test(name.trim())) return false;
  return produceKindOf(name) === 'mixed';
}

/**
 * The day's lunches and dinners that are planned, not yet logged, and list no
 * produce. `loggedSlots` is the slots the food log already covers that day.
 */
export function mealsWithoutProduce(
  dayEntries: readonly MealPlanEntry[],
  loggedSlots: ReadonlySet<MealSlot>,
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): MealWithoutProduce[] {
  const out: MealWithoutProduce[] = [];
  for (const entry of dayEntries) {
    if (!PRODUCE_CHECK_SLOTS.includes(entry.slot)) continue;
    if (entry.cookedAt || loggedSlots.has(entry.slot)) continue;
    if (!listsNoProduce(entry, recipesById, items, products, swaps)) continue;
    out.push({ slot: entry.slot, recipeName: recipesById.get(entry.recipeId!)!.name });
  }
  return out.sort((a, b) => PRODUCE_CHECK_SLOTS.indexOf(a.slot) - PRODUCE_CHECK_SLOTS.indexOf(b.slot));
}

/**
 * Produce the pantry lists as on hand, frozen first, then by name. Leftovers and
 * produce past its use-by day (`over`) are skipped, and so is anything that is
 * not produce.
 */
export function producesOnHand(entries: readonly KitchenEntry[]): string[] {
  const byKey = new Map<string, KitchenEntry>();
  for (const entry of entries) {
    if (entry.kind === 'leftover' || !entry.matchKey) continue;
    if (entry.freshness === 'over') continue;
    const kind = produceKindOf(entry.title);
    if (kind === null || kind === 'mixed') continue;
    const current = byKey.get(entry.matchKey);
    if (!current || (isFrozen(entry) && !isFrozen(current))) byKey.set(entry.matchKey, entry);
  }
  return [...byKey.values()]
    .sort((a, b) => Number(isFrozen(b)) - Number(isFrozen(a)) || a.title.localeCompare(b.title))
    .map(entry => {
      const name = entry.title.toLowerCase();
      return isFrozen(entry) && !name.includes('frozen') ? `frozen ${name}` : name;
    });
}

function isFrozen(entry: KitchenEntry): boolean {
  return entry.section === FREEZER_SECTION;
}

/** "Dinner (Mac and cheese) lists no vegetables or fruit. On hand: frozen peas, spinach." */
export function describeProduceGaps(gaps: readonly MealWithoutProduce[], onHand: readonly string[]): string {
  const meals = gaps.map(g => `${slotLabel(g.slot)} (${g.recipeName})`);
  const subject = meals.length === 1 ? meals[0] : `${meals.slice(0, -1).join(', ')} and ${meals[meals.length - 1]}`;
  const verb = meals.length === 1 ? 'lists' : 'list';
  const head = `${subject} ${verb} no vegetables or fruit.`;
  if (onHand.length === 0) return head;
  return `${head} On hand: ${onHand.slice(0, PRODUCE_SIDES_SHOWN).join(', ')}.`;
}
