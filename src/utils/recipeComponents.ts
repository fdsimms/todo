import type { Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';
import { RECIPE_CHOICE_GROUP_MAX_LENGTH, RECIPE_NAME_MAX_LENGTH } from '../types';
import { generateId } from './id';
import { applyStandingSwap, NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';

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
 * about a *meal*, so the pick is stored on MealPlanEntry.recipeChoices and
 * arrives here as a `ChoiceResolution`. Passing none resolves every group to
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
 * The chosen ids stored on a meal plan entry. Tolerates a null column or a
 * corrupt blob exactly as parseRecipeComponents does, and drops anything that
 * isn't a non-empty string — an id that names nothing is harmless (its group
 * falls back to the default), but a number or an object in the list would only
 * ever be a miss with a confusing shape.
 */
export function parseRecipeChoices(raw: unknown): string[] {
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
export interface ChoiceResolution {
  /**
   * Chosen ids — MealPlanEntry.recipeChoices, verbatim. Names component links
   * and ingredient lines alike; each is looked up only against the list it
   * could have come from, so the two can't collide.
   */
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
  /**
   * Ingredient groups whose options should *all* come through, named by
   * `choiceGroupKey` — "I'll decide which pepper when I'm standing in front of
   * them".
   *
   * Narrower than `allOptions` in two ways that are the whole point. It names
   * groups one at a time rather than switching the rule off wholesale, and it
   * **only ever affects ingredients**: an ingredient names a row you can put in
   * a trolley, so its options map exactly onto `GroceryItem.choiceGroup`, which
   * already resolves destructively at the shelf. A *component* names a dish, and
   * "mash or roast" undecided would mean two dishes' worth of lines on the list
   * with nothing that could ever take one set back off. So `activeComponents`
   * ignores this and the picker only offers it on ingredient groups.
   *
   * Every reader that turns a recipe into *tasks* leaves it unset, for the same
   * reason `allOptions` does — a prep step for the road not taken is a task
   * nobody asked for.
   */
  undecided?: readonly string[];
}

/**
 * Names one either/or slot across a plan — the recipe whose list holds the
 * group, plus the label. Scoped by recipe because two recipes in one week can
 * both call their group "Cheese" while posing entirely different questions.
 */
export function choiceGroupKey(recipeId: string, label: string): string {
  return `${recipeId}:${label}`;
}

/** Anything that can be an either/or option: it has an id and a group label. */
interface Groupable {
  id: string;
  choiceGroup: string | null;
}

/**
 * The rows of `list` that actually contribute under `resolution`: every
 * ungrouped row, plus one option per choice group.
 *
 * List order is preserved, so a resolved list reads exactly as the recipe is
 * written. The winner of a group is the first of its options named in `chosen`,
 * falling back to the first option in list order — which is what makes "the
 * default is the first one" true (see RecipeComponent.choiceGroup) and keeps
 * the result deterministic even if a stored list somehow names two options of
 * one group.
 *
 * Generic over components and ingredients because the rule is genuinely the
 * same one, and having written it twice is how they'd drift apart. It stays a
 * shared *function* rather than a shared type — see RecipeIngredient.choiceGroup
 * for why a dish and a shopping line don't belong in one list.
 */
function activeIn<T extends Groupable>(
  list: readonly T[],
  resolution?: ChoiceResolution,
  /** Labels within `list` left open — see ChoiceResolution.undecided. */
  undecided?: ReadonlySet<string>,
): T[] {
  if (resolution?.allOptions) return [...list];
  const groups = groupOptions(list);
  if (groups.size === 0) return [...list];
  const chosen = new Set(resolution?.chosen ?? []);
  const winners = new Set<string>();
  for (const [label, options] of groups) {
    if (undecided?.has(label)) {
      for (const option of options) winners.add(option.id);
      continue;
    }
    winners.add((options.find(o => chosen.has(o.id)) ?? options[0]).id);
  }
  return list.filter(row => !row.choiceGroup || winners.has(row.id));
}

/** The labels of `recipe`'s own ingredient groups the resolution leaves open. */
function undecidedLabelsOf(recipe: Recipe, resolution?: ChoiceResolution): Set<string> | undefined {
  if (!resolution?.undecided?.length) return undefined;
  const keys = new Set(resolution.undecided);
  const labels = new Set<string>();
  for (const ingredient of recipe.ingredients) {
    if (ingredient.choiceGroup && keys.has(choiceGroupKey(recipe.id, ingredient.choiceGroup))) {
      labels.add(ingredient.choiceGroup);
    }
  }
  return labels.size > 0 ? labels : undefined;
}

/** The components a meal of `recipe` actually cooks under `resolution`. */
export function activeComponents(
  recipe: Recipe,
  resolution?: ChoiceResolution,
): RecipeComponent[] {
  return activeIn(recipe.components, resolution);
}

/**
 * The ingredient lines a meal of `recipe` actually buys under `resolution` —
 * "serrano" or "jalapeño", never both, and never the string "serrano or
 * jalapeño".
 *
 * Every shopping read reaches this through flattenRecipeIngredients rather than
 * calling it directly; it's exported for the authoring surfaces that need to
 * know what one *meal* of a recipe looks like without flattening the tree.
 */
export function activeIngredients(
  recipe: Recipe,
  resolution?: ChoiceResolution,
): RecipeIngredient[] {
  return activeIn(recipe.ingredients, resolution, undecidedLabelsOf(recipe, resolution));
}

/** label → its rows, in list order. Empty for a list with no alternatives. */
function groupOptions<T extends Groupable>(list: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of list) {
    if (!row.choiceGroup) continue;
    const options = groups.get(row.choiceGroup);
    if (options) options.push(row);
    else groups.set(row.choiceGroup, [row]);
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
  /**
   * The recipe's own name for this line when a standing swap rewrote it (see
   * standingSwaps.ts) — null for every line that wasn't swapped, which is
   * every line for a caller that passes no rules.
   *
   * Optional so a hand-built fixture doesn't have to say "not swapped"; the
   * walk itself always sets it.
   */
  swappedFrom?: string | null;
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
  resolution?: ChoiceResolution,
  /**
   * The user's standing swaps, applied on the way out — "always use oat milk
   * for milk" (#1571). This is the one gate every shopping read already goes
   * through, which is why the rule is resolved here rather than at each of
   * them; a caller passing none reads the recipe's own words, which is what
   * every authoring and search read wants.
   *
   * In particular `rankRecipes` passes none (with `allOptions`), so a recipe
   * stays findable by the ingredient it is actually written with — a swap
   * changes what you buy, not what the recipe says.
   */
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): FlatIngredient[] {
  const out: FlatIngredient[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    // Resolved, not raw: an either/or line contributes whichever pepper this
    // meal picked. Ungrouped lines are every line, so a recipe with no
    // alternatives flattens exactly as it always did.
    for (const line of activeIngredients(node.recipe, resolution)) {
      // Swapped after the choice is resolved, never before: an option the
      // user isn't cooking has nothing to be swapped into.
      const { ingredient, swappedFrom } = applyStandingSwap(line, swaps);
      out.push({ ingredient, recipe: node.recipe, depth: node.depth, swappedFrom });
    }
  });
  return out;
}

/**
 * Every recipe whose shopping list actually calls for this catalog item —
 * the reverse of the bridge `nameKey` already gives ingredients into the
 * catalog. Reads through `flattenRecipeIngredients` rather than a recipe's
 * own `ingredients` array, so a recipe that only calls for something via a
 * component (the mash inside "steak with mash") still counts — every other
 * shopping read in the app already makes this same choice, and reading raw
 * `ingredients` here would be the one place that quietly disagreed.
 *
 * A full scan of the library rather than an index kept in step with every
 * edit: this runs once per `GroceryItemSheet` open, not per keystroke, and
 * `rankRecipes`/`suggestRecipesForEmptyNight` already make the same trade for
 * reads at the same frequency.
 */
export function recipesUsingIngredient(nameKey: string, recipes: readonly Recipe[]): Recipe[] {
  if (!nameKey) return [];
  const byId = recipeMap(recipes);
  return recipes.filter(r =>
    flattenRecipeIngredients(r, byId).some(f => f.ingredient.nameKey === nameKey)
  );
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
  resolution?: ChoiceResolution,
): FlatPrepTask[] {
  const out: FlatPrepTask[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    for (const prepTask of node.recipe.prepTasks) {
      out.push({ prepTask, recipe: node.recipe, depth: node.depth });
    }
  });
  return out;
}

