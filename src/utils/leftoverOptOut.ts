import { groceryNameKey } from './groceryParse';

/**
 * Meals the "Anything left over?" question is switched off for.
 *
 * A recipe is remembered by its id, so renaming it keeps the answer. A meal with
 * no recipe ("Protein shake") has nothing to hang a flag on, so it is
 * remembered by its title, compared the way recipe names are (`groceryNameKey`, the key under
 * `recipeNameKey`, which can't be imported here without pulling in the app).
 * Both live in one list of strings in settings (`leftoverPromptOptOuts`), the
 * same shape as the other small preference lists, rather than a column on
 * `recipes` that every sync, backup and MCP field list would then have to know.
 *
 * Only the Leftovers row of the post-cook sheet reads this. The rest of that
 * sheet (cooked weight, what was used up, restock) is unaffected, and so is
 * logging leftovers by hand from a meal's own sheet.
 */
export function leftoverOptOutKey(recipeId: string | null, title: string): string | null {
  if (recipeId) return `recipe:${recipeId}`;
  const clean = title.trim();
  const key = groceryNameKey(clean) || clean.toLowerCase();
  return key ? `title:${key}` : null;
}

export function isLeftoverOptedOut(
  optOuts: readonly string[],
  recipeId: string | null,
  title: string
): boolean {
  const key = leftoverOptOutKey(recipeId, title);
  return key !== null && optOuts.includes(key);
}

export function addLeftoverOptOut(
  optOuts: readonly string[],
  recipeId: string | null,
  title: string
): string[] {
  const key = leftoverOptOutKey(recipeId, title);
  if (key === null || optOuts.includes(key)) return [...optOuts];
  return [...optOuts, key];
}

export function parseLeftoverOptOuts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string' && k.length > 0);
  } catch {
    return [];
  }
}

export function serializeLeftoverOptOuts(optOuts: readonly string[]): string {
  return JSON.stringify(optOuts);
}
