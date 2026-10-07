import type { FoodLogEntry, FoodNutrition, GroceryItem, ItemProduct, MealSlot } from '../types';
import { isPortionBox } from '../types';
import { groceryNameKey } from './groceryParse';
import { matchWeight } from './grocerySuggest';
import { nutritionFor } from './foodNutrition';
import {
  currentEstimateCount,
  currentEstimateFactor,
  estimateAmountPatch,
  estimateCount,
  keptDatabasePanel,
  MAX_ESTIMATE_MULTIPLE,
  scalePanelToAmount,
  wholeEstimate,
  type EstimateCount,
} from './foodLog';
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
 * falls back to the label for the same reason (dropping every hand-entered
 * food would misreport what somebody eats), and this is made of nothing but
 * the entries that fallback exists for.
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
  /**
   * The panel the most recent logging kept (`FoodLogEntry.sourcePanel`), or
   * null. Carried so the entry logged from this can be corrected just as that
   * one can, and so a new weight is measured against it rather than
   * multiplied out of `nutrition`. See `recalledHelping`.
   */
  sourcePanel: FoodNutrition | null;
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
 * The weight of the whole an estimate describes: the one recorded for it, or
 * else the one its confirmed words open with ("27 g (about 2 tablespoons)").
 *
 * An estimate's panel carries no weight on purpose (`estimateToPanel`), but a
 * quantity that starts with grams is a weight the person confirmed, so the
 * amount can be asked for in grams instead of percent of an amount shown.
 */
