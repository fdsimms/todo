import type { Leftover, LeftoverOutcome, MealPlanEntry, Recipe } from '../types';
import { getLogicalDayKey } from './dateUtils';
import { recipeIndex, slotLabel, slotRank, titleForEntry } from './mealPlan';
import { describeOutcome } from './leftovers';
import { normalizeScale } from './recipeScale';
import { scoreSubstring } from './ranges';

/**
 * What happened in the kitchen, one row per event — the Logbook's cooking lens
 * (#1779).
 *
 * The sibling of `kitchenInventory.ts`, and named to say so: that module reads
 * what's in the kitchen *now*, this one reads what has already happened in it.
 * Both are pure derivations over rows that already exist — a cooked
 * `MealPlanEntry` and a closed-out `Leftover` — so there is no schema change
 * here and nothing is written.
 *
 * It is deliberately **not** part of `cookingStats.ts`, which answers "how much
 * cooking happened" and keeps four integers. This answers "what happened, and
 * when", which is rows, and the two disagree about a question an aggregate
 * never has to ask — see `KitchenEvent.dayKey`.
 *
 * Read-only by construction. A `KitchenEvent` carries only what a row draws,
 * the `ContextRow`/`KitchenEntry` pattern, so nothing downstream can mistake it
 * for the source and try to write through it.
 */

export type KitchenEventKind = 'cooked' | 'leftover';

export interface KitchenEvent {
  /**
   * Row key. Prefixed by kind: a meal entry and a leftover are different tables
   * and nothing stops the two id spaces colliding.
   */
  key: string;
  kind: KitchenEventKind;
  /**
   * The logical day this happened on, `YYYY-MM-DD` — what the list buckets and
   * sorts by. See the note on `kitchenEvents` for why the two kinds derive it
   * from different fields.
   */
  dayKey: string;
  title: string;
  /**
   * 'Dinner' for a cooked meal, 'Eaten' / 'Thrown out' for a leftover — the one
   * thing the row says about the event besides its name. Never both: a meal has
   * no outcome and a container has no slot.
   */
  detail: string;
  /**
   * Where in the day it sits, for ordering within a section. Meals rank by
   * their slot, and a closed-out leftover sorts after every meal (see below).
   */
  rank: number;
  /**
   * The recipe behind it, when there is one — what makes a row openable. Null
   * for a free-text meal ("Takeout curry") and for a leftover logged by hand.
   */
  recipeId: string | null;
  /**
   * `Leftover.outcome`, for the row's glyph. Null on a cooked meal.
   */
  outcome: LeftoverOutcome | null;
  /**
   * `MealPlanEntry.recipeScale` — 1 for a meal cooked as written, and always 1
   * for a leftover. The one fact about a particular cooking this history has
   * that nothing else does: how much of it was made. Carried as the number
   * rather than as text, since `formatScale` is the row's business.
   */
  scale: number;
}

export interface KitchenHistoryDay {
  dayKey: string;
  events: KitchenEvent[];
}

/**
 * A leftover sorts after every meal in its day. `MEAL_SLOTS` has four entries,
 * so any rank past the last of them does it — a meal is placed in the day by
 * its slot and a container isn't placed at all, so the containers read as the
 * day's footnote rather than being interleaved on a position they don't have.
 */
const LEFTOVER_RANK = 100;

/**
 * Every kitchen event in the sets it's handed, newest day first.
 *
 * **The two kinds derive their day from different fields, and that's one rule
 * with two spellings rather than an inconsistency.** The day a thing happened
 * is what a history is bucketed by — but a cooked meal already carries that day
 * as `entry.date`, while a leftover only knows the instant it was closed out.
 *
 * So a cooked meal is filed under its own `date`, the same call
 * `mealCookCounts` makes, and *not* under its `cookedAt`. `cookedAt` is when
 * the box was ticked, which is not when the meal was: `bulkSetCooked` exists so
 * that a whole week can be marked off on a Sunday, and reading that instant as
 * the event would drop five dinners into one afternoon. It stays the proof that
 * the meal was cooked at all, and nothing else.
 *
 * A leftover has no such field — `storedAt` is when it went in and `keepUntil`
 * is a deadline — so it's filed under `finishedAt`, which is an instant and
 * therefore takes `dayResetTime`, exactly as a task's `completedAt` does. A
 * meal's `date` is a calendar day the user picked and takes no reset time; the
 * same asymmetry `calendarMonth.ts` documents for the month grid.
 *
 * Neither kind is windowed here. What the caller can see is whatever it hands
 * in, which is bounded by the two retention purges rather than by this module.
 */
export function kitchenEvents(
  entries: readonly MealPlanEntry[],
  leftovers: readonly Leftover[],
  recipes: readonly Recipe[],
  dayResetTime?: string
): KitchenEvent[] {
  const byId = recipeIndex(recipes);
  const events: KitchenEvent[] = [];

  for (const entry of entries) {
    if (!entry.cookedAt) continue;
    events.push({
      key: `cooked:${entry.id}`,
      kind: 'cooked',
      dayKey: entry.date,
      title: titleForEntry(entry, byId),
      detail: slotLabel(entry.slot),
      rank: slotRank(entry.slot),
      recipeId: entry.recipeId,
      outcome: null,
      scale: normalizeScale(entry.recipeScale),
    });
  }

  for (const leftover of leftovers) {
    if (!leftover.finishedAt) continue;
    events.push({
      key: `leftover:${leftover.id}`,
      kind: 'leftover',
      dayKey: getLogicalDayKey(new Date(leftover.finishedAt), dayResetTime),
      title: leftover.title,
      detail: describeOutcome(leftover),
      rank: LEFTOVER_RANK,
      recipeId: leftover.recipeId,
      outcome: leftover.outcome ?? 'eaten',
      scale: 1,
    });
  }

  // Newest day first, then down through the day. Ties break on the title so the
  // order is stable across renders — two dinners on one night otherwise sit in
  // whichever order the two source arrays happened to arrive in.
  events.sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? 1 : -1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.title.localeCompare(b.title);
  });

  return events;
}

/** `kitchenEvents`, grouped into days. Insertion order is already newest-first. */
export function kitchenHistoryDays(events: readonly KitchenEvent[]): KitchenHistoryDay[] {
  const grouped = new Map<string, KitchenEvent[]>();
  for (const event of events) {
    const day = grouped.get(event.dayKey);
    if (day) day.push(event);
    else grouped.set(event.dayKey, [event]);
  }
  return Array.from(grouped.entries()).map(([dayKey, dayEvents]) => ({
    dayKey,
    events: dayEvents,
  }));
}

/**
 * The Logbook's search, applied to this lens.
 *
 * Reuses `scoreSubstring` rather than `fuzzySearch`, which scores a `Task` and
 * its project. A title is all there is to match here — the detail is one of six
 * fixed words, so matching it would make "eaten" return the whole fridge.
 *
 * Unranked, deliberately: these rows are a chronology, and re-sorting them by
 * relevance as someone types would hand back a history in no order at all.
 */
export function filterKitchenEvents(
  events: readonly KitchenEvent[],
  query: string
): KitchenEvent[] {
  const needle = query.trim();
  if (!needle) return [...events];
  return events.filter(event => scoreSubstring(event.title, needle).score > 0);
}
