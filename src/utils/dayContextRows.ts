import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import type { ContextRow, MealPlanEntry, Recipe } from '../types';
import { MEAL_SLOTS, MEAL_SLOT_LABELS } from '../types';
import type { CategoryListItem, TodayListItem } from './taskGrouping';
import { LATER_TODAY_LABEL } from './taskGrouping';
import { formatTimeOfDay } from './dateUtils';
import { titleForEntry } from './mealPlan';
import { useUpEntries, type KitchenEntry } from './kitchenInventory';
import { flattenRecipeIngredients } from './recipeComponents';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';
import { resolvePluralKey } from './groceryPlural';

/**
 * The day's calendar events, planned meals and dying food, as rows in the task
 * list (#1571, #1689).
 *
 * Both used to be a fixed strip pinned above the list — one line of calendar,
 * one of menu — which meant the top of the Today screen was never a task. This
 * turns each into a `ContextRow` filed under a *category*, so they land inside
 * the list the user already orders and collapses, and Today reads as tasks all
 * the way down.
 *
 * **Filing them under a real category is what makes this cheap.** The
 * alternative was a synthetic section threaded through grouping, collapse,
 * focus, counts and the order sheet for the same appearance; a category the
 * user picks (`calendarEventCategory`, and the cook tasks' own
 * `mealCookTaskCategory` for meals) gets all of that for free, and is the same
 * shape as the three "File them under" settings the generated tasks already
 * have. Placement, collapsing and renaming stop being this feature's problem.
 *
 * **The kitchen is the third source, and it files with the meals.** A meal row
 * is a plan and a kitchen row is a warning, so the question was whether the
 * warning belongs above the plan or beside it — and beside is the answer that
 * needs no new setting: `mealCookTaskCategory` is already "where food goes on
 * Today", and `insertContextRows` leads a section with its context rows, so
 * pushing the kitchen ahead of the meals puts the warning at the top of the
 * section the plan it concerns is in. Which is also what makes the pairing
 * legible — see `plannedUsesToday`, where the two halves meet.
 *
 * Pure, and the whole reason the rules are testable: the impure halves stay
 * where they were — EventKit in `calendarSync`/`useCalendarStore`, the entries
 * in `useMealPlanStore`, the catalog and the fridge in
 * `useGroceryStore`/`useLeftoverStore` — and what may appear, in what order,
 * and under which header is decided here.
 */

/** Slot order, for meals sharing a section. Matches the meal plan's own read. */
const SLOT_RANK = new Map(MEAL_SLOTS.map((slot, i) => [slot, i]));

const UNCATEGORIZED = '';

/**
 * Today's events as rows, in the order they'll be read.
 *
 * **An event that has ended is dropped.** Today is a list of what's left, not a
 * log — the same call `uncookedEntries` makes about a meal already cooked. It
 * also means the section empties itself as the day runs out and disappears
 * entirely once the last event is over, so nobody is left looking at a heading
 * over this morning's standup at bedtime.
 *
 * All-day events lead, then the timed ones by start. They have no clock time to
 * sort by (`calendarBusy` is explicit that an all-day event isn't minutes), and
 * a birthday reading "12:00 AM" in the caption column would be the app
 * inventing a time the calendar never gave it.
 *
 * **A hidden event is dropped too**, for a different reason than a finished
 * one: the user asked never to be reminded of this occurrence, and rows on
 * Today are exactly the reminder. It stays a fact `useHiddenEventsStore` knows
 * rather than one folded into `BusyEvent` — the event itself is a read-only
 * mirror of EventKit, and hiding is a local opinion about it.
 */
export function eventContextRows(
  events: readonly BusyEvent[],
  opts: {
    now: Date;
    category: string | null;
    use24Hour: boolean;
    /**
     * Title/color per calendar id, tagging each row with where it came from —
     * omit (or pass an empty map) to leave every row untagged. The caller
     * decides whether tagging is worth it at all: with one calendar chosen,
     * every event already comes from it, so `TodayScreen` only ever passes
     * this once more than one calendar is being read.
     */
    calendarsById?: Readonly<Record<string, { title: string; color: string }>>;
    /** True for an occurrence the user hid — see `useHiddenEventsStore`. */
    isHidden?: (event: Pick<BusyEvent, 'id' | 'start'>) => boolean;
  },
): ContextRow[] {
  const { now, category, use24Hour, calendarsById, isHidden } = opts;
  const at = now.getTime();

  const rows: Array<{ row: ContextRow; allDay: boolean; start: number }> = [];
  for (const event of events) {
    if (!isLiveEvent(event)) continue;
    if (isHidden?.(event)) continue;
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    // Half-open, matching eventsIn: a meeting that ended exactly now is over.
    if (!event.allDay && end <= at) continue;
    const running = !event.allDay && start <= at && end > at;
    const calendar = calendarsById?.[event.calendarId];
    rows.push({
      row: {
        id: `event-${event.id}`,
        sourceId: event.id,
        kind: 'event',
        title: event.title || 'Event',
        caption: event.allDay ? 'All day'
          : running ? 'Now'
          : formatTimeOfDay(new Date(start), use24Hour),
        category,
        now: running,
        calendarTag: calendar ? { name: calendar.title, color: calendar.color } : null,
      },
      allDay: event.allDay,
      start,
    });
  }

  return rows
    .sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1))
    .map(r => r.row);
}

