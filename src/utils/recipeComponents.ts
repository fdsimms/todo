import type { Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { generateId } from './id';

/**
 * Composed recipes: one recipe used as a part of another.
 *
 * Everything that walks the component graph lives here — parsing the stored
 * links, resolving them, flattening a recipe down to everything it actually
 * takes to shop for and prep, and refusing a link that would make a loop.
 * Pure and store-free so jest can reach it under the node env, same as
 * recipeUtils and mealPlanGroceries.
 *
 * Its own module rather than more of recipeUtils.ts for one concrete reason:
 * mealPlanGroceries.ts needs the flattener and recipeUtils.ts already imports
 * *from* mealPlanGroceries, so putting it there would close a cycle. It also
 * happens to be the right seam — this is the composition graph, not recipe
 * text handling.
 *
 * The shape deliberately mirrors the nested-template helpers in
 * templateUtils.ts (reachable ids → cycle check → recursive expansion →
 * broken-reference detection), because it is the same problem and the app
 * should not grow two different answers to it. The one deliberate divergence
 * is the visited set — see flattenRecipeIngredients.
 */

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version — same as parseRecipeIngredients. */
export function parseRecipeComponents(raw: unknown): RecipeComponent[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: RecipeComponent[] = [];
  const seen = new Set<string>();
  for (const row of parsed) {
    const component = normalizeComponent(row);
    if (!component) continue;
    // One link per target. A blob carrying the same recipe twice would double
    // its ingredients' quantities on the shopping pass, and addComponent
    // already refuses it — this is the same rule enforced on the way in.
    if (seen.has(component.recipeId)) continue;
    seen.add(component.recipeId);
    out.push(component);
  }
  return out;
}

/**
 * Repairs one stored component link. Returns null for a row with no target —
 * a link pointing at nothing can't be resolved, can't be flattened and can't
 * be repaired into one, so dropping it beats rendering a blank row forever
 * (same call normalizeIngredient makes for a nameless ingredient).
 *
 * An empty `name` is fine and stays empty: it's only ever read when the target
 * has gone, and callers fall back to a generic label rather than to a lie.
 */
export function normalizeComponent(raw: unknown): RecipeComponent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipeComponent>;
  const recipeId = typeof r.recipeId === 'string' ? r.recipeId.trim() : '';
  if (!recipeId) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    recipeId,
    name: typeof r.name === 'string' ? r.name.trim().slice(0, RECIPE_NAME_MAX_LENGTH) : '',
  };
}

/** A new link to `target`, with its name captured for the day the target stops resolving. */
export function makeComponent(target: Recipe): RecipeComponent {
  return { id: generateId(), recipeId: target.id, name: target.name };
}

/** The id → recipe map every walker here takes. Callers holding the store's array build one once. */
export function recipeMap(recipes: readonly Recipe[]): Map<string, Recipe> {
  return new Map(recipes.map(r => [r.id, r]));
}

/** One component link with whatever it currently resolves to. */
export interface ResolvedComponent {
  component: RecipeComponent;
  /** Null once the referenced recipe is gone — the row still renders, as broken. */
  recipe: Recipe | null;
  /**
   * What to call it: the live recipe's own name while it resolves, so a rename
   * shows up in every parent immediately; the captured name once it doesn't.
   */
  name: string;
}

/** A recipe's direct components, in order, resolved against the library. */
export function resolveComponents(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): ResolvedComponent[] {
  return recipe.components.map(component => {
    const target = recipesById.get(component.recipeId) ?? null;
    return {
      component,
      recipe: target,
      name: target?.name ?? component.name,
    };
  });
}

/** One ingredient line, plus which recipe in the tree actually carries it. */
export interface FlatIngredient {
  ingredient: RecipeIngredient;
  /** The recipe the line is written on — the root itself, or a component at any depth. */
  recipe: Recipe;
  /** 0 for the root's own lines, 1 for a direct component's, and so on. */
  depth: number;
}

