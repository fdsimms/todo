import type { GroceryItem } from '../types';

/**
 * Singular and plural, resolved to one shelf item.
 *
 * `groceryNameKey` deliberately does not stem plurals — stemming the *identity*
 * key would merge two shelf items forever, and "chips" → "chip" / "glasses" →
 * "glasse" are merges nobody asked for. That rule stands and this file does not
 * touch it: every stored `name_key` is exactly what it always was, so there is
 * nothing to backfill.
 *
 * What this adds is the other half — a resolve, at read time, against the rows
 * that actually exist. A key is only ever matched to a key already in the
 * catalog, so a bad stem ("hummus" → "hummu") resolves to nothing rather than
 * to a row it invented, and the worst case of a wrong guess is that two names
 * the user really did mean to keep apart land on one row they can rename.
 *
 * The cost of not having this was a "did you mean serrano peppers?" nudge on
 * every recipe line whose only sin was being singular — and, if you ignored the
 * nudge, a second catalog row one letter away from the first, splitting its
 * purchase count, its aisle and its pantry state in two.
 *
 * Plural tolerance already lived in `matchWeight` for the autocomplete, where a
 * wrong guess costs a keystroke. This is the same tolerance where a wrong guess
 * costs a row, which is why it refuses ambiguity (below) rather than ranking it.
 */

/**
 * Below this many characters a word has no plural worth guessing at: "as",
 * "is" and "es" all stem to two letters that are words of their own, and a
 * three-letter stem is where the real groceries start ("egg", "oat", "pea").
 */
const MIN_WORD_LENGTH = 3;

/** Endings that take "-es" rather than a bare "-s" — box/boxes, peach/peaches. */
const SIBILANT = /(?:s|x|z|ch|sh)$/;

/**
 * Every plural this word could take. A small closed table rather than a
 * stemmer: the point is to *generate candidates to look up*, so an ending it
 * doesn't know simply produces one fewer candidate, and none of them can create
 * anything.
 */
function pluralForms(word: string): string[] {
  const forms = [`${word}s`];
  if (SIBILANT.test(word)) forms.push(`${word}es`);
  // potato/potatoes, mango/mangoes — and "-os" is already covered above, since
  // both spellings are in use and only one of them will be in the catalog.
  if (word.endsWith('o')) forms.push(`${word}es`);
  // berry/berries, but not boy/boys: the y has to follow a consonant.
  if (/[^aeiou]y$/.test(word)) forms.push(`${word.slice(0, -1)}ies`);
  // knife/knives, loaf/loaves.
  if (word.endsWith('fe')) forms.push(`${word.slice(0, -2)}ves`);
  else if (word.endsWith('f')) forms.push(`${word.slice(0, -1)}ves`);
  return forms;
}

/** The mirror of `pluralForms` — every singular this word could be a plural of. */
function singularForms(word: string): string[] {
  const forms: string[] = [];
  if (word.endsWith('ies')) forms.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('ves')) forms.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`);
  if (word.endsWith('oes')) forms.push(word.slice(0, -2));
  if (word.endsWith('es')) {
    const stem = word.slice(0, -2);
    // Only where "-es" was the *required* plural. Without this "grapes" would
    // offer "grap" as well as "grape", and every extra candidate is another
    // chance to collide with a row that means something else.
    if (SIBILANT.test(stem)) forms.push(stem);
  }
  // "glass" is not the singular of "glas", and "couscous" is not a plural at all.
  if (word.endsWith('s') && !word.endsWith('ss')) forms.push(word.slice(0, -1));
  return forms;
}

/**
 * The keys that would name the same shelf item as `key`, differing only in the
 * plural of its **last** word — "serrano pepper" ↔ "serrano peppers", and never
 * "green beans" ↔ "greens beans".
 *
 * Both directions, so the relation is symmetric: whichever of the pair is in
 * the catalog, the other one finds it.
 */
export function pluralKeyVariants(key: string): string[] {
  const trimmed = key.trim();
  if (!trimmed) return [];
  const cut = trimmed.lastIndexOf(' ');
  const head = cut === -1 ? '' : trimmed.slice(0, cut + 1);
  const word = trimmed.slice(cut + 1);
  if (word.length < MIN_WORD_LENGTH) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const form of [...pluralForms(word), ...singularForms(word)]) {
    if (form.length < MIN_WORD_LENGTH) continue;
    const variant = head + form;
    if (variant === trimmed || seen.has(variant)) continue;
    seen.add(variant);
    out.push(variant);
  }
  return out;
}

/**
 * The one existing key that `key` is the singular or plural of, or null.
 *
 * Null in three cases, and each of them is a deliberate refusal rather than a
 * gap:
 *
 * - `key` itself exists. An exact key answers for itself; that's the join, and
 *   nothing here gets to reinterpret it.
 * - Nothing matches. The honest answer for a name that is genuinely new.
 * - **Several match.** A catalog holding both "leaf" and "leave" says nothing
 *   about which one "leaves" meant, and picking one is a coin flip that writes
 *   to a row. Same refusal `uniqueSimilarItem` makes in
 *   `ingredientCatalogMatch`, for the same reason.
 */
export function resolvePluralKey(key: string, existing: Iterable<string>): string | null {
  const variants = pluralKeyVariants(key);
  if (variants.length === 0) return null;
  const wanted = new Set(variants);
  let found: string | null = null;
  for (const candidate of existing) {
    if (candidate === key) return null;
    if (!wanted.has(candidate)) continue;
    if (found && found !== candidate) return null;
    found = candidate;
  }
  return found;
}

/**
 * The catalog row a name key resolves to: the exact one, else the one it is a
 * plural of. **The one lookup every find-or-insert should use** — reading
 * `items.find(i => i.nameKey === key)` bare is what mints the near-duplicate.
 *
 * First wins among rows sharing a key, the same rule `catalogItem`'s own
 * `.find` has always had.
 */
export function catalogItemForKey(
  key: string,
  items: readonly GroceryItem[]
): GroceryItem | null {
  if (!key) return null;
  const exact = items.find(i => i.nameKey === key);
  if (exact) return exact;
  const resolved = resolvePluralKey(key, itemKeys(items));
  if (!resolved) return null;
  return items.find(i => i.nameKey === resolved) ?? null;
}

function* itemKeys(items: readonly GroceryItem[]): Generator<string> {
  for (const item of items) yield item.nameKey;
}
