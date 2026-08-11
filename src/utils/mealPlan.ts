import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import { isSameDay } from 'date-fns/isSameDay';
import { isSameWeek } from 'date-fns/isSameWeek';
import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, MEAL_PLAN_RETENTION_DAYS } from '../types';
import { cleanRecipeName } from './recipeUtils';
import { dayKeyOf } from './dateUtils';
import type { WeekStart } from '../store/useSettingsStore';

/**
 * Everything decidable about a week plan, kept store-free and node-testable —
 * same discipline recipeUtils and groceryParse follow, and the same reason:
 * jest here runs in the `node` env with no renderer, so logic left inside a
 * screen ships untested.
 *
 * The one thing this module does *not* do is arithmetic on ingredients — that
 * belongs to the "add the week to my list" increment, which needs its own
 * quantity rules.
 */

/** Where a slot sits in the day. The index in MEAL_SLOTS *is* the order. */
export function slotRank(slot: MealSlot): number {
  const i = MEAL_SLOTS.indexOf(slot);
  // An unknown slot sorts last rather than first: a row the reader doesn't
  // understand must not push breakfast down the day.
  return i === -1 ? MEAL_SLOTS.length : i;
}

export function slotLabel(slot: MealSlot): string {
  return MEAL_SLOT_LABELS[slot] ?? 'Meal';
}

/**
 * Reading order for a set of entries: by day, then down the day, then by the
 * order within one meal.
 *
 * `createdAt` is the last tiebreak so two entries that landed on the same
 * sortOrder (a restored backup, a race between two writes) still have a stable
 * order rather than swapping places between renders.
 */
export function sortMealEntries(entries: readonly MealPlanEntry[]): MealPlanEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      slotRank(a.slot) - slotRank(b.slot) ||
      a.sortOrder - b.sortOrder ||
      a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * Which day a plain tap on the meal-plan FAB should target, when the button
 * wasn't dragged onto a specific day.
 *
 * Today is the obvious guess, and it's on screen for exactly as long as it's
 * useful: the only way it drops out of `days` is paging to a different week,
 * at which point the user is already looking at that week's first day rather
 * than at today's, so that's the sane fallback rather than "today" reaching
 * off-screen into a week that isn't shown.
 */
export function defaultPlanningDay(days: readonly Date[], now: Date = new Date()): string | null {
  if (days.length === 0) return null;
  const today = days.find(d => isSameDay(d, now));
  return dayKeyOf(today ?? days[0]);
}

/** One day's entries, in reading order. */
export function entriesForDay(
  entries: readonly MealPlanEntry[],
  dayKey: string
): MealPlanEntry[] {
  return sortMealEntries(entries.filter(e => e.date === dayKey));
}

/** One (day, slot)'s entries, in reading order. Several is normal — see MealPlanEntry.sortOrder. */
export function entriesForSlot(
  entries: readonly MealPlanEntry[],
  dayKey: string,
  slot: MealSlot
): MealPlanEntry[] {
  return sortMealEntries(entries.filter(e => e.date === dayKey && e.slot === slot));
}

/**
 * The sortOrder a new entry should take to land at the end of its slot.
 *
 * Scoped to the (date, slot) rather than to the whole plan, because that's the
 * only place the number is ever compared — a dinner and a breakfast on the same
 * day are ordered by slotRank long before sortOrder is consulted.
 */
export function nextSortOrder(
  entries: readonly MealPlanEntry[],
  dayKey: string,
  slot: MealSlot
): number {
  return entries
    .filter(e => e.date === dayKey && e.slot === slot)
    .reduce((max, e) => Math.max(max, e.sortOrder), 0) + 1;
}

/**
 * Trims a typed meal name for storage. Empty means "not a name" and the caller
 * refuses it.
 *
 * Shares cleanRecipeName rather than forking a near-identical one: a free-text
 * meal *is* a dish name typed somewhere else, and the two would drift the first
 * time either cap moved.
 */
export function cleanMealTitle(raw: string): string {
  return cleanRecipeName(raw);
}

/**
 * What an entry's row says.
 *
 * The live recipe's own name wins while it resolves, so renaming a recipe
 * follows through onto the plan. `title` is the captured fallback for when it
 * stops resolving — a deleted recipe leaves last Tuesday reading exactly as it
 * did, which is the whole point of there being no cascade. Same shape as
 * TemplateItem.refTemplateName.
 */
