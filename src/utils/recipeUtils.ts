import type { GroceryItem, ItemSubLink, Recipe, RecipeIngredient, RecipeMealType, RecipePrepTask, RecipeSortOption, RecipeStep, RecipeVote } from '../types';
import { MAX_STEP_TIMER_SECONDS, MIN_STEP_TIMER_SECONDS } from './stepTimers';
import {
  RECIPE_CHOICE_GROUP_MAX_LENGTH,
  RECIPE_MEAL_TYPES,
  RECIPE_MEAL_TYPE_LABELS,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  RECIPE_SECTION_MAX_LENGTH,
  PREP_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../types';
import { format } from 'date-fns/format';
import { groceryNameKey, parseGroceryInput, splitGroceryLines, splitPrep, splitPurpose } from './groceryParse';
import { generateId } from './id';
import { resolveOffsetDate } from './templateUtils';
import { classifyPlanned, plannedIngredientsForRecipe } from './mealPlanGroceries';
import { substitutesOnHand } from './itemSubs';
import { standingSwapMap } from './standingSwaps';
import { formatDuration } from './effort';
import {
  countChoiceAware,
  describeComponents,
  flattenRecipeIngredients,
  flattenRecipePrepTasks,
  recipeMap,
  type ChoiceResolution,
} from './recipeComponents';

// splitPrep lives in groceryParse.ts now — the plain grocery quick-add field
// runs the same split for its live preview, not just recipe ingredient lines
// — but re-exported here so existing imports of it from this module keep
// working.
export { splitPrep } from './groceryParse';

/**
 * Everything between raw recipe text and a stored Recipe. Pure and store-free
 * so it stays testable under the node jest env, same as groceryParse.
 *
 * The offline path is not a stub: splitGroceryLines + parseGroceryInput turn
 * the ingredient list most recipe sites hand you ("2 lb chicken thighs / 1
 * bunch parsley / 3 cloves garlic") into named, quantified rows with no API
 * key involved. AI only ever gets to do the part a parser genuinely can't —
 * separating the method from the shopping.
 */

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version. */
export function parseRecipeIngredients(raw: unknown): RecipeIngredient[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeIngredient).filter((i): i is RecipeIngredient => i !== null);
}

/**
 * Repairs one stored ingredient. Returns null for a row with no usable name —
 * a nameless ingredient can't be shopped for and can't be edited into one, so
 * dropping it beats rendering a blank row forever.
 *
 * Recomputes `nameKey` from the name rather than trusting the stored one, so a
 * blob written by an older build (or hand-edited in a restored backup) can't
 * carry a key that no longer matches its own name.
 */
export function normalizeIngredient(raw: unknown): RecipeIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipeIngredient>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, GROCERY_NAME_MAX_LENGTH) : '';
  if (!name) return null;
  const normalized: RecipeIngredient = {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    name,
    nameKey: groceryNameKey(name),
    quantity: typeof r.quantity === 'string'
      ? r.quantity.trim().slice(0, GROCERY_QUANTITY_MAX_LENGTH)
      : '',
    aisle: typeof r.aisle === 'string' && r.aisle ? r.aisle : null,
    prep: typeof r.prep === 'string' && r.prep.trim()
      ? r.prep.trim().slice(0, PREP_MAX_LENGTH)
      : null,
    purpose: typeof r.purpose === 'string' && r.purpose.trim()
      ? r.purpose.trim().slice(0, PREP_MAX_LENGTH)
      : null,
    section: typeof r.section === 'string' && r.section.trim()
      ? r.section.trim().slice(0, RECIPE_SECTION_MAX_LENGTH)
      : null,
    choiceGroup: cleanChoiceGroup(typeof r.choiceGroup === 'string' ? r.choiceGroup : null),
  };
  // Written only when it's true, which is what makes the field optional worth
  // anything: "keep as written" is off for nearly every line in the app, and
  // storing `false` on all of them would grow every recipe's blob to say so.
  if (r.noSwap === true) normalized.noSwap = true;
  return normalized;
}

/**
 * One typed line ("2 lb chicken thighs") into an ingredient.
 *
 * Deliberately leaves `aisle` null rather than calling aisleForName here: the
 * lexicon's guess is worth making at *add* time, when addByName can weigh it
 * against what the user has actually filed. Baking a guess into the recipe
 * would outrank their own filings for ever after — the same mistake
 * deleteAisle avoids by forgetting overrides rather than rewriting them.
 *
 * `section` stamps the row with whatever heading the caller currently has
 * selected (the editor's add field carries one along) — trimmed and capped
 * the same way RecipeIngredientSheet's own Section field is.
 */
export function makeIngredient(line: string, section: string | null = null): RecipeIngredient | null {
  const { name: rawName, quantity } = parseGroceryInput(line);
  if (!rawName.trim()) return null;
  const { name: afterPrep, prep } = splitPrep(rawName);
  if (!afterPrep.trim()) return null;
  // splitPurpose only runs when splitPrep didn't already take a comma clause
  // — a comma-based prep clause can legitimately contain "for" on its own
  // ("cheese, plus more for topping" is one prep note), so a raw line with a
  // comma has already had its trailing text claimed. `rawName` (not
  // `afterPrep`) is what's checked, since the comma sits before the prep
  // split either way.
  const purposeSplit = rawName.includes(',') ? null : splitPurpose(afterPrep);
  const name = purposeSplit ? purposeSplit.name : afterPrep;
  if (!name.trim()) return null;
  return {
    id: generateId(),
    name,
    nameKey: groceryNameKey(name),
    quantity: quantity ?? '',
    aisle: null,
    prep,
    purpose: purposeSplit?.purpose ?? null,
    section: section && section.trim() ? section.trim().slice(0, RECIPE_SECTION_MAX_LENGTH) : null,
    choiceGroup: null,
  };
}

/**
 * A pasted ingredient list into ingredients, deduped on the catalog's own key
 * so a recipe listing salt twice doesn't carry it twice.
 *
 * splitGroceryLines already strips bullets and caps the paste; this adds only
 * the parse and the empty-name guard. `section` is passed through to every
 * line, same as makeIngredient.
 */
export function ingredientsFromText(raw: string, section: string | null = null): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  const seen = new Set<string>();
  for (const line of splitGroceryLines(raw)) {
    const ingredient = makeIngredient(line, section);
    if (!ingredient) continue;
    const key = ingredient.nameKey || ingredient.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ingredient);
  }
  return out;
}

/**
 * Merges new ingredients into an existing list, keeping the first occurrence of
 * each key. Used by both paste-into-an-existing-recipe and the editor's add
 * field, so "garlic" typed twice edits rather than duplicates.
 *
 * The *existing* row wins on a collision: it may carry a quantity or an aisle
 * the user set by hand, and silently replacing that with a freshly-parsed line
 * is the kind of quiet overwrite addByName refuses to do to a quantity.
 */
export function mergeIngredients(
  existing: readonly RecipeIngredient[],
  incoming: readonly RecipeIngredient[],
): RecipeIngredient[] {
  const out = [...existing];
  const seen = new Set(existing.map(i => i.nameKey || i.name.toLowerCase()));
  for (const ingredient of incoming) {
    const key = ingredient.nameKey || ingredient.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ingredient);
  }
  return out;
}

/**
 * Rewrites every ingredient sitting on `fromKey` to `toKey` across a set of
 * recipes, returning only the recipes that actually changed.
 *
 * This is the other half of the nameKey bridge: renaming a grocery item
 * rewrites its key, and without this the recipe keeps pointing at a spelling
 * that no longer exists. Returning only the changed rows is what lets the
 * store skip the write when a rename touches nothing — the same
 * null-when-unchanged shape rememberAisles uses.
 */
