import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import type { ContextRow, MealPlanEntry, Recipe } from '../types';
import { MEAL_SLOTS, MEAL_SLOT_LABELS } from '../types';
import type { CategoryListItem, TodayListItem } from './taskGrouping';
import { LATER_TODAY_LABEL } from './taskGrouping';
import { formatTimeOfDay } from './dateUtils';
import { titleForEntry } from './mealPlan';

/**
 * The day's calendar events and planned meals, as rows in the task list
 * (#1571).
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
 * **Health is the third source, and it is the one that files nowhere else.**
 * The other two either had a category already ("where your calendar goes",
 * "where food goes") or could borrow one on a subject argument. A step count
 * shares a subject with nothing in this app, so it gets `healthCategory` of its
 * own, filled in on first switch-on the way `calendarEventCategory` is — which
 * also gives it the same off switch: a cleared category is a real answer, and
 * it is how somebody says "read Health, but not onto my list".
 *
 * A kitchen source used to sit here too — anything about to go off, as a
 * plain uncheckable row. It's gone (#1689 retired): the row it drew had no
 * way to dismiss or reschedule what it was warning about, unlike the events
 * and meals beside it, which are context rather than something to act on. A
 * grocery or leftover actually going off is exactly the "do it or don't"
 * shape a real `groceryUseUp`/`leftoverUseUp` task already covers, so the
 * generator is the only surface for it now — see `docs/arch/generated-tasks.md`.
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
 * Today's health reading as a row (see `docs/arch/health-data.md`).
 *
 * **Silence unless there is something to say** is the shape that works here.
 * Three of the four inputs produce no row at all, and the reasons differ:
 *
 * - **No reading, or one from another day.** The store holds one day-keyed
 *   snapshot and a day that has turned over is not an answer about this one —
 *   the check every reader of a day-keyed snapshot makes.
 * - **A null count.** Null covers a refused read, a day with nothing recorded
 *   and a phone that has never recorded a step, and HealthKit does not
 *   distinguish them: a refusal is deliberately served as an empty store. There
 *   is no honest row to draw for "we don't know", and "No steps" would be shown
 *   to exactly the people who declined.
 * - **A count of zero.** This is the one rule that is a *choice* rather than a
 *   consequence, so it is worth stating: the bridge keeps a real 0 truthfully,
 *   because a bridge that rounded would be lying, and this declines to make a
 *   row out of it, because zero steps is not context about a day. Every logical
 *   day starts at 0 and stays there until the first samples land, so the row
 *   would otherwise be a "0 steps" line every morning — which reads as a scold
 *   to somebody who cannot walk and as a bug to everybody else, and is in
 *   practice indistinguishable from the not-synced-yet state anyway.
 *
 * `now` stays false: it means "this event is running" and drives the
 * treatment's one emphasis, which a step count has no claim on.
 *
 * The reading is taken as its two fields rather than as `HealthDay` so this
 * module keeps importing nothing from a store — the same line `eventContextRows`
 * draws by taking `BusyEvent` from `calendarBusy` rather than from
 * `useCalendarStore`.
 */
export function healthContextRows(
  reading: { dayKey: string; steps: number | null } | null,
  opts: { todayKey: string; category: string | null },
): ContextRow[] {
  if (!reading) return [];
  if (reading.dayKey !== opts.todayKey) return [];
  const { steps } = reading;
  if (steps === null || steps <= 0) return [];

  return [{
    // One row, one day, so a fixed key. No source id: the reading is about a
    // day rather than a row, and there is no record in this app to point at.
    id: 'health-steps',
    sourceId: '',
    kind: 'health',
    title: steps === 1 ? '1 step' : `${steps.toLocaleString()} steps`,
    // "So far today" rather than a time: every other caption here says *when*,
    // and what a running total says is that it is still running. A clock time
    // would be the freshness of the read, which is not a thing anybody wants
    // to read off a task list.
    caption: 'So far today',
    category: opts.category,
    now: false,
    calendarTag: null,
  }];
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