/**
 * Everything it takes to shop for `recipe`: its own ingredient lines, then
 * each component's, depth-first, in component order.
 *
 * **A recipe contributes its lines at most once per flatten**, which is the
 * one place this deliberately parts company with expandTemplateItems (whose
 * visited set is per-branch, so a template nested twice yields its tasks
 * twice). Two tasks are two things to do; two copies of "1 lb potatoes" are
 * not two purchases — classifyPlanned would merge them into "2 lb" and quietly
 * double the shop. A component graph here is a set of parts, not a bill of
 * materials with multiplicities.
 *
 * A component that no longer resolves contributes nothing, as does one already
 * visited (which is also what makes a cycle safe rather than fatal, even though
 * addComponent refuses to create one).
 */
export function flattenRecipeIngredients(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): FlatIngredient[] {
  const out: FlatIngredient[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, node => {
    for (const ingredient of node.recipe.ingredients) {
      out.push({ ingredient, recipe: node.recipe, depth: node.depth });
    }
  });
  return out;
}

/** One prep step, plus which recipe in the tree carries it. */
export interface FlatPrepTask {
  prepTask: RecipePrepTask;
  recipe: Recipe;
  depth: number;
}

/**
 * Every prep step a composed recipe implies, same walk and same
 * once-per-recipe rule as the ingredients.
 *
 * A component's prep steps come along for the same reason its ingredients do:
 * "boil the potatoes the night before" is a fact about the mash, and planning
 * the dish that contains the mash is exactly when it needs doing. The offsets
 * are already relative to the meal (see RecipePrepTask.offsetDays), so a
 * component's step needs no re-anchoring — it resolves against the same date.
 */
export function flattenRecipePrepTasks(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): FlatPrepTask[] {
  const out: FlatPrepTask[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, node => {
    for (const prepTask of node.recipe.prepTasks) {
      out.push({ prepTask, recipe: node.recipe, depth: node.depth });
    }
  });
  return out;
}

/** Depth-first over the component tree, root first, each recipe visited once. */
function walk(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  visited: Set<string>,
  depth: number,
  visit: (node: { recipe: Recipe; depth: number }) => void,
): void {
  visit({ recipe, depth });
  for (const component of recipe.components) {
    if (visited.has(component.recipeId)) continue;
    const target = recipesById.get(component.recipeId);
    if (!target) continue;
    visited.add(component.recipeId);
    walk(target, recipesById, visited, depth + 1, visit);
  }
}

/**
 * Every recipe id reachable from `recipeId` by following component links, not
 * including `recipeId` itself unless it's part of a cycle. Mirrors
 * reachableTemplateIds.
 */
export function reachableRecipeIds(
  recipesById: ReadonlyMap<string, Recipe>,
  recipeId: string,
): Set<string> {
  const result = new Set<string>();
  const stack = [recipeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = recipesById.get(stack.pop()!);
    if (!current) continue;
    for (const component of current.components) {
      if (seen.has(component.recipeId)) continue;
      seen.add(component.recipeId);
      result.add(component.recipeId);
      stack.push(component.recipeId);
    }
  }
  return result;
}

/** True if making `candidateId` a component of `parentId` would create a loop. */
export function wouldCreateRecipeCycle(
  recipesById: ReadonlyMap<string, Recipe>,
  parentId: string,
  candidateId: string,
): boolean {
  if (parentId === candidateId) return true;
  return reachableRecipeIds(recipesById, candidateId).has(parentId);
}

/** Recipes that use `targetId` as a direct component — what a delete is about to break. */
export function recipesUsing(recipes: readonly Recipe[], targetId: string): Recipe[] {
  return recipes.filter(r => r.components.some(c => c.recipeId === targetId));
}

/**
 * "2 components" / "1 component" — the clause describeRecipe appends, kept
 * here so the wording of a composed recipe lives with the rest of the feature.
 * Empty for a recipe that isn't composed.
 */
export function describeComponents(recipe: Recipe): string {
  const count = recipe.components.length;
  if (count === 0) return '';
  return count === 1 ? '1 component' : `${count} components`;
}
