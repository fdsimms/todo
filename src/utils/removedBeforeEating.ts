import { groceryNameKey } from './groceryParse';

/**
 * Whether an ingredient is usually something you take out before eating, like
 * kombu in a stock or a bay leaf in a stew, so that counting it toward a dish's
 * nutrition is probably wrong.
 *
 * **A closed list of whole phrases, never a guess from the name.** A wrong
 * "usually removed" is a suggestion the person can ignore, but a list that grew
 * by pattern ("leaf", "stick") would offer it on kale and on a celery stick.
 * It only ever *offers*: nothing is excluded unless the person taps, and
 * `RecipeIngredient.excludeFromNutrition` is still what records the answer, per
 * line, since the same ingredient is eaten in another recipe.
 */
const REMOVED_BEFORE_EATING: readonly string[] = [
  'kombu',
  'konbu',
  'dashima',
  'dried kelp',
  'bay leaf',
  'bay leaves',
  'cinnamon stick',
  'cinnamon sticks',
  'star anise',
  'lemongrass',
  'lemon grass',
  'kaffir lime leaf',
  'kaffir lime leaves',
  'makrut lime leaf',
  'makrut lime leaves',
  'bouquet garni',
  'parmesan rind',
];

const KEYS = new Set(REMOVED_BEFORE_EATING.map(groceryNameKey));

/** True when the line's name is one of the phrases above, as a whole or as its last words ("dried kombu"). */
export function isUsuallyRemovedBeforeEating(name: string): boolean {
  const key = groceryNameKey(name);
  if (!key) return false;
  if (KEYS.has(key)) return true;
  const words = key.split(' ');
  for (let i = 1; i < words.length; i++) {
    if (KEYS.has(words.slice(i).join(' '))) return true;
  }
  return false;
}
