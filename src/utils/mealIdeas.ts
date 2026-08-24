import type { Recipe, RecipeIngredient } from '../types';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { generateId } from './id';
import { cleanRecipeName, normalizeIngredient } from './recipeUtils';
import type { KitchenEntry } from './kitchenInventory';

/**
 * AI-invented meal ideas (#1063) — the *generation* half of the meal
 * suggestion flow, and deliberately not the same thing as
 * `suggestRecipesForEmptyNight`, which only ever ranks recipes the user
 * already owns against their grocery catalog.
 *
 * Everything here is pure: the bounds and the case-insensitive dedupe the
 * service applies to a model response, the rule that decides how an idea may
 * sit next to the offline ranking, and the mapping from an accepted idea to a
 * real `Recipe` draft. The network call itself is `suggestMealIdeas` /
 * `draftMealRecipe` in `src/services/aiSuggestions.ts`.
 *
 * **The settled rule this file exists to enforce: an AI idea supplements the
 * offline ranking, it never replaces it.** That was decided in #1041 and
 * restated in #1063, and it isn't a rendering preference — an invented dish
 * has no ingredients yet, no cook history, and nothing in the grocery catalog
 * behind it, so it can never out-rank a recipe the user has actually cooked.
 * `mergeMealSuggestions` is the one place that ordering lives, so no caller
 * can interleave the two lists by accident.
 */

/**
 * Same MIN/MAX shape `suggestTemplateItems` uses: the bounds are stated to
 * the model in the tool schema *and* enforced on the way back, because a
 * schema description is a request, not a guarantee.
 */
export const MIN_MEAL_IDEAS = 3;
export const MAX_MEAL_IDEAS = 6;

/** How far back a cooking still counts as "we just had that" for the prompt. */
export const RECENT_MEAL_DAYS = 21;

export interface MealIdea {
  /**
   * Client-side only, minted here rather than by the model — it keys a row and
   * tracks which ideas have been accepted or dismissed, and nothing invented
   * by a language model should ever be trusted as an identifier.
   */
  id: string;
  title: string;
  /** One line of "what this actually is", or empty when the model gave none. */
  blurb: string;
}

/** The un-validated shape a tool_use response hands back. */
export interface RawMealIdea {
  title?: unknown;
  blurb?: unknown;
}

/** The comparison key for "we already have that meal" — names, case-folded. */
export function mealTitleKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * How many ideas to ask for. The caller knows how many empty dinners there
 * are; the model is asked for that many, clamped into the MIN/MAX band so a
 * one-empty-night week still gets a choice to make and a wide-open month
 * doesn't ask for thirty dishes in one breath.
 */
export function clampIdeaCount(slotsToFill: number): number {
  if (!Number.isFinite(slotsToFill)) return MIN_MEAL_IDEAS;
  return Math.max(MIN_MEAL_IDEAS, Math.min(MAX_MEAL_IDEAS, Math.round(slotsToFill)));
}

/**
 * Validates a model response into ideas: drops blanks, trims to the same
 * length a recipe name is allowed, and drops anything colliding
 * case-insensitively with a title the caller already knows about (what's
 * planned this week, what was cooked recently, what's already in the recipe
 * box) or with an earlier idea in the same response. Same discipline
 * `suggestTemplateItems` applies to a template's existing items.
 */
export function dedupeMealIdeas(
  raw: readonly RawMealIdea[] | undefined,
  knownTitles: readonly string[] = [],
): MealIdea[] {
  if (!raw) return [];
  const seen = new Set(knownTitles.map(mealTitleKey).filter(Boolean));
  const out: MealIdea[] = [];
  for (const item of raw) {
    const title = typeof item?.title === 'string'
      ? item.title.trim().slice(0, RECIPE_NAME_MAX_LENGTH)
      : '';
    if (!title) continue;
    const key = mealTitleKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: generateId(),
      title,
      blurb: typeof item?.blurb === 'string' ? item.blurb.trim() : '',
    });
    if (out.length === MAX_MEAL_IDEAS) break;
  }
  return out;
}

/**
 * One row of the suggestion sheet. A discriminated union rather than a
 * flattened "recipe-ish" shape because the two are genuinely different
 * things: one is a `Recipe` that can be planned in a tap, the other is a
 * name the app invented and has to build a recipe for before it can plan it.
 * The sheet has to be able to tell them apart to say so on screen.
 */
export type MealSuggestion =
  | { kind: 'recipe'; key: string; recipe: Recipe }
  | { kind: 'idea'; key: string; idea: MealIdea };

/**
 * The supplement-never-replace rule, in one function.
 *
 * Every ranked recipe is emitted, in the order it arrived (the sheet doesn't
 * re-sort, and neither does this), and only then any ideas — so an AI idea
 * can never displace, reorder, or hide a recipe the user already owns. Ideas
 * whose name collides with a ranked recipe are dropped rather than shown
 * twice: the real one, with its ingredients and its cook history, wins.
 */
