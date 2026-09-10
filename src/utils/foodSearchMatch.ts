import { groceryNameKey } from './groceryParse';
import { pluralKeyVariants } from './groceryPlural';
import type { NutrientKey } from '../types';

/**
 * Ranking what a food database offered back against the name a person typed.
 *
 * **The matching is the work, and it is the same problem
 * `ingredientCatalogMatch.ts` already solves against the local catalog**: a
 * name written by one person against a set of names written by somebody else.
 * The posture is reused rather than the code, since the corpus is remote, one
 * shot, and far larger.
 *
 * **Rank and offer, never auto-apply.** FoodData Central answers "milk" with
 * several dozen entries differing by fat content, fortification and whether
 * they are dried. Picking one on the user's behalf is how a recipe silently
 * acquires the calories of evaporated milk, and unlike a wrong aisle nothing
 * downstream would ever question it. So this orders candidates and says which
 * are worth showing; a person chooses.
 *
 * **Nothing here writes and nothing here fetches.** The service asks, this
 * ranks, the sheet offers, the store records. Same split `gtin.ts` keeps
 * against `productLookup.ts`, and for the same reason: the network half can't
 * be tested and the judgement half must be.
 */

/** One food a search offered back, reduced to what ranking and rendering need. */
export interface FoodCandidate {
  /** FoodData Central's own id, which the detail call needs for the portion table. */
  fdcId: string;
  /** The food as the database names it — "Onions, raw", "Milk, whole, 3.25% milkfat". */
  description: string;
  /**
   * Which dataset it came from. Foundation is the newer, more thoroughly
   * analysed set; SR Legacy is broader. Kept because it breaks ties and
   * because a caller may want to say where a figure came from.
   */
  dataType: string;
  /** The database's own shelf label, for telling two similar rows apart on screen. */
  category: string | null;
  /**
   * Which nutrients this row actually reports.
   *
   * **Carried because plenty of rows report none of the useful ones.** The
   * Foundation entry for "Butter, stick, salted" lists 130 analysed nutrients
   * and no energy at all, so picking it stores a panel with no calories in it.
   * That is observable in the payload rather than guessed, so it both ranks
   * (below) and renders: a person choosing between two similar rows should be
   * able to see which one answers the question they came with.
   */
  reports: readonly NutrientKey[];
}

/**
 * How well a candidate answers the typed name, higher being better.
 *
 * Deliberately crude, because precision here would be false comfort: the point
 * is to float the obvious answer to the top of a list a person then reads, not
 * to be right on its own. Three things earn rank, in the order they matter.
 *
 * **An exact name match wins outright.** "Onions, raw" against a typed
 * "onions" matches on the leading segment, which is how this corpus is written
 * — the food first, the qualifiers after the comma.
 *
 * **A shorter description beats a longer one at equal footing.** FoodData
 * Central's qualifiers accumulate ("Onions, young green, tops only, raw"), and
 * the plainest row is nearly always the one somebody typing "onion" meant.
 *
 * **Foundation edges out SR Legacy**, being the more thoroughly analysed set,
 * but only as a tie-break: it is much smaller, so preferring it any harder
 * would bury the right answer for most foods.
 */
/**
 * How closely a candidate's *name* answered, independent of the tie-breaks.
 *
 * Kept apart from the score because the auto-apply rule turns on it: a
 * threshold expressed as a number would silently change meaning the next time
 * a tie-break is reweighted, which is exactly the kind of drift that ends in
 * the wrong food being applied unasked.
 */
export type FoodMatchTier = 'exact' | 'leading' | 'partial' | 'none';

function scoreCandidate(candidate: FoodCandidate, queryKey: string): { tier: FoodMatchTier; score: number } {
  const description = candidate.description.toLowerCase();
  const leading = description.split(',')[0].trim();
  const leadingKey = groceryNameKey(leading);
  const fullKey = groceryNameKey(description);
  // `groceryNameKey` deliberately does not singularise — merging two shelf
  // items would be permanent — so plural tolerance is applied here, the same
  // layer `resolvePluralKey` keeps it in for the catalog. The typed key itself
  // goes in alongside, because `pluralKeyVariants` returns the *other* forms
  // and not the one it was given.
  const variants = new Set([queryKey, ...pluralKeyVariants(queryKey)]);

  let tier: FoodMatchTier;
  let score: number;
  if (variants.has(fullKey)) { tier = 'exact'; score = 100; }
  else if (variants.has(leadingKey)) { tier = 'exact'; score = 80; }
  else if (leadingKey.includes(queryKey) || queryKey.includes(leadingKey)) { tier = 'leading'; score = 40; }
  else if (fullKey.includes(queryKey)) { tier = 'partial'; score = 20; }
  else return { tier: 'none', score: 0 };

  // A row that reports no calories is a panel with the headline number missing,
  // which is a worse answer than a plainer-named row that has one. Weighted
  // below a naming tier so it reorders equals rather than promoting a poor
  // name match over a good one.
  if (candidate.reports.includes('calorieKcal')) score += 15;

  // Shorter is plainer, and plainer is nearly always what was meant.
  // Deliberately coarse-grained relative to the dataset tie-break below, so a
  // Foundation row can never edge out a plainer SR Legacy one — which is
  // exactly what "Onions, red, raw" did to "Onions, raw" before this.
  score += Math.max(0, 10 - Math.floor(description.length / 12)) * 2;
  if (candidate.dataType === 'Foundation') score += 1;
  return { tier, score };
}

/** A candidate and how well it answered, for a caller that wants to show the reasoning. */
export interface RankedFood {
  candidate: FoodCandidate;
  score: number;
  /** How closely the name matched, which is what the auto-apply rule reads. */
  tier: FoodMatchTier;
}

/**
 * The candidates worth offering for `query`, best first.
 *
 * Anything that didn't match at all is dropped rather than shown at the
 * bottom: a list whose tail is unrelated invites picking from it, and every
 * row here ends in a stored nutrition panel.
 */
export function rankFoodCandidates(
  query: string,
  candidates: readonly FoodCandidate[],
): RankedFood[] {
  const queryKey = groceryNameKey(query);
  if (!queryKey) return [];
  return candidates
    .map(candidate => ({ candidate, ...scoreCandidate(candidate, queryKey) }))
    .filter(r => r.tier !== 'none')
    .sort((a, b) => b.score - a.score || a.candidate.description.localeCompare(b.candidate.description));
}

/**
 * The one candidate a caller may take without asking, or null.
 *
 * **Null is the ordinary answer and the whole point.** This exists so a future
 * caller has one place to ask the question rather than each inventing its own
 * threshold, not so the picker can skip itself: today's sheet offers the
 * ranked list either way.
 *
 * A tie is refused for the reason `uniqueSimilarItem` refuses one — beet, beef
 * and beer are all one edit apart, and picking among them is a coin toss with
 * a person's calorie count on it. So this answers only when a single candidate
 * matched the typed name exactly and nothing else came close.
 */
export function unambiguousFood(ranked: readonly RankedFood[]): FoodCandidate | null {
  const [best, next] = ranked;
  if (best?.tier !== 'exact') return null;
  if (next?.tier === 'exact') return null;
  return best.candidate;
}