export function remapIngredientKeyIn(
  recipes: readonly Recipe[],
  fromKey: string,
  toKey: string,
): Recipe[] {
  if (!fromKey || !toKey || fromKey === toKey) return [];
  const changed: Recipe[] = [];
  for (const recipe of recipes) {
    if (!recipe.ingredients.some(i => i.nameKey === fromKey)) continue;
    changed.push({
      ...recipe,
      ingredients: recipe.ingredients.map(i =>
        i.nameKey === fromKey ? { ...i, nameKey: toKey } : i
      ),
    });
  }
  return changed;
}

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version — same as parseRecipeIngredients. */
export function parsePrepTasks(raw: unknown): RecipePrepTask[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizePrepTask).filter((t): t is RecipePrepTask => t !== null);
}

/** Repairs one stored prep task. Returns null for a row with no usable title — see normalizeIngredient. */
export function normalizePrepTask(raw: unknown): RecipePrepTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipePrepTask>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, TITLE_MAX_LENGTH) : '';
  if (!title) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    title,
    offsetDays: typeof r.offsetDays === 'number' && Number.isFinite(r.offsetDays) ? Math.round(r.offsetDays) : 0,
    reminderOffsetMinutes: typeof r.reminderOffsetMinutes === 'number' && Number.isFinite(r.reminderOffsetMinutes)
      ? Math.round(r.reminderOffsetMinutes)
      : null,
  };
}

export function parseSteps(raw: unknown): RecipeStep[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeStep).filter((s): s is RecipeStep => s !== null);
}

/** Repairs one stored step. Returns null for a row with no usable text — see normalizePrepTask. */
export function normalizeStep(raw: unknown): RecipeStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipeStep>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;
  // Only stored when someone actually set one: a step with no hand-set
  // duration keeps the shape it has always had, so an install that upgrades
  // into the field round-trips byte for byte. Out-of-range values are dropped
  // rather than clamped — a stored 0 or a stored day means the row is wrong,
  // and the sentence is a better answer than a repaired number.
  const seconds = typeof r.timerSeconds === 'number' && Number.isFinite(r.timerSeconds)
    ? Math.round(r.timerSeconds)
    : null;
  const timerSeconds = seconds !== null
    && seconds >= MIN_STEP_TIMER_SECONDS
    && seconds <= MAX_STEP_TIMER_SECONDS
    ? seconds
    : null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    text,
    ...(timerSeconds === null ? {} : { timerSeconds }),
  };
}

/**
 * A prep task plus the meal date it's attached to, into what `addTask` needs.
 *
 * Reuses templateUtils.resolveOffsetDate rather than re-deriving the same
 * noon-normalized-day math a second time — a prep task's `offsetDays` is
 * TemplateItem's `dueOffsetDays` reduced to one anchor (the meal itself,
 * never null), so the date arithmetic is identical. The reminder instant is
 * the same inline "dueDate minus N minutes" buildDraftsFromTemplate already
 * does, for the same reason: no separate "compute a reminder" helper exists
 * to call instead.
 */
export function resolvePrepTaskDraft(
  prepTask: RecipePrepTask,
  mealDate: Date
): { dueDate: string; reminderTime: string | null } {
  // Never null: mealDate is always a real Date and offsetDays is never null
  // on a RecipePrepTask (see the type).
  const dueDate = resolveOffsetDate(mealDate, prepTask.offsetDays)!;
  const reminderTime = prepTask.reminderOffsetMinutes !== null
    ? new Date(new Date(dueDate).getTime() - prepTask.reminderOffsetMinutes * 60_000).toISOString()
    : null;
  return { dueDate, reminderTime };
}

/** One prep step, resolved against a meal date and shaped for addTask. */
export interface PrepTaskDraft {
  title: string;
  dueDate: string;
  reminderTime: string | null;
}

/**
 * Every prep step a meal implies, resolved against the date it's planned for.
 *
 * Goes through flattenRecipePrepTasks rather than `recipe.prepTasks`, the same
 * discipline every shopping read keeps: a dish that is mostly its components
 * would otherwise look like it needed no prep at all. One place both callers
 * share — the offer made when the meal is planned, and the entry sheet's "Add
 * prep tasks" — so the two can't drift on which steps a composed dish has.
 *
 * `resolution` carries the meal's own either/or picks (MealPlanEntry.recipeChoices)
 * so a night having the roast potatoes doesn't get "boil the potatoes" on its
 * prep list. Omitted at plan time, when nothing has been chosen yet — the
 * offer that fires right after planning always sees the defaults.
 */
export function prepTaskDraftsForMeal(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  mealDate: Date,
  resolution?: ChoiceResolution
): PrepTaskDraft[] {
  return flattenRecipePrepTasks(recipe, recipesById, resolution).map(({ prepTask }) => ({
    title: prepTask.title,
    ...resolvePrepTaskDraft(prepTask, mealDate),
  }));
}

/**
 * "4" or "4-6" — just the number(s), for callers that want to build their own
 * sentence around it (the editor's collapsed value, the extract preview).
 * Null when there's no servings count at all. A `max` that doesn't exceed
 * `servings` is ignored rather than trusted — `setServings` and
 * `extractRecipe` are the only writers and already refuse to store one, but a
 * restored backup could still carry a stale pair.
 */
export function formatServingsRange(servings: number | null, max: number | null): string | null {
  if (!servings) return null;
  if (max && max > servings) return `${servings}-${max}`;
  return String(servings);
}

/**
 * How far ahead of the meal a prep task can be asked to start. Shared by
 * `PrepTaskSheet`'s stepper and the import review sheets' own, so the two
 * can't drift into offering different ranges for the same field. The top is
 * `1` rather than `0` because a task the day *after* is a real thing to want
 * (chilling something overnight once it's made).
 */
export const PREP_OFFSET_MIN = -7;
export const PREP_OFFSET_MAX = 1;

/**
 * `formatServingsRange`'s inverse, for the one place a person types a serving
 * count back in rather than picking it: the import review sheets, where the
 * row shows whatever the extractor read off the page and lets you correct it.
 *
 * Deliberately forgiving about the separator, because it's re-reading its own
 * output *and* whatever a person typed over it: "4-6", "4 - 6", "4 to 6" and
 * "4–6" (en dash, which is what a page that prints a range usually uses) all
 * mean the same range. Anything with no usable number in it returns null,
 * which the caller reads as "leave the servings alone" rather than as zero.
 *
 * The max follows `setServings`' own rule rather than a second one: a top that
 * doesn't beat its bottom isn't a range, so it's dropped instead of stored.
 */
export function parseServingsRange(text: string): { servings: number; servingsMax: number | null } | null {
  const numbers = text.match(/\d+/g);
  if (!numbers) return null;
  const servings = parseInt(numbers[0], 10);
  if (!servings) return null;
  const max = numbers.length > 1 ? parseInt(numbers[1], 10) : null;
  return { servings, servingsMax: max && max > servings ? max : null };
}

/** Same as `formatServingsRange`, reading straight off a `Recipe`. */
export function formatServings(recipe: Recipe): string | null {
  return formatServingsRange(recipe.servings, recipe.servingsMax);
}