export function mergeMealSuggestions(
  ranked: readonly Recipe[],
  ideas: readonly MealIdea[] = [],
): MealSuggestion[] {
  const rankedKeys = new Set(ranked.map(r => mealTitleKey(r.name)));
  const out: MealSuggestion[] = ranked.map(recipe => ({
    kind: 'recipe' as const,
    key: `recipe:${recipe.id}`,
    recipe,
  }));
  for (const idea of ideas) {
    if (rankedKeys.has(mealTitleKey(idea.title))) continue;
    out.push({ kind: 'idea', key: `idea:${idea.id}`, idea });
  }
  return out;
}

/**
 * What the user has cooked lately, newest first — context for the prompt so
 * it doesn't propose Wednesday's dinner again on Friday. Recipes with no
 * `lastCookedAt`, or one older than `days`, aren't recent and aren't named.
 */
export function recentlyCookedTitles(
  recipes: readonly Recipe[],
  now: Date,
  days: number = RECENT_MEAL_DAYS,
  limit = 12,
): string[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return recipes
    .filter(r => {
      if (!r.lastCookedAt) return false;
      const at = new Date(r.lastCookedAt).getTime();
      return Number.isFinite(at) && at >= cutoff && at <= now.getTime();
    })
    .sort((a, b) => (b.lastCookedAt ?? '').localeCompare(a.lastCookedAt ?? ''))
    .slice(0, limit)
    .map(r => r.name);
}

/**
 * "Spinach — Use by today" for kitchen entries about to go bad, in whatever
 * order they're given (callers pass `useUpEntries(...)`, already most urgent
 * first). Handed to `suggestMealIdeas` as inspiration, never a requirement —
 * the prompt built around this list is what keeps it from forcing a dish
 * around an ingredient just to use it up.
 *
 * Reads only `title`/`useByCaption` — `Pick` rather than the full
 * `KitchenEntry`, since `reason` ("bought 6× · last on 12 Jul") is why the
 * pantry thinks the row exists at all, not something a meal idea needs to
 * know, and the narrower type is what lets a test build a fixture with two
 * fields instead of the whole shape.
 */
export function expiringItemHints(
  entries: readonly Pick<KitchenEntry, 'title' | 'useByCaption'>[],
): string[] {
  return entries.map(e => (e.useByCaption ? `${e.title} — ${e.useByCaption}` : e.title));
}

/** Same shape `ExtractedPrepTask` (aiSuggestions.ts) has — structurally, not
 * by import, so this file stays free of the network-calling service it feeds
 * (see the file-level comment above). */
export interface MealIdeaPrepTask {
  title: string;
  offsetDays: number;
}

export interface MealIdeaRecipeDraft {
  name: string;
  /** The idea's own blurb, carried onto the recipe rather than thrown away. */
  notes: string;
  ingredients: RecipeIngredient[];
  estimatedMinutes: number | null;
  steps: string[];
  prepTasks: MealIdeaPrepTask[];
}

/**
 * An accepted idea, as the arguments the recipe store wants: a name for
 * `addRecipe`, rows for `addStructuredIngredients`, and everything else
 * `draftMealRecipe` came back with, for `setNotes`/`setEstimatedMinutes`/
 * `addStep`/`addPrepTask`.
 *
 * Accepting an invented meal creates a *real* recipe (#1063) rather than a
 * free-text `MealPlanEntry`, so the next time it comes round it's already in
 * the box and can be ranked, cooked, scored and shopped for like any other —
 * which is the whole point of generating it. The ingredient rows go through
 * `normalizeIngredient`, the same gate `RecipeCreateSheet` puts an extracted
 * recipe through, so a nameless or malformed line is dropped here rather
 * than stored.
 *
 * Returns an empty name when nothing survives the clean — the caller must
 * not create a recipe for it. `recipe` defaults to empty so a caller with
 * only ingredients (or a test) doesn't have to spell out the rest.
 */
export function mealIdeaRecipeDraft(
  idea: MealIdea,
  items: readonly unknown[],
  recipe: {
    estimatedMinutes: number | null;
    steps: readonly string[];
    prepTasks: readonly MealIdeaPrepTask[];
  } = { estimatedMinutes: null, steps: [], prepTasks: [] },
): MealIdeaRecipeDraft {
  return {
    name: cleanRecipeName(idea.title),
    notes: idea.blurb,
    ingredients: items
      .map(item => normalizeIngredient(item))
      .filter((i): i is RecipeIngredient => i !== null),
    estimatedMinutes: recipe.estimatedMinutes,
    steps: [...recipe.steps],
    prepTasks: [...recipe.prepTasks],
  };
}
