import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import { isSameDay } from 'date-fns/isSameDay';
import { isSameWeek } from 'date-fns/isSameWeek';
import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, MEAL_PLAN_RETENTION_DAYS } from '../types';
import { cleanRecipeName } from './recipeUtils';
import { dayKeyOf, dayKeyToDate } from './dateUtils';
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

/** One day's entries, in reading order. */
export function entriesForDay(
  entries: readonly MealPlanEntry[],
  dayKey: string
): MealPlanEntry[] {
  return sortMealEntries(entries.filter(e => e.date === dayKey));
}

/**
 * The planned meal a just-finished cooking should be ticked off against, or
 * null when the day's plan holds nothing matching.
 *
 * Which day counts is the caller's to decide and is deliberately not read here
 * — a cook timer stopped at 1 a.m. belongs to the evening it was started in,
 * so the key handed in is `dayKeyOf(getLogicalToday())` rather than a calendar
 * date the clock has already turned over.
 *
 * Between the rows of that day it takes the same recipe, not already cooked,
 * earliest slot first: a dish planned for both lunch and dinner ticks lunch
 * off first rather than whichever row happened to be written first. An entry
 * that names the dish only by `title` is never matched — the identity being
 * claimed is the recipe's, and a free-text meal that reads the same is a
 * coincidence of spelling.
 */
export function cookEntryForRecipe(
  entries: readonly MealPlanEntry[],
  recipeId: string,
  dayKey: string
): MealPlanEntry | null {
  const candidates = entries.filter(
    e => e.date === dayKey && e.recipeId === recipeId && !e.cookedAt
  );
  return sortMealEntries(candidates)[0] ?? null;
}

/**
 * The earliest of `enabledSlots` (in day order) with nothing planned yet for
 * this day — what a picker opened cold, with no slot named by whatever
 * opened it (see RecipePickerSheet's `forceSlot`), should default to.
 *
 * Falls back to `dinner` when every enabled slot already has something in
 * it, or none is enabled: there's no unplanned slot left to point at, and
 * dinner is what a week plan is mostly about (see RecipePickerSheet's
 * `lastPickedSlot` comment, which makes the same call for its own fallback).
 */
export function earliestUnplannedSlot(
  entries: readonly Pick<MealPlanEntry, 'date' | 'slot'>[],
  dayKey: string,
  enabledSlots: readonly MealSlot[]
): MealSlot {
  const planned = new Set(entries.filter(e => e.date === dayKey).map(e => e.slot));
  const ordered = MEAL_SLOTS.filter(s => enabledSlots.includes(s));
  return ordered.find(s => !planned.has(s)) ?? 'dinner';
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
 * `count` days starting today — the nights a "plan this" picker offers when it
 * is reached from somewhere that has no week on screen (a recipe).
 *
 * Deliberately a rolling window rather than `buildWeekDays`. The meal plan's
 * own chip rows show the calendar week because that is what the screen behind
 * them is showing, and moving a meal is a fact about that week. A recipe has no
 * such context, and a calendar week reached on a Friday is five days of past
 * with two of future — the useful answer from a recipe is "the next week of
 * dinners", which is what this returns.
 */
export function upcomingDays(from: Date = new Date(), count = 7): Date[] {
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(start, i));
}

/**
 * The days out of `days` with nothing planned in `slot` yet.
 *
 * Two jobs, and they have to be the same answer or the second one goes wrong:
 * it gates the "Suggest meals" shelf (a week with no free dinner has nothing
 * to suggest *into*), and it is the set of days that shelf may actually plan
 * onto. `SuggestMealsSheet` lands each acceptance on the next day it was
 * given, in order, with no knowledge of the plan — so handing it the whole
 * week would drop a second dinner onto a night that already had one.
 *
 * Scoped to a slot rather than to the day as a whole: a day holding only a
 * planned breakfast still wants a dinner suggestion, and "two things on one
 * dinner" being legal (see MealPlanEntry.sortOrder) is about the user saying
 * so deliberately, not about a suggestion shelf filling a slot twice.
 */
export function daysWithoutMeal(
  entries: readonly MealPlanEntry[],
  days: readonly Date[],
  slot: MealSlot
): Date[] {
  const taken = new Set(entries.filter(e => e.slot === slot).map(e => e.date));
  return days.filter(d => !taken.has(dayKeyOf(d)));
}

/** The day key `days` after `dayKey` — negative counts back. */
export function shiftDayKey(dayKey: string, days: number): string {
  return dayKeyOf(addDays(dayKeyToDate(dayKey), days));
}

