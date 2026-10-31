/**
 * The weekly pool: meals chosen for a week with no day or slot yet
 * (`WeekPoolEntry`). Pure rules only; the writes are `useMealPlanStore`'s
 * (`addToPool`, `placePoolEntry`, `sendToPool`, `carryPoolOver`).
 *
 * A pool meal is not a planned meal, so nothing that hangs off a day reads it:
 * no Today slot task, calendar event, nudge, shortfall or thaw task, cooking
 * stat or dinner count. What it does share with the plan is the week's
 * shopping, cost and nutrition, which take the plan's entries and so see the
 * pool through `poolAsEntries`.
 */
import type { MealPlanEntry, Recipe, WeekPoolEntry } from '../types';
import { buildMealPlanEntry } from './mealPlan';

/**
 * The picker's "no day yet" chip, in the place of a day key. The recipe picker
 * (`RecipePickerSheet`) hands its choice back as a day, and this is the one
 * value that is not one: the caller files the pick in the week's pool instead.
 */
export const POOL_DAY_KEY = 'pool';

/**
 * The entry a pool pick hands back to the picker, which tracks what it has
 * added this session as planned meals. Dated `POOL_DAY_KEY` so the picker's
 * "already added" check matches only the pool, and never written anywhere.
 */
export function poolPickEntry(
  row: WeekPoolEntry,
  slot: MealPlanEntry['slot'],
  recipe?: Pick<Recipe, 'servings' | 'servingsMax'>,
  householdServings = 0,
): MealPlanEntry {
  const [entry] = poolAsEntries(
    [row],
    new Map(recipe && row.recipeId ? [[row.recipeId, recipe]] : []),
    householdServings,
  );
  return { ...entry, date: POOL_DAY_KEY, slot };
}

/** Prefix of the stand-in entry ids, so a reader can tell a pool meal from a planned one. */
export const POOL_ENTRY_ID_PREFIX = 'pool:';

export function isPoolEntryId(id: string): boolean {
  return id.startsWith(POOL_ENTRY_ID_PREFIX);
}

/** One week's pool in the order the person arranged it. */
export function poolForWeek(pool: readonly WeekPoolEntry[], weekStart: string): WeekPoolEntry[] {
  return pool
    .filter(e => e.weekStart === weekStart)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/**
 * The pool as planned-meal entries, for the readers that total a week
 * (`collectPlannedIngredients`, `weekNutrition`, `estimateWeekCost`, the add to
 * list sheet). Each is dated the week's first day, which keeps it inside the
 * week's range and nowhere else, and scaled for the household exactly as
 * planning the same recipe would scale it. These are never written.
 */
export function poolAsEntries(
  pool: readonly WeekPoolEntry[],
  recipesById: ReadonlyMap<string, Pick<Recipe, 'servings' | 'servingsMax'>>,
  householdServings: number,
): MealPlanEntry[] {
  return pool.map(e =>
    buildMealPlanEntry(
      { date: e.weekStart, slot: 'dinner', recipeId: e.recipeId, title: e.title },
      {
        id: `${POOL_ENTRY_ID_PREFIX}${e.id}`,
        title: e.title,
        recipe: e.recipeId ? recipesById.get(e.recipeId) : undefined,
        sameDay: [],
        householdServings,
        now: e.createdAt,
      },
    ),
  );
}

/** "3 meals" / "1 meal" for the pool card's count. */
export function describePool(count: number): string {
  return count === 1 ? '1 meal' : `${count} meals`;
}
