import type { ComponentPlacement, MealPlanEntry, Recipe, RecipeComponent, RecipeIngredient, RecipeOverride, RecipePrepTask } from '../types';
import { GROCERY_QUANTITY_MAX_LENGTH, RECIPE_CHOICE_GROUP_MAX_LENGTH, RECIPE_NAME_MAX_LENGTH, RECIPE_SECTION_MAX_LENGTH } from '../types';
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
 * its default — so an unresolved read is always a complete, cookable dish
 * rather than a partial one.
 *
 * **The default itself prefers whatever's already on hand.**
 * `ChoiceResolution.onHand` names ingredient nameKeys the caller already has
 * in the pantry; an unresolved group with an on-hand ingredient among its
 * options resolves to that ingredient rather than to the first-listed
 * option, on the reasoning that "I have extra-firm tofu" is a stronger
 * signal about which dish you're actually cooking than the order the recipe
 * happened to list its alternatives in. It's computed by the caller from
 * live pantry state and never persisted, so it tracks the pantry rather than
 * freezing a pick — this module still reads no store of its own; the set
 * just rides along as data on `ChoiceResolution`, same as `chosen`. An
 * explicit `chosen` id always outranks it, and it can only ever promote an
 * *ingredient* — a component names a dish, not something that can be "on
 * hand" (see `ChoiceResolution.onHand`'s own doc for why that isn't a
 * loophole).
 *
 * **A label can be shared across the two lists** — an ingredient and a
 * component both carrying `choiceGroup: 'Rice'` resolve as one exclusive
 * either/or ("buy rice, or cook this component instead"), not two independent
 * ones that both land on the shopping list. `resolveGroupWinners` is the one
 * place that reads a label across both `recipe.ingredients` and
 * `recipe.components` together; everything downstream (`activeComponents`,
 * `activeIngredients`, `recipeChoiceGroups`) goes through it, the same
 * discipline `activeIn` used to keep the two per-type resolvers from drifting
 * apart. **Ingredients are tried before components** when nothing is chosen,
 * so pairing an existing ingredient with a new alternative component never
 * flips what the recipe already buys by default — an explicit pick in
 * `chosen` can still name either side, same as it always could.
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
  const placement = normalizePlacement(r.placement);
  const amountUsed = typeof r.amountUsed === 'string'
    ? r.amountUsed.trim().slice(0, GROCERY_QUANTITY_MAX_LENGTH)
    : '';
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    recipeId,
    name: typeof r.name === 'string' ? r.name.trim().slice(0, RECIPE_NAME_MAX_LENGTH) : '',
    choiceGroup: choiceGroup || null,
    ...(placement ? { placement } : {}),
    ...(amountUsed ? { amountUsed } : {}),
  };
}

/** A stored placement, or undefined for anything that isn't one (absent, not null, so an unplaced link round-trips unchanged). */
function normalizePlacement(raw: unknown): ComponentPlacement | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Partial<ComponentPlacement>;
  const before = typeof p.before === 'string' && p.before ? p.before : null;
  const section = typeof p.section === 'string'
    ? p.section.trim().slice(0, RECIPE_SECTION_MAX_LENGTH).trim()
    : '';
  return { before, section: section || null };
}

/**
 * Where a component sits among its parent's ingredients, or undefined when it
 * was never placed. Every reader of a placement goes through this rather than
 * `component.placement`.
 */
export function componentPlacement(component: RecipeComponent): ComponentPlacement | undefined {
  return component.placement;
}

/** One line of a recipe's ingredient list, with the parts placed among them — see `ingredientLayout`. */
export type LayoutItem =
  | { kind: 'ingredient'; ingredient: RecipeIngredient }
  | { kind: 'component'; component: RecipeComponent };

/**
 * A recipe's own ingredients with its components placed among them, in the
 * order the recipe page shows and every flatten reads.
 *
 * A component sits directly above the ingredient its placement names, so one
 * placed before the same line keeps component order. An unplaced component in
 * a choice group an ingredient also carries sits right after that group's last
 * ingredient, where the page has always drawn it ("buy rice, or cook this
 * instead"). Anything else with no usable placement (never placed, or anchored
 * to a line that is gone) goes after the last ingredient in component order,
 * which for a recipe with no placements at all is exactly the order the walk
 * always had.
 */