/**
 * `countLikelyInPantry`'s return shape (#1568) — two counts, never folded into
 * one number. `probablyHave` is a direct pantry match; `viaSubstitute` is an
 * ingredient with no pantry match of its own whose linked substitute the app
 * currently thinks is on hand. Reporting them separately is what keeps a
 * substitute link — which is user-authored, not a guess — from reading like
 * one anyway: a coverage number that can't be taken apart is indistinguishable
 * from the deleted `likelyItemIds` bucket's kind of invention, however honest
 * its inputs are. See `describeRecipe` and `describePantryCoverage`, which
 * both render the two as separate clauses rather than summing them.
 */
export interface LikelyInPantryCount {
  probablyHave: number;
  viaSubstitute: number;
}

/**
 * "Breakfast · 8 ingredients · 1 component · 6 likely in pantry · 1 with a
 * substitute · serves 4-6 · NYT Cooking" — the recipe row's subtitle.
 * `likelyInPantry` is optional and each clause is omitted independently on a
 * falsy count, rather than ever rendering "0 likely in pantry" — see
 * `countLikelyInPantry`. The meal type leads, ahead of the ingredient count,
 * since it's the fact someone scanning the list is most likely browsing by
 * (see RecipeMealType).
 *
 * The ingredient count is the recipe's *own* lines, never the flattened total,
 * because it has to agree with the list the detail screen puts on screen right
 * under it. What the component clause is for is saying there's more: "3
 * ingredients" alone would read as the whole shop for a dish that's mostly its
 * parts.
 */
export function describeRecipe(recipe: Recipe, likelyInPantry?: LikelyInPantryCount | null): string {
  // Choice-aware, so "serrano or jalapeño" reads as the one pepper a meal of
  // this actually buys — see countChoiceAware.
  const count = countChoiceAware(recipe.ingredients);
  const parts: string[] = [];
  if (recipe.mealType) parts.push(RECIPE_MEAL_TYPE_LABELS[recipe.mealType]);
  parts.push(count === 1 ? '1 ingredient' : `${count} ingredients`);
  const components = describeComponents(recipe);
  if (components) parts.push(components);
  if (likelyInPantry?.probablyHave) {
    parts.push(likelyInPantry.probablyHave === 1 ? '1 likely in pantry' : `${likelyInPantry.probablyHave} likely in pantry`);
  }
  if (likelyInPantry?.viaSubstitute) {
    parts.push(likelyInPantry.viaSubstitute === 1 ? '1 with a substitute' : `${likelyInPantry.viaSubstitute} with a substitute`);
  }
  const servings = formatServings(recipe);
  if (servings) parts.push(`serves ${servings}`);
  if (recipe.recipeYield) parts.push(`makes ${recipe.recipeYield}`);
  const total = totalMinutes(recipe);
  if (total) parts.push(formatDuration(total));
  const attribution = describeAttribution(recipe);
  if (attribution) parts.push(attribution);
  return parts.join(' · ');
}

/**
 * How many of a recipe's ingredients grocerySuggest's pantry guess would call
 * "probably have" — the same `classifyPlanned` signal RecipeToListSheet and
 * AddMealsToListSheet already use to fill their "Probably have" section,
 * reused here rather than re-deriving it, and reduced to two counts for the
 * recipe list row. Null (never both-zero) when there's nothing worth
 * showing: no ingredients, or nothing in the catalog reads as still on hand
 * and nothing is covered via a substitute either.
 *
 * `recipesById` counts a composed recipe's components in, so the number means
 * the same thing the "Add ingredients to list" sheet will show. Optional for
 * the same reason plannedIngredientsForRecipe's is. `itemSubs` is optional and
 * empty by default: with no links there's nothing to add to the direct count.
 */
export function countLikelyInPantry(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
  itemSubs: readonly ItemSubLink[] = [],
): LikelyInPantryCount | null {
  const coverage = pantryCoverageForRecipe(recipe, items, now, recipesById, itemSubs);
  if (coverage.probablyHave === 0 && coverage.viaSubstitute === 0) return null;
  return { probablyHave: coverage.probablyHave, viaSubstitute: coverage.viaSubstitute };
}

/**
 * The richer form of `countLikelyInPantry` (#1103) — a percentage plus enough
 * of its denominator for a caller to tell "we checked and it's low" apart
 * from "there's nothing to check against yet", which a bare count can't say.
 */
export interface PantryCoverage {
  /** Ingredient lines counted, after flattening to the resolved defaults — same denominator scoreRecipeAgainstCatalog uses. */
  total: number;
  /**
   * How many of those lines have *any* catalog row, matched or not — the
   * denominator for whether there's anything to judge by at all.
   * Zero here (with `total` > 0) is what makes `percent` null rather than 0:
   * a recipe of ingredients that have never been through the grocery list
   * isn't "0% likely on hand", it's unjudged. Catalog membership, not
   * purchase history — a row the catalog knows but nobody has bought is a
   * real 0%, which `pantryCoverageForRecipe`'s own tests pin.
   */
  catalogMatches: number;
  /**
   * How many lines `classifyPlanned` currently calls "probably have" —
   * grocerySuggest's pantry guess, an explicit `onHandUntil` assertion, or a
   * `staple` row (`isStaple`, "I always have this"). Staples are their own
   * `classifyPlanned` category — RecipeToListSheet needs to tell "always have
   * it" apart from a purchase-history guess for its own two sections — but
   * this coverage number answers a coarser question ("do I probably have
   * this ingredient"), where a standing fact is at least as strong a yes as a
   * recent-purchase guess. Folded in here rather than left out, or `total`
   * and `catalogMatches` (which already count a staple, since it always has
   * a catalog row) would silently outrun the numerator.
   */
  probablyHave: number;
  /**
   * Ingredient lines with no pantry match of their own (`needToBuy`) whose
   * linked substitute the app currently thinks is on hand — `classifyPlanned`
   * already answers this via `row.reason` (#1566), so this reads that rather
   * than re-deriving it. Counted separately from `probablyHave` and never
   * folded into `percent`, per #1568: a substitute-covered ingredient is real
   * (every link is user-authored) but isn't the same fact as a direct match,
   * and a number that can't be taken apart reads like a guess even when it
   * isn't one.
   */
  viaSubstitute: number;
  /** `probablyHave / total` as a whole-number percentage. Null when there's nothing to compute it from: no ingredients, or none of them has ever been added to the grocery catalog. */
  percent: number | null;
}

/**
 * The pantry-coverage signal for one recipe — "you probably have ~60% of
 * this already" — built on the same `plannedIngredientsForRecipe` +
 * `classifyPlanned` pass `countLikelyInPantry` already reduces to a count,
 * kept here as a shape a suggestion row can render directly (see
 * `describePantryCoverage` and `SuggestMealsSheet`).
 *
 * `recipesById` folds a composed recipe's components in, same as
 * `countLikelyInPantry` — a dish that's mostly its parts must not read as
 * fully unjudged just because its own two lines are. `itemSubs` is optional
 * and empty by default, matching every other reader of these links.
 */
export function pantryCoverageForRecipe(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
  itemSubs: readonly ItemSubLink[] = [],
): PantryCoverage {
  // Swapped, from the same links this already takes: a cook who never buys
  // dairy milk is not missing an ingredient, and a coverage number that says
  // they are is the exact complaint #1571 exists to answer. Built here rather
  // than passed in so every caller of this — and of
  // `countLikelyInPantry` above it — gets the same answer without a new
  // argument each.
  const planned = plannedIngredientsForRecipe(
    recipe, recipesById, undefined, 1, standingSwapMap(itemSubs, items)
  );
  if (planned.length === 0) return { total: 0, catalogMatches: 0, probablyHave: 0, viaSubstitute: 0, percent: null };

  const classified = classifyPlanned(planned, items, now, itemSubs);
  const total = classified.length;
  const itemKeys = new Set(items.map(i => i.nameKey));
  const catalogMatches = classified.filter(row => itemKeys.has(row.nameKey)).length;
  const probablyHave = classified.filter(row => row.category === 'probablyHave' || row.category === 'staple').length;
  const viaSubstitute = classified.filter(row => row.category === 'needToBuy' && row.reason !== null).length;
  const percent = catalogMatches > 0 ? Math.round((probablyHave / total) * 100) : null;

  return { total, catalogMatches, probablyHave, viaSubstitute, percent };
}