/**
 * Today's meals as rows — but only the ones that aren't already a task.
 *
 * A meal in a slot that gets a task (see `mealSlotTasks.ts`) is already a row
 * in this list as that task, and that
 * task is a row in this list already; captioning it a second time here would be
 * the strip's duplication moved indoors. What's left is exactly the set with
 * nowhere else to appear — a leftover, a takeaway, a dinner typed by hand — and
 * that set is the reason folding the meal strip into the cook tasks isn't
 * enough on its own.
 *
 * `hasCookTask` is passed in rather than read here because "is there a live
 * generated task for this entry" is a question about the task store, and this
 * module is the tested half. It takes the whole entry rather than its id
 * because the task covering a meal is no longer keyed by the meal: a meal task
 * is keyed by the day and the slot it sits in (see `mealSlotTasks.ts`), which
 * is exactly what lets one exist before the meal does — and what this filter
 * has to be able to ask about. Cooked entries drop for `uncookedEntries`'
 * reason: the decision has been made.
 */
export function mealContextRows(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  opts: { category: string | null; hasCookTask: (entry: MealPlanEntry) => boolean },
): ContextRow[] {
  return entries
    .filter(entry => !entry.cookedAt && !opts.hasCookTask(entry))
    .slice()
    .sort((a, b) =>
      (SLOT_RANK.get(a.slot) ?? 0) - (SLOT_RANK.get(b.slot) ?? 0) || a.sortOrder - b.sortOrder)
    .map(entry => ({
      id: `meal-${entry.id}`,
      sourceId: entry.id,
      kind: 'meal' as const,
      title: titleForEntry(entry, recipesById),
      // The slot, not a time: a meal plan entry is a day and a slot by
      // construction (see MealPlanEntry.date), so there is no clock time to
      // show and "Dinner" is the whole of what's known.
      caption: MEAL_SLOT_LABELS[entry.slot],
      category: opts.category,
      now: false,
      calendarTag: null,
    }));
}

/**
 * How many things can go off before Today stops naming them one by one.
 *
 * Two, because a single container of chilli going off tomorrow deserves its own
 * line and a pair still reads as two facts rather than as a list. Past that the
 * rows stop being readable *as* rows — a run of five is the kitchen screen
 * wedged into the task list, which is the thing this feature exists not to be —
 * so they collapse to one line that says how many and opens the kitchen.
 */
export const KITCHEN_ROW_LIMIT = 2;

/**
 * Which of today's planned meals would eat each thing that's dying — the meal's
 * own title, keyed by `KitchenEntry.id` (#1689).
 *
 * The title alone, with no slot in front of it: "Use by tomorrow · Dinner:
 * Weeknight chicken stir-fry" truncates mid-word at 390pt, and what gets cut is
 * the dish — the only part of the clause worth reading. The row is on Today and
 * sits in the section holding the day's food, so "which meal" was the question
 * and "which slot" was never really it. `kitchenContextRows` owns the wording
 * the title goes into.
 *
 * **This is the row the whole feature is for.** A bag of spinach going off
 * today is a warning; a bag of spinach going off today with tonight's salad
 * already planned is an answer, and the app is the only thing that can see both
 * halves at once. It costs one pass over the day's meals because both halves
 * are already on this screen.
 *
 * The two kinds are paired by different keys, and neither is a guess:
 *
 * - **A leftover is matched by `MealPlanEntry.leftoverId`** — a pointer the
 *   user created by planning that container onto that night. Nothing is
 *   inferred from its title, which would otherwise have to match "Leftover
 *   chicken stir-fry" against "Chicken stir-fry" by luck.
 * - **A catalog row is matched by `nameKey`** against the flattened ingredients
 *   of the meal's recipe — the same bridge `classifyPlanned` and
 *   `scoreRecipeAgainstCatalog` cross, so a component's lines count and an
 *   either/or contributes whichever option this meal picked. `swaps` are passed
 *   for the same reason every other shopping read passes them: with "always use
 *   oat milk for milk" on, the line reads oat milk, and oat milk is what's in
 *   the fridge going off.
 *
 * **The earliest slot wins**, so a spinach wanted by both lunch and dinner
 * names lunch: that's the meal that settles it first. A cooked entry is
 * dropped, for `uncookedEntries`' reason — that dinner already happened, and
 * naming it would tell the user to relax about food nothing is going to eat.
 *
 * Pure and separate from the row-building below so it can be tested against a
 * hand-built week, and so the impure half (which recipes are loaded, which
 * swaps are set) stays in the screen.
 */
