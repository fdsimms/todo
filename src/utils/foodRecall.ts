import type { FoodLogEntry, FoodNutrition, MealSlot } from '../types';
import { groceryNameKey } from './groceryParse';
import { matchWeight } from './grocerySuggest';

/**
 * Something already eaten, found again from the words describing it.
 *
 * **The estimate sheet is a main way in, and a meal eaten before does not need
 * guessing at.** `estimateMealNutrition` is given nothing but the typed
 * description — no recipe, no catalog, no history — so describing last
 * Tuesday's lunch a second time spends a request to re-derive figures the log
 * already holds. This reads the log first.
 *
 * **The real argument is the source, not the round trip.** `estimateToPanel`
 * stamps `source: 'estimated'` and `nutritionEstimate.ts` is emphatic that the
 * mark is permanent. So a barcode-scanned yogurt logged once from its label
 * (`openFoodFacts`) and typed into the estimator the next morning is recorded
 * twice under two different claims, the second weaker than the truth, and
 * `sourceMix` on the Stats screen counts it as a guess for ever. Handing the
 * stored panel back keeps the original claim, exactly as `duplicateEntry`
 * does. This is a way of not degrading a record, and only incidentally a way
 * of being quick.
 *
 * **Grouped by label, because the entries this exists for have no id.**
 * `foodLogRecents.ts` counts `itemId`/`productId`/`recipeId` and says plainly
 * that it counts ids and never labels, which is right for the question it
 * answers (which row of a list to float). It cannot answer this one: a meal
 * logged from an estimate carries none of those three, so an id-keyed map is
 * blind to precisely the history worth recalling here. `mostLoggedFoods`
 * already made this call for the leaderboard and gives the reason — dropping
 * every hand-entered food would misreport what somebody eats. Same reason,
 * same grouping.
 *
 * **It offers and never applies**, which is what lets it skip the refusals its
 * neighbours need. `unambiguousFood` and `uniqueSimilarItem` both decline to
 * pick between near-ties because their answer is acted on unseen, and a wrong
 * pick there writes a calorie panel nobody chose. Every result here is a row
 * somebody reads and taps, so a second plausible candidate is something to
 * show rather than a reason to show nothing.
 *
 * Pure and store-free, so the ranking is exercised without a database.
 */

/**
 * Shorter than this and a description is not yet describing anything — two
 * characters match most of a full log. Same floor the sheet's own recipe match
 * already used.
 */
export const RECALL_MIN_QUERY = 3;

/** Three rows, so a card of offers never buries the estimate button under it. */
export const RECALL_LIMIT = 3;

/**
 * How short a stored label may be and still be looked for *inside* a longer
 * description.
 *
 * The containment direction below is the loose one, and a three-character
 * label ("tea", "ham") appears inside enough ordinary sentences to offer a
 * wrong panel on most of them. A label that short is still found the other
 * way round, by typing it.
 */
const MIN_CONTAINED_LABEL = 4;

/** One food already eaten, with the most recent logging of it kept whole. */
export interface RecalledFood {
  /** The normalized label the group shares, and its identity for a React key. */
  key: string;
  /** The most recent spelling, which is what the row shows. */
  label: string;
  quantity: string;
  grams: number | null;
  /**
   * The stored panel, reused verbatim rather than rebuilt: it carries the
   * amounts actually eaten, and its `source`/`sourceId` are the claim being
   * preserved. See the note above.
   */
  nutrition: FoodNutrition;
  slot: MealSlot | null;
  recipeId: string | null;
  itemId: string | null;
  productId: string | null;
  /** How many entries share this label, for ranking and for the row's own line. */
  count: number;
  lastAtISO: string;
}

/**
 * How well a stored label answers a typed description, in `matchWeight`'s own
 * 3/2/1 ladder.
 *
 * **Two directions, because the two sides are not the same length here.**
 * A grocery query is a few characters of a name, so `matchWeight` looks for
 * the query inside the name and that is the whole question. A meal description
 * runs the other way as often as not: "chicken burrito bowl with extra guac"
 * is longer than the "Chicken burrito bowl" it names, and nothing in the
 * forward direction can see that.
 *
 * The containment direction is deliberately worth half. It is the weaker
 * evidence of the two — the words matched are ones the user happened to
 * include rather than ones they set out to type — so it ranks under every
 * direct hit while still beating no hit at all, and it is gated on the label
 * being long enough to mean something on its own.
 */
export function recallWeight(labelKey: string, queryKey: string): number {
  if (!labelKey || !queryKey) return 0;
  const direct = matchWeight(labelKey, queryKey);
  if (direct > 0) return direct;
  if (labelKey.length < MIN_CONTAINED_LABEL) return 0;
  return matchWeight(queryKey, labelKey) / 2;
}

/**
 * The foods in `entries` that the description names, best first.
 *
 * Ties break on how often it has been eaten, then how recently, then the
 * label, so the order is stable rather than however the rows came back.
 * `mealPlanEntryId` is deliberately not carried: a recalled food is a fresh
 * eating rather than the same planned meal again, which is the call
 * `duplicateEntry` already makes.
 */
export function recallFoods(
  entries: readonly FoodLogEntry[],
  description: string,
  limit = RECALL_LIMIT,
): RecalledFood[] {
  const queryKey = groceryNameKey(description);
  if (queryKey.length < RECALL_MIN_QUERY) return [];

  const byLabel = new Map<string, RecalledFood>();
  for (const entry of entries) {
    const label = entry.label.trim();
    if (!label) continue;
    const key = groceryNameKey(label);
    if (!key) continue;
    const seen = byLabel.get(key);
    if (!seen) {
      byLabel.set(key, {
        key,
        label,
        quantity: entry.quantity,
        grams: entry.grams,
        nutrition: entry.nutrition,
        slot: entry.slot,
        recipeId: entry.recipeId,
        itemId: entry.itemId,
        productId: entry.productId,
        count: 1,
        lastAtISO: entry.atISO,
      });
      continue;
    }
    seen.count += 1;
    // The most recent logging is the one worth repeating: a food re-linked to a
    // catalog row, or re-portioned, should come back as it was last eaten
    // rather than as it was first.
    if (entry.atISO > seen.lastAtISO) {
      seen.label = label;
      seen.quantity = entry.quantity;
      seen.grams = entry.grams;
      seen.nutrition = entry.nutrition;
      seen.slot = entry.slot;
      seen.recipeId = entry.recipeId;
      seen.itemId = entry.itemId;
      seen.productId = entry.productId;
      seen.lastAtISO = entry.atISO;
    }
  }

  return [...byLabel.values()]
    .map(food => ({ food, weight: recallWeight(food.key, queryKey) }))
    .filter(scored => scored.weight > 0)
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (b.food.count !== a.food.count) return b.food.count - a.food.count;
      if (b.food.lastAtISO !== a.food.lastAtISO) return b.food.lastAtISO.localeCompare(a.food.lastAtISO);
      return a.food.label.localeCompare(b.food.label);
    })
    .slice(0, limit)
    .map(scored => scored.food);
}

/**
 * The row's second line: how often, and how it was measured.
 *
 * States the amount rather than any figure. The panel is handed back whole and
 * the calories are already on the row above this in every caller, so repeating
 * one here would read as this sentence making a claim of its own — the rule
 * `describeEstimate` keeps for the same reason.
 */
export function describeRecall(food: RecalledFood): string {
  const times = food.count === 1 ? 'Logged once' : `Logged ${food.count} times`;
  return food.quantity ? `${times}, last as ${food.quantity}` : times;
}
