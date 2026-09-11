import { getJson, ProductLookupError } from './productLookup';
import { readFdcNutrition, readFdcPortions } from '../utils/nutritionParse';
import { useSettingsStore } from '../store/useSettingsStore';
import { GROCERY_NAME_MAX_LENGTH, NUTRIENT_KEYS } from '../types';
import type { FoodNutrition, FoodPortion } from '../types';
import type { FoodCandidate } from '../utils/foodSearchMatch';

/**
 * Asking FoodData Central what a plain food is, by name.
 *
 * **The barcode path covers packaged food and none of what a recipe is made
 * of.** "Onion", "chicken breast", "olive oil", "all-purpose flour" have no
 * barcode, will never have one, and are most of every ingredient list. The
 * same service `productLookup.ts` already holds a key for answers all of them
 * against its `Foundation` and `SR Legacy` datasets, searched by name.
 *
 * **It rides `productLookupEnabled` rather than earning a switch of its own.**
 * That setting's own rationale in `useSettingsStore` is written about the
 * *service* — the one thing the app talks to that the user has no account with
 * — not about barcodes specifically, and this is the same host, the same key
 * and the same dataset. A second switch would mean a user who had already
 * decided about FoodData Central being asked again in different words, which
 * is how a privacy control stops meaning anything. What is genuinely different
 * is that this sends a *typed ingredient name* rather than a barcode, which is
 * slightly more revealing, so the setting's description covers it explicitly
 * rather than by implication.
 *
 * **Two requests, and the split is forced by the API.** The nutrients arrive
 * with the search hit; `foodPortions` does not, and the search response's
 * `foodMeasures` comes back empty for whole foods. So the portion table — the
 * thing `ingredientGrams` cannot work without — needs `/food/{fdcId}`, asked
 * only for the food a person actually picked. See `readFdcPortions`.
 *
 * Everything decidable offline is decided elsewhere: `foodSearchMatch.ts`
 * ranks and refuses, this only asks. Same split `gtin.ts` keeps against the
 * barcode lookup, and for the same reason.
 */

const FDC_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const FDC_FOOD_URL = 'https://api.nal.usda.gov/fdc/v1/food';

/**
 * The two datasets of whole foods, and deliberately not `Branded`.
 *
 * Branded is the barcode path's dataset: it is packaged products, keyed by
 * GTIN, and searching it by name returns a thousand near-identical own-brand
 * rows for "milk". These two are the analysed whole foods a recipe is written
 * in, and they are the only ones that carry a portion table worth having.
 */
const FDC_DATASETS = 'Foundation,SR Legacy';

/** Enough to rank meaningfully without making a person read a catalogue. */
const MAX_RESULTS = 25;

/** One search hit: what to show, and the panel that came back with it. */
export interface FoodSearchHit {
  candidate: FoodCandidate;
  /**
   * The nutrients, already converted, with an empty portion table.
   *
   * Portions are filled in by `fetchFoodPortions` for the one food that gets
   * chosen, since they need a second request. A hit whose nutrients this build
   * could not read at all is dropped rather than offered: picking it would
   * store nothing.
   */
  nutrition: FoodNutrition;
}

function readHit(food: Record<string, unknown>, recordedAt: string): FoodSearchHit | null {
  const description = typeof food.description === 'string' ? food.description.trim() : '';
  const fdcId = food.fdcId === undefined || food.fdcId === null ? '' : String(food.fdcId);
  if (!description || !fdcId) return null;
  const nutrition = readFdcNutrition(food, recordedAt);
  if (!nutrition) return null;
  return {
    candidate: {
      fdcId,
      description: description.slice(0, GROCERY_NAME_MAX_LENGTH),
      dataType: typeof food.dataType === 'string' ? food.dataType : '',
      category: typeof food.foodCategory === 'string' ? food.foodCategory.trim() || null : null,
      // Read off what actually parsed rather than off the raw payload, so a
      // nutrient the source stated in a unit this build can't convert counts
      // as unreported — which it is, as far as anything downstream is
      // concerned. See FoodCandidate.reports.
      reports: NUTRIENT_KEYS.filter(k => nutrition.amounts[k] !== undefined),
    },
    nutrition,
  };
}

/**
 * What FoodData Central offers for `query`, unranked and unfiltered beyond
 * what this build can read.
 *
 * Throws rather than answering empty when it could not ask — no key, the
 * setting off, the network down — because "nobody knows this food" and "nobody
 * could be asked" are different things to put in front of someone, exactly as
 * `lookupGtin` distinguishes them.
 */
export async function searchFoods(
  query: string,
  now: Date = new Date(),
): Promise<FoodSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { productLookupEnabled, fdcApiKey } = useSettingsStore.getState();
  if (!productLookupEnabled) throw new ProductLookupError('Lookups are off');
  if (!fdcApiKey) throw new ProductLookupError('No food database key');

  const url = `${FDC_SEARCH_URL}?query=${encodeURIComponent(trimmed)}`
    + `&dataType=${encodeURIComponent(FDC_DATASETS)}&pageSize=${MAX_RESULTS}`
    + `&api_key=${encodeURIComponent(fdcApiKey)}`;
  const payload = await getJson(url, {});
  const foods = (payload as { foods?: unknown })?.foods;
  if (!Array.isArray(foods)) return [];

  const recordedAt = now.toISOString();
  const hits: FoodSearchHit[] = [];
  for (const food of foods) {
    if (!food || typeof food !== 'object') continue;
    const hit = readHit(food as Record<string, unknown>, recordedAt);
    if (hit) hits.push(hit);
  }
  return hits;
}

/**
 * The portion table for one food, or empty when it states none.
 *
 * **Empty is an answer, not a failure.** Plenty of foods carry no portions at
 * all, and one that doesn't is still worth storing: its nutrients answer every
 * recipe line already written as a mass, which is where `ingredientGrams`
 * needs no table. So this returns `[]` rather than throwing on a food it
 * reached and found nothing on.
 */
export async function fetchFoodPortions(
  fdcId: string,
  ): Promise<FoodPortion[]> {
  const { productLookupEnabled, fdcApiKey } = useSettingsStore.getState();
  if (!productLookupEnabled) throw new ProductLookupError('Lookups are off');
  if (!fdcApiKey) throw new ProductLookupError('No food database key');

  const url = `${FDC_FOOD_URL}/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(fdcApiKey)}`;
  const payload = await getJson(url, {});
  if (!payload || typeof payload !== 'object') return [];
  return readFdcPortions(payload as Record<string, unknown>);
}

/**
 * Copy for a search that couldn't be run, mirroring `describeLookupError`.
 *
 * The advice differs from the barcode one because the fallback differs: there
 * is no name to type instead, since a name is what was just typed. What a
 * person can do is fill the panel in themselves, which is what every branch
 * points at.
 */
export function describeFoodSearchError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Request timed out') return 'The search took too long. Try again in a moment.';
  if (message === 'Lookups are off') return 'Food lookups are off. Turn them on in Settings.';
  if (message === 'No food database key') return 'Add a FoodData Central key in Settings to search for foods.';
  return 'Couldn\'t reach the food database. Try again in a moment.';
}

/**
 * Which Settings row fixes this error, if any — the "Barcode lookups" entry
 * a caller should jump to rather than leaving someone to hunt for it. `null`
 * for anything that isn't a Settings problem (a timeout, a bad response).
 */
export function foodSearchErrorSettingsEntryId(error: unknown): string | null {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Lookups are off') return 'productLookupEnabled';
  if (message === 'No food database key') return 'fdcApiKey';
  return null;
}
