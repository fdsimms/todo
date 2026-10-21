import type { RecipeIngredient, RecipeStep } from '../types';
import { groceryNameKey } from './groceryParse';

/**
 * How much of a cooking oil reaches the plate.
 *
 * Two tablespoons of oil to sauté an onion is not two tablespoons eaten: some
 * stays in the pan, some on the pan's surface. The recipe's figures counted
 * every written gram, so a pan-cooked dish read about a quarter too high on the
 * oil's calories.
 *
 * **One number, and an estimate.** `PAN_OIL_SHARE` is the fraction of the
 * written amount that counts when the oil was used to cook in a pan. There is
 * no source for a more exact figure (it depends on the pan, the heat and how
 * much was poured off), so the line it came from is shown as counted at that
 * share rather than as measured, and the person can switch it off per line.
 *
 * **Deep frying is not modelled.** What a deep fryer's oil leaves in the food
 * scales with the food's weight, not with the amount poured, so a share of the
 * written oil is the wrong shape for it. A recipe that deep-fries is read as
 * "not cooked in the pan" and counts the whole amount, as before.
 *
 * **Tri-state on purpose.** `RecipeIngredient.cookedInPan` is absent until the
 * person answers. Absent means "decide from the method", which is what the
 * recipe's own steps say; `true` and `false` are answers and the steps are never
 * consulted again. The guess is a default, never a value that gets stored:
 * editing the steps later moves every line still on its default.
 *
 * **A closed list of oils, never a guess from the name.** The same reasoning as
 * `removedBeforeEating.ts`: "sun-dried tomatoes in oil" ends in "oil", and a
 * suffix match would offer the toggle on it. Butter and ghee are left out on
 * purpose (the share for a fat that melts into the dish is a different claim),
 * and so is sesame oil, which is mostly a finishing oil.
 */
export const PAN_OIL_SHARE = 0.75;

const COOKING_OILS = new Set([
  'oil',
  'olive oil',
  'evoo',
  'vegetable oil',
  'cooking oil',
  'neutral oil',
  'canola oil',
  'rapeseed oil',
  'sunflower oil',
  'safflower oil',
  'corn oil',
  'peanut oil',
  'avocado oil',
  'grapeseed oil',
  'coconut oil',
].map(groceryNameKey));

/** Words that qualify an oil without changing which one it is ("extra virgin olive oil"). */
const OIL_QUALIFIERS = new Set([
  'extra', 'virgin', 'light', 'pure', 'refined', 'unrefined', 'organic', 'cold', 'pressed',
  'good', 'quality', 'mild', 'regular',
]);

/** Whether a line's name is a cooking oil, which is the only kind of line the pan toggle applies to. */
export function isCookingOil(name: string): boolean {
  const key = groceryNameKey(name);
  if (!key) return false;
  const words = key.split(' ').filter(word => !OIL_QUALIFIERS.has(word));
  return words.length > 0 && COOKING_OILS.has(words.join(' '));
}

const DEEP_FRY = /\bdeep[- ]?fr(?:y|ied|ying)\b/;
/** A verb that puts oil in a pan and leaves some of it there. Not "brown": brown sugar. */
// Lookarounds rather than \b: the accented "é" is not a word character, so a
// trailing \b after "sauté" never matches.
const PAN_VERB = /(?<![a-z])(?:saut[eé](?:e?d|ing|s)?|fr(?:y|ies|ied|ying)|stir[- ]?fr(?:y|ied|ying)|sear(?:s|ed|ing)?)(?![a-zé])/;
/** Cookware or heat, enough to say the oil in the same sentence went into a pan. */
const PAN_WORD = /\b(?:heat(?:ed|ing)?|skillet|pan|wok|griddle)\b/;

/**
 * Whether a recipe's method cooks `oilName` in a pan.
 *
 * A step counts when it names the oil and also names a pan verb or a pan, so
 * "heat the oil in a skillet" is a yes and "whisk the oil into the lemon" is a
 * no. A recipe whose steps never name the oil at all falls back to whether any
 * step sautés, fries or sears, since "sauté the onions until soft" is a recipe
 * written without saying what they cooked in. Deep frying anywhere makes it no.
 */
export function stepsCookInPan(oilName: string, steps: readonly Pick<RecipeStep, 'text'>[]): boolean {
  const texts = steps.map(step => step.text.toLowerCase());
  if (texts.some(text => DEEP_FRY.test(text))) return false;

  const words = groceryNameKey(oilName).split(' ').filter(word => !OIL_QUALIFIERS.has(word));
  const named = words.join(' ');
  const namesOil = (text: string) => (named ? text.includes(named) : false) || /\boil\b/.test(text);

  const naming = texts.filter(namesOil);
  if (naming.length > 0) return naming.some(text => PAN_VERB.test(text) || PAN_WORD.test(text));
  return texts.some(text => PAN_VERB.test(text));
}

/**
 * Whether this line is cooked in the pan, or null for a line the question
 * doesn't apply to (anything that isn't a cooking oil).
 */
export function oilCookedInPan(
  ingredient: Pick<RecipeIngredient, 'name' | 'cookedInPan'>,
  steps: readonly Pick<RecipeStep, 'text'>[],
): boolean | null {
  if (!isCookingOil(ingredient.name)) return null;
  if (ingredient.cookedInPan !== undefined) return ingredient.cookedInPan;
  return stepsCookInPan(ingredient.name, steps);
}

/** The fraction of this line's written amount that counts toward the dish: 1, or `PAN_OIL_SHARE`. */
export function panOilShare(
  ingredient: Pick<RecipeIngredient, 'name' | 'cookedInPan'>,
  steps: readonly Pick<RecipeStep, 'text'>[],
): number {
  return oilCookedInPan(ingredient, steps) === true ? PAN_OIL_SHARE : 1;
}