export function ingredientLayout(recipe: Recipe): LayoutItem[] {
  const ingredientIds = new Set(recipe.ingredients.map(i => i.id));
  const lastOfGroup = new Map<string, string>();
  for (const ingredient of recipe.ingredients) {
    if (ingredient.choiceGroup) lastOfGroup.set(ingredient.choiceGroup, ingredient.id);
  }
  const before = new Map<string, RecipeComponent[]>();
  const after = new Map<string, RecipeComponent[]>();
  const trailing: RecipeComponent[] = [];
  const push = (map: Map<string, RecipeComponent[]>, key: string, component: RecipeComponent) => {
    const list = map.get(key);
    if (list) list.push(component); else map.set(key, [component]);
  };
  for (const component of recipe.components) {
    const anchor = componentPlacement(component)?.before ?? null;
    const folded = !component.placement && component.choiceGroup
      ? lastOfGroup.get(component.choiceGroup)
      : undefined;
    if (anchor && ingredientIds.has(anchor)) push(before, anchor, component);
    else if (folded) push(after, folded, component);
    else trailing.push(component);
  }
  const out: LayoutItem[] = [];
  for (const ingredient of recipe.ingredients) {
    for (const component of before.get(ingredient.id) ?? []) out.push({ kind: 'component', component });
    out.push({ kind: 'ingredient', ingredient });
    for (const component of after.get(ingredient.id) ?? []) out.push({ kind: 'component', component });
  }
  for (const component of trailing) out.push({ kind: 'component', component });
  return out;
}

/**
 * `components` with the placement of any that sat above a removed ingredient
 * moved to the next line that survives (null when none does), so deleting the
 * line under a part leaves it where it was instead of sending it to the end.
 * `before` is the ingredient list as it stood; `removedIds` is what is going.
 */
export function reanchorComponents(
  components: readonly RecipeComponent[],
  before: readonly RecipeIngredient[],
  removedIds: ReadonlySet<string>,
): RecipeComponent[] {
  return components.map(component => {
    const placement = component.placement;
    if (!placement?.before || !removedIds.has(placement.before)) return component;
    const at = before.findIndex(i => i.id === placement.before);
    const next = before.slice(at + 1).find(i => !removedIds.has(i.id));
    return { ...component, placement: { ...placement, before: next?.id ?? null } };
  });
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

/**
 * The overrides stored on a meal plan entry (`MealPlanEntry.recipeOverrides`).
 * Tolerates a null column or a corrupt blob like `parseRecipeChoices`, and drops
 * a row with no target or a replacement with no name: one that names nothing
 * replaces nothing, but a nameless line would only ever shop for a blank.
 */
export function parseRecipeOverrides(raw: unknown): RecipeOverride[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: RecipeOverride[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<RecipeOverride> & { replacement?: unknown };
    const targetId = typeof r.targetId === 'string' ? r.targetId.trim() : '';
    if (!targetId || out.some(o => o.targetId === targetId)) continue;
    const note = typeof r.note === 'string' ? r.note.trim() : '';
    // A blank's fill (RecipeOverride.fill): the lines picked into it, each
    // repaired like a replacement. One whose lines all fail fills nothing, so
    // it is dropped rather than kept as an empty fill.
    if (Array.isArray(r.fill)) {
      const fill = r.fill.map(overrideLine).filter((l): l is RecipeIngredient => l !== null);
      if (fill.length > 0) out.push({ targetId, replacement: null, fill });
      continue;
    }
    if (r.replacement === null) {
      out.push({ targetId, replacement: null, ...(note ? { note } : {}) });
      continue;
    }
    const replacement = overrideLine(r.replacement);
    if (!replacement) continue;
    out.push({ targetId, replacement, ...(note ? { note } : {}) });
  }
  return out;
}

/** One stored replacement or fill line, repaired; null for one with no name, which would only shop for a blank. */
function overrideLine(raw: unknown): RecipeIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const rep = raw as Partial<RecipeIngredient>;
  const name = typeof rep.name === 'string' ? rep.name.trim() : '';
  if (!name) return null;
  return {
    ...(rep as RecipeIngredient),
    id: typeof rep.id === 'string' && rep.id ? rep.id : generateId(),
    name,
    nameKey: typeof rep.nameKey === 'string' && rep.nameKey ? rep.nameKey : name.toLowerCase(),
    quantity: typeof rep.quantity === 'string' ? rep.quantity : '',
    aisle: typeof rep.aisle === 'string' ? rep.aisle : null,
    prep: typeof rep.prep === 'string' ? rep.prep : null,
    purpose: typeof rep.purpose === 'string' ? rep.purpose : null,
    section: typeof rep.section === 'string' ? rep.section : null,
    choiceGroup: null,
  };
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
  /**
   * Ingredient nameKeys the caller already has on hand, computed live from
   * pantry state (the same "have it" opinion `probablyHaveReason` owns —
   * callers build this set with it, never a second rule). An unresolved
   * group prefers an option whose nameKey is in this set over the
   * first-listed option; an explicit `chosen` id still wins outright.
   *
   * **Never promotes a component.** A component names a dish ("Mash"), which
   * has no nameKey and nothing in a pantry to check — only a `chosen` id can
   * make a component win its group. So a mixed group ("corn tortillas" the
   * ingredient vs. "Tortillas de Maíz" the component) can only default to
   * the ingredient side, same as it already did before this existed; `onHand`
   * just widens *which* ingredient option that default picks.
   *
   * Left unset, resolution is exactly what it always was: the first option.
   * `allOptions` and `undecided` both ignore it — neither reads a "winner"
   * at all.
   */
  onHand?: ReadonlySet<string>;
  /**
   * This cooking's one-off replacements (`MealPlanEntry.recipeOverrides`). A line
   * or used recipe named here is swapped for the replacement, or left out, on
   * the way out of `flattenRecipeIngredients`, and a replaced used recipe drops
   * out of `activeComponents` so its steps and prep tasks go with it.
   *
   * Shopping, cost, nutrition and the cooking views all go through those two, so
   * a caller only has to carry this; build it with `entryResolution`.
   */
  overrides?: readonly RecipeOverride[];
  /**
   * Count every optional line as though the meal picked it (`optionalCounts`).
   * For the top of a recipe page's range only: a purchase or a meal's own
   * figures must leave it off, or a garnish nobody chose is bought and counted.
   */
  withOptional?: boolean;
}

