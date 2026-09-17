import type { FoodLogEntry, FoodNutrition, GroceryItem, ItemProduct, MealSlot } from '../types';
import { groceryNameKey } from './groceryParse';
import { matchWeight } from './grocerySuggest';
import { nutritionFor } from './foodNutrition';
import { describeProduct } from './groceryProduct';
import { packageChoices, type PackageChoice } from './scanPortion';

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

/**
 * What a containment hit is divided by, chosen so every one of them lands
 * below `matchWeight`'s weakest direct rung (0.5, its out-of-order words).
 *
 * A direct hit means the characters the user actually typed appear in the
 * name, which `matchWeight`'s own reasoning calls the stronger signal, so
 * containment may order its own hits among themselves and must never outrank
 * one. Halving was the first attempt and got this wrong: typing "good culture
 * yogurt" put a bare "Yogurt" above "Yogurt, Good Culture low fat", because
 * the short generic name sat inside the query at word-start (1.0) while the
 * specific one matched only out of order (0.5).
 */
const CONTAINED_SCALE = 10;

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
 * A gram weight named in a typed description ("205g cooked beans"), as a
 * clean quantity string a recalled food's own panel can be scaled to.
 *
 * **A recalled food is grams-denominated and nothing else here is**, so this
 * looks for grams specifically rather than reusing `parseQuantity` over the
 * whole description: that reads units this food's panel cannot answer (no
 * portion table survives onto a logged entry, see `scalePanelToAmount`) and
 * would refuse harmlessly, but it would also happily parse "2 servings" as an
 * amount that means something quite different from a weight.
 *
 * **Returns the matched digits plus "g", never the sentence around them.**
 * The result becomes `scalePanelToAmount`'s `quantity` argument, which is
 * stored verbatim as the scaled panel's `servingText` — the field an entry
 * reopens its amount field from (`foodLogEntryEdit`). Handing back "205g
 * cooked beans" would work once and then show that whole sentence as the
 * amount the next time the entry is edited.
 */
export function describedGrams(description: string): string | null {
  const match = /(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i.exec(description);
  return match ? `${match[1]}g` : null;
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
 * The containment direction is deliberately scaled under the whole forward
 * ladder rather than merely reduced. It is the weaker evidence of the two, the
 * words matched being ones the user happened to include rather than ones they
 * set out to type, so every containment hit ranks below every direct one while
 * still beating no hit at all. See `CONTAINED_SCALE` for what getting that
 * wrong looked like. It is also gated on the label being long enough to mean
 * something on its own.
 */
export function recallWeight(labelKey: string, queryKey: string): number {
  if (!labelKey || !queryKey) return 0;
  const direct = matchWeight(labelKey, queryKey);
  if (direct > 0) return direct;
  if (labelKey.length < MIN_CONTAINED_LABEL) return 0;
  return matchWeight(queryKey, labelKey) / CONTAINED_SCALE;
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

/** Anything that can be looked for by the words naming it. */
export interface RecallCandidate {
  /** Its identity, and the key `foodLogRecency` credits it under. */
  key: string;
  /** Its name, already through `groceryNameKey`. */
  nameKey: string;
}

/**
 * The candidates the description names, best match first.
 *
 * **Ties keep the order they arrived in**, which is how this composes with
 * `rankByRecency`: a caller hands its candidates over already arranged by what
 * has actually been eaten, and everything the weight cannot separate stays in
 * that arrangement. Re-ranking here instead would throw away the only signal
 * that distinguishes two packets of equal name.
 */
export function rankRecallCandidates<T extends RecallCandidate>(
  candidates: readonly T[],
  description: string,
  limit = RECALL_LIMIT,
): T[] {
  const queryKey = groceryNameKey(description);
  if (queryKey.length < RECALL_MIN_QUERY) return [];
  return candidates
    .map(candidate => ({ candidate, weight: recallWeight(candidate.nameKey, queryKey) }))
    .filter(scored => scored.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(scored => scored.candidate);
}

/**
 * A food in the catalog with figures already on it, and the one helping it can
 * be logged as.
 *
 * The helping is settled here rather than asked for later. `ItemProduct` holds
 * no pack size, so `packageChoices` can only ever offer the serving its panel
 * states — the whole-package option needs a size to divide, and there is none
 * to give it. A row is therefore one tap like a recalled entry, and a panel
 * with no serving to speak of (per-100g with no serving weight) yields no
 * choice at all and is left off the list rather than logged as some invented
 * amount.
 */
export interface RecalledCatalogFood extends RecallCandidate {
  /** What the row shows: the item, and which packet of it when that is known. */
  label: string;
  /** The panel as filed, whose `source` the helping carries through. */
  nutrition: FoodNutrition;
  choice: PackageChoice;
  itemId: string;
  productId: string | null;
}

/**
 * Everything in the catalog that could be logged from its own figures.
 *
 * **A packet and the item it belongs to are both offered**, the call
 * `creditedKeys` already makes: eating one of an item's boxes is eating the
 * item, and floating the specific pot while leaving the generic food out would
 * be the same complaint one level in. They carry the keys that function
 * credits, so a caller can put `rankByRecency` in front of this directly.
 */
/** Only what naming and measuring a row needs, the `Pick` style `nutritionFor` keeps. */
export type RecallableItem = Pick<GroceryItem, 'id' | 'name' | 'nutrition'>;
export type RecallableProduct = Pick<ItemProduct, 'id' | 'itemId' | 'brand' | 'variant' | 'nutrition'>;

export function catalogRecallFoods(
  items: readonly RecallableItem[],
  products: readonly RecallableProduct[] = [],
): RecalledCatalogFood[] {
  const out: RecalledCatalogFood[] = [];
  const itemsById = new Map(items.map(item => [item.id, item]));

  for (const product of products) {
    const item = itemsById.get(product.itemId);
    if (!item) continue;
    const nutrition = nutritionFor(item, product);
    if (!nutrition) continue;
    const choice = packageChoices(nutrition, null)[0];
    if (!choice) continue;
    const described = describeProduct(product);
    const label = described ? `${item.name}, ${described}` : item.name;
    out.push({
      key: `p:${product.id}`,
      nameKey: groceryNameKey(label),
      label,
      nutrition,
      choice,
      itemId: item.id,
      productId: product.id,
    });
  }

  for (const item of items) {
    const nutrition = nutritionFor(item, null);
    if (!nutrition) continue;
    const choice = packageChoices(nutrition, null)[0];
    if (!choice) continue;
    out.push({
      key: `i:${item.id}`,
      nameKey: groceryNameKey(item.name),
      label: item.name,
      nutrition,
      choice,
      itemId: item.id,
      productId: null,
    });
  }

  return out;
}

/**
 * The catalog row's second line: where it came from and how much of it.
 *
 * Says the helping rather than any figure, the rule `describeRecall` keeps
 * directly below and `describeEstimate` keeps for the same reason.
 */
export function describeCatalogRecall(food: RecalledCatalogFood): string {
  return `In your kitchen, ${food.choice.label}`;
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