/** One dish a cooking of a composed recipe actually puts on the table. */
export interface CookedDish {
  /** The recipe it is — the root itself, or a component at any depth. */
  recipe: Recipe;
  /** True for the root only: the meal as a whole rather than one of its parts. */
  whole: boolean;
}

/**
 * Every distinct dish one cooking of `recipe` produces: the meal itself first,
 * then each component it is actually cooking, depth-first, once each.
 *
 * The same walk the flatteners take, stopped one level up — they want the lines
 * *inside* each node, this wants the nodes. It exists because a component is a
 * dish in its own right the moment the cooking is over: the mash is what's left
 * in the fridge on a night the steak went (#1322), so "what did this meal
 * produce" is a real question with a different answer to "what does it cost to
 * shop for".
 *
 * **Resolved, like every other read that turns into a row.** A component on the
 * road not taken was never cooked, so it cannot be in the fridge — passing the
 * entry's `recipeChoices` is what keeps a roast-potatoes night from offering to
 * log leftover mash.
 *
 * A component whose recipe has been deleted contributes nothing, exactly as it
 * contributes no ingredients: `walk` can't descend into a dish it can't read,
 * and a part the library no longer knows about is one the user can still log by
 * hand under any name they like.
 */
export function cookedDishes(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution?: ChoiceResolution,
): CookedDish[] {
  const out: CookedDish[] = [];
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    out.push({ recipe: node.recipe, whole: node.depth === 0 });
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
  resolution: ChoiceResolution | undefined,
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

/** One option of a choice group, flattened to what a picker needs to draw it. */
export interface ChoiceOption {
  /** The component link id or the ingredient id — what goes in the chosen list. */
  id: string;
  /** What to call it: a live component's current name, or the ingredient's. */
  name: string;
  /** True for a component whose recipe is gone. Still pickable, contributes nothing. */
  broken: boolean;
}

/** One either/or slot: the label, its options, and which one is in force. */
/**
 * The active options across a meal's choice groups, for a row that has one
 * line to say them in — "Roast potatoes", or "Roast potatoes, Green beans".
 *
 * Names the *option*, not the group: "Roast potatoes" is what was cooked, and
 * "Side: roast potatoes" spends half a narrow caption on a label the answer
 * already implies. A meal with no groups gets an empty string and the caller
 * renders nothing rather than an empty separator.
 *
 * Deliberately not marked as chosen-vs-default. The row is saying what this
 * meal is, and a default nobody overrode is still what's being cooked — the
 * distinction only matters inside the picker, where the chips show it.
 */
export function describeChoices(groups: readonly ChoiceGroup[]): string {
  return groups
    .map(g => g.active.name.trim())
    .filter(Boolean)
    .join(', ');
}

export interface ChoiceGroup {
  /** The recipe carrying the group — the root itself, or a component at any depth. */
  recipe: Recipe;
  /** The `choiceGroup` label the options share — "Side", "Pepper". */
  label: string;
  /**
   * Which list the options came from. Pickers render both identically; this is
   * for a caller that needs to say "side" rather than "ingredient" in a label.
   */
  kind: 'component' | 'ingredient';
  /** The alternatives, in list order. The first is the group's default. */
  options: ChoiceOption[];
  /** Whichever option the resolution selects: the chosen one, else the default. */
  active: ChoiceOption;
}

/**
 * Every choice a meal of `recipe` actually poses — its own either/or
 * ingredients and components, plus those of every component it's cooking, at
 * any depth.
 *
 * This is what the pickers render, and it's a *tree* read rather than a read of
 * one recipe's own lists for the reason MealPlanEntry.recipeChoices gives: the
 * question "mash or roast?" can be posed by a component two levels down, and
 * the entry pointing at the root still has to be able to answer it.
 *
 * Walked under the same resolution as the flatteners, so a group only appears
 * while the branch holding it is actually being cooked — answering a question
 * about the mash on a roast-potatoes night would be storing a pick that changes
 * nothing.
 *
 * Components come before ingredients within one recipe, since "which side" is
 * the bigger decision than "which pepper" and reads better first.
 */
export function recipeChoiceGroups(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution?: ChoiceResolution,
): ChoiceGroup[] {
  const chosen = new Set(resolution?.chosen ?? []);
  const out: ChoiceGroup[] = [];
  const push = (node: Recipe, label: string, kind: ChoiceGroup['kind'], options: ChoiceOption[]) => {
    out.push({
      recipe: node,
      label,
      kind,
      options,
      active: options.find(o => chosen.has(o.id)) ?? options[0],
    });
  };
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    for (const [label, components] of groupOptions(node.recipe.components)) {
      push(node.recipe, label, 'component', components.map(component => {
        const resolved = resolveComponent(component, recipesById);
        return { id: component.id, name: resolved.name, broken: !resolved.recipe };
      }));
    }
    for (const [label, ingredients] of groupOptions(node.recipe.ingredients)) {
      push(node.recipe, label, 'ingredient',
        ingredients.map(ingredient => ({ id: ingredient.id, name: ingredient.name, broken: false })));
    }
  });
  return out;
}

