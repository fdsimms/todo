import type { GroceryItem } from '../types';
import { groceryNameKey, suggestShorterCatalogName } from './groceryParse';
import { rankGrocerySuggestions } from './grocerySuggest';

/**
 * What a recipe ingredient line resolves to in the grocery catalog, and — when
 * it resolves to nothing — what it probably meant.
 *
 * `RecipeIngredient.nameKey` has always been the bridge to the catalog, but it
 * is an *exact* key match and nothing else (see "the join is nameKey and
 * nothing else" in docs/arch/groceries.md). That is the right rule for the
 * join itself: it's a stored pointer every reader trusts, and widening it
 * would silently merge two shelf items for good. The cost is that a line one
 * character or one leading word away from something you already buy reads as a
 * brand-new ingredient, with nothing on screen saying otherwise — which is how
 * "skyr" looked like it was about to be created from scratch when it had been
 * in the catalog all along (#2061).
 *
 * So this module is deliberately the *other* half: everything the exact join
 * can't say, computed at read time, offered as a suggestion, and never written
 * anywhere on its own. Same division `matchWeight` already makes by keeping
 * plural tolerance in the suggestion layer rather than in `groceryNameKey`,
 * "where merging two shelf items would be permanent", and the same
 * surface-it-rather-than-solve-it call `splitAlternativeNames` and
 * `suggestShorterCatalogName` both make: the parse offers, a person confirms.
 *
 * **Nothing here writes.** Every caller resolves a suggestion the one way the
 * app already resolves them — by renaming the line to the catalog item's own
 * name (`commit(item.name)`, see `CatalogLinkPicker`), letting the existing
 * `nameKey` derivation take it from there. There is no second key field and
 * there must not be one.
 */

/**
 * Why a suggestion was offered. Carried for tests and for a caller that wants
 * to rank one kind above another; the UI copy is deliberately the same
 * sentence for all four, since "did you mean this" is the only question being
 * asked and naming the mechanism would explain the parser rather than the
 * ingredient.
 */
export type IngredientMatchReason =
  /** A leading word dropped, confirmed against the catalog — "cloves garlic" → "garlic". */
  | 'shorter'
  /** A catalog name is the opening words of this line — "greek yogurt plain" → "Greek yogurt". */
  | 'prefix'
  /** The autocomplete's own ranking, which is also where plural tolerance lives. */
  | 'ranked'
  /** One character out — "skir" → "Skyr". The only tier that tolerates a misspelling. */
  | 'similar';

export type IngredientMatchKind =
  /** Exact `nameKey` hit: this line already *is* that catalog row. */
  | 'linked'
  /** No exact hit, but something close enough to offer. */
  | 'suggested'
  /** Nothing in the catalog resembles it. The honest answer for most one-off ingredients. */
  | 'unknown';

export interface IngredientCatalogMatch {
  kind: IngredientMatchKind;
  /** The catalog row — the one it resolves to (`linked`) or the one being offered (`suggested`). */
  item: GroceryItem | null;
  /**
   * What to rename the line to in order to take the suggestion. The catalog
   * item's own name for every tier except `shorter`, which offers the trimmed
   * line — those two agree in practice (the trim is confirmed *against* a
   * catalog key) but the item's name carries the user's own capitalisation.
   */
  suggestedName: string | null;
  reason: IngredientMatchReason | null;
}

const NO_MATCH: IngredientCatalogMatch = {
  kind: 'unknown',
  item: null,
  suggestedName: null,
  reason: null,
};

/**
 * Below this many characters a one-character edit is too much of the word to
 * be evidence of anything: at three characters "ham"/"jam"/"yam" are all
 * within one edit of each other and all real.
 */
const MIN_SIMILAR_LENGTH = 4;

/**
 * Whether two keys are within one insertion, deletion or substitution.
 *
 * Bounded at one on purpose rather than being a general edit distance with a
 * tunable threshold: two edits is where "lime"/"line"/"lint" and
 * "butter"/"batter" start colliding, and every one of those pairs is two real
 * groceries. One edit catches the transposition and the dropped letter that
 * actually happen when typing, and is cheap enough to run against the whole
 * catalog per line.
 *
 * Not Damerau — a transposition ("yoghurt"/"yogurth") counts as two
 * substitutions here and so is *not* offered. That's the conservative side of
 * the same trade, and the fuzzy picker (`CatalogLinkPicker`) is still there for
 * anything this declines.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.length - shorter.length > 1) return false;

  let i = 0;
  let j = 0;
  let edited = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (edited) return false;
    edited = true;
    // Same length means a substitution (step both); different means the extra
    // character is in `longer` alone (step only it).
    if (shorter.length === longer.length) i++;
    j++;
  }
  return true;
}

/**
 * The longest catalog name that is the *opening words* of this line.
 *
 * "greek yogurt plain" → "greek yogurt", but "gree" → nothing: the boundary has
 * to fall on a space, or a catalog row called "egg" would claim "eggplant". The
 * word-boundary test is the whole safety of this tier, and it's the reason this
 * is a separate pass rather than a `startsWith` inside the ranked one — the
 * autocomplete matches the other direction (catalog name *starts with* the
 * query), which is right for something typed a letter at a time and wrong for a
 * whole ingredient line that has already been typed in full.
 *
 * Longest wins, so a catalog holding both "yogurt" and "greek yogurt" offers the
 * more specific one.
 */
