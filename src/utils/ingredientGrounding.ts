/**
 * Whether the ingredients a model read out of a page or a paste are actually
 * in the text it was given.
 *
 * A model asked to extract a recipe it recognizes can answer from memory: a
 * saved gingersnap list carried cloves and an egg yolk that the page it was
 * imported from never mentioned. The review sheet already lets a person edit
 * every row, but nothing told them which rows to look at. This names them.
 *
 * Deliberately lenient. A row is grounded when any distinctive word of its name
 * shows up in the text ("unsulphured molasses" is covered by "molasses"), so
 * the check flags a line that has nothing to do with the page and never one the
 * page merely worded differently. It does not catch a wrong amount, and it says
 * nothing about a page that was edited after it was imported.
 */

/** Words that describe an ingredient without being it. */
const DESCRIPTORS = new Set([
  'ground', 'fresh', 'large', 'small', 'medium', 'whole', 'unsalted', 'salted', 'light', 'dark',
  'extra', 'virgin', 'finely', 'chopped', 'white', 'black', 'red', 'green', 'yellow', 'sweet',
  'plain', 'dried', 'raw', 'ripe', 'the', 'and', 'for', 'with', 'or', 'of', 'a',
]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).map(stem);
}

/**
 * Indexes of the ingredients whose names appear nowhere in `sourceText`.
 * Empty when there is no text to compare against, or a name has no distinctive
 * word to look for.
 */
export function ungroundedIngredientIndexes(
  sourceText: string | null | undefined,
  ingredients: ReadonlyArray<{ name: string }>,
): number[] {
  if (!sourceText || !sourceText.trim()) return [];
  const present = new Set(wordsOf(sourceText));
  const out: number[] = [];
  ingredients.forEach((row, i) => {
    const wanted = wordsOf(row.name).filter(w => w.length >= 3 && !DESCRIPTORS.has(w));
    if (wanted.length === 0) return;
    if (!wanted.some(w => present.has(w))) out.push(i);
  });
  return out;
}