export function plannedUsesToday(
  entries: readonly KitchenEntry[],
  mealEntries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): Map<string, string> {
  const out = new Map<string, string>();
  if (entries.length === 0) return out;

  const meals = mealEntries
    .filter(entry => !entry.cookedAt)
    .slice()
    .sort((a, b) =>
      (SLOT_RANK.get(a.slot) ?? 0) - (SLOT_RANK.get(b.slot) ?? 0) || a.sortOrder - b.sortOrder);

  for (const meal of meals) {
    if (out.size === entries.length) break;
    const recipe = meal.recipeId ? recipesById.get(meal.recipeId) : undefined;
    const ingredientKeys = recipe
      ? new Set(
          flattenRecipeIngredients(recipe, recipesById, { chosen: meal.recipeChoices }, swaps)
            .map(flat => flat.ingredient.nameKey)
            .filter(Boolean),
        )
      : null;
    // Built once per meal rather than once per (meal, entry): the title is a
    // fact about the meal, and titleForEntry resolves a recipe to do it.
    const label = titleForEntry(meal, recipesById);

    for (const entry of entries) {
      if (out.has(entry.id)) continue;
      // A pantry row and the line that cooks it are one thing across a plural
      // ("serrano peppers" in the drawer, "serrano pepper" in the recipe) —
      // the same resolution the catalog itself makes, see groceryPlural.ts.
      const used = entry.kind === 'leftover'
        ? meal.leftoverId === entry.sourceId
        : !!entry.matchKey && !!ingredientKeys && (
            ingredientKeys.has(entry.matchKey)
            || resolvePluralKey(entry.matchKey, ingredientKeys) !== null
          );
      if (used) out.set(entry.id, label);
    }
  }

  return out;
}

/**
 * What's about to be wasted, as rows on Today (#1689).
 *
 * **Silence unless something needs attention**, which is the whole shape of it:
 * `useUpEntries` is the shared "what's dying" read, and on the ordinary day it
 * returns nothing and this returns nothing. A standing "6 things in the
 * kitchen" row is a status bar, and a status bar on a task list is noise you
 * learn to skip — the same call `tripMarkerFor` makes about captioning a row it
 * knows nothing about.
 *
 * **Anything that already has a "Use up X" task is dropped**, exactly as
 * `mealContextRows` drops a meal with a cook task behind it, and for a sharper
 * reason: the task *is* the same food, phrased as work. Two rows for one bag of
 * spinach is the duplication the meal strip was folded in to end. `hasUseUpTask`
 * is passed in because "is there a live generated task for this row" is a
 * question about the task store and this module is the tested half.
 *
 * That dedupe is also what makes the feature mean something rather than merely
 * repeat the generators. `groceryUseUpTasks` is **off** by default — a task list
 * that fills itself with food is the one people turn off — so a perishable's
 * only voice was the catalog screen nobody opens. It gets a row here instead.
 * The same goes for anything the user opted out of per-row, and for whatever
 * `useUpTaskCap` left without a task: the cap stops evicting knowledge and
 * starts choosing which of it is worth a *task*.
 *
 * One row per thing up to `KITCHEN_ROW_LIMIT`, then one row for all of it. The
 * summary's caption is the soonest day among them, which is the honest lead for
 * a line that can't state four dates; it is not a claim about the other rows,
 * and the kitchen it opens has each of them in `compareKitchenEntries` order.
 *
 * `now` stays false throughout. It means "this event is running" and drives the
 * one emphasis the treatment has; a use-by day is already the loudest thing a
 * caption can say, and borrowing the accent for it would put food above the
 * work it sits among.
 */
