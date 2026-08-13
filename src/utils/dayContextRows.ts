import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import type { ContextRow, MealPlanEntry, Recipe } from '../types';
import { MEAL_SLOTS, MEAL_SLOT_LABELS } from '../types';
import type { CategoryListItem, TodayListItem } from './taskGrouping';
import { LATER_TODAY_LABEL } from './taskGrouping';
import { formatTimeOfDay } from './dateUtils';
import { titleForEntry } from './mealPlan';

/**
 * The day's calendar events and planned meals, as rows in the task list (#1571).
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
 * Pure, and the whole reason the rules are testable: the impure halves stay
 * where they were — EventKit in `calendarSync`/`useCalendarStore`, the entries
 * in `useMealPlanStore` — and what may appear, in what order, and under which
 * header is decided here.
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
 */
export function eventContextRows(
  events: readonly BusyEvent[],
  opts: { now: Date; category: string | null; use24Hour: boolean },
): ContextRow[] {
  const { now, category, use24Hour } = opts;
  const at = now.getTime();

  const rows: Array<{ row: ContextRow; allDay: boolean; start: number }> = [];
  for (const event of events) {
    if (!isLiveEvent(event)) continue;
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    // Half-open, matching eventsIn: a meeting that ended exactly now is over.
    if (!event.allDay && end <= at) continue;
    const running = !event.allDay && start <= at && end > at;
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
 * A recipe-backed meal gets a "Cook X" task (see `wantsCookTask`), and that
 * task is a row in this list already; captioning it a second time here would be
 * the strip's duplication moved indoors. What's left is exactly the set with
 * nowhere else to appear — a leftover, a takeaway, a dinner typed by hand — and
 * that set is the reason folding the meal strip into the cook tasks isn't
 * enough on its own.
 *
 * `hasCookTask` is passed in rather than read here because "is there a live
 * generated task for this entry" is a question about the task store, and this
 * module is the tested half. Cooked entries drop for `uncookedEntries`' reason:
 * the decision has been made.
 */
export function mealContextRows(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  opts: { category: string | null; hasCookTask: (entryId: string) => boolean },
): ContextRow[] {
  return entries
    .filter(entry => !entry.cookedAt && !opts.hasCookTask(entry.id))
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
    }));
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