/**
 * Everything a copied entry carries; the store adds the id, the stamp and a
 * null `calendarEventId`.
 *
 * `calendarEventId` is omitted rather than carried for the same reason
 * `duplicateTask` clears a task's: a copy is a new meal on a new day and
 * needs its own event, and two rows pointing at one device event means
 * whichever reconciles last rewrites the other's night.
 */
export type MealCopyDraft = Omit<MealPlanEntry, 'id' | 'createdAt' | 'calendarEventId'>;

/**
 * What copying a week forward actually carries, shifted by `days`.
 *
 * Three rules, each about what a copy *is*:
 *
 * - **`cookedAt` is dropped.** A copy is a plan, not a record. Carrying it
 *   would claim next Tuesday's dinner has already been eaten, and — worse —
 *   would let the row's cooked toggle un-tick a cooking that really happened
 *   on a different night.
 * - **A meal eating a tracked leftover is skipped entirely**, rather than
 *   copied as free text. A container is one physical thing that was in the
 *   fridge that week; it isn't there now, so "Leftover chilli" copied into
 *   next week claims a dinner that container can't actually supply. The
 *   night comes back empty, which is the honest answer.
 * - **`recipeChoices` and `recipeScale` carry.** They're facts about how you
 *   cook the dish — the roast potatoes, the double batch — and repeating the
 *   week is repeating those too. This is the whole reason a copy beats
 *   re-planning by hand.
 * - **Guests are dropped**, on `cookedAt`'s side of the line rather than
 *   `recipeScale`'s. Who came on Tuesday is a fact about that night, not about
 *   the dish, and a copied week claiming the same four people are coming again
 *   is the app asserting something about other people's plans — the one thing
 *   `docs/arch/people.md` rules out everywhere. Re-inviting is a thing you do,
 *   and it is two taps on the copied meal.
 * - **`cookTask` carries**, for the same reason and unlike `cookedAt`: it says
 *   whether *this meal* is one you want reminding about, which is a fact about
 *   how you cook the dish rather than a record of a night that happened. A
 *   week copied forward re-spawns the cook tasks, which is the point.
 * - **`shopTask` carries** on the same reading — "don't warn me about this
 *   one, I buy it fresh on the day" is a fact about the dish, and a copied week
 *   that dropped it would ask again about every meal already answered.
 *
 * `sortOrder` carries as well, so two things on one dinner keep their order
 * relative to each other.
 */
export function weekCopyDrafts(
  entries: readonly MealPlanEntry[],
  days: number
): MealCopyDraft[] {
  return entries
    .filter(e => !e.leftoverId)
    .map(e => ({
      date: shiftDayKey(e.date, days),
      slot: e.slot,
      recipeId: e.recipeId,
      title: e.title,
      sortOrder: e.sortOrder,
      cookedAt: null,
      leftoverId: null,
      recipeChoices: [...e.recipeChoices],
      personIds: [],
      recipeScale: e.recipeScale,
      cookTask: e.cookTask,
      shopTask: e.shopTask,
    }));
}

/** Where one entry lands in a bulk move — see resolveBulkMoveTargets. */
export interface BulkMoveTarget {
  id: string;
  date: string;
  slot: MealSlot;
}

/**
 * Resolves the destination of every entry in a bulk move, for
 * useMealPlanStore.bulkMoveEntries.
 *
 * Same per-entry fallback as moveEntry — an omitted `date` or `slot` keeps
 * that entry's own value, so "move to Thursday" run against a mixed-slot
 * selection changes only the day. An entry landing exactly where it already
 * is drops out of the result, the same no-op moveEntry itself already
 * refuses, rather than round-tripping a write that changes nothing.
 *
 * Stops short of assigning sortOrder: two selected entries can resolve to
 * the same (date, slot) destination (two dinners both moved to Thursday), and
 * ordering them against each other and against what the destination already
 * holds needs the live table, which is store, not util, territory.
 */
