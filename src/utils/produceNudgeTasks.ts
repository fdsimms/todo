import type { FoodLogEntry, Recipe } from '../types';
import { FREEZER_SECTION, type KitchenEntry } from './kitchenInventory';
import { resolvePluralKey } from './groceryPlural';
import {
  dayProduce,
  formatServings,
  produceKindOf,
  type DayProduce,
  type RecipeProduceResolver,
} from './produceServings';
import { isNutrientOnlyEntry } from './nutrientLog';
import { flattenRecipeIngredients, recipeMap } from './recipeComponents';

/**
 * `produceNudge`: a one-off task, once the evening has started, suggesting
 * vegetables or fruit when today's food log is short of a servings goal.
 *
 * See `docs/arch/generated-tasks.md` for the mechanism it shares. It is
 * `snackNudgeTasks.ts`'s shape over the produce estimate in `produceServings.ts`,
 * so it inherits both files' limits and this one restates them:
 *
 * **It reads the food log, so it can only say what was logged.** A day nobody
 * logged is not a day without produce, so a log with no food entry in it is
 * nothing to judge, and the title names the figure it judged by ("1.5 of 4
 * servings logged"). Servings are an estimate from food names and weights, and
 * a food the lexicon does not name as produce counts as none. When entries
 * could not be weighed (`unmeasured`) the notes say so, so a low figure reads as
 * "could not tell" and not as "ate little".
 *
 * **A goal the person typed, never a verdict.** The task is a count against a
 * number they chose. It does not say a day was good or bad, and logging enough
 * takes the task away rather than congratulating anyone (`produceServings.ts`:
 * counts, never a score).
 *
 * **The idea in the notes is a suggestion drawn from what the kitchen vouches
 * for.** `produceIdeas` ranks recipes by how much on-hand produce they use,
 * frozen first, then by how few ingredients they have. Like `useUpRecipes` it
 * reads the join on `nameKey` and nothing fuzzier, and it cannot know that a
 * cupboard item missing from the pantry is absent, only that a listed one is
 * there. It writes nothing and plans nothing.
 *
 * **One a day, day-keyed with no source row**, `snackNudge`'s position: a
 * completed or deleted one blocks the next that day (`blocksOnFinished`,
 * `produceNudgeDeclinedDayKey`).
 */

/** The hour (local clock) from which the nudge may appear, and the range the setting allows. */
export const DEFAULT_PRODUCE_NUDGE_FROM_HOUR = 17;
export const PRODUCE_NUDGE_FROM_HOUR_MIN = 12;
export const PRODUCE_NUDGE_FROM_HOUR_MAX = 21;

/** Servings the day is measured against. The Food log's own bar uses a fixed 5; this one is the person's. */
export const DEFAULT_PRODUCE_NUDGE_GOAL = 4;
export const PRODUCE_NUDGE_GOAL_MIN = 1;
export const PRODUCE_NUDGE_GOAL_MAX = 10;

export function clampProduceNudgeFromHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_PRODUCE_NUDGE_FROM_HOUR;
  return Math.min(PRODUCE_NUDGE_FROM_HOUR_MAX, Math.max(PRODUCE_NUDGE_FROM_HOUR_MIN, Math.round(hour)));
}

export function clampProduceNudgeGoal(goal: number): number {
  if (!Number.isFinite(goal)) return DEFAULT_PRODUCE_NUDGE_GOAL;
  return Math.min(PRODUCE_NUDGE_GOAL_MAX, Math.max(PRODUCE_NUDGE_GOAL_MIN, Math.round(goal)));
}

