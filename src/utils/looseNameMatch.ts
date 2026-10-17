import { groceryNameKey } from './groceryParse';

/**
 * Whether a typed description names a stored dish, when the plain substring
 * rules (`matchWeight`, `recallWeight`) cannot see it.
 *
 * Those rules compare the characters as typed, so "122g of roasted vegetables
 * with zataar recipe" never reached a recipe called "Roasted vegetables with
 * za'atar": the amount and the word "recipe" break the prefix, the apostrophe
 * becomes a space ("za atar"), and "zataar" is one letter-swap from either.
 * This is the fallback that survives all three.
 *
 * **Every word the name carries must be found in the description, and a name
 * needs two of them to be matched loosely.** One word is the existing
 * containment rule's job (exact, four letters or more); a typo-tolerant match
 * on a single word would offer "Tuna" for "tuba". Words under five letters
 * must match exactly, so "rice" never drifts to "mice".
 */

/** Words that join a dish's name to its parts and say nothing about which dish. */
const FILLER = new Set(['a', 'an', 'and', 'of', 'the', 'with', 'in', 'on', 'my', 'some', 'recipe', 'homemade']);

/** An amount ("122g", "2", "1.5oz"): what was eaten, not which dish. */
const AMOUNT = /^\d+(\.\d+)?(g|kg|mg|oz|lb|lbs|ml|l|cup|cups|tbsp|tsp)?$/;

/** Shorter than this, a word has to match exactly. */
const MIN_FUZZY_WORD = 5;

/** What a loose hit weighs: under `recallWeight`'s weakest containment hit (0.05). */
export const LOOSE_NAME_WEIGHT = 0.04;

/** The words of a name or description that identify a dish. */
function dishWords(text: string): string[] {
  return groceryNameKey(text.replace(/['’]/g, ''))
    .split(' ')
    .filter(word => word && !FILLER.has(word) && !AMOUNT.test(word));
}

/** One swap, insertion, deletion or substitution apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true;
  const restA = a.slice(i + 1);
  const restB = b.slice(i + 1);
  if (a.length === b.length && (restA === restB || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)))) return true;
  return a.length < b.length ? a.slice(i) === restB : restA === b.slice(i);
}

function wordFound(word: string, queryWords: readonly string[]): boolean {
  const fuzzy = word.length >= MIN_FUZZY_WORD;
  return queryWords.some(q => q === word || (fuzzy && q.length >= MIN_FUZZY_WORD && withinOneEdit(word, q)));
}

/**
 * `LOOSE_NAME_WEIGHT` when every identifying word of `name` is in
 * `description` (allowing one typo in a longer word), else 0.
 */
export function looseNameWeight(name: string, description: string): number {
  const words = dishWords(name);
  if (words.length < 2) return 0;
  const queryWords = dishWords(description);
  // A caller holding a `groceryNameKey` has already split "za'atar" into
  // "za atar", so a word that is not found may be the front of one that was.
  for (let i = 0; i < words.length; i++) {
    if (wordFound(words[i], queryWords)) continue;
    if (i + 1 < words.length && wordFound(words[i] + words[i + 1], queryWords)) { i++; continue; }
    return 0;
  }
  return LOOSE_NAME_WEIGHT;
}