export function titleForEntry(
  entry: MealPlanEntry,
  recipesById: ReadonlyMap<string, Recipe>
): string {
  if (entry.recipeId) {
    const recipe = recipesById.get(entry.recipeId);
    if (recipe) return recipe.name;
  }
  return entry.title;
}

/** Index for titleForEntry — built once per render rather than per row. */
export function recipeIndex(recipes: readonly Recipe[]): Map<string, Recipe> {
  return new Map(recipes.map(r => [r.id, r]));
}

/**
 * The inclusive day-key range a set of days covers, for a range-scoped read.
 *
 * Takes the min and max rather than the first and last: the caller passes
 * whatever buildWeekDays handed back, and a range read that quietly depends on
 * that array being sorted would break the day something reorders it.
 */
export function dayKeyRange(days: readonly Date[]): { startKey: string; endKey: string } | null {
  if (days.length === 0) return null;
  const keys = days.map(dayKeyOf).sort();
  return { startKey: keys[0], endKey: keys[keys.length - 1] };
}

/** Whether a day key falls inside an inclusive range. Keys sort lexically. */
export function isKeyInRange(key: string, startKey: string, endKey: string): boolean {
  return key >= startKey && key <= endKey;
}

/**
 * The header's overline — "3 – 9 Aug", or "28 Jul – 3 Aug" across a month
 * boundary, or "29 Dec – 4 Jan 2027" across a year one.
 *
 * The year appears only when the week straddles one, because that's the only
 * time it tells the reader something they can't already see from the rest of
 * the screen.
 */
export function describeWeekRange(days: readonly Date[]): string {
  if (days.length === 0) return '';
  const sorted = [...days].sort((a, b) => +a - +b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const sameYear = first.getFullYear() === last.getFullYear();
  const start = format(first, first.getMonth() === last.getMonth() && sameYear ? 'd' : 'd MMM');
  const end = format(last, sameYear ? 'd MMM' : 'd MMM yyyy');
  return `${start} – ${end}`;
}

/**
 * The header's summary — "6 meals planned", counting entries rather than days.
 *
 * An entry with no recipe counts exactly as much as one with: "leftovers" is a
 * plan, and a count that quietly ignored it would be telling the user their
 * week is emptier than it is.
 */
export function describeWeekPlan(entries: readonly MealPlanEntry[]): string {
  const n = entries.length;
  if (n === 0) return 'Nothing planned yet';
  return `${n} ${n === 1 ? 'meal' : 'meals'} planned`;
}

/**
 * The day key before which an entry is old enough to purge.
 *
 * Anchored to the calendar day rather than to a clock instant — the rows it
 * judges carry no time at all — so it takes the same set of entries whenever in
 * the day the app happens to be opened.
 */
export function mealPlanPurgeCutoffKey(
  now: Date = new Date(),
  days: number = MEAL_PLAN_RETENTION_DAYS
): string {
  return dayKeyOf(subDays(now, days));
}

/**
 * "Added to list today", "Added to list yesterday", "Added to list on
 * Sunday", "Added to list on Aug 3" — the week header's stamp line.
 *
 * Deliberately its own ladder rather than a reuse of dateUtils'
 * formatScheduledDate/formatDeadlineDate family: those are written for a date
 * that can be in the *future* relative to today (a task due date), so their
 * "Nd ago" branch fires for anything more than one day in the past and never
 * falls through to a weekday name. `addedAt` is a stamp about something that
 * already happened — always today or earlier — so a weekday name is the
 * right answer all the way back to the start of the week, same as this app's
 * other read of a *past* instant, TaskItem's completed-row timestamp.
 *
 * `now` and `weekStartsOn` are parameters rather than reads of the settings
 * store, matching buildWeekDays/weekdayHeaders — this module stays store-free
 * so jest can reach it without a renderer.
 */
export function describeAddedToList(
  addedAt: string,
  now: Date = new Date(),
  weekStartsOn: WeekStart = 0
): string {
  const d = new Date(addedAt);
  if (isSameDay(d, now)) return 'Added to list today';
  if (isSameDay(d, subDays(now, 1))) return 'Added to list yesterday';
  if (isSameWeek(d, now, { weekStartsOn })) return `Added to list on ${format(d, 'EEEE')}`;
  return `Added to list on ${format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')}`;
}
