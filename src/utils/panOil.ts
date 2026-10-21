import type { RecipeIngredient, RecipeStep } from '../types';
import { groceryNameKey } from './groceryParse';

/**
 * How much of a cooking fat (an oil, butter or ghee) reaches the plate.
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
 * **Deep frying has its own, much smaller share.** A pot of frying oil is mostly
 * left behind: what the food takes up scales with the food's weight, not with
 * the oil poured, and the recipe rarely names that weight. So `DEEP_FRY_SHARE`
 * is a rough stand-in for "a small part of it", used when the steps deep fry
 * the fat. It is the roughest number here, and the same switch turns it off.
 *
 * **Tri-state on purpose.** `RecipeIngredient.cookedInPan` is absent until the
 * person answers. Absent means "decide from the method", which is what the
 * recipe's own steps say; `true` and `false` are answers and the steps are never
 * consulted again. The guess is a default, never a value that gets stored:
 * editing the steps later moves every line still on its default.
 *
 * **A closed list of cooking fats, never a guess from the name.** The same
 * reasoning as `removedBeforeEating.ts`: "sun-dried tomatoes in oil" ends in
 * "oil" and "peanut butter" starts with a fat, and a suffix match would offer
 * the toggle on both. Butter, ghee and sesame oil are on the list because they
 * are sometimes used to sauté. That is only sometimes (a cookie's butter and a
 * finishing drizzle of sesame oil are eaten whole), so the steps decide the
 * default and the same 75% is a rougher fit for them than for a plain oil.
 */
export const PAN_OIL_SHARE = 0.75;

/** The fraction of a deep-frying oil's written amount that counts. See the header. */
export const DEEP_FRY_SHARE = 0.1;

const COOKING_FATS = new Set([
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
  'sesame oil',
  'butter',
  'ghee',
].map(groceryNameKey));

/** Words that qualify a fat without changing which one it is ("extra virgin olive oil", "unsalted butter"). */
const OIL_QUALIFIERS = new Set([
  'extra', 'virgin', 'light', 'pure', 'refined', 'unrefined', 'organic', 'cold', 'pressed',
  'good', 'quality', 'mild', 'regular', 'toasted', 'unsalted', 'salted', 'clarified',
]);

/** Whether a line's name is a cooking fat, which is the only kind of line the pan toggle applies to. */
export function isCookingFat(name: string): boolean {
  const key = groceryNameKey(name);
  if (!key) return false;
  const words = key.split(' ').filter(word => !OIL_QUALIFIERS.has(word));
  return words.length > 0 && COOKING_FATS.has(words.join(' '));
}

/**
 * A step that deep fries, by name, by the fryer, or by the depth and heat of the
 * oil ("heat 2 inches of oil to 350°F"). The last two matter because the step
 * that names the oil often never says "deep fry".
 */
const DEEP_STEP = /deep[- ]?fr(?:y|ied|ying)|\bfryer\b|inches of oil|enough oil to (?:cover|submerge|fill)|\boil\b[^.]*\b(?:3[0-9]{2}|1[6-9][0-9])\s*°/;
/** A verb that puts oil in a pan and leaves some of it there. Not "brown": brown sugar. */
// Lookarounds rather than \b: the accented "é" is not a word character, so a
// trailing \b after "sauté" never matches.
const PAN_VERB = /(?<![a-z])(?:saut[eé](?:e?d|ing|s)?|fr(?:y|ies|ied|ying)|stir[- ]?fr(?:y|ied|ying)|sear(?:s|ed|ing)?)(?![a-zé])/;
/** Cookware or heat, enough to say the oil in the same sentence went into a pan. */
const PAN_WORD = /\b(?:heat(?:ed|ing)?|skillet|pan|wok|griddle)\b/;

export type CookMethod = 'pan' | 'deep';

/**
 * How a recipe's method cooks `fatName`, or null when it doesn't cook it.
 *
 * A step counts when it names the fat and also names a pan verb or a pan, so
 * "heat the oil in a skillet" is a pan and "whisk the oil into the lemon" is
 * nothing. A naming step that deep fries makes it deep. A recipe whose steps
 * never name the fat at all falls back to the recipe as a whole: any deep-fry
 * step makes it deep, else any step that sautés, fries or sears makes it a pan,
 * since "sauté the onions until soft" is written without saying what they
 * cooked in.
 */
export function stepsCookMethod(fatName: string, steps: readonly Pick<RecipeStep, 'text'>[]): CookMethod | null {
  const texts = steps.map(step => step.text.toLowerCase());

  const words = groceryNameKey(fatName).split(' ').filter(word => !OIL_QUALIFIERS.has(word));
  const named = words.join(' ');
  // The full name, or just its last word: "heat the oil" cooks an olive oil.
  const last = words[words.length - 1] ?? '';
  // The last word alone ("the oil") stands for this fat only when the step
  // doesn't name another one: "heat the vegetable oil" is not about an olive oil.
  const namesOther = (text: string) =>
    [...COOKING_FATS].some(fat => fat !== 'oil' && fat !== named && text.includes(fat));
  const namesFat = (text: string) =>
    (named !== '' && text.includes(named))
    || (last !== '' && new RegExp(`\\b${last}\\b`).test(text) && !namesOther(text));

  const naming = texts.filter(namesFat);
  if (naming.length > 0) {
    if (naming.some(text => DEEP_STEP.test(text))) return 'deep';
    return naming.some(text => PAN_VERB.test(text) || PAN_WORD.test(text)) ? 'pan' : null;
  }
  if (texts.some(text => DEEP_STEP.test(text))) return 'deep';
  return texts.some(text => PAN_VERB.test(text)) ? 'pan' : null;
}

/** What a cooking fat's line is doing in this recipe. */
export interface FatCooking {
  /** Whether part of it is left behind: the person's answer, else what the steps say. */
  cooked: boolean;
  /** Which way it was cooked. A pan when the steps don't say, so an answer of "cooked" has a share to use. */
  method: CookMethod;
  /** The fraction of the written amount that counts toward the dish: 1 when not cooked. */
  share: number;
}

/** What a line is doing in the recipe, or null for a line that isn't a cooking fat. */
export function fatCooking(
  ingredient: Pick<RecipeIngredient, 'name' | 'cookedInPan'>,
  steps: readonly Pick<RecipeStep, 'text'>[],
): FatCooking | null {
  if (!isCookingFat(ingredient.name)) return null;
  const fromSteps = stepsCookMethod(ingredient.name, steps);
  const cooked = ingredient.cookedInPan ?? fromSteps !== null;
  const method = fromSteps ?? 'pan';
  const share = !cooked ? 1 : method === 'deep' ? DEEP_FRY_SHARE : PAN_OIL_SHARE;
  return { cooked, method, share };
}

/** The fraction of this line's written amount that counts toward the dish: 1, `PAN_OIL_SHARE` or `DEEP_FRY_SHARE`. */
export function panOilShare(
  ingredient: Pick<RecipeIngredient, 'name' | 'cookedInPan'>,
  steps: readonly Pick<RecipeStep, 'text'>[],
): number {
  return fatCooking(ingredient, steps)?.share ?? 1;
}
