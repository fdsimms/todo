import type { Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';
import { RECIPE_CHOICE_GROUP_MAX_LENGTH, RECIPE_NAME_MAX_LENGTH } from '../types';
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
 *
 * **Alternatives (choice groups) are resolved here, at read time, and are
 * never written back onto the recipe.** A group is a set of components sharing
 * a `choiceGroup` label, of which exactly one is cooked; which one is a fact
 * about a *meal*, so the pick is stored on MealPlanEntry.componentChoices and
 * arrives here as a `ComponentResolution`. Passing none resolves every group to
 * its default, which is what every caller that predates this does implicitly —
 * so an unresolved read is always a complete, cookable dish rather than a
 * partial one.
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
  // An all-whitespace group label is no label: it would render as an empty
  // heading over its options and, being a distinct string from null, would
  // silently make them alternatives of each other.
  const choiceGroup = typeof r.choiceGroup === 'string'
    ? r.choiceGroup.trim().slice(0, RECIPE_CHOICE_GROUP_MAX_LENGTH)
    : '';
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    recipeId,
    name: typeof r.name === 'string' ? r.name.trim().slice(0, RECIPE_NAME_MAX_LENGTH) : '',
    choiceGroup: choiceGroup || null,
  };
}

/**
 * The chosen link ids stored on a meal plan entry. Tolerates a null column or a
 * corrupt blob exactly as parseRecipeComponents does, and drops anything that
 * isn't a non-empty string — an id that names no link is harmless (its group
 * falls back to the default), but a number or an object in the list would only
 * ever be a miss with a confusing shape.
 */