function longestPrefixItem(
  key: string,
  items: readonly GroceryItem[]
): GroceryItem | null {
  let best: GroceryItem | null = null;
  for (const item of items) {
    if (!item.nameKey || item.nameKey.length >= key.length) continue;
    if (!key.startsWith(`${item.nameKey} `)) continue;
    if (!best || item.nameKey.length > best.nameKey.length) best = item;
  }
  return best;
}

/**
 * The one catalog row within a single edit, or null when there is none — or
 * when there are several.
 *
 * Ambiguity is refused rather than ranked. A tie means the evidence points two
 * ways at once ("lime" against a catalog holding both "line" and "limes"), and
 * a suggestion that picks one is a coin flip presented as a correction. The
 * ranked tier above already ran, so anything genuinely familiar has had its
 * chance to win on frequency first.
 */
function uniqueSimilarItem(
  key: string,
  items: readonly GroceryItem[]
): GroceryItem | null {
  if (key.length < MIN_SIMILAR_LENGTH) return null;
  let found: GroceryItem | null = null;
  for (const item of items) {
    if (item.nameKey.length < MIN_SIMILAR_LENGTH) continue;
    if (!withinOneEdit(key, item.nameKey)) continue;
    if (found) return null;
    found = item;
  }
  return found;
}

/**
 * One line against the catalog.
 *
 * The tiers are tried strongest-evidence first, and each one is something the
 * app already trusts somewhere else: an exact key (the join itself), a
 * confirmed leading-word trim (`suggestShorterCatalogName`), a whole-word
 * prefix, the autocomplete's own ranking (`rankGrocerySuggestions`, which
 * carries plural tolerance), and finally a single character's difference.
 *
 * `byKey` is passed in rather than derived so the batch call below builds it
 * once for a recipe's worth of lines.
 */
function matchOne(
  name: string,
  items: readonly GroceryItem[],
  byKey: ReadonlyMap<string, GroceryItem>,
  now: Date
): IngredientCatalogMatch {
  const key = groceryNameKey(name);
  if (!key) return NO_MATCH;

  const exact = byKey.get(key);
  if (exact) return { kind: 'linked', item: exact, suggestedName: null, reason: null };

  const suggest = (item: GroceryItem, reason: IngredientMatchReason): IngredientCatalogMatch => ({
    kind: 'suggested',
    item,
    suggestedName: item.name,
    reason,
  });

  const shorter = suggestShorterCatalogName(name, new Set(byKey.keys()));
  if (shorter) {
    const item = byKey.get(groceryNameKey(shorter));
    if (item) return suggest(item, 'shorter');
  }

  const prefix = longestPrefixItem(key, items);
  if (prefix) return suggest(prefix, 'prefix');

  const ranked = rankGrocerySuggestions(name, items, now, 1)[0];
  if (ranked) return suggest(ranked.item, 'ranked');

  const similar = uniqueSimilarItem(key, items);
  if (similar) return suggest(similar, 'similar');

  return NO_MATCH;
}

/** One ingredient line against the catalog. See `matchOne`. */
export function matchIngredientToCatalog(
  name: string,
  items: readonly GroceryItem[],
  now: Date
): IngredientCatalogMatch {
  return matchOne(name, items, indexByKey(items), now);
}

function indexByKey(items: readonly GroceryItem[]): Map<string, GroceryItem> {
  const byKey = new Map<string, GroceryItem>();
  // First wins, so a catalog that somehow holds two rows with one key resolves
  // the same way `catalogItem`'s own `.find` always has.
  for (const item of items) if (!byKey.has(item.nameKey)) byKey.set(item.nameKey, item);
  return byKey;
}

/**
 * A recipe's worth of lines in one pass, in the order given.
 *
 * The key index is built once here rather than per line — a recipe of thirty
 * ingredients against a catalog of several hundred rows is a screenful of
 * badges, computed on every render of the ingredient list.
 */
export function matchIngredientsToCatalog(
  names: readonly string[],
  items: readonly GroceryItem[],
  now: Date
): IngredientCatalogMatch[] {
  const byKey = indexByKey(items);
  return names.map(name => matchOne(name, items, byKey, now));
}

export interface CatalogMatchSummary {
  total: number;
  linked: number;
  suggested: number;
  unknown: number;
}

/**
 * The counts a header line reads out ("12 ingredients · 9 in your groceries").
 *
 * Separate from the matches themselves because the summary is what makes the
 * bridge visible *without* a glyph on every row: the per-line badge is reserved
 * for lines with something to act on, so the count is the only place a recipe
 * that is entirely, healthily matched says so.
 */
export function catalogMatchSummary(
  matches: readonly IngredientCatalogMatch[]
): CatalogMatchSummary {
  let linked = 0;
  let suggested = 0;
  for (const match of matches) {
    if (match.kind === 'linked') linked++;
    else if (match.kind === 'suggested') suggested++;
  }
  return {
    total: matches.length,
    linked,
    suggested,
    unknown: matches.length - linked - suggested,
  };
}