export function resolveBulkMoveTargets(
  entries: readonly MealPlanEntry[],
  ids: readonly string[],
  to: { date?: string; slot?: MealSlot }
): BulkMoveTarget[] {
  if (to.date === undefined && to.slot === undefined) return [];
  const idSet = new Set(ids);
  const targets: BulkMoveTarget[] = [];
  for (const entry of entries) {
    if (!idSet.has(entry.id)) continue;
    const date = to.date ?? entry.date;
    const slot = to.slot ?? entry.slot;
    if (date === entry.date && slot === entry.slot) continue;
    targets.push({ id: entry.id, date, slot });
  }
  return targets;
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
 * Today's planned meals, for TodayScreen's inline section (#1133) —
 * `useMealPlanStore.entries` is range-scoped (see the store's own doc
 * comment), so a bare filter on `entries` would silently read "nothing
 * planned" for a today that was simply never loaded, as happens on a cold
 * app start before the user has ever opened Meal plan this session.
 *
 * Returns `null` when today isn't known to be covered by the loaded window —
 * `rangeStart`/`rangeEnd` null (nothing loaded yet) or today outside them
 * (the user paged Meal plan to a different week and left it there) — so the
 * caller can tell "definitely nothing planned" (`[]`) apart from "no idea"
 * (`null`) and render neither an empty state nor a false one for the latter.
 * Deliberately never loads the range itself: `entries` is a single shared
 * window and Today calling loadRange would clobber whatever week
 * MealPlanScreen currently has on screen the next time it's visited without
 * remounting (see AppNavigator's `enableScreens(false)` note in CLAUDE.md —
 * hidden tabs stay mounted, they don't reload on refocus).
 */
export function selectTodayMealEntries(
  entries: readonly MealPlanEntry[],
  rangeStart: string | null,
  rangeEnd: string | null,
  todayKey: string
): MealPlanEntry[] | null {
  if (!rangeStart || !rangeEnd || !isKeyInRange(todayKey, rangeStart, rangeEnd)) return null;
  return entriesForDay(entries, todayKey);
}

/**
 * What's left to eat today — the strip's contents (#1402).
 *
 * **The strip empties as the day is eaten, and the full block deliberately
 * doesn't.** They're answering different questions: the block is the day's
 * plan, where a cooked meal keeps its place and wears a tick because seeing
 * what you've had is half of what a plan is for. The strip is one line of
 * remaining type sitting above the task list, and a line that still reads
 * "Quest protein shake" at nine at night is stale — it's spending the screen's
 * scarcest row on a decision already made. So this filters, and once the last
 * meal is ticked the strip renders nothing at all and the list starts at the
 * top of the screen.
 *
 * Cooked-ness is the filter rather than the clock, deliberately: the app can't
 * know when you ate, only that you said you had, and a time-based rule would
 * hide a dinner nobody has cooked yet at some hour it picked for them.
 */
export function uncookedEntries(entries: readonly MealPlanEntry[]): MealPlanEntry[] {
  return entries.filter(e => !e.cookedAt);
}

/**
 * The header's overline — "Aug 3 – 9", or "Jul 28 – Aug 3" across a month
 * boundary, or "Dec 29 – Jan 4, 2027" across a year one.
 *
 * The year appears only when the week straddles one, because that's the only
 * time it tells the reader something they can't already see from the rest of
 * the screen.
 *
 * **Which end drops the repeated month is decided by the date order, not by
 * taste.** Day-first ("3 – 9 Aug") had to elide on the *first* date, because
 * the month trails; month-first has to elide on the *second*, because the
 * month leads. Flipping the format without moving the elision produces
 * "Aug 3 – Aug 9", which is the repetition this exists to remove.
 */
export function describeWeekRange(days: readonly Date[]): string {
  if (days.length === 0) return '';
  const sorted = [...days].sort((a, b) => +a - +b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const sameYear = first.getFullYear() === last.getFullYear();
  const start = format(first, 'MMM d');
  const end = format(
    last,
    !sameYear ? 'MMM d, yyyy' : first.getMonth() === last.getMonth() ? 'd' : 'MMM d'
  );
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
 * "Added today", "Added yesterday", "Added Sunday", "Added Aug 3" — the week
 * header's stamp line.
 *
 * **"Added", not "Added to list".** It shares a one-line subtitle with the
 * week's own count ("6 meals planned · Added yesterday"), and the longer
 * wording is what pushed that line to two — on the one screen in the app whose
 * header is already carrying the most controls. What was added, and to what,
 * is not in doubt standing on the meal plan next to a button that says "Add
 * week to list"; the day it happened is the only part that isn't already on
 * screen.
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
  if (isSameDay(d, now)) return 'Added today';
  if (isSameDay(d, subDays(now, 1))) return 'Added yesterday';
  if (isSameWeek(d, now, { weekStartsOn })) return `Added ${format(d, 'EEEE')}`;
  return `Added ${format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')}`;
}