/**
 * "5/7 likely on hand" / "None of these have been on your list yet" — the one
 * line a suggestion row renders next to a recipe. Null only when there's
 * nothing to say at all (no ingredients), same as `countLikelyInPantry`'s null.
 *
 * The no-catalog-match case is worded as a state, not a number: a bare "0/7"
 * there would read as "you have none of this" when the honest answer is "these
 * ingredients have never been through the grocery list, so we can't guess" —
 * the graceful-degradation case #1103 asks for. It names *catalog membership*
 * and not purchase history, because that's the condition it actually tests: an
 * ingredient the catalog knows but nobody has bought is a deliberate real 0%
 * (see `pantryCoverageForRecipe`), and wording this branch as "no purchase
 * history" claimed a line the other branch also sits on. `viaSubstitute` rides
 * as its own trailing clause either way, never folded into the fraction in
 * front of it — same shape `describeShops` uses for a trailing
 * negative-evidence clause.
 */
export function describePantryCoverage(coverage: PantryCoverage): string | null {
  if (coverage.total === 0) return null;
  const base = coverage.catalogMatches === 0
    ? 'None of these have been on your list yet'
    : `${coverage.probablyHave}/${coverage.total} likely on hand`;
  if (coverage.viaSubstitute === 0) return base;
  const clause = coverage.viaSubstitute === 1 ? '1 with a substitute' : `${coverage.viaSubstitute} with a substitute`;
  return `${base} · ${clause}`;
}

/**
 * "by Alison Roman — Nothing Fancy", or whichever of author/source is set.
 * Falls back to the legacy sourceName only when neither new field has ever
 * been given a value — an old recipe nobody has re-edited since #1266.
 *
 * A cookbook page number rides along on `source` itself ("Nothing Fancy, p.
 * 142") rather than getting its own clause — it only ever means anything
 * alongside the book it's a page *of*, so it can't stand on its own the way
 * author/source do.
 */
export function describeAttribution(recipe: Recipe): string | null {
  const sourceLabel = recipe.source && recipe.sourceType === 'cookbook' && recipe.sourcePage
    ? `${recipe.source}, p. ${recipe.sourcePage}`
    : recipe.source;
  if (recipe.author && sourceLabel) return `by ${recipe.author}, ${sourceLabel}`;
  if (recipe.author) return `by ${recipe.author}`;
  if (sourceLabel) return sourceLabel;
  return recipe.sourceName || null;
}

/** Trims and caps a name for storage. Empty means "not a name" — callers refuse it. */
export function cleanRecipeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, RECIPE_NAME_MAX_LENGTH).trim();
}

/**
 * Trims and caps a source byline ("NYT Cooking"). Empty is a valid answer —
 * no attribution. `maxLength` defaults to a byline's own ceiling; callers
 * with a shorter field (a page number) pass their own.
 */
export function cleanRecipeSource(raw: string, maxLength: number = RECIPE_SOURCE_MAX_LENGTH): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, maxLength).trim();
}

/**
 * A cookbook's normalised identity, from its title *and* its author.
 *
 * Title alone would be wrong: "Dinner" is a Melissa Clark book and also a Meera
 * Sodha one, and a shelf that can only hold one of them is a worse bug than the
 * near-duplicate a compound key lets through. Author alone is obviously wrong,
 * since a cook writes more than one book.
 *
 * Falls back to lowercased raw text per part for the reason `addShop` does: a
 * title with no letters or digits normalises to empty, and two of those would
 * collide on the UNIQUE index and throw out of whatever called this.
 */
export function cookbookKey(title: string, author: string | null): string {
  const part = (raw: string) => groceryNameKey(raw) || raw.trim().toLowerCase();
  return `${part(title)}|${part(author ?? '')}`;
}

/**
 * Distinct, alpha-sorted values of a text field across every *other* recipe —
 * the same "derive suggestions from the data that's actually there" idea as
 * groceryAisles/grocerySuggest, shared by both Source's and Author's
 * suggestion chips (RecipeEditor) so retyping "NYT Cooking" or "Alison
 * Roman" on a fifth recipe is one tap instead of two nearly-identical
 * `useMemo`s.
 */
export function distinctRecipeValues(
  recipes: readonly Recipe[],
  excludeId: string | undefined,
  field: (recipe: Recipe) => string | null
): string[] {
  return Array.from(
    new Set(
      recipes
        .filter(r => r.id !== excludeId)
        .map(r => field(r)?.trim())
        .filter((s): s is string => !!s)
    )
  ).sort((a, b) => a.localeCompare(b));
}

/**
 * Up to 8 of `values` matching `query` (substring, case-insensitive),
 * excluding an exact match — what a suggestion chip row filters
 * `distinctRecipeValues()` down to as the field is typed into.
 */
export function filterRecipeSuggestions(values: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const matches = q ? values.filter(v => v.toLowerCase().includes(q) && v.toLowerCase() !== q) : values;
  return matches.slice(0, 8);
}

/**
 * Trims and caps a choice group label, collapsing "no label" to null.
 *
 * The whitespace collapse is what makes typing an existing label join that
 * group rather than start a lookalike beside it — the label *is* the grouping
 * key (same as an aisle name), so "Side " and "Side" have to be one thing.
 */
export function cleanChoiceGroup(raw: string | null | undefined): string | null {
  const clean = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, RECIPE_CHOICE_GROUP_MAX_LENGTH).trim();
  return clean || null;
}

/**
 * Ranks recipes for the library's search field, mirroring
 * rankGrocerySuggestions' 3/2/1 prefix / word-start / substring weighting so
 * searching here behaves the way searching the catalog already does. The vote
 * breaks ties, loved first; nothing else does, because Phase 1 has no cook
 * history to rank on.
 *
 * Below the name, the ladder runs tag (0.75) → ingredient (0.5) → attribution
 * (0.4) → notes (0.25), ordered by how deliberate the match is: a tag is a label
 * chosen for this recipe, an ingredient is what it's made of, attribution is
 * where it came from, and notes is free text that can mention anything. Each
 * tier only decides which of two *matching* recipes comes first, so the order
 * matters far less than every tier existing — a recipe that can't be found at
 * all is the actual failure.
 *
 * The ingredient match runs over the *flattened* list, built from the same
 * `recipes` array rather than a second parameter — searching "potato" has to
 * find the dinner whose mash is where the potatoes are written down, or a
 * component is a place ingredients go to hide from search.
 */
