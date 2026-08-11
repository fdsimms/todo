import type { Recipe } from '../types';
import { RECIPE_TAG_MAX_LENGTH } from '../types';

/**
 * Free-form recipe labels — "vegetarian", "weeknight", "thai" — and the filter
 * built on them. See the note on `Recipe.tags` for why these have no registry
 * the way `Task.tags` does.
 *
 * A tag *is* its name: it's stored on the row, matched by string, and rendered
 * as a chip. So every tag entering the app goes through `cleanRecipeTag` and
 * every list through `normalizeRecipeTags`, exactly the way an ingredient's
 * `nameKey` is derived rather than passed in — otherwise "Thai", "thai " and
 * "thai" are three chips in the filter row for one idea, and filtering by one
 * hides the recipes carrying the others.
 */

/**
 * The one place a tag's stored spelling is decided: trimmed, inner whitespace
 * collapsed, lowercased, capped. Empty (never null) for anything that isn't a
 * usable tag, so callers can test it with a plain falsy check.
 *
 * Lowercase rather than title case because these are matched, not displayed as
 * written — the chip styling is what makes them read as labels, and a stored
 * capital would make "Thai" and "thai" different tags for good.
 */
export function cleanRecipeTag(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, RECIPE_TAG_MAX_LENGTH)
    .trim();
}

/**
 * A whole list, cleaned and de-duplicated, keeping first-seen order — the order
 * the cook added them in is the order they read in, so this never sorts.
 *
 * Takes `unknown` rather than `string[]` on the same "a restored backup can
 * carry anything" grounds as `normalizeIngredient`: anything that isn't a
 * usable string is dropped rather than thrown over.
 */
export function normalizeRecipeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const tag = cleanRecipeTag(entry);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version. */
export function parseRecipeTags(raw: unknown): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  return normalizeRecipeTags(parsed);
}

/**
 * Every tag in the box, alphabetical — the filter row's vocabulary and the
 * editor's suggestions. Derived from the recipes rather than a stored list (see
 * `Recipe.tags`), so a tag lifted off the last recipe carrying it stops being
 * offered, and nothing has to clean up after a rename.
 */
export function allRecipeTags(recipes: readonly Recipe[]): string[] {
  const seen = new Set<string>();
  for (const recipe of recipes) {
    for (const tag of recipe.tags) seen.add(tag);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** How many recipes carry each tag — the counts beside the filter chips. */
export function recipeTagCounts(recipes: readonly Recipe[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    // A recipe's own list is already de-duplicated (normalizeRecipeTags), so a
    // recipe can only ever count once towards a tag.
    for (const tag of recipe.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/**
 * The recipes carrying **every** selected tag. Empty selection means no filter
 * — the whole list back, not nothing.
 *
 * AND rather than OR, and that's the whole design of the filter row: each tap
 * narrows. Under OR a second tap would *widen* the results, which makes the
 * first tap pointless — you'd be adding recipes you just said you didn't want.
 * "vegetarian + quick" is the question a two-tag filter is asked to answer.
 */
export function filterRecipesByTags(
  recipes: readonly Recipe[],
  selected: readonly string[]
): Recipe[] {
  const wanted = normalizeRecipeTags(selected);
  if (wanted.length === 0) return [...recipes];
  return recipes.filter(recipe => {
    const has = new Set(recipe.tags);
    return wanted.every(tag => has.has(tag));
  });
}

/**
 * "“vegetarian”" / "“vegetarian” and “quick”" / "“a”, “b” and “c”" — the tags
 * currently narrowing the box, named in the empty state. Quoted because a tag
 * is free text and can be several words ("make ahead"), which an unquoted list
 * would run together with the sentence around it.
 */
export function formatTagList(tags: readonly string[]): string {
  const quoted = tags.map(tag => `“${tag}”`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * Adds a tag to a recipe's list, or takes it back out — the chip tap, in both
 * the editor and (against the selection) the filter row. Cleans what it's
 * given, so a tag typed into the editor's field and one tapped from the
 * suggestions land under the same spelling; a name that cleans to nothing is a
 * no-op rather than an empty chip.
 */
export function toggleRecipeTag(tags: readonly string[], raw: string): string[] {
  const tag = cleanRecipeTag(raw);
  if (!tag) return [...tags];
  return tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
}