export function estimateWholeGrams(food: RecalledFood): number | null {
  const whole = wholeEstimate(food);
  if (!whole) return null;
  if (whole.servingGrams && whole.servingGrams > 0) return whole.servingGrams;
  const words = whole.servingText?.trim() ?? '';
  const match = /^(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i.exec(words);
  const grams = match ? parseFloat(match[1]) : 0;
  return grams > 0 ? grams : null;
}

/**
 * A weight named in a description, as a multiple of the whole an estimate
 * described, or null when there is none to read.
 *
 * **The weight typed with the food is the amount, whatever the food was last
 * logged as.** An estimate is asked for a count or a share rather than grams
 * (`recallAmountAsk`), so a "29g" in the clause was ignored and the row opened
 * on the previous amount. When the estimate recorded a weight for its whole
 * the two meet: 29 g of a 27 g whole is 29/27 of it, the same arithmetic
 * `recalledHelping` applies to a gram change. With no recorded weight there is
 * nothing to compare 29 g to, so this says nothing and the row opens as logged.
 */
export function describedEstimateFactor(food: RecalledFood, clause: string): number | null {
  const typed = describedGrams(clause);
  const wholeG = estimateWholeGrams(food);
  if (!typed || !wholeG) return null;
  const factor = parseFloat(typed) / wholeG;
  return factor > 0 && factor <= MAX_ESTIMATE_MULTIPLE ? factor : null;
}

/**
 * A typed description split into the separate foods it names, on the comma
 * the field's own placeholder already treats as a food boundary ("31g
 * baguette, 25g peach jam").
 *
 * **Matching and weight-extraction both run per clause, never over the whole
 * string.** A multi-food description matched (or `describedGrams`-scanned) as
 * one query mixes them up: "peach jam" can match a clause it isn't in, and a
 * weight search over the whole string finds whichever number comes first
 * rather than the one sitting next to the food it's meant to describe. Every
 * offer `EstimateMealSheet` stages is scoped to the clause that produced it
 * for exactly this reason.
 */
export function descriptionClauses(description: string): string[] {
  return description.split(',').map(s => s.trim()).filter(Boolean);
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
        sourcePanel: entry.sourcePanel ?? null,
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
      seen.sourcePanel = entry.sourcePanel ?? null;
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
 * What a recalled food is measured against when it is logged at a weight of
 * its own: the database panel it kept, or else the recorded helping.
 *
 * **The kept panel wins, because an amount is re-measured, never multiplied**
 * (`docs/arch/health-data.md`). A database food nobody filed keeps the
 * database's own per-100 g record (`FoodLogEntry.sourcePanel`, #2914), and
 * 170 g of it is measured off that record exactly as the entry sheet's
 * correction measures it. The recorded helping is already one amount's worth,
 * so scaling it compounds that helping's rounding into the next one, and it
 * stays the base only for a food that kept nothing better.
 *
 * Only for a food linked to nothing, the order `foodLogEntryEdit` reads them
 * in: a link wins over a kept panel. An estimate is never weighed against
 * this: `recalledHelping` changes it as a multiple of its whole instead, and
 * its kept whole is not a panel to measure with (`keptDatabasePanel` says why).
 */
export function recallMeasuringPanel(food: RecalledFood): FoodNutrition {
  const linked = !!(food.recipeId || food.itemId || food.productId);
  return (linked ? null : keptDatabasePanel(food)) ?? food.nutrition;
}

/**
 * Whether a panel can be measured at a weight at all: per 100 g, or a helping
 * or serving whose weight is known.
 *
 * Asked before a weight field is shown, because a field whose value would be
 * ignored is worse than none (#2914). A per-100 ml drink, or a helping
 * recorded as "1 serving" with no weight, has nothing a gram figure can be
 * measured against, and every weight typed into one used to log the recorded
 * helping without a word.
 */
export function measuresByWeight(panel: FoodNutrition): boolean {
  // An approximate answer (a weight counted as water on a per-100 ml panel)
  // is not a measurement; this step offers a weight only where one is exact.
  const scaled = scalePanelToAmount(panel, '100g', null);
  return scaled !== null && !scaled.approximate;
}

/**
 * How the Describe sheet's amount step asks for a different amount of a food
 * eaten before.
 *
 * - **`count`**: an estimate whose words count one thing ("2 slices"). Asked
 *   in that unit, the question "Change amount" asks. `opensAt` is the count
 *   last logged, or null when that helping is no count of its whole.
 * - **`multiple`**: an estimate whose words give no count. The same closed
 *   set of shares and multiples "Change amount" offers, `opensAt` being the
 *   one last logged, or null when it was none of them.
 * - **`weight`**: anything else its measuring panel can weigh, in grams.
 * - **`none`**: nothing a different amount could be measured against. It
 *   logs as recorded, and the step shows no field that would be ignored.
 *
 * An estimate is never asked for grams, even one whose whole carried a
 * weight: the count is the unit it was estimated in, and a described meal is
 * logged with no weight (`handleLog` in `EstimateMealSheet`).
 */
export type RecallAmountAsk =
  | { kind: 'count'; count: EstimateCount; opensAt: number | null }
  | { kind: 'multiple'; opensAt: number | null }
  | { kind: 'weight' }
  | { kind: 'none' };

export function recallAmountAsk(food: RecalledFood): RecallAmountAsk {
  const whole = wholeEstimate(food);
  if (whole) {
    const count = estimateCount(whole.servingText);
    if (count) return { kind: 'count', count, opensAt: currentEstimateCount(food) };
    return { kind: 'multiple', opensAt: currentEstimateFactor(food) };
  }
  return measuresByWeight(recallMeasuringPanel(food)) ? { kind: 'weight' } : { kind: 'none' };
}

/** What logging a recalled food again writes, beside where and when it lands. */
export interface RecalledHelping {
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  sourcePanel: FoodNutrition | null;
}

/**
 * A different amount of a recalled food: a weight in grams, or for an
 * estimate a multiple of the whole meal it described (a count asked in its
 * own unit arrives here as new over old).
 */
export type RecallChange = { grams: number } | { factor: number };

/**
 * A recalled food as it is logged again: as recorded when `change` is null,
 * or at the amount it names. Null when that amount can't be applied, which a
 * caller says in words rather than logging the recorded helping in its place.
 *
 * **As recorded, everything goes back verbatim, the kept panel included**,
 * the copy `duplicateEntry` and `helpingAgain` make. The new entry can then be
 * corrected, or for an estimate changed in amount, exactly as the old one
 * could. Leaving the panel behind was the bug (#2914): an unfiled database
 * food came back as an entry that could only be renamed.
 *
 * **An estimate at a new amount is a multiple of its whole**, through
 * `estimateAmountPatch`, the same arithmetic "Change amount" uses: its kept
 * whole when it has one, else its helping (`wholeEstimate`). "2 slices" last
 * logged as 3 and asked for at 4 is twice the 2-slice meal, not four-thirds of
 * the helping, and the new entry keeps that whole as its `sourcePanel` so it
 * can be changed again later. A weight is taken only against a whole that
 * recorded one, scaled by it, and refused otherwise: there is nothing to
 * measure 110 g of "2 slices" against, and logging the recorded helping in
 * its place, with the field still showing 110, was the other half of the
 * report.
 *
 * **Anything else at a new weight is measured off `recallMeasuringPanel`**,
 * and keeps the panel only when that is what measured it. Measured off a kept
 * database panel, the new entry keeps that panel, since its helping was
 * measured against exactly that. Measured off the recorded helping, it keeps
 * nothing, the way a correction against a linked row drops it. A weight the
 * base cannot measure gets null, as does a multiple, which is an estimate's
 * correction and nothing else's.
 */
export function recalledHelping(food: RecalledFood, change: RecallChange | null, now: Date): RecalledHelping | null {
  if (change === null) {
    return { quantity: food.quantity, grams: food.grams, nutrition: food.nutrition, sourcePanel: food.sourcePanel };
  }

  const whole = wholeEstimate(food);
  if (whole) {
    const factor = 'factor' in change
      ? change.factor
      : whole.servingGrams !== null && whole.servingGrams > 0 ? change.grams / whole.servingGrams : null;
    const patch = factor === null ? null : estimateAmountPatch(food, factor);
    return patch && {
      quantity: patch.quantity,
      grams: patch.grams,
      nutrition: patch.nutrition,
      sourcePanel: patch.sourcePanel,
    };
  }

  if (!('grams' in change)) return null;
  const base = recallMeasuringPanel(food);
  const scaled = scalePanelToAmount(base, `${change.grams}g`, null, now);
  // Same rule as `measuresByWeight`: a weight counted as water is not exact.
  if (!scaled || scaled.approximate) return null;
  return {
    quantity: scaled.grams != null ? `${scaled.grams}g` : food.quantity,
    grams: scaled.grams,
    nutrition: scaled.nutrition,
    sourcePanel: base === food.nutrition ? null : base,
  };
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
export type RecallableProduct = Pick<ItemProduct, 'id' | 'itemId' | 'brand' | 'variant' | 'nutrition'>
  & Partial<Pick<ItemProduct, 'isPortion'>>;

export function catalogRecallFoods(
  items: readonly RecallableItem[],
  products: readonly RecallableProduct[] = [],
): RecalledCatalogFood[] {
  const out: RecalledCatalogFood[] = [];
  const itemsById = new Map(items.map(item => [item.id, item]));

  for (const product of products) {
    // A frozen portion is some of the item rather than a brand of it, and it
    // carries no panel, so `nutritionFor` would fall through to the item's and
    // offer the item a second time under its own name. See
    // ItemProduct.isPortion.
    if (isPortionBox(product)) continue;
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