export function rankRecipes(query: string, recipes: readonly Recipe[]): Recipe[] {
  const q = groceryNameKey(query);
  if (!q) return [...recipes];
  const byId = recipeMap(recipes);
  const scored: Array<{ recipe: Recipe; weight: number }> = [];
  for (const recipe of recipes) {
    const key = recipe.nameKey;
    let weight = 0;
    if (key.startsWith(q)) weight = 3;
    else if (key.split(' ').some(word => word.startsWith(q))) weight = 2;
    else if (key.includes(q)) weight = 1;
    // A tag is a label the cook chose for this recipe, so typing one is a
    // deliberate hit — ranked under every name match and above an ingredient,
    // which is a match on something the recipe merely contains. The chip row is
    // still the way to *filter* by a tag (filterRecipesByTags); this is only so
    // typing "thai" into the search field doesn't come back empty.
    // Matched through the same key the query went through, so a hyphenated
    // "gluten-free" is still found by typing it with the hyphen.
    else if (recipe.tags.some(tag => groceryNameKey(tag).includes(q))) weight = 0.75;
    // An ingredient match is a real hit — "what can I make with fennel" is the
    // question a recipe box is for — but it must never outrank a name match.
    // `allOptions` here and nowhere else that shops: an alternative the user
    // isn't cooking tonight is still an ingredient this recipe can call for, and
    // hiding it would make a recipe unfindable by a search for the very thing
    // it's sometimes made of. A result is an invitation to look, not a purchase.
    else if (flattenRecipeIngredients(recipe, byId, { allOptions: true })
      .some(f => f.ingredient.nameKey.includes(q))) weight = 0.5;
    // Attribution — "ottolenghi", "nyt cooking". A person or a publication is a
    // deliberate way to slice a box ("what else is out of Sweet"), so it's a
    // real hit, but it names where a recipe came from rather than what it is,
    // which is why it sits under the ingredient the recipe is made of.
    //
    // `sourceName` is matched alongside the two fields that superseded it
    // precisely because nothing backfilled it (see the field's note in
    // types/index.ts): an old recipe whose only attribution is "Alison Roman,
    // Nothing Fancy" would otherwise be the one recipe in the box that can't be
    // found by its own author. Matching it needs no split — a substring finds
    // either half of that string, which is the whole reason the field was left
    // alone rather than guessed apart.
    //
    // sourceUrl is deliberately *not* searched. groceryNameKey strips the
    // punctuation out of it, so "https://cooking.nytimes.com/x" collapses to one
    // long word — "nyt" would match it by accident, and "https" would match
    // every recipe carrying a link at all.
    else if ([recipe.author, recipe.source, recipe.sourceName]
      .some(field => field !== null && groceryNameKey(field).includes(q))) weight = 0.4;
    // Notes last, and last on purpose: it's the one free-text field, so it's
    // where an incidental mention lives ("used up the chicken from Sunday").
    // Ranked below every deliberate match, that noise lands under the real hits
    // rather than displacing them — the same trade fuzzySearch makes weighting a
    // task's notes at 0.5 against its title's 2.
    else if (groceryNameKey(recipe.notes).includes(q)) weight = 0.25;
    if (weight > 0) scored.push({ recipe, weight });
  }
  return scored
    .sort((a, b) =>
      b.weight - a.weight ||
      voteRank(a.recipe.vote) - voteRank(b.recipe.vote) ||
      a.recipe.name.localeCompare(b.recipe.name)
    )
    .map(s => s.recipe);
}

/**
 * Field updates to apply when a cook timer session finishes — the recipe
 * counterpart of effort.ts's applyMeasuredTime. `lastCookMinutes` is always
 * set and `cookTimeCount`/`totalCookMinutes` always advance; `estimatedMinutes`
 * is only backfilled when the recipe has never had a duration of its own, so a
 * typed estimate is never silently overwritten by a single measurement.
 *
 * Tasks deliberately no longer work this way — applyMeasuredTime overwrites,
 * because timing a task exists to correct its estimate. A recipe differs in
 * that its duration is part of the written recipe, shared by everyone who
 * cooks it, and one slow evening shouldn't rewrite it.
 */
/**
 * Prep + cook, whenever either is set — the number `describeRecipe` shows
 * next to the ingredient count. Null only when neither field has ever been
 * given a value; once one has, the other's absence reads as 0 rather than
 * making the total unknowable, the same rule `describeRecipe`'s `servings`
 * clause already applies to a servings-less yield.
 */
export function totalMinutes(recipe: Pick<Recipe, 'prepMinutes' | 'estimatedMinutes'>): number | null {
  if (recipe.prepMinutes == null && recipe.estimatedMinutes == null) return null;
  return (recipe.prepMinutes ?? 0) + (recipe.estimatedMinutes ?? 0);
}

export function applyMeasuredCookTime(
  minutes: number,
  recipe: Pick<Recipe, 'estimatedMinutes' | 'cookTimeCount' | 'totalCookMinutes'>
): {
  lastCookMinutes: number;
  cookTimeCount: number;
  totalCookMinutes: number;
  estimatedMinutes?: number;
} {
  const rounded = Math.max(1, Math.round(minutes));
  const patch = {
    lastCookMinutes: rounded,
    cookTimeCount: recipe.cookTimeCount + 1,
    totalCookMinutes: recipe.totalCookMinutes + rounded,
  };
  if (recipe.estimatedMinutes != null) return patch;
  return { ...patch, estimatedMinutes: rounded };
}

/** The prep-timer counterpart of `applyMeasuredCookTime` — same shape, same backfill-only-if-unset rule, targeting `prepMinutes` instead of `estimatedMinutes`. */
export function applyMeasuredPrepTime(
  minutes: number,
  recipe: Pick<Recipe, 'prepMinutes' | 'prepTimeCount' | 'totalPrepMinutes'>
): {
  lastPrepMinutes: number;
  prepTimeCount: number;
  totalPrepMinutes: number;
  prepMinutes?: number;
} {
  const rounded = Math.max(1, Math.round(minutes));
  const patch = {
    lastPrepMinutes: rounded,
    prepTimeCount: recipe.prepTimeCount + 1,
    totalPrepMinutes: recipe.totalPrepMinutes + rounded,
  };
  if (recipe.prepMinutes != null) return patch;
  return { ...patch, prepMinutes: rounded };
}

/**
 * The running average of logged cook sessions — `totalCookMinutes /
 * cookTimeCount`, derived at read time rather than stored, same as
 * describeShops derives a grocery item's per-store share from its links
 * rather than ever summing them into a stored total. Null until at least one
 * session has been logged.
 */
export function avgCookMinutes(recipe: Pick<Recipe, 'cookTimeCount' | 'totalCookMinutes'>): number | null {
  if (recipe.cookTimeCount <= 0) return null;
  return Math.round(recipe.totalCookMinutes / recipe.cookTimeCount);
}

/** The prep-timer counterpart of `avgCookMinutes`. */
export function avgPrepMinutes(recipe: Pick<Recipe, 'prepTimeCount' | 'totalPrepMinutes'>): number | null {
  if (recipe.prepTimeCount <= 0) return null;
  return Math.round(recipe.totalPrepMinutes / recipe.prepTimeCount);
}

/**
 * "Est. 25m · took 32m last time" / "Est. 25m · avg 30m over 4 cooks" — the
 * line that puts a recipe's static estimate next to what cooking it has
 * actually taken, so the two can be compared rather than the estimate just
 * being trusted forever. Empty when there's nothing to say yet.
 */
export function describeCookTime(recipe: Recipe): string {
  const parts: string[] = [];
  if (recipe.estimatedMinutes) parts.push(`Est. ${formatDuration(recipe.estimatedMinutes)}`);
  if (recipe.lastCookMinutes != null) {
    parts.push(recipe.cookTimeCount > 1
      ? `took ${formatDuration(recipe.lastCookMinutes)} last time`
      : `took ${formatDuration(recipe.lastCookMinutes)}`);
  }
  const avg = avgCookMinutes(recipe);
  if (avg != null && recipe.cookTimeCount > 1) {
    parts.push(`avg ${formatDuration(avg)} over ${recipe.cookTimeCount} cooks`);
  }
  return parts.join(' · ');
}

