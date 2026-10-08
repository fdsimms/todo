import type { MealPlanEntry, Recipe } from '../types';
import { logicalDayStart, onLogicalDay } from './clockTime';

/**
 * When to start each dish so a meal is ready at the time it's eaten: "eat at
 * 6:30" with a roast (20 min prep, 90 min cook) and potatoes (10 and 45) says
 * start the roast at 4:40 and the potatoes at 5:35.
 *
 * Store-free, so the MCP server can read the same answer. The time is the
 * meal's (`MealPlanEntry.eatAt`, shared by every dish in the slot); the
 * minutes are each recipe's.
 *
 * **Your own minutes first.** A recipe's stated prep and cook times are the
 * author's; the logged ones (`totalPrepMinutes / prepTimeCount`, the same
 * average the recipe page shows) are how long it takes in this kitchen. Each
 * half is chosen on its own, and the row says which it used.
 *
 * **It counts back, and claims nothing else.** Every dish finishes at the eat
 * time; there is no resting, no oven sharing and no hands-on/hands-off split,
 * because the recipe holds none of that. A composed recipe uses its own
 * times, not its components', since nothing records how they overlap. Scaling
 * a meal doesn't change the minutes: cooking twice as much is rarely twice as
 * long, and a guess would be worse than the recipe's number.
 *
 * **A dish with no minutes is listed, not guessed.** It sits at the end with
 * no start, so the person can see it was left out and why.
 */

/** The minutes a dish takes, and where each half came from. */
export interface DishTiming {
  prepMinutes: number | null;
  cookMinutes: number | null;
  prepLogged: boolean;
  cookLogged: boolean;
}

export interface TimelineDish {
  entryId: string;
  title: string;
  recipeId: string | null;
  /** Null when the dish has no recipe behind it or the recipe has no minutes. */
  timing: DishTiming | null;
  /** When to start: prep's start, or cooking's when there is no prep. */
  startAt: Date | null;
  /** When cooking starts, when there is a cook time and a prep time before it. */
  cookAt: Date | null;
}

export interface ServeTimeline {
  eatAt: Date;
  /** Timed dishes by start, earliest first; untimed ones after, in plan order. */
  dishes: TimelineDish[];
}

/** An "HH:MM" the store can hold. */
export function isEatAtTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The meal's time: the first dish in the slot that carries one (see MealPlanEntry.eatAt). */
export function slotEatAt(entries: readonly Pick<MealPlanEntry, 'eatAt' | 'sortOrder'>[]): string | null {
  const hit = [...entries].sort((a, b) => a.sortOrder - b.sortOrder).find(e => isEatAtTime(e.eatAt));
  return hit?.eatAt ?? null;
}

/**
 * The eat time as an instant. A meal's day is a calendar day (`dayKeyOf`), and
 * its logical day starts at the reset on that date, so "00:30" after a late
 * dinner party lands in the small hours after it, as every clock time placed
 * on a day does.
 */
export function eatAtInstant(dayKey: string, hhmm: string, dayResetTime: string): Date {
  const [h, m] = dayResetTime.split(':').map(Number);
  const dayStart = new Date(`${dayKey}T00:00:00`);
  dayStart.setHours(h || 0, m || 0, 0, 0);
  return onLogicalDay(dayStart, hhmm);
}

function average(total: number, count: number): number | null {
  return count > 0 && total > 0 ? Math.round(total / count) : null;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && n > 0 ? Math.round(n) : null;
}

/** A recipe's prep and cook minutes, logged average first. Null when it has neither. */
export function dishTiming(
  recipe: Pick<Recipe, 'prepMinutes' | 'estimatedMinutes' | 'prepTimeCount' | 'totalPrepMinutes' | 'cookTimeCount' | 'totalCookMinutes'>,
): DishTiming | null {
  const loggedPrep = average(recipe.totalPrepMinutes ?? 0, recipe.prepTimeCount ?? 0);
  const loggedCook = average(recipe.totalCookMinutes ?? 0, recipe.cookTimeCount ?? 0);
  const prepMinutes = loggedPrep ?? positive(recipe.prepMinutes);
  const cookMinutes = loggedCook ?? positive(recipe.estimatedMinutes);
  if (prepMinutes === null && cookMinutes === null) return null;
  return { prepMinutes, cookMinutes, prepLogged: loggedPrep !== null, cookLogged: loggedCook !== null };
}