export function parseComponentChoices(raw: unknown): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const id of parsed) {
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** A new link to `target`, with its name captured for the day the target stops resolving. */
export function makeComponent(target: Recipe, choiceGroup: string | null = null): RecipeComponent {
  return { id: generateId(), recipeId: target.id, name: target.name, choiceGroup };
}

/**
 * Which alternative wins in each choice group, for one read of the graph.
 *
 * The empty resolution is the meaningful default — every group falls back to
 * its first option — so a caller with no opinion (recipe detail, the pantry
 * scorer, an old test) gets one complete dish rather than having to know this
 * exists.
 */
export interface ComponentResolution {
  /** Chosen component *link* ids — MealPlanEntry.componentChoices, verbatim. */
  chosen?: readonly string[];
  /**
   * Every alternative contributes, as though nothing were a choice.
   *
   * **Search only** (see rankRecipes). Filtering here would hide a recipe from
   * a search for an ingredient it genuinely calls for, just because that
   * ingredient sits on the road not taken — and a search result is a suggestion
   * to look, not a shopping list. Every read that turns into a *purchase* or a
   * *task* must leave this off, or the user buys both sides.
   */
  allOptions?: boolean;
}

/**
 * The components of one recipe that actually contribute under `resolution`:
 * every ungrouped component, plus one option per choice group.
 *
 * List order is preserved, so a resolved list reads exactly as the recipe is
 * written. The winner of a group is the first of its options named in `chosen`,
 * falling back to the first option in list order — which is what makes "the
 * default is the first one" true (see RecipeComponent.choiceGroup) and keeps
 * the result deterministic even if a stored list somehow names two options of
 * one group.
 */
export function activeComponents(
  recipe: Recipe,
  resolution?: ComponentResolution,
): RecipeComponent[] {
  if (resolution?.allOptions) return [...recipe.components];
  const groups = groupOptions(recipe);
  if (groups.size === 0) return [...recipe.components];
  const chosen = new Set(resolution?.chosen ?? []);
  const winners = new Set<string>();
  for (const options of groups.values()) {
    winners.add((options.find(o => chosen.has(o.id)) ?? options[0]).id);
  }
  return recipe.components.filter(c => !c.choiceGroup || winners.has(c.id));
}

/** label → its components, in list order. Empty for a recipe with no alternatives. */
function groupOptions(recipe: Recipe): Map<string, RecipeComponent[]> {
  const groups = new Map<string, RecipeComponent[]>();
  for (const component of recipe.components) {
    if (!component.choiceGroup) continue;
    const options = groups.get(component.choiceGroup);
    if (options) options.push(component);
    else groups.set(component.choiceGroup, [component]);
  }
  return groups;
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

/**
 * A recipe's direct components, in order, resolved against the library.
 *
 * **Every one of them, alternatives included** — this is the authoring read,
 * and a recipe that offers a choice has to show both options to be edited at
 * all. The shopping reads are the ones that resolve down to one (see
 * activeComponents).
 */
export function resolveComponents(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): ResolvedComponent[] {
  return recipe.components.map(component => resolveComponent(component, recipesById));
}

/** One link against the library. Unfiltered by any choice — see resolveComponents. */
function resolveComponent(
  component: RecipeComponent,
  recipesById: ReadonlyMap<string, Recipe>,
): ResolvedComponent {
  const target = recipesById.get(component.recipeId) ?? null;
  return { component, recipe: target, name: target?.name ?? component.name };
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
  resolution?: ComponentResolution,
): FlatIngredient[] {
  const out: FlatIngredient[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
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
  resolution?: ComponentResolution,
): FlatPrepTask[] {
  const out: FlatPrepTask[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    for (const prepTask of node.recipe.prepTasks) {
      out.push({ prepTask, recipe: node.recipe, depth: node.depth });
    }
  });
  return out;
}

/**
 * Depth-first over the component tree, root first, each recipe visited once,
 * descending only into the components `resolution` leaves standing.
 *
 * An unchosen alternative is not walked *at all*, rather than walked and
 * discarded, which is what keeps a choice inside a choice honest: the mash's
 * own "Topping" group is not a question anyone needs answered on a night the
 * roast potatoes won.
 */
function walk(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  visited: Set<string>,
  depth: number,
  resolution: ComponentResolution | undefined,
  visit: (node: { recipe: Recipe; depth: number }) => void,
): void {
  visit({ recipe, depth });
  for (const component of activeComponents(recipe, resolution)) {
    if (visited.has(component.recipeId)) continue;
    const target = recipesById.get(component.recipeId);
    if (!target) continue;
    visited.add(component.recipeId);
    walk(target, recipesById, visited, depth + 1, resolution, visit);
  }
}

/** One either/or slot: the label, its options, and which one is in force. */
export interface ComponentChoiceGroup {
  /** The recipe carrying the group — the root itself, or a component at any depth. */
  recipe: Recipe;
  /** The `choiceGroup` label the options share — "Side", "Starch". */
  label: string;
  /** The alternatives, in list order. The first is the group's default. */
  options: ResolvedComponent[];
  /** Whichever option the resolution selects: the chosen one, else the default. */
  active: ResolvedComponent;
}

/**
 * Every choice a meal of `recipe` actually poses, including groups carried by
 * its components at any depth.
 *
 * This is what the pickers render, and it's a *tree* read rather than a read of
 * `recipe.components` for the reason MealPlanEntry.componentChoices gives: the
 * question "mash or roast?" can be posed by a component two levels down, and
 * the entry pointing at the root still has to be able to answer it.
 *
 * Walked under the same resolution as the flatteners, so a group only appears
 * while the branch holding it is actually being cooked — answering a question
 * about the mash on a roast-potatoes night would be storing a pick that changes
 * nothing.
 */
export function componentChoiceGroups(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution?: ComponentResolution,
): ComponentChoiceGroup[] {
  const chosen = new Set(resolution?.chosen ?? []);
  const out: ComponentChoiceGroup[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    for (const [label, components] of groupOptions(node.recipe)) {
      const options = components.map(component => resolveComponent(component, recipesById));
      const active = options.find(o => chosen.has(o.component.id)) ?? options[0];
      out.push({ recipe: node.recipe, label, options, active });
    }
  });
  return out;
}

/**
 * `choices` with `componentId` picked for its group — the one write path for a
 * pick, so no caller has to remember that a group holds exactly one answer.
 *
 * Every other option of the same group is dropped, and picking the group's
 * default drops the entry's answer entirely rather than storing it: an explicit
 * "the usual one" and no answer at all resolve identically, and the shorter
 * list is the one that keeps following the recipe if its default is later
 * reordered.
 */
export function applyComponentChoice(
  choices: readonly string[],
  group: ComponentChoiceGroup,
  componentId: string,
): string[] {
  const optionIds = new Set(group.options.map(o => o.component.id));
  const rest = choices.filter(id => !optionIds.has(id));
  const isDefault = group.options[0]?.component.id === componentId;
  return isDefault || !optionIds.has(componentId) ? rest : [...rest, componentId];
}

/**
 * Every recipe id reachable from `recipeId` by following component links, not
 * including `recipeId` itself unless it's part of a cycle. Mirrors
 * reachableTemplateIds.
 *
 * **Deliberately ignores choice groups and walks every alternative.** A loop
 * hiding down an unchosen branch is still a loop, and it would become a live
 * one the moment someone picked that option — so the cycle check this feeds has
 * to see the whole graph, not tonight's slice of it.
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
 *
 * **A choice group counts once, not once per option.** The number has to agree
 * with what a meal of this recipe actually involves, and "mash or roast" is one
 * side dish however many ways it can be made — the same reason the clause
 * exists at all, which is to stop a count reading as more of a shop than it is.
 */
export function describeComponents(recipe: Recipe): string {
  const groups = new Set<string>();
  let count = 0;
  for (const component of recipe.components) {
    if (!component.choiceGroup) count += 1;
    else if (!groups.has(component.choiceGroup)) { groups.add(component.choiceGroup); count += 1; }
  }
  if (count === 0) return '';
  return count === 1 ? '1 component' : `${count} components`;
}