/**
 * `choices` with `optionId` picked for its group — the one write path for a
 * pick, so no caller has to remember that a group holds exactly one answer.
 *
 * Every other option of the same group is dropped, and picking the group's
 * default drops the entry's answer entirely rather than storing it: an explicit
 * "the usual one" and no answer at all resolve identically, and the shorter
 * list is the one that keeps following the recipe if its default is later
 * reordered.
 */
export function applyChoice(
  choices: readonly string[],
  group: ChoiceGroup,
  optionId: string,
): string[] {
  const optionIds = new Set(group.options.map(o => o.id));
  const rest = choices.filter(id => !optionIds.has(id));
  const isDefault = group.options[0]?.id === optionId;
  return isDefault || !optionIds.has(optionId) ? rest : [...rest, optionId];
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
  const count = countChoiceAware(recipe.components);
  if (count === 0) return '';
  return count === 1 ? '1 component' : `${count} components`;
}

/**
 * Row id → "or manchego", for every row that is one option of a real choice —
 * the caption that stops a cook reading the list from buying both.
 *
 * Named siblings rather than a bare "or" badge, because a group's options need
 * not be adjacent (see the choice-header note in RecipeDetailScreen): a marker
 * that only says *that* a row is an alternative leaves you scanning the list for
 * what it's an alternative to. Naming them answers it in place.
 *
 * A group with one surviving option is not a choice and gets no caption — the
 * same rule splitIngredientAlternatives applies when it refuses to split.
 */
export function alternativeCaptions(
  rows: readonly (Groupable & { name: string })[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const options of groupOptions(rows).values()) {
    if (options.length < 2) continue;
    for (const row of options) {
      const others = options.filter(o => o.id !== row.id).map(o => o.name.trim() || 'unnamed');
      out.set(row.id, `or ${others.join(' or ')}`);
    }
  }
  return out;
}

/**
 * How many things a list actually amounts to for one meal: every ungrouped row,
 * plus one per choice group however many options it holds.
 *
 * Shared by describeComponents and describeRecipe's ingredient count, because
 * both are answering the same question — "how much is this dish" — and
 * "serrano or jalapeño" is one pepper, not two. Counting raw rows there would
 * inflate exactly the number the user reads to decide whether they have time to
 * cook it.
 */
export function countChoiceAware(rows: readonly Groupable[]): number {
  const groups = new Set<string>();
  let count = 0;
  for (const row of rows) {
    if (!row.choiceGroup) count += 1;
    else if (!groups.has(row.choiceGroup)) { groups.add(row.choiceGroup); count += 1; }
  }
  return count;
}
