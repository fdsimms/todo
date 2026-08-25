import { dayKeyOf } from './dateUtils';
import { isRealCompletion } from './missed';
import type { MealPlanEntry, Task } from '../types';

/**
 * A warm year in review — see `docs/arch/people.md`.
 *
 * Two aggregate facts about the *user's* year, and only ever that. "Aggregates
 * about you are fine; aggregates about individual people are the thing to
 * refuse." Nothing here builds a per-person breakdown, not even one nothing
 * renders — the arch doc's reach-out section rules out sorting by neglect
 * "even done invisibly where nobody sees it", and the same discipline holds
 * here: a `Map<personId, count>` computed as a stepping stone to the total
 * would be the disease this file exists to avoid, whether or not a line of it
 * ever reaches the screen.
 *
 * Pure, and takes explicit range bounds rather than `today` — the caller
 * resolves what "this year" means (`getLogicalToday()`, a day-key window),
 * the same split `cookingWindow`/`mealCookCounts` keep.
 */

/**
 * Completed, top-level tasks naming somebody, in `[startIso, endIso]`.
 *
 * The same two filters `personHistory()` uses, and for the same reasons: a
 * missed task is stored completed (`isRealCompletion` catches it), and a
 * subtask would multiply-count one occasion. `personIds` is the only
 * addition — this counts events that involved somebody, not every completion.
 * Self-contained rather than assuming a pre-filtered list, the same call
 * `onTimeSummary` makes.
 */
export function timeTogetherInRange(
  tasks: readonly Task[],
  startIso: string,
  endIso: string
): number {
  let count = 0;
  for (const t of tasks) {
    if (t.parentId || !isRealCompletion(t) || !t.completedAt) continue;
    if (t.personIds.length === 0) continue;
    if (t.completedAt < startIso || t.completedAt > endIso) continue;
    count++;
  }
  return count;
}

/**
 * Cooked meals with a guest, in `[startKey, endKey]`.
 *
 * Gated on `cookedAt`, the same way `mealCookCounts` counts a cooking rather
 * than a plan: a dinner planned for four people and never made is not a time
 * you had people over.
 */
export function mealsTogetherInRange(
  entries: readonly MealPlanEntry[],
  startKey: string,
  endKey: string
): number {
  let count = 0;
  for (const e of entries) {
    if (e.date < startKey || e.date > endKey) continue;
    if (!e.cookedAt) continue;
    if (e.personIds.length === 0) continue;
    count++;
  }
  return count;
}

/**
 * The first sentence, or null when there is nothing to say.
 *
 * Null rather than a zero: "you spent time with people 0 times this year" is
 * a debt the way "94 days ago" is (rule 2), and a stat that can only ever be a
 * cheerful fact or silent is what keeps it that way.
 */
export function describeTimeTogether(count: number): string | null {
  if (count <= 0) return null;
  return `You spent time with people on ${count} ${count === 1 ? 'occasion' : 'occasions'} this year.`;
}

/** The second sentence, or null. Same reasoning as `describeTimeTogether`. */
export function describeMealsTogether(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? 'You had people over for a meal this year.'
    : `You had people over for ${count} meals this year.`;
}

/** The year `today` falls in, as `[startIso, endIso]` — Jan 1 through today. */
export function taskYearRange(today: Date): { startIso: string; endIso: string } {
  return {
    startIso: new Date(today.getFullYear(), 0, 1).toISOString(),
    endIso: today.toISOString(),
  };
}

/** The same year, as day keys — what `mealsTogetherInRange` and a DB read need. */
export function mealYearRange(today: Date): { startKey: string; endKey: string } {
  return {
    startKey: dayKeyOf(new Date(today.getFullYear(), 0, 1)),
    endKey: dayKeyOf(today),
  };
}