/**
 * Whether an ingredient line counts toward a meal's figures and its shopping.
 *
 * An optional line (`RecipeIngredient.optional`, "lime wedges, for serving")
 * counts only when the meal picked it: its id in `chosen`, the same list the
 * either/or picks live in, which every path carrying a meal's picks already
 * carries. A line in no either/or group names no option, so the choice readers
 * ignore it there. Everything else counts. Cook mode and the recipe page still
 * show an optional line either way; this decides what is bought and counted.
 */
export function optionalCounts(ingredient: RecipeIngredient, resolution?: ChoiceResolution): boolean {
  if (!ingredient.optional) return true;
  return !!resolution?.withOptional || (resolution?.chosen ?? []).includes(ingredient.id);
}

/** `chosen` with the optional line `id` picked or unpicked for this meal. */
export function toggleOptionalPick(chosen: readonly string[], id: string): string[] {
  return chosen.includes(id) ? chosen.filter(c => c !== id) : [...chosen, id];
}

/**
 * The resolution for one planned meal: its picks and its one-off replacements
 * together, plus whatever the caller adds (`onHand`, `undecided`).
 *
 * **The one way to turn an entry into a `ChoiceResolution`.** Building
 * `{ chosen: entry.recipeChoices }` by hand compiles and works, and silently
 * leaves the override off, so the meal shops for the very line it replaced.
 * `noBareEntryResolution.test.ts` fails the build on the hand-built form.
 */
export function entryResolution(
  entry: Pick<MealPlanEntry, 'recipeChoices' | 'recipeOverrides'> | null | undefined,
  extra: Omit<ChoiceResolution, 'chosen' | 'overrides'> = {},
): ChoiceResolution {
  return {
    chosen: entry?.recipeChoices ?? [],
    ...(entry?.recipeOverrides?.length ? { overrides: entry.recipeOverrides } : {}),
    ...extra,
  };
}