export function totalTimingMinutes(timing: DishTiming): number {
  return (timing.prepMinutes ?? 0) + (timing.cookMinutes ?? 0);
}

/**
 * The timeline for one meal: every entry in the slot, each counted back from
 * the eat time. `titleOf` names a dish the way the plan does (a leftover, a
 * typed meal, a recipe).
 */
export function serveTimeline(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  eatAt: Date,
  titleOf: (entry: MealPlanEntry) => string,
): ServeTimeline {
  const dishes = [...entries]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry): TimelineDish => {
      const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
      // A leftover night reheats something already cooked: the recipe's
      // minutes are for making it, not for warming it up.
      const timing = recipe && !entry.leftoverId ? dishTiming(recipe) : null;
      if (!timing) return { entryId: entry.id, title: titleOf(entry), recipeId: entry.recipeId, timing: null, startAt: null, cookAt: null };
      const cookAt = timing.cookMinutes !== null ? new Date(eatAt.getTime() - timing.cookMinutes * 60_000) : null;
      const startAt = new Date(eatAt.getTime() - totalTimingMinutes(timing) * 60_000);
      return {
        entryId: entry.id,
        title: titleOf(entry),
        recipeId: entry.recipeId,
        timing,
        startAt,
        // Only worth a second time when prep comes first.
        cookAt: timing.prepMinutes !== null && cookAt ? cookAt : null,
      };
    });
  const timed = dishes.filter(d => d.startAt).sort((a, b) => a.startAt!.getTime() - b.startAt!.getTime());
  return { eatAt, dishes: [...timed, ...dishes.filter(d => !d.startAt)] };
}

/** "Prep 20 min, cook 1 hr 30 min (your average)". */
export function describeDishTiming(timing: DishTiming): string {
  const parts: string[] = [];
  if (timing.prepMinutes !== null) parts.push(`prep ${formatMinutes(timing.prepMinutes)}${timing.prepLogged ? ' (your average)' : ''}`);
  if (timing.cookMinutes !== null) parts.push(`cook ${formatMinutes(timing.cookMinutes)}${timing.cookLogged ? ' (your average)' : ''}`);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "45 min", "1 hr", "1 hr 30 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Whether a dish's start task is worth offering by default: it has a start that hasn't passed. */
export function isStartAhead(dish: TimelineDish, now: Date): boolean {
  return !!dish.startAt && dish.startAt.getTime() > now.getTime();
}

/**
 * The plain task a dish's start becomes: due on the logical day it starts,
 * with a reminder at the minute to start. `formatTime` is the caller's clock
 * format (the 12/24-hour setting lives in the store).
 */
export function startTaskDraft(
  dish: TimelineDish,
  eatAt: Date,
  dayResetTime: string,
  formatTime: (d: Date) => string,
): { title: string; notes: string; dueDate: string; reminderTime: string; estimatedMinutes: number } | null {
  if (!dish.startAt || !dish.timing) return null;
  // The logical day the start falls on, at noon: the dueDate every dated task
  // the meal plan writes carries (resolvePrepTaskDraft).
  const due = logicalDayStart(dish.startAt, dayResetTime);
  due.setHours(12, 0, 0, 0);
  const steps = dish.cookAt
    ? `Start prep at ${formatTime(dish.startAt)}, cooking at ${formatTime(dish.cookAt)}.`
    : `Start at ${formatTime(dish.startAt)}.`;
  return {
    title: `Start ${dish.title}`,
    notes: `${steps} Eating at ${formatTime(eatAt)}. ${describeDishTiming(dish.timing)}.`,
    dueDate: due.toISOString(),
    reminderTime: dish.startAt.toISOString(),
    estimatedMinutes: totalTimingMinutes(dish.timing),
  };
}