export function kitchenContextRows(
  entries: readonly KitchenEntry[],
  opts: {
    category: string | null;
    hasUseUpTask: (entry: KitchenEntry) => boolean;
    /** `plannedUsesToday`'s answer. Absent is the same as nothing planned. */
    plannedUses?: ReadonlyMap<string, string>;
  },
): ContextRow[] {
  const dying = useUpEntries(entries).filter(entry => !opts.hasUseUpTask(entry));
  if (dying.length === 0) return [];

  if (dying.length > KITCHEN_ROW_LIMIT) {
    return [{
      // No source id: this row is built from all of them and names none. See
      // ContextRow.sourceId — nothing dereferences it, since every kitchen row
      // opens the same sheet.
      id: 'kitchen-all',
      sourceId: '',
      kind: 'kitchen',
      title: `${dying.length} things to use up`,
      caption: dying[0].useByCaption,
      category: opts.category,
      now: false,
      calendarTag: null,
    }];
  }

  return dying.map(entry => {
    const usedBy = opts.plannedUses?.get(entry.id);
    return {
      // The entry id is already prefixed by its own kind, so this reads
      // `kitchen-leftover-<id>` and can't collide with the other two sources.
      id: `kitchen-${entry.id}`,
      sourceId: entry.sourceId,
      kind: 'kitchen' as const,
      title: entry.title,
      // "Use by tomorrow · For Weeknight chicken stir-fry". "For" rather than
      // the slot: it's three characters, it reads the same over a recipe and
      // over a leftover planned onto the night ("For Leftover chilli"), and it
      // leaves the dish room to survive the row's single line.
      caption: usedBy ? `${entry.useByCaption} · For ${usedBy}` : entry.useByCaption,
      category: opts.category,
      now: false,
      calendarTag: null,
    };
  });
}

/**
 * Put context rows into the grouped Today list, under their own category.
 *
 * **They lead their section, ahead of its tasks.** Interleaving them by clock
 * was the first design and it doesn't survive contact with the data: a task row
 * on Today has no clock time to interleave *against* — tasks carry time
 * segments and windows, not a time of day — so "in time order" would have
 * meant inventing one. Events (and a meal's slot) do have a position in the
 * day, so they sort among themselves and sit at the top of the section, which
 * also leaves every task below them in the hand-order a drag just committed.
 *
 * **A section is created when its category has only context rows**, which is
 * the normal case for the calendar: `makeCategoryGroups` emits a header only
 * for a category with tasks or stacks in it, so a Calendar Events category
 * holding nothing but events would otherwise never appear. The new header goes
 * where `categoryOrder` says, so it lands in the same place it will once the
 * user files a task there.
 *
 * Rows for the header-less loose group (no category set) go to the very top,
 * which is where their uncategorized tasks already are.
 */
export function insertContextRows(
  items: readonly TodayListItem[],
  rows: readonly ContextRow[],
  opts: { categoryOrder: readonly string[] },
): TodayListItem[] {
  if (rows.length === 0) return items.slice();

  const byCategory = new Map<string, ContextRow[]>();
  for (const row of rows) {
    const key = row.category ?? UNCATEGORIZED;
    const list = byCategory.get(key);
    if (list) list.push(row);
    else byCategory.set(key, [row]);
  }

  const out: TodayListItem[] = items.slice();
  const asItems = (list: ContextRow[]): TodayListItem[] =>
    list.map(row => ({ type: 'context', row }) as TodayListItem);

  // Existing sections first, so the indexes used to place new ones are read
  // against a list that isn't shifting under them.
  for (const [category, list] of byCategory) {
    if (category === UNCATEGORIZED) {
      out.unshift(...asItems(list));
      byCategory.delete(category);
      continue;
    }
    const headerIndex = out.findIndex(
      item => item.type === 'header' && item.label === category,
    );
    if (headerIndex !== -1) {
      out.splice(headerIndex + 1, 0, ...asItems(list));
      byCategory.delete(category);
    }
  }

  // A category the order doesn't name sorts after the ones it does, matching
  // makeCategoryGroups' own "leftovers go last" rule.
  const rankOf = (label: string) => {
    const i = opts.categoryOrder.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  for (const [category, list] of byCategory) {
    const rank = rankOf(category);
    let at = out.length;
    for (let i = 0; i < out.length; i++) {
      const item = out[i];
      if (item.type !== 'header') continue;
      // Later Today is a time section rather than a category and always comes
      // last, so a new section belongs above it however it ranks.
      if (item.label === LATER_TODAY_LABEL || rankOf(item.label) > rank) {
        at = i;
        break;
      }
    }
    out.splice(at, 0, { type: 'header', label: category }, ...asItems(list));
  }

  return out;
}

/** Narrow a rendered list back to the rows the drag machinery understands. */
export function withoutContextRows(items: readonly TodayListItem[]): CategoryListItem[] {
  return items.filter((item): item is CategoryListItem => item.type !== 'context');
}
