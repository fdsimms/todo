import type { Recipe, RecipeOverride } from '../types';
import {
  activeComponents,
  activeIngredients,
  cookedDishes,
  type ChoiceResolution,
} from './recipeComponents';
import { makeIngredient } from './recipeUtils';

/**
 * Editing a planned meal's one-off replacements (`MealPlanEntry.recipeOverrides`)
 * from the app: which lines the meal could replace, and building and removing an
 * override. Pure, so the sheet is only a form over it. How an override resolves
 * is `recipeComponents.ts`'s; this is only how one is made.
 */

/** How long the note beside a replacement may be. A sentence, not prose. */
export const OVERRIDE_NOTE_MAX_LENGTH = 120;

/** One thing a meal could replace: a line of its recipe, or a recipe used inside it. */
export interface OverrideTarget {
  id: string;
  /** "2 cups broth" for a line, the used recipe's name for a dish. */
  label: string;
  kind: 'line' | 'dish';
  /** The used recipe a line sits in; null for the meal's own recipe, so its lines read bare. */
  recipeName: string | null;
  /** Whether this meal already replaces it, so the sheet can say so. */
  replaced: boolean;
}

/**
 * Everything a meal of `recipe` cooks that it could replace, in the order the
 * ingredients are shopped for: each cooked recipe's picked lines, then the used
 * recipes it picked. Read under the meal's picks, so the side it did not choose
 * is not offered, and a used recipe the meal already replaced drops its own
 * lines from the list but stays listed itself (so it can be changed back).
 */
export function overrideTargets(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution: ChoiceResolution,
): OverrideTarget[] {
  // The picks without the replacements: whether a line is replaced is a label
  // on the target, not a reason to hide it.
  const bare: ChoiceResolution = { ...resolution, overrides: undefined };
  const replacedIds = new Set((resolution.overrides ?? []).map(o => o.targetId));
  const out: OverrideTarget[] = [];
  for (const dish of cookedDishes(recipe, recipesById, resolution)) {
    const recipeName = dish.whole ? null : dish.recipe.name;
    for (const line of activeIngredients(dish.recipe, bare)) {
      out.push({
        id: line.id,
        label: [line.quantity, line.name].filter(Boolean).join(' '),
        kind: 'line',
        recipeName,
        replaced: replacedIds.has(line.id),
      });
    }
    for (const link of activeComponents(dish.recipe, bare)) {
      out.push({
        id: link.id,
        label: recipesById.get(link.recipeId)?.name ?? link.name,
        kind: 'dish',
        recipeName,
        replaced: replacedIds.has(link.id),
      });
    }
  }
  return out;
}

/**
 * The override a form describes: this line replaced by `text` as an ingredient
 * is printed ("8 oz vegan fish fillets"), or left out. Null when `replace` has
 * nothing readable to replace it with, which the form treats as not yet savable.
 */
export function overrideFromInput(
  targetId: string,
  input: { mode: 'replace' | 'omit'; text: string; note: string },
): RecipeOverride | null {
  const note = input.note.trim().slice(0, OVERRIDE_NOTE_MAX_LENGTH);
  if (input.mode === 'omit') return { targetId, replacement: null, ...(note ? { note } : {}) };
  const made = makeIngredient(input.text);
  if (!made) return null;
  return { targetId, replacement: made, ...(note ? { note } : {}) };
}

/** `list` with `override` in it, taking the place of any earlier one for the same target. */
export function withOverride(list: readonly RecipeOverride[], override: RecipeOverride): RecipeOverride[] {
  return [...list.filter(o => o.targetId !== override.targetId), override];
}

/** `list` without the override for `targetId`. */
export function withoutOverride(list: readonly RecipeOverride[], targetId: string): RecipeOverride[] {
  return list.filter(o => o.targetId !== targetId);
}