/** The prep-timer counterpart of `describeCookTime`. */
export function describePrepTime(recipe: Recipe): string {
  const parts: string[] = [];
  if (recipe.prepMinutes) parts.push(`Est. ${formatDuration(recipe.prepMinutes)}`);
  if (recipe.lastPrepMinutes != null) {
    parts.push(recipe.prepTimeCount > 1
      ? `took ${formatDuration(recipe.lastPrepMinutes)} last time`
      : `took ${formatDuration(recipe.lastPrepMinutes)}`);
  }
  const avg = avgPrepMinutes(recipe);
  if (avg != null && recipe.prepTimeCount > 1) {
    parts.push(`avg ${formatDuration(avg)} over ${recipe.prepTimeCount} preps`);
  }
  return parts.join(' · ');
}

/**
 * Loved-first ordering for the unfiltered recipe box — the same sort
 * RecipesScreen has always applied to its flat list, pulled out so
 * groupRecipesByMealType can give each of its sections the identical order
 * instead of inventing a second one. A search ranking (rankRecipes) is a
 * different question — "what matches this text" — so it's never routed
 * through here.
 *
 * Ranked by `vote` rather than a separate favorite flag — loved
 * first, then liked, then no opinion, then never-again last — with
 * `sortOrder` breaking ties within a rung. Most recipes carry no vote at
 * all, so for them this is exactly the plain `sortOrder` list it always was;
 * only an explicitly rated recipe moves.
 */
export function sortRecipesForDisplay(recipes: readonly Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) =>
    voteRank(a.vote) - voteRank(b.vote) || a.sortOrder - b.sortOrder
  );
}

// Loved first, then liked, then no opinion, then never-again last — the same
// order productsForItem ranks ProductRating in (groceryProduct.ts), minus
// that list's "preferred" rung, which a recipe has no equivalent of. No
// opinion sits above never-again for the same reason it always did: cooking
// something you never explicitly rejected isn't the same as having decided
// against it.
function voteRank(vote: RecipeVote | null): number {
  if (vote === 'loved') return 0;
  if (vote === 'liked') return 1;
  if (vote === 'never') return 3;
  return 2;
}

/**
 * The box's sort options beyond the default loved-first order — driven by
 * RecipeSortFilterSheet, mirroring SortFilterSheet's `sort` for tasks. Kept as
 * one switch over RecipeSortOption (rather than a comparator per screen)
 * because it's the one place `describeCookHistory`'s underlying fields
 * (cookCount/lastCookedAt) get compared, and duplicating that would drift.
 *
 * Never-cooked recipes (`lastCookedAt: null`) sort to the *end* of either cook
 * direction — "not cooked in a while" means "you have cooked it, and it's
 * been a while", not "you've never made this", which `describeCookHistory`
 * already renders as no caption at all rather than "cooked never".
 */
