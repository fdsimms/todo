/**
 * Recipes and the meal plan. Read both; the one write is putting a meal on the
 * plan. Same contract as tools.ts.
 */
import type { MealPlanEntry, MealSlot, Recipe } from '../../src/types';
import type { MealChoice, MealPatch, Replica } from './replica';

export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const RECIPE_LIMIT = 50;
export const DEFAULT_PLAN_DAYS = 7;
export const MAX_PLAN_DAYS = 62;

export interface SerializedRecipe {
  id: string;
  name: string;
  mealType?: string;
  tags?: string[];
  servings?: number;
  minutes?: number;
  /** 'loved' | 'liked' | 'never', when the user rated it. */
  vote?: string;
  timesCooked?: number;
  lastCooked?: string;
  /** On the user's "Up next" shelf. */
  upNext?: boolean;
  cookbook?: string;
}

function serializeRecipe(r: Recipe, cookbooks: Map<string, string>): SerializedRecipe {
  return {
    id: r.id,
    name: r.name,
    ...(r.mealType ? { mealType: r.mealType } : {}),
    ...(r.tags.length > 0 ? { tags: r.tags } : {}),
    ...(r.servings ? { servings: r.servings } : {}),
    ...(r.estimatedMinutes ? { minutes: r.estimatedMinutes } : {}),
    ...(r.vote ? { vote: r.vote } : {}),
    ...(r.cookCount > 0 ? { timesCooked: r.cookCount } : {}),
    ...(r.lastCookedAt ? { lastCooked: r.lastCookedAt } : {}),
    ...(r.upNext ? { upNext: true } : {}),
    ...(r.cookbookId && cookbooks.has(r.cookbookId) ? { cookbook: cookbooks.get(r.cookbookId) } : {}),
  };
}

export interface ListRecipesInput {
  /** Matches the name, a tag, or an ingredient. */
  query?: string;
  mealType?: string;
  upNext?: boolean;
  limit?: number;
}