/** An hour of the day as the clock reads it: 17 is "5 PM". */
export function describeProduceNudgeHour(hour: number): string {
  const h = clampProduceNudgeFromHour(hour);
  if (h === 12) return '12 PM';
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

/** What today's log holds, or null when it has no food entry to judge. */
export interface ProduceReading {
  servings: number;
  unmeasured: number;
}

/**
 * Today's vegetable and fruit servings, or null when the log can't speak to it.
 * A nutrient-only entry (water, a logged sodium figure) is not food, so a day
 * holding only those is nothing to judge, the same call `dayProduce` makes.
 */
export function produceReadingToday(
  entries: readonly FoodLogEntry[],
  recipeGrams?: RecipeProduceResolver,
): ProduceReading | null {
  const food = entries.filter(entry => !isNutrientOnlyEntry(entry));
  if (food.length === 0) return null;
  const day: DayProduce = dayProduce(food, recipeGrams);
  return { servings: day.vegetable + day.fruit, unmeasured: day.unmeasured };
}

/**
 * Whether the day is short enough to ask. False on no usable log, which is
 * "nothing to judge" rather than "not short". Compared on the half-serving the
 * title shows, so a title never reads "4 of 4" while the task still stands.
 */
export function produceNudgeApplies(
  reading: ProduceReading | null,
  now: Date,
  fromHour: number = DEFAULT_PRODUCE_NUDGE_FROM_HOUR,
  goal: number = DEFAULT_PRODUCE_NUDGE_GOAL,
): boolean {
  if (reading === null) return false;
  if (now.getHours() < clampProduceNudgeFromHour(fromHour)) return false;
  return roundedServings(reading.servings) < clampProduceNudgeGoal(goal);
}

function roundedServings(value: number): number {
  return Math.round(value * 2) / 2;
}

/** The title, naming the figure it judged by. */
export function produceNudgeTitle(servings: number, goal: number): string {
  return `Add vegetables or fruit (${formatServings(servings)} of ${clampProduceNudgeGoal(goal)} servings logged)`;
}

/** One recipe worth suggesting, and the produce on hand it would use. */
export interface ProduceIdea {
  recipe: Recipe;
  /** The on-hand produce entries it calls for, frozen first. Never empty. */
  uses: KitchenEntry[];
}

/**
 * Recipes that use produce the kitchen has, best first.
 *
 * `entries` is the whole kitchen (`kitchenInventory`). Leftovers are skipped
 * (they are reheated, not cooked with, as in `useUpRecipes`), and so is
 * anything past its use-by day (`over`), which is questionable rather than
 * ready. The ranking, in order:
 *
 * 1. How many on-hand produce items it uses.
 * 2. How many of those are frozen, because a frozen or bagged vegetable is the
 *    low-effort one.
 * 3. Fewer ingredients overall, as the nearest thing to low effort a recipe
 *    states without a time on it.
 * 4. Name, so the order is stable.
 *
 * Only a line that is itself produce (`produceKindOf`) counts: a recipe that
 * uses the onions on hand as a garnish for a cheese bake is not a produce idea.
 */
export function produceIdeas(
  entries: readonly KitchenEntry[],
  recipes: readonly Recipe[],
): ProduceIdea[] {
  const onHand = new Map<string, KitchenEntry>();
  for (const entry of entries) {
    if (entry.kind === 'leftover' || !entry.matchKey) continue;
    if (entry.freshness === 'over') continue;
    if (produceKindOf(entry.title) === null) continue;
    const current = onHand.get(entry.matchKey);
    // A frozen packet answers for the item, since it is the one needing no prep.
    if (!current || (isFrozen(entry) && !isFrozen(current))) onHand.set(entry.matchKey, entry);
  }
  if (onHand.size === 0) return [];

  const byId = recipeMap(recipes);
  const out: ProduceIdea[] = [];
  for (const recipe of recipes) {
    const uses = new Map<string, KitchenEntry>();
    const lines = flattenRecipeIngredients(recipe, byId, { onHand: new Set(onHand.keys()) });
    for (const { ingredient } of lines) {
      if (!ingredient.nameKey) continue;
      const kind = produceKindOf(ingredient.name);
      if (kind === null || kind === 'mixed') continue;
      const key = onHand.has(ingredient.nameKey)
        ? ingredient.nameKey
        : resolvePluralKey(ingredient.nameKey, onHand.keys());
      const entry = key ? onHand.get(key) : undefined;
      if (entry) uses.set(entry.id, entry);
    }
    if (uses.size === 0) continue;
    out.push({
      recipe,
      uses: [...uses.values()].sort((a, b) => Number(isFrozen(b)) - Number(isFrozen(a)) || a.title.localeCompare(b.title)),
    });
  }

  return out.sort(
    (a, b) =>
      b.uses.length - a.uses.length ||
      frozenCount(b) - frozenCount(a) ||
      a.recipe.ingredients.length - b.recipe.ingredients.length ||
      a.recipe.name.localeCompare(b.recipe.name),
  );
}

function isFrozen(entry: KitchenEntry): boolean {
  return entry.section === FREEZER_SECTION;
}

function frozenCount(idea: ProduceIdea): number {
  return idea.uses.filter(isFrozen).length;
}

/** How many ideas the notes name. Two is what a task's notes line holds. */
export const PRODUCE_IDEAS_SHOWN = 2;

/** Why the task exists, plus the ideas when there are any. */
export function produceNudgeNotes(reading: ProduceReading | null, ideas: readonly ProduceIdea[]): string {
  const lines = [
    'Estimated from the food and weights in today’s food log. Dismiss it if you ate produce without logging.',
  ];
  if (reading !== null && reading.unmeasured > 0) {
    lines.push(
      `${reading.unmeasured} ${reading.unmeasured === 1 ? 'entry' : 'entries'} could not be weighed, so the count may be low.`,
    );
  }
  const shown = ideas.slice(0, PRODUCE_IDEAS_SHOWN);
  if (shown.length > 0) {
    lines.push('', ...shown.map(describeProduceIdea));
  }
  return lines.join('\n');
}

/** "Stir-fry (uses frozen peas and spinach)". Names the food, as `describeUseUpRecipe` does. */
export function describeProduceIdea(idea: ProduceIdea): string {
  const names = idea.uses.slice(0, 2).map(e => {
    const name = e.title.toLowerCase();
    return isFrozen(e) && !name.includes('frozen') ? `frozen ${name}` : name;
  });
  const more = idea.uses.length - names.length;
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
  return `${idea.recipe.name} (uses ${list}${more > 0 ? ` and ${more} more` : ''})`;
}