/**
 * One plain sentence per override for the recipe page, in the order given:
 * "Korean-Style Fish is replaced by 8 oz vegan fish fillets. Note." or "salt is
 * left out." The replaced name is the recipe's own line or used recipe; an
 * override whose target is no longer on the recipe is skipped, as everywhere
 * else (resolve-or-shrug).
 */
export function describeOverrides(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  overrides: readonly RecipeOverride[],
): string[] {
  return overrideLines(recipe, recipesById, overrides).map(l => l.text);
}

/** `describeOverrides`, each sentence with the target it is about, for a row that can take it back off. */
export function overrideLines(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  overrides: readonly RecipeOverride[],
): { targetId: string; text: string }[] {
  if (overrides.length === 0) return [];
  const names = new Map<string, string>();
  for (const id of [recipe.id, ...reachableRecipeIds(recipesById, recipe.id)]) {
    const node = recipesById.get(id) ?? (id === recipe.id ? recipe : undefined);
    if (!node) continue;
    for (const line of node.ingredients) names.set(line.id, line.name);
    for (const link of node.components) names.set(link.id, recipesById.get(link.recipeId)?.name ?? link.name);
  }
  const out: { targetId: string; text: string }[] = [];
  for (const o of overrides) {
    const was = names.get(o.targetId);
    if (!was) continue;
    const note = o.note ? ` ${o.note.trim().replace(/[.!]?$/, '.')}` : '';
    if (!o.replacement) {
      out.push({ targetId: o.targetId, text: `${was} is left out.${note}` });
      continue;
    }
    const line = [o.replacement.quantity, o.replacement.name, o.replacement.prep].filter(Boolean).join(' ');
    out.push({ targetId: o.targetId, text: `${was} is replaced by ${line}.${note}` });
  }
  return out;
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
 * Which ingredient(s) and component(s) win each of `recipe`'s choice groups —
 * the one place a label is read across both lists together. A group made of
 * options from only one list resolves exactly as it always did; a group with
 * members in both resolves as a single either/or, with the winner named in
 * `chosen` if there is one, else the first option in **ingredients-before-
 * components** order (see the module doc comment for why that order, not the
 * reverse, is the one that keeps a recipe's existing default from moving).
 *
 * `undecided` — see ChoiceResolution.undecided — only ever applies to a group
 * with no component members at all: a component names a dish, and leaving a
 * dish undecided has no shelf-side tick that could ever take it back off.
 */
function resolveGroupWinners(
  recipe: Recipe,
  resolution: ChoiceResolution | undefined,
  undecided: ReadonlySet<string> | undefined,
): { ingredientIds: Set<string>; componentIds: Set<string> } {
  const ingredientIds = new Set<string>();
  const componentIds = new Set<string>();
  const componentGroups = groupOptions(recipe.components);
  const ingredientGroups = groupOptions(recipe.ingredients);
  const chosen = new Set(resolution?.chosen ?? []);
  const onHand = resolution?.onHand;
  const labels = new Set([...ingredientGroups.keys(), ...componentGroups.keys()]);
  for (const label of labels) {
    const ingredients = ingredientGroups.get(label) ?? [];
    const components = componentGroups.get(label) ?? [];
    if (components.length === 0 && undecided?.has(label)) {
      for (const ingredient of ingredients) ingredientIds.add(ingredient.id);
      continue;
    }
    const options: { id: string; kind: 'ingredient' | 'component'; nameKey: string | null }[] = [
      ...ingredients.map(i => ({ id: i.id, kind: 'ingredient' as const, nameKey: i.nameKey })),
      ...components.map(c => ({ id: c.id, kind: 'component' as const, nameKey: null })),
    ];
    const winner = options.find(o => chosen.has(o.id))
      ?? options.find(o => !!o.nameKey && !!onHand?.has(o.nameKey))
      ?? options[0];
    if (!winner) continue;
    (winner.kind === 'ingredient' ? ingredientIds : componentIds).add(winner.id);
  }
  return { ingredientIds, componentIds };
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

/**
 * The components a meal of `recipe` actually cooks under `resolution`: the
 * picked side of each either/or, minus any the meal replaces outright
 * (`ChoiceResolution.overrides`), so a replaced dish contributes no steps and no
 * prep tasks either. `allOptions` (search) sees every link, replaced or not.
 */
export function activeComponents(
  recipe: Recipe,
  resolution?: ChoiceResolution,
): RecipeComponent[] {
  const replaced = overriddenIds(resolution);
  return pickedComponents(recipe, resolution).filter(c => !replaced.has(c.id) || !!resolution?.allOptions);
}

/** The components that win their groups, before any one-off replacement. */
function pickedComponents(recipe: Recipe, resolution?: ChoiceResolution): RecipeComponent[] {
  if (resolution?.allOptions) return [...recipe.components];
  if (recipe.components.every(c => !c.choiceGroup)) return [...recipe.components];
  const { componentIds } = resolveGroupWinners(recipe, resolution, undecidedLabelsOf(recipe, resolution));
  return recipe.components.filter(c => !c.choiceGroup || componentIds.has(c.id));
}

const NO_IDS: ReadonlySet<string> = new Set();

/** The ids a resolution replaces, or a shared empty set. */
function overriddenIds(resolution?: ChoiceResolution): ReadonlySet<string> {
  if (!resolution?.overrides?.length) return NO_IDS;
  return new Set(resolution.overrides.map(o => o.targetId));
}

/**
 * The ingredient lines a meal of `recipe` actually buys under `resolution` —
 * "serrano" or "jalapeño", never both, and never the string "serrano or
 * jalapeño". Also where a component wins a group it shares with an ingredient:
 * the ingredient line drops out exactly as a losing ingredient sibling would.
 *
 * Every shopping read reaches this through flattenRecipeIngredients rather than
 * calling it directly; it's exported for the authoring surfaces that need to
 * know what one *meal* of a recipe looks like without flattening the tree.
 */
export function activeIngredients(
  recipe: Recipe,
  resolution?: ChoiceResolution,
): RecipeIngredient[] {
  if (resolution?.allOptions) return [...recipe.ingredients];
  if (recipe.ingredients.every(i => !i.choiceGroup)) return [...recipe.ingredients];
  const { ingredientIds } = resolveGroupWinners(recipe, resolution, undecidedLabelsOf(recipe, resolution));
  return recipe.ingredients.filter(i => !i.choiceGroup || ingredientIds.has(i.id));
}

/**
 * Whether a method step belongs in one cooking of `recipe` — `RecipeStep.onlyWhen`.
 *
 * Visible when the step names no option, when `allOptions` is on (search and
 * the editor see everything), or when any option it names is a winner of its
 * group. An id that is not an option on this recipe (deleted, or its
 * `choiceGroup` since cleared) is ignored, and a step left with no valid id
 * shows always: dropping instructions because a pointer dangled is the worse
 * failure. An undecided ingredient group counts every member as live, the same
 * as it does for the shopping reads.
 *
 * `recipe` must be the recipe that owns the step: option ids are looked up in
 * its own lists, so a component's step is judged against that component's picks.
 */
export function stepVisible(
  step: { onlyWhen?: readonly string[] },
  recipe: Recipe,
  resolution?: ChoiceResolution,
): boolean {
  const wanted = step.onlyWhen;
  if (!wanted || wanted.length === 0 || resolution?.allOptions) return true;
  const optionIds = new Set<string>();
  for (const row of recipe.ingredients) if (row.choiceGroup) optionIds.add(row.id);
  for (const row of recipe.components) if (row.choiceGroup) optionIds.add(row.id);
  const valid = wanted.filter(id => optionIds.has(id));
  if (valid.length === 0) return true;
  const { ingredientIds, componentIds } = resolveGroupWinners(
    recipe, resolution, undecidedLabelsOf(recipe, resolution),
  );
  return valid.some(id => ingredientIds.has(id) || componentIds.has(id));
}

/**
 * The names of the options a step is tied to (`RecipeStep.onlyWhen`), in the
 * order the step lists them, for the caption that says why a step is or isn't
 * on screen and for share text, which sends every step. Ids that name no
 * option are left out, matching `stepVisible`'s "ignore a dangling id".
 *
 * A used recipe is named as it is now when `recipesById` is given (a rename
 * after linking shows), falling back to the name captured on the link.
 */
export function stepOptionNames(
  step: { onlyWhen?: readonly string[] },
  recipe: Recipe,
  recipesById?: ReadonlyMap<string, Recipe>,
): string[] {
  const names = new Map<string, string>();
  for (const row of recipe.ingredients) if (row.choiceGroup) names.set(row.id, row.name);
  for (const row of recipe.components) {
    if (row.choiceGroup) names.set(row.id, recipesById?.get(row.recipeId)?.name ?? row.name);
  }
  const out: string[] = [];
  for (const id of step.onlyWhen ?? []) {
    const name = names.get(id);
    if (name) out.push(name);
  }
  return out;
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
  /**
   * The heading the component this line came through is placed under in its
   * parent (`ComponentPlacement.section`), null for the root's own lines and for
   * a part with no placement. `ingredientHeadings` reads it to open that heading
   * above the part's own name.
   */
  linkSection?: string | null;
  /**
   * The recipe's own line or used-recipe name this line stands in for when the
   * meal replaced it (`RecipeOverride`), else absent. For the row that says
   * "instead of ...".
   */
  replacedName?: string;
  /** The override's note, when it has one. */
  replacedNote?: string;
}

/**
 * Everything it takes to shop for `recipe`: its own ingredient lines with its
 * components placed among them (`ingredientLayout`), depth-first. For a recipe
 * whose components were never placed, that is the lines, then each component's
 * in component order.
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
  const visited = new Set([recipe.id]);
  const overrides = new Map((resolution?.overrides ?? []).map(o => [o.targetId, o]));
  // Not `walk`: that visits a node's lines whole and then its children, and a
  // component placed between two lines has to land between them. The rules it
  // enforces are repeated here, each recipe once and only the components the
  // resolution leaves standing, and `cookedDishes` and the prep walk still use it.
  const emit = (node: Recipe, depth: number, via: RecipeComponent | null): void => {
    // Resolved, not raw: an either/or line contributes whichever pepper this
    // meal picked. Ungrouped lines are every line, so a recipe with no
    // alternatives flattens exactly as it always did.
    const lines = new Set(activeIngredients(node, resolution));
    // The picked components before any replacement: a replaced one still has a
    // slot here, which its replacement line takes.
    const parts = new Set(pickedComponents(node, resolution).map(c => c.id));
    const linkSection = (via && componentPlacement(via)?.section) || null;
    // This cooking's one-off replacements. A standing swap is deliberately not
    // applied to a replacement: the person typed what they are using this time,
    // and a standing rule must not rewrite it.
    const replace = (targetId: string, name: string): boolean => {
      const override = overrides.get(targetId);
      if (!override) return false;
      if (override.replacement) {
        out.push({
          ingredient: override.replacement,
          recipe: node,
          depth,
          swappedFrom: null,
          linkSection,
          replacedName: name,
          ...(override.note ? { replacedNote: override.note } : {}),
        });
      }
      return true;
    };
    for (const item of ingredientLayout(node)) {
      if (item.kind === 'ingredient') {
        if (!lines.has(item.ingredient)) continue;
        if (replace(item.ingredient.id, item.ingredient.name)) continue;
        // Swapped after the choice is resolved, never before: an option the
        // user isn't cooking has nothing to be swapped into.
        const { ingredient, swappedFrom } = applyStandingSwap(item.ingredient, swaps);
        out.push({ ingredient, recipe: node, depth, swappedFrom, linkSection });
        continue;
      }
      const { component } = item;
      if (!parts.has(component.id)) continue;
      if (replace(component.id, recipesById.get(component.recipeId)?.name ?? component.name)) continue;
      if (visited.has(component.recipeId)) continue;
      const target = recipesById.get(component.recipeId);
      if (!target) continue;
      visited.add(component.recipeId);
      emit(target, depth + 1, component);
    }
    // What this cooking filled the node's blanks with, after its own lines. A
    // blank names no food, so one the meal left empty contributes nothing, and
    // a standing swap is not applied for the reason it isn't to a replacement:
    // the person picked these.
    for (const blank of node.blanks ?? []) {
      for (const ingredient of overrides.get(blank.id)?.fill ?? []) {
        out.push({ ingredient, recipe: node, depth, swappedFrom: null, linkSection });
      }
    }
  };
  emit(recipe, 0, null);
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
  /**
   * The link this dish was reached through and the recipe holding it, for
   * every dish but the root, which has none (so the key is absent there
   * rather than null). The link's `choiceGroup` says whether the dish is one
   * option of an either/or, which the share's heading names (#2948's
   * remainder, see `buildRecipeShareText`).
   */
  via?: ComponentLink;
}

/** A component link and the recipe it sits on. */
export interface ComponentLink {
  parent: Recipe;
  component: RecipeComponent;
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
    out.push({ recipe: node.recipe, whole: node.depth === 0, ...(node.via ? { via: node.via } : {}) });
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
  visit: (node: { recipe: Recipe; depth: number; via: ComponentLink | null }) => void,
  via: ComponentLink | null = null,
): void {
  visit({ recipe, depth, via });
  for (const component of activeComponents(recipe, resolution)) {
    if (visited.has(component.recipeId)) continue;
    const target = recipesById.get(component.recipeId);
    if (!target) continue;
    visited.add(component.recipeId);
    walk(target, recipesById, visited, depth + 1, resolution, visit, { parent: recipe, component });
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
  /** The ingredient's catalog nameKey, or null for a component — see ChoiceResolution.onHand. */
  nameKey: string | null;
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
   * Which list the options came from — `'mixed'` when the group has members
   * in both. Pickers render every kind identically; this is for a caller that
   * needs to say "side" rather than "ingredient" in a label, or (like
   * RecipeToListSheet's "Decide at the store" chip) that must refuse a group
   * with any component in it — `'mixed'` fails that check exactly as
   * `'component'` already does, without the caller needing to know about it.
   */
  kind: 'component' | 'ingredient' | 'mixed';
  /**
   * The alternatives, in list order. The first is the group's default when
   * nothing is chosen and nothing else is on hand — see `active` and
   * ChoiceResolution.onHand.
   */
  options: ChoiceOption[];
  /**
   * Whichever option the resolution selects: the chosen one, else an
   * on-hand ingredient among the options, else the first option.
   */
  active: ChoiceOption;
  /**
   * The option this group would resolve to with nothing explicitly chosen
   * for it — an on-hand ingredient among the options, else the first one.
   * What `applyChoice` compares a new pick against to decide whether it
   * still needs storing (see that function's doc comment).
   */
  defaultId: string;
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
  const onHand = resolution?.onHand;
  const out: ChoiceGroup[] = [];
  const push = (node: Recipe, label: string, kind: ChoiceGroup['kind'], options: ChoiceOption[]) => {
    // Same order as resolveGroupWinners: an on-hand ingredient, else the
    // first option — computed with no regard for `chosen` so it names what
    // this group would resolve to on its own, for applyChoice to compare against.
    const defaultOption = options.find(o => !!o.nameKey && !!onHand?.has(o.nameKey)) ?? options[0];
    out.push({
      recipe: node,
      label,
      kind,
      options,
      defaultId: defaultOption.id,
      active: options.find(o => chosen.has(o.id)) ?? defaultOption,
    });
  };
  // Ingredients before components within one group's *options* (see
  // resolveGroupWinners), but a label is emitted at the point a component
  // names it, same as before — components still read as the bigger decision
  // when a node poses more than one distinct question.
  walk(recipe, recipesById, new Set([recipe.id]), 0, resolution, node => {
    const componentsByLabel = groupOptions(node.recipe.components);
    const ingredientsByLabel = groupOptions(node.recipe.ingredients);
    const optionsFor = (label: string): ChoiceOption[] => [
      ...(ingredientsByLabel.get(label) ?? []).map(ingredient =>
        ({ id: ingredient.id, name: ingredient.name, broken: false, nameKey: ingredient.nameKey })),
      ...(componentsByLabel.get(label) ?? []).map(component => {
        const resolved = resolveComponent(component, recipesById);
        return { id: component.id, name: resolved.name, broken: !resolved.recipe, nameKey: null };
      }),
    ];
    const kindFor = (label: string): ChoiceGroup['kind'] =>
      ingredientsByLabel.has(label) && componentsByLabel.has(label) ? 'mixed'
        : componentsByLabel.has(label) ? 'component' : 'ingredient';
    const emitted = new Set<string>();
    for (const label of componentsByLabel.keys()) {
      push(node.recipe, label, kindFor(label), optionsFor(label));
      emitted.add(label);
    }
    for (const label of ingredientsByLabel.keys()) {
      if (emitted.has(label)) continue;
      push(node.recipe, label, kindFor(label), optionsFor(label));
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
 * reordered — or, now, if what's on hand changes. That's why the comparison
 * is against `group.defaultId` (what this group resolves to with *no*
 * explicit pick) rather than `group.active.id` (what it resolves to with
 * whatever was already stored): re-tapping an already-explicit non-default
 * pick must stay explicit, not collapse into "whatever's on hand right now"
 * the moment it happens to match.
 */
export function applyChoice(
  choices: readonly string[],
  group: ChoiceGroup,
  optionId: string,
): string[] {
  const optionIds = new Set(group.options.map(o => o.id));
  const rest = choices.filter(id => !optionIds.has(id));
  const isDefault = group.defaultId === optionId;
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
 *
 * With `recipesById` the clause also says how many ingredients the components
 * bring ("1 component with 22 ingredients"), counted choice-aware like the
 * recipe's own number. Without it the clause is only the component count, for a
 * caller with no library to resolve against. A component that no longer
 * resolves contributes nothing, so the tail is dropped when the total is 0.
 */
export function describeComponents(
  recipe: Recipe,
  recipesById?: ReadonlyMap<string, Recipe>,
): string {
  const count = countChoiceAware(recipe.components);
  if (count === 0) return '';
  const base = count === 1 ? '1 component' : `${count} components`;
  if (!recipesById) return base;
  const fromComponents = countChoiceAware(
    flattenRecipeIngredients(recipe, recipesById)
      .filter(f => f.depth > 0)
      .map(f => f.ingredient),
  );
  if (fromComponents === 0) return base;
  return `${base} with ${fromComponents === 1 ? '1 ingredient' : `${fromComponents} ingredients`}`;
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
 * `alternativeCaptions`, crossing the two lists — the ingredient half of "corn
 * tortillas or Tortillas de Maíz" has to name the component alternative, and
 * the component half has to name the ingredient back. Not built by calling
 * `alternativeCaptions` twice: each of those calls only ever sees its own
 * list, which is exactly the bug this fixes (a shared label used to open two
 * separate "Choose one" headers instead of one shared caption on each side).
 * `recipe`'s own groups only, same as `alternativeCaptions`'s callers — a
 * caption for a component two levels down is a question for that recipe's own
 * detail screen, not this one's.
 */
export function recipeAlternativeCaptions(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): Map<string, string> {
  const componentGroups = groupOptions(recipe.components);
  const ingredientGroups = groupOptions(recipe.ingredients);
  const labels = new Set([...ingredientGroups.keys(), ...componentGroups.keys()]);
  const out = new Map<string, string>();
  for (const label of labels) {
    const options = [
      ...(ingredientGroups.get(label) ?? []).map(i => ({ id: i.id, name: i.name })),
      ...(componentGroups.get(label) ?? []).map(c =>
        ({ id: c.id, name: resolveComponent(c, recipesById).name || 'Deleted recipe' })),
    ];
    if (options.length < 2) continue;
    for (const option of options) {
      const others = options.filter(o => o.id !== option.id).map(o => o.name.trim() || 'unnamed');
      out.set(option.id, `or ${others.join(' or ')}`);
    }
  }
  return out;
}

/**
 * Ids of the rows whose choice group is drawn as one unbroken run, as the list
 * is actually shown (headings included, as rows with no group).
 *
 * The "Choose one" header and the group's bar already say these rows are one
 * choice, and the next row is the other option, so an "or manchego" caption
 * under each only repeats it. A group whose options are split up (by another
 * row or a section heading) keeps its captions, since there the caption is the
 * only thing saying what the line is an alternative to.
 */
export function choiceOptionsShownTogether(
  rows: readonly { id: string; choiceGroup: string | null }[],
): Set<string> {
  const runs = new Map<string, string[]>();
  const broken = new Set<string>();
  let open: string | null = null;
  for (const row of rows) {
    const group = row.choiceGroup;
    if (group !== open && group) {
      if (runs.has(group)) broken.add(group);
      else runs.set(group, []);
    }
    if (group) runs.get(group)!.push(row.id);
    open = group;
  }
  const out = new Set<string>();
  for (const [group, ids] of runs) {
    if (!broken.has(group)) for (const id of ids) out.add(id);
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