export function sortRecipesBy(recipes: readonly Recipe[], sort: RecipeSortOption): Recipe[] {
  switch (sort) {
    case 'name':
      return [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    case 'cooked-recent':
      return [...recipes].sort((a, b) => {
        if (!a.lastCookedAt && !b.lastCookedAt) return 0;
        if (!a.lastCookedAt) return 1;
        if (!b.lastCookedAt) return -1;
        return b.lastCookedAt.localeCompare(a.lastCookedAt);
      });
    case 'cooked-oldest':
      return [...recipes].sort((a, b) => {
        if (!a.lastCookedAt && !b.lastCookedAt) return 0;
        if (!a.lastCookedAt) return 1;
        if (!b.lastCookedAt) return -1;
        return a.lastCookedAt.localeCompare(b.lastCookedAt);
      });
    case 'ingredients-asc':
      return [...recipes].sort((a, b) => a.ingredients.length - b.ingredients.length);
    case 'ingredients-desc':
      return [...recipes].sort((a, b) => b.ingredients.length - a.ingredients.length);
    case 'default':
    default:
      return sortRecipesForDisplay(recipes);
  }
}

export interface RecipeMealTypeSection {
  /** null is the trailing "Untagged" section — RecipeMealType has no null member of its own. */
  mealType: RecipeMealType | null;
  title: string;
  data: Recipe[];
}

/**
 * Groups recipes into sections by RecipeMealType, in RECIPE_MEAL_TYPES' fixed
 * display order — mirroring how makeCategoryGroups orders Today's category
 * sections by a fixed list rather than alphabetically or by section size.
 * Untagged recipes (mealType: null) trail in their own section rather than
 * leading like Today's header-less loose group: most existing recipes predate
 * this field, so leading with a wall of "Untagged" would bury the very
 * grouping the user just asked for. That does mean the drag surface (below)
 * has to forbid dropping a recipe above the very first header — there's no
 * "above every section" region here the way Today has one for uncategorized.
 *
 * A meal type with no recipes is omitted entirely rather than rendered empty,
 * same as makeCategoryGroups omitting empty categories.
 *
 * `sort` orders each section independently, defaulting to the loved-first
 * order every section used before RecipeSortFilterSheet existed — a caller
 * that never asked for a different sort keeps exactly the layout it had.
 */
export function groupRecipesByMealType(
  recipes: readonly Recipe[],
  sort: (list: readonly Recipe[]) => Recipe[] = sortRecipesForDisplay,
): RecipeMealTypeSection[] {
  const byType = new Map<string, Recipe[]>();
  recipes.forEach(recipe => {
    const key = recipe.mealType ?? '';
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(recipe);
  });

  const sections: RecipeMealTypeSection[] = [];
  RECIPE_MEAL_TYPES.forEach(mealType => {
    const list = byType.get(mealType);
    if (list && list.length > 0) {
      sections.push({ mealType, title: RECIPE_MEAL_TYPE_LABELS[mealType], data: sort(list) });
    }
  });
  const untagged = byType.get('');
  if (untagged && untagged.length > 0) {
    sections.push({ mealType: null, title: 'Untagged', data: sort(untagged) });
  }
  return sections;
}

/** One row of the grouped, draggable recipe list — a section header or a recipe. */
export type RecipeListItem =
  | { type: 'header'; mealType: RecipeMealType | null; title: string }
  | { type: 'recipe'; recipe: Recipe };

/** Flattens grouped sections into the row list RecipesScreen's ReorderableList drags. */
export function flattenRecipeMealTypeSections(sections: readonly RecipeMealTypeSection[]): RecipeListItem[] {
  const items: RecipeListItem[] = [];
  sections.forEach(section => {
    items.push({ type: 'header', mealType: section.mealType, title: section.title });
    section.data.forEach(recipe => items.push({ type: 'recipe', recipe }));
  });
  return items;
}

/**
 * The stable identity of a meal-type section, independent of its display
 * title — used both for the header's row key below and as the key
 * RecipesScreen collapses a section by (settings' `collapsedRecipeSections`).
 */
export function recipeSectionKey(mealType: RecipeMealType | null): string {
  return mealType ?? 'untagged';
}

/** Stable row key for a RecipeListItem, for ReorderableList's keyExtractor. */
export function recipeListItemKey(item: RecipeListItem): string {
  return item.type === 'header' ? `h-${recipeSectionKey(item.mealType)}` : item.recipe.id;
}

/**
 * Resolve a drag-and-drop on the grouped recipe list into mealType writes.
 *
 * A recipe adopts the mealType of the nearest header above it — same rule
 * `resolveDrop` (taskGrouping.ts) applies for tasks and Today's categories.
 * There's no "above every header" case to handle here (unlike Today, where
 * that region is the loose/uncategorized group): the caller's dragRange must
 * keep row 0 — always a header, since groupRecipesByMealType never emits an
 * empty section — off limits to a drop.
 *
 * `hiddenRecipes` are recipes left out of `reordered` entirely — a collapsed
 * section's rows, which RecipesScreen hides from the draggable list rather
 * than passing through untouched (a whole section is hidden or not, so
 * there's nothing of theirs to reorder). Without them here, rebuilding
 * `settled` from `reordered` alone would drop every recipe a collapsed
 * section holds the moment any other section is dragged. Their own mealType
 * is left exactly as it was — they were never in reach of the drop.
 *
 * `settled` is the regrouped layout (rebuilt with groupRecipesByMealType, so
 * loved-first order within a section is preserved) to render immediately,
 * matching what the store-derived list will recompute to once the writes land.
 */
export function resolveRecipeMealTypeDrop(
  reordered: readonly RecipeListItem[],
  hiddenRecipes: readonly Recipe[] = [],
): {
  mealTypeUpdates: Array<{ id: string; mealType: RecipeMealType | null }>;
  settled: RecipeListItem[];
} {
  const mealTypeUpdates: Array<{ id: string; mealType: RecipeMealType | null }> = [];
  const updatedRecipes: Recipe[] = [...hiddenRecipes];
  let currentMealType: RecipeMealType | null = null;
  reordered.forEach(item => {
    if (item.type === 'header') {
      currentMealType = item.mealType;
      return;
    }
    if (item.recipe.mealType !== currentMealType) {
      mealTypeUpdates.push({ id: item.recipe.id, mealType: currentMealType });
      updatedRecipes.push({ ...item.recipe, mealType: currentMealType });
    } else {
      updatedRecipes.push(item.recipe);
    }
  });
  return { mealTypeUpdates, settled: flattenRecipeMealTypeSections(groupRecipesByMealType(updatedRecipes)) };
}

/** "Cooked once" / "Cooked 4× · last on Jul 12" — empty when never cooked. */
export function describeCookHistory(recipe: Recipe): string {
  if (recipe.cookCount === 0) return '';
  const times = recipe.cookCount === 1 ? 'once' : `${recipe.cookCount}×`;
  if (!recipe.lastCookedAt) return `Cooked ${times}`;
  return `Cooked ${times} · last on ${format(new Date(recipe.lastCookedAt), 'MMM d')}`;
}

const DAY_MS = 86_400_000;
/** Score halves every this many days since last cooked — mirrors grocerySuggest's monthly halving. */
const COOK_RECENCY_HALF_LIFE_DAYS = 30;

function cookFamiliarity(recipe: Recipe, now: Date): number {
  const frequency = 1 + Math.log1p(recipe.cookCount);
  const days = recipe.lastCookedAt
    ? Math.max(0, (now.getTime() - new Date(recipe.lastCookedAt).getTime()) / DAY_MS)
    : Infinity;
  const recency = days === Infinity ? 0.5 : 0.5 ** (days / COOK_RECENCY_HALF_LIFE_DAYS);
  return frequency * recency;
}

/**
 * The "Cook again" shelf — recipes made often and made recently, same
 * frequency × recency halving as rankGrocerySuggestions/rankedCatalogItems so this
 * behaves the way the grocery autocomplete has already taught the user to
 * expect. Only recipes with at least one cooking: a never-made recipe has
 * nothing to rank on here (rankRecipes' search already covers "what do I have").
 */
export function rankRecipeSuggestions(recipes: readonly Recipe[], now: Date, limit = 3): Recipe[] {
  return recipes
    .filter(r => r.cookCount > 0)
    .map(recipe => ({ recipe, score: cookFamiliarity(recipe, now) }))
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
    .map(x => x.recipe);
}

/** Score halves every this many days since last bought — same monthly cadence as the cook-history one above. */
const PURCHASE_RECENCY_HALF_LIFE_DAYS = 30;

function purchaseRecency(item: GroceryItem, now: Date): number {
  if (!item.lastPurchasedAt) return 0.5; // in the catalog but never bought — a wash, not a penalty
  const days = Math.max(0, (now.getTime() - new Date(item.lastPurchasedAt).getTime()) / DAY_MS);
  return 0.5 ** (days / PURCHASE_RECENCY_HALF_LIFE_DAYS);
}

/**
 * How much a "what can I cook" suggestion should be discounted for having
 * been cooked recently (#1103) — the mirror image of `cookFamiliarity`
 * above: that one *rewards* a recent cook for the "Cook again" shelf,
 * because pulling up something you already know you like is the point of
 * that shelf. This one *penalizes* it, because the point of an empty-night
 * suggestion is variety — the same dinner every week is exactly what this
 * feature exists to avoid repeating.
 *
 * A two-week half-life (not the 30-day one used elsewhere) so "made this two
 * nights ago" reads as a real discount instead of a rounding error, while a
 * favorite from three-plus weeks back is most of the way back to full
 * strength. Never cooked (or no cook history) applies no discount at all —
 * `1`, not a bonus — since a made-up recency can't be more novel than
 * genuinely unknown.
 *
 * Bounded to at most a `MAX_RECENCY_DISCOUNT` (50%) cut, deliberately not
 * closer to 100%: catalog coverage is what answers "can I actually cook
 * this tonight", and recency is a nudge on top of that answer, not a veto —
 * a well-stocked recipe must still be able to outrank a poorly-stocked one
 * cooked a month ago, however many nights it's been.
 */
const SUGGESTION_NOVELTY_HALF_LIFE_DAYS = 14;
const MAX_RECENCY_DISCOUNT = 0.5;

function suggestionNovelty(recipe: Pick<Recipe, 'lastCookedAt'>, now: Date): number {
  if (!recipe.lastCookedAt) return 1;
  const days = Math.max(0, (now.getTime() - new Date(recipe.lastCookedAt).getTime()) / DAY_MS);
  const closeness = 0.5 ** (days / SUGGESTION_NOVELTY_HALF_LIFE_DAYS); // 1 right after cooking, → 0 as it fades
  return 1 - MAX_RECENCY_DISCOUNT * closeness;
}

/**
 * How well a recipe fits what's actually in the catalog, for "what can I
 * make tonight" — not what the user has cooked before (that's
 * rankRecipeSuggestions' job), but what they could cook *right now* without
 * a special trip. Coverage (the fraction of the recipe's ingredients that
 * are already known items) dominates; how recently those ingredients were
 * bought only nudges the ranking, since an item you bought once six months
 * ago still means you've made this before and know how to get it.
 *
 * How recently the *recipe itself* was last cooked nudges it the other way
 * (#1103, `suggestionNovelty`) — a recipe made two nights ago is discounted
 * so it doesn't crowd out something that hasn't come up in a while, without
 * that discount ever being able to drop a well-stocked recipe below a
 * poorly-stocked one just because it's due for a repeat.
 *
 * Zero for a recipe with no ingredients or nothing in common with the
 * catalog — there is nothing here to recommend it over any other empty
 * night, regardless of how long it's been since it was cooked.
 */
/** Coverage has to clear this before a recipe reads as "made from the catalog" rather than
 * "shares one ingredient with it" — see `suggestRecipesForEmptyNight`. */
const MIN_SUGGESTION_COVERAGE = 0.5;

// How strongly a substitute-covered ingredient contributes to the recency
// average, relative to a genuine direct purchase (1.0). Less than a direct
// match, per #1568 — two recipes, one fully stocked and one stocked only via
// substitutes, must not rank equally — but still a real credit: an unpurchased
// or long-stale catalog row already contributes ~0.5 on its own (a wash, not
// a penalty — see purchaseRecency), so this only matters, and only helps,
// when the substitute genuinely beats that.
const SUBSTITUTE_RECENCY_CREDIT = 0.75;

function catalogCoverage(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
  itemSubs: readonly ItemSubLink[] = [],
): { matched: number; total: number; coverage: number; avgRecency: number } {
  // Coverage has to be measured over everything the dish actually needs — a
  // parent with two ingredients of its own would otherwise score as a night's
  // cooking away from ready while its components' shopping list is untouched.
  //
  // Resolved to the defaults, deliberately unlike rankRecipes' `allOptions`
  // search: this is a fraction, and counting every alternative inflates the
  // denominator with lines that will never be bought, so a recipe offering a
  // choice would score as less ready than the same recipe without one.
  // Standing swaps applied, for the reason pantryCoverageForRecipe gives: this
  // is "how ready am I to cook this", and the answer is about the ingredients
  // this kitchen actually uses.
  const ingredients = flattenRecipeIngredients(
    recipe, recipesById ?? new Map([[recipe.id, recipe]]), undefined, standingSwapMap(itemSubs, items)
  ).map(f => f.ingredient);
  if (ingredients.length === 0) return { matched: 0, total: 0, coverage: 0, avgRecency: 0 };
  const byKey = new Map(items.map(i => [i.nameKey, i]));
  let matched = 0;
  let recencySum = 0;
  for (const ingredient of ingredients) {
    const item = byKey.get(ingredient.nameKey);
    if (!item) continue;
    matched += 1;
    // `matched` (hence `coverage`) is existence-only and unaffected by
    // substitutes — a link can only exist between two rows that are already
    // catalog items (see linkItemSub), so an ingredient with no catalog row
    // at all can never carry one anyway; there is nothing here to credit that
    // isn't already counted. What a substitute *can* fix is a row that exists
    // but reads as stale or never-bought: its own recency is a wash (0.5) or
    // worse, while a linked substitute the app currently thinks is on hand is
    // a real, if lesser, signal that this line is actually coverable tonight.
    const own = purchaseRecency(item, now);
    const subs = substitutesOnHand(item.id, itemSubs, items, now);
    const recency = subs.length > 0 ? Math.max(own, SUBSTITUTE_RECENCY_CREDIT) : own;
    recencySum += recency;
  }
  return {
    matched,
    total: ingredients.length,
    coverage: matched / ingredients.length,
    avgRecency: matched === 0 ? 0 : recencySum / matched,
  };
}

export function scoreRecipeAgainstCatalog(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
  itemSubs: readonly ItemSubLink[] = [],
): number {
  const { matched, coverage, avgRecency } = catalogCoverage(recipe, items, now, recipesById, itemSubs);
  if (matched === 0) return 0;
  const catalogFit = coverage * (0.5 + 0.5 * avgRecency);
  return catalogFit * suggestionNovelty(recipe, now);
}

/**
 * The "what can I make from what I've got" shelf for an empty night —
 * `scoreRecipeAgainstCatalog`, ranked and capped. Deliberately offline and
 * ungated: the AI half of meal-idea suggestion (inventing a new recipe from
 * nothing) is a separate, much larger surface — this is "the offline
 * suggestions should be the better ones" being taken at its word, not a
 * fallback for when there's no API key.
 *
 * Gated on `MIN_SUGGESTION_COVERAGE`, not just "shares an ingredient" —
 * without a floor, a recipe with one match out of eleven ingredients still
 * scored above zero and could out-rank an empty result set, which reads as
 * the app recommending a dish you're nowhere close to being able to cook.
 */
export function suggestRecipesForEmptyNight(
  recipes: readonly Recipe[],
  items: readonly GroceryItem[],
  now: Date,
  limit = 3,
  itemSubs: readonly ItemSubLink[] = [],
): Recipe[] {
  const byId = recipeMap(recipes);
  return recipes
    .map(recipe => ({ recipe, ...catalogCoverage(recipe, items, now, byId, itemSubs) }))
    .filter(x => x.coverage >= MIN_SUGGESTION_COVERAGE)
    .map(x => ({ recipe: x.recipe, score: scoreRecipeAgainstCatalog(x.recipe, items, now, byId, itemSubs) }))
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
    .map(x => x.recipe);
}

// A token that is nothing but a web address. Anchored at both ends, so a line
// of prose that happens to contain a link ("adapted from https://…, but I use
// less salt") isn't one — the same both-ends discipline mealPlanGroceries'
// WHOLE_QUANTITY uses, and for the same reason: this decides whether to refuse
// something, so it has to be sure.
const BARE_URL = /^(https?:\/\/|www\.)\S+$/i;

/**
 * Whether pasted text is *only* links — the case the paste box has to refuse
 * rather than run.
 *
 * The paste box sends what you type straight to the model, which has no way to
 * open a page: handed a bare URL it does the only thing it can and writes a
 * plausible recipe from the words in the address, which arrives looking exactly
 * like a successful import (#1607). That's the worst failure this app has —
 * silently invented data the user has no reason to distrust — so it's blocked
 * up front rather than defended against downstream.
 *
 * **Still a refusal now that the Link tab exists**, because it is a fact about
 * the *paste* box and nothing about that changed: the model still can't open a
 * page, and the address still contains no ingredients. What changed is where it
 * sends you — `RecipeSourcePicker` turns this into the offer of the tab that
 * fetches the page, carrying the address over with it.
 *
 * Deliberately requires *every* non-empty line to be a bare address. A real
 * paste from a recipe site is prose and quantities with a URL somewhere in it,
 * and that must go through untouched.
 */
export function looksLikeBareUrl(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(line => BARE_URL.test(line));
}

/**
 * Whether a recipe already carries a method of its own.
 *
 * `notes` counts, and that's the conservative half: every recipe predating
 * `Recipe.steps` keeps its method in that blob (see the cook mode notes), and
 * nothing can tell a method there apart from "I like this with extra chilli".
 * Reading non-empty `notes` as a method means the odd recipe whose notes are
 * only a remark gets `RecipeExtractSheet`'s method row unticked when it could
 * have been ticked — one extra tap, weighed against silently writing a second
 * copy of a method the recipe already shows.
 *
 * Deliberately a question about *having* one, not about which field holds it:
 * every caller is deciding whether there is something here to land on top of.
 */
export function recipeHasMethod(recipe: Recipe | null | undefined): boolean {
  return !!recipe && (recipe.steps.length > 0 || !!recipe.notes.trim());
}

/** Whether a recipe already carries any prep tasks of its own. */
export function recipeHasPrepTasks(recipe: Recipe | null | undefined): boolean {
  return !!recipe && recipe.prepTasks.length > 0;
}

/**
 * Whether a recipe carries any attribution at all.
 *
 * The three fields are independent by design (a recipe can name a person and
 * no publication, or a URL and neither), so this asks whether *any* of them is
 * set — an import filling in the blanks is only uncontroversial when they are
 * all blank. `sourceName` is the legacy field nothing writes any more and is
 * read here for the same reason `describeRecipe` still falls back to it: an old
 * recipe carrying only that one is still a recipe that says where it came from.
 */
export function recipeHasAttribution(recipe: Recipe | null | undefined): boolean {
  return !!recipe && (!!recipe.sourceUrl || !!recipe.source || !!recipe.author || !!recipe.sourceName);
}