export function listRecipes(replica: Replica, input: ListRecipesInput = {}): { recipes: SerializedRecipe[]; matched: number } {
  const cookbooks = new Map(replica.cookbooks().map(c => [c.id, c.title]));
  const q = input.query?.trim().toLowerCase();
  const hits = replica
    .recipes()
    .filter(r => !input.mealType || r.mealType === input.mealType)
    .filter(r => input.upNext === undefined || r.upNext === input.upNext)
    .filter(r => !q
      || r.name.toLowerCase().includes(q)
      || r.tags.some(t => t.toLowerCase().includes(q))
      || r.ingredients.some(i => i.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const limit = Math.min(Math.max(input.limit ?? RECIPE_LIMIT, 1), RECIPE_LIMIT);
  return { matched: hits.length, recipes: hits.slice(0, limit).map(r => serializeRecipe(r, cookbooks)) };
}

export interface RecipeDetail extends SerializedRecipe {
  notes?: string;
  source?: string;
  ingredients: { section?: string; quantity?: string; name: string; prep?: string; optional?: boolean; oneOf?: string }[];
  steps: { section?: string; text: string; timerSeconds?: number; note?: string }[];
  /** Other recipes used inside this one ("the pie crust"). */
  uses?: string[];
  /** The same, by recipe id; ones sharing a choiceGroup are alternatives (cook one). */
  components?: { recipeId: string; name: string; choiceGroup?: string }[];
  /** Tasks written ahead of a planned meal of it, days before the meal (negative) or on the day (0). */
  prepTasks?: { title: string; offsetDays: number; reminderOffsetMinutes?: number }[];
  cookbookId?: string;
  page?: string;
  author?: string;
  servingsMax?: number;
  yield?: string;
  prepMinutes?: number;
  leftoverKeepDays?: number;
  /** Minutes the last measured cook took. */
  lastCookMinutes?: number;
}

export function getRecipe(replica: Replica, id: string): RecipeDetail | null {
  const all = replica.recipes();
  const r = all.find(x => x.id === id);
  if (!r) return null;
  // A component shows the used recipe's name as it is now (RecipeComponent.name is the fallback).
  const names = new Map(all.map(x => [x.id, x.name]));
  const cookbooks = new Map(replica.cookbooks().map(c => [c.id, c.title]));
  const source = [
    r.cookbookId && cookbooks.get(r.cookbookId),
    r.sourcePage ? `p. ${r.sourcePage}` : null,
    r.sourceName,
    r.author,
    r.sourceUrl,
  ].filter(Boolean).join(', ');
  return {
    ...serializeRecipe(r, cookbooks),
    ...(r.notes ? { notes: r.notes } : {}),
    ...(source ? { source } : {}),
    ingredients: r.ingredients.map(i => ({
      ...(i.section ? { section: i.section } : {}),
      ...(i.quantity ? { quantity: i.quantity } : {}),
      name: i.name,
      ...(i.prep ? { prep: i.prep } : {}),
      ...(i.optional ? { optional: true } : {}),
      // Lines sharing a group are alternatives: use one of them.
      ...(i.choiceGroup ? { oneOf: i.choiceGroup } : {}),
    })),
    steps: r.steps.map(s => ({
      ...(s.section ? { section: s.section } : {}),
      text: s.text,
      ...(s.timerSeconds ? { timerSeconds: s.timerSeconds } : {}),
      ...(s.note ? { note: s.note } : {}),
    })),
    ...(r.components.length > 0 ? { uses: r.components.map(c => names.get(c.recipeId) ?? c.name) } : {}),
    ...(r.components.length > 0
      ? { components: r.components.map(c => ({ recipeId: c.recipeId, name: names.get(c.recipeId) ?? c.name, ...(c.choiceGroup ? { choiceGroup: c.choiceGroup } : {}) })) }
      : {}),
    ...(r.prepTasks.length > 0
      ? { prepTasks: r.prepTasks.map(p => ({ title: p.title, offsetDays: p.offsetDays, ...(p.reminderOffsetMinutes != null ? { reminderOffsetMinutes: p.reminderOffsetMinutes } : {}) })) }
      : {}),
    ...(r.cookbookId ? { cookbookId: r.cookbookId } : {}),
    ...(r.sourcePage ? { page: r.sourcePage } : {}),
    ...(r.author ? { author: r.author } : {}),
    ...(r.servingsMax ? { servingsMax: r.servingsMax } : {}),
    ...(r.recipeYield ? { yield: r.recipeYield } : {}),
    ...(r.prepMinutes ? { prepMinutes: r.prepMinutes } : {}),
    ...(r.leftoverKeepDays != null ? { leftoverKeepDays: r.leftoverKeepDays } : {}),
    ...(r.lastCookMinutes ? { lastCookMinutes: r.lastCookMinutes } : {}),
  };
}

export interface SerializedMeal {
  id: string;
  date: string;
  slot: MealSlot;
  title: string;
  recipeId?: string;
  /** A leftover night: the container it eats from. */
  leftoverId?: string;
  cooked?: boolean;
  /** How much of the recipe: 2 doubles it, 0.5 halves it. Absent when as written. */
  scale?: number;
  /** Its either/or questions and the option in force for each. */
  choices?: MealChoice[];
  /** The per-meal answers to the meal task settings; absent when the setting decides. */
  shopTask?: boolean;
  thawTask?: boolean;
  logMeal?: boolean;
  cookTask?: boolean;
}

function serializeMeal(e: MealPlanEntry, recipes: Map<string, string>, replica?: Replica): SerializedMeal {
  const choices = replica ? replica.mealChoices(e) : [];
  return {
    id: e.id,
    date: e.date,
    slot: e.slot,
    // The recipe's name as it is now, since a rename after planning should show;
    // the captured title is the fallback for a recipe since deleted.
    title: (e.recipeId && recipes.get(e.recipeId)) || e.title,
    ...(e.recipeId ? { recipeId: e.recipeId } : {}),
    ...(e.leftoverId ? { leftoverId: e.leftoverId } : {}),
    ...(e.cookedAt ? { cooked: true } : {}),
    ...(e.recipeId && e.recipeScale !== 1 ? { scale: e.recipeScale } : {}),
    ...(choices.length > 0 ? { choices } : {}),
    ...(e.shopTask != null ? { shopTask: e.shopTask } : {}),
    ...(e.thawTask != null ? { thawTask: e.thawTask } : {}),
    ...(e.logMeal != null ? { logMeal: e.logMeal } : {}),
    ...(e.cookTask != null ? { cookTask: e.cookTask } : {}),
  };
}

export interface MealPlanInput {
  from?: string;
  to?: string;
  days?: number;
}

/** Planned meals over a range of days, defaulting to the coming week from today. */
export function listMealPlan(replica: Replica, input: MealPlanInput = {}): { from: string; to: string; meals: SerializedMeal[] } {
  const from = input.from ?? replica.todayKey();
  const days = Math.min(Math.max(input.days ?? DEFAULT_PLAN_DAYS, 1), MAX_PLAN_DAYS);
  const to = input.to ?? replica.shiftDayKey(from, days - 1);
  if (to < from) throw new Error('to is before from.');
  if (replica.shiftDayKey(from, MAX_PLAN_DAYS) < to) throw new Error(`At most ${MAX_PLAN_DAYS} days at a time.`);
  const names = new Map(replica.recipes().map(r => [r.id, r.name]));
  const order = (s: MealSlot) => MEAL_SLOTS.indexOf(s);
  return {
    from,
    to,
    meals: replica
      .mealPlan(from, to)
      .sort((a, b) => a.date.localeCompare(b.date) || order(a.slot) - order(b.slot) || a.sortOrder - b.sortOrder)
      .map(e => serializeMeal(e, names, replica)),
  };
}

export function planMeal(
  replica: Replica,
  input: { date: string; slot: MealSlot; recipeId?: string | null; leftoverId?: string | null; title?: string },
): SerializedMeal {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('date must be YYYY-MM-DD.');
  if (!MEAL_SLOTS.includes(input.slot)) throw new Error(`slot must be one of ${MEAL_SLOTS.join(', ')}.`);
  if (!input.recipeId && !input.leftoverId && !input.title?.trim()) throw new Error('Give a recipeId, a leftoverId, or a title for a meal with no recipe.');
  const entry = replica.planMeal(input);
  return serializeMeal(entry, names(replica), replica);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function names(replica: Replica): Map<string, string> {
  return new Map(replica.recipes().map(r => [r.id, r.name]));
}

export function updateMeal(replica: Replica, id: string, patch: MealPatch): SerializedMeal {
  if (patch.date !== undefined && !DATE.test(patch.date)) throw new Error('date must be YYYY-MM-DD.');
  if (patch.slot !== undefined && !MEAL_SLOTS.includes(patch.slot)) throw new Error(`slot must be one of ${MEAL_SLOTS.join(', ')}.`);
  const entry = replica.updateMeal(id, patch);
  return serializeMeal(entry, names(replica), replica);
}

export function removeMeal(replica: Replica, id: string): { removed: SerializedMeal } {
  const entry = replica.removeMeal(id);
  return { removed: serializeMeal(entry, names(replica)) };
}

export function setMealCooked(replica: Replica, id: string, cooked: boolean) {
  const result = replica.setMealCooked(id, cooked);
  const meal = serializeMeal(result.entry, names(replica));
  if ('opened' in result) {
    return {
      meal,
      ...(result.opened.length ? { markedOpened: result.opened } : {}),
      ...(result.tasksCompleted.length ? { tasksCompleted: result.tasksCompleted } : {}),
      note: 'The phone asks what the cooking used up, and about leftovers, when the person marks a meal cooked there; neither was asked here.',
    };
  }
  return { meal, ...(result.tasksReopened.length ? { tasksReopened: result.tasksReopened } : {}) };
}

export function saveMealAsRecipe(replica: Replica, id: string) {
  const { recipe, created, entry } = replica.saveMealAsRecipe(id);
  return {
    meal: serializeMeal(entry, names(replica)),
    recipe: { id: recipe.id, name: recipe.name },
    created,
    ...(created ? { note: 'The recipe is empty; update_recipe fills in its ingredients and steps.' } : {}),
  };
}

export function copyMeals(
  replica: Replica,
  input: { fromWeek?: string; toWeek?: string; slot?: MealSlot; mealId?: string; dates?: string[] },
) {
  const all = [input.fromWeek, input.toWeek, input.mealId, ...(input.dates ?? [])].filter((x): x is string => !!x);
  for (const d of [input.fromWeek, input.toWeek, ...(input.dates ?? [])]) {
    if (d !== undefined && !DATE.test(d)) throw new Error('Days are YYYY-MM-DD.');
  }
  if (all.length === 0) throw new Error('Give fromWeek and toWeek, or mealId and dates.');
  const n = names(replica);
  if (input.mealId) {
    if (!input.dates?.length) throw new Error('Give the dates to copy the meal to.');
    const { copied, skipped } = replica.copyMealTo(input.mealId, input.dates);
    return {
      copied: copied.map(e => serializeMeal(e, n)),
      ...(skipped.length ? { skipped, note: 'Those days already had this meal in that slot.' } : {}),
    };
  }
  if (!input.fromWeek || !input.toWeek) throw new Error('Give both fromWeek and toWeek (any day in each).');
  return { copied: replica.copyMealWeek(input.fromWeek, input.toWeek, input.slot).map(e => serializeMeal(e, n)) };
}
