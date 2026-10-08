import type {
  GroceryItem,
  GroceryList,
  GroceryListEntry,
  MealSlot,
  Priority,
  RecurrenceType,
  Recipe,
  MealPlanEntry,
  MedicationLog,
  Shop,
  Task,
} from '../types';
import { displayTitleFor, isHeldBack, isWithheld } from './visibilityUtils';
import { liveStreakCount } from './dateUtils';
import {
  itemsOnList,
  listCount,
  listNameFor,
  listRemainingCount,
  HOME_LIST_NAME,
} from './groceryLists';
import { resolveActiveTrip } from './activeTrip';
import { recipeIndex, slotLabel, titleForEntry, uncookedEntries } from './mealPlan';
import { compareKitchenEntries, useUpEntries, type KitchenEntry } from './kitchenInventory';
import { agendaCounts, type AgendaCounts } from './dailyAgenda';
import { occupiesTime, type BusyEvent } from './calendarBusy';
import { eventTaskEventOf } from './eventTasks';
import { addDays } from 'date-fns/addDays';
import { widgetTapNeedsApp } from './widgetQuietTaps';
import { formatDose, medicationStats, repeatDose } from './medicationLog';

/**
 * Everything the iOS widgets read, and the one place its shape is decided.
 *
 * Split out of `widgetSync.ts` when the snapshot stopped being "the task list"
 * and became the app: the sync file owns the subscriptions, the drains and the
 * native call, none of which can run under jest, and this owns the derivation,
 * all of which can. Same split `focusLiveActivity.ts` already keeps between
 * `buildFocusRun` and its sync hook, and for the same reason.
 *
 * **The Swift side decodes this by property name** (`TodoWidgetData.swift`,
 * a separate compilation unit that can't import the types), so a rename here
 * is a silent decode failure over there rather than a type error here. The
 * widget's `.decodeFailed` state exists to make that visible when it happens.
 *
 * **Nothing here is a rendered string where the widget could render it
 * itself.** A trip's elapsed minutes, a use-by day's "in 2 days" and a due
 * time all move while the app is closed, and a string baked at write time is
 * wrong by the time anybody looks at it. Stamps and day keys go across; the
 * words are Swift's. The exception is anything needing the user's own
 * settings to say at all (`dayResetTime`, the logical day a count belongs to),
 * which the extension has no access to — those are counted here.
 */

/** How much of each section crosses the bridge. */
const MAX_VISIBLE_TASKS = 50;
const MAX_PINNED_TASKS = 10;
const MAX_UPCOMING_TASKS = 30;
const MAX_GROCERY_LISTS = 12;
const MAX_GROCERY_ITEMS_PER_LIST = 10;
const MAX_MEALS = 6;
const MAX_KITCHEN_ITEMS = 8;

export interface WidgetTask {
  id: string;
  title: string;
  priority: Priority;
  pinned: boolean;
  dueDate: string | null;
  category: string | null;
  streakCount: number;
  recurrenceType: RecurrenceType;
  /**
   * A daily target's state, or null on every ordinary task. Carried as the two
   * numbers plus the unit rather than as "3/8 glasses" because the widget lays
   * the parts out differently per family — the accessory circular draws the
   * fraction as a ring and never says it in words at all.
   */
  targetCount: number | null;
  progressCount: number;
  targetUnit: string | null;
  /**
   * The title of the calendar event a rule wrote this task for, or null on
   * every other row. The widget dims it after the task's own title.
   */
  eventTitle: string | null;
  /**
   * The reminder's instant, the one clock time a task row in the app names
   * (see `reminderTimeLabel` in TaskItem). An ISO stamp, so the widget formats
   * it in the device's own clock style.
   */
  reminderTime: string | null;
  /**
   * Whether the row's checkbox has to open the app (`widgetTapNeedsApp`):
   * anything a tap in the app answers with a question or a picker. Every other
   * row is checked off from the widget without leaving the home screen.
   */
  needsApp: boolean;
}

/**
 * A task that isn't on Today yet but will be before the widget has to admit
 * the snapshot is stale: deferred to this afternoon, or due tomorrow.
 *
 * **This is what lets the widget move on without the app.** The snapshot used
 * to carry only what was visible at the moment it was written, so a task
 * deferred to 3 PM stayed off the home screen until the app (or a background
 * refresh, whenever iOS chose to run one) wrote again, and the day rolling over
 * left yesterday's list up with nothing to say so. The widget now builds a
 * timeline entry at each `visibleAt` and folds the task in from that moment.
 */
export interface WidgetUpcomingTask extends WidgetTask {
  /** When `getVisibleAt` says the task surfaces, as an ISO stamp. */
  visibleAt: string;
}

export interface WidgetGroceryList {
  /** Null is the list at home, matching `GroceryListEntry.listId`. */
  id: string | null;
  name: string;
  remaining: number;
  /**
   * Every row in the trolley, ticked or not — the denominator the circular
   * Lock Screen accessory draws `remaining` against. Without it that ring has
   * nothing to be a fraction of, and `items` can't stand in for it: that one
   * is capped, so a 30-item shop would read as a full ring at 10.
   */
  total: number;
  /** The first few rows still to buy, in the list's own walk order. */
  items: string[];
  /**
   * The same rows with the ids the widget's checkbox needs. `items` stays for
   * a widget built before this field, which reads only names.
   */
  rows: WidgetGroceryRow[];
}

export interface WidgetGroceryRow {
  id: string;
  name: string;
  /**
   * One side of an either/or. The widget draws no checkbox on these: ticking
   * one option is how the choice gets made, which removes the others, and that
   * is a decision to make in front of the whole list.
   */
  choice: boolean;
}

export interface WidgetGroceries {
  /** Every list, active one first — the configuration picker enumerates these. */
  lists: WidgetGroceryList[];
  activeListId: string | null;
  /** The shop being walked right now, or null. */
  tripShopName: string | null;
  /** The trip's start stamp, so Swift counts the minutes rather than this. */
  tripStartedAt: string | null;
}

export interface WidgetMeal {
  slot: MealSlot;
  slotLabel: string;
  title: string;
}

export interface WidgetKitchenItem {
  title: string;
  /** A `YYYY-MM-DD` day key, or null for a row with nothing said about it. */
  useBy: string | null;
}

/** A meeting still ahead today, as raw stamps for the widget to format. */
export interface WidgetEvent {
  /** The event's own title; empty for an untitled one. */
  title: string;
  start: string;
  end: string;
}

/**
 * How many of today's meetings ride along. More than one so the widget can
 * move on to the next when one starts, without the app having to write again.
 */
export const MAX_WIDGET_EVENTS = 3;

export interface WidgetSnapshot {
  updatedAt: string;
  visibleTasks: WidgetTask[];
  pinnedTasks: WidgetTask[];
  /** Tasks surfacing before `staleAfter`, soonest first. See `WidgetUpcomingTask`. */
  upcomingTasks: WidgetUpcomingTask[];
  /**
   * When the next logical day starts. From then on `doneToday` and `agenda`
   * describe yesterday, so the widget stops showing them.
   */
  nextDayStart: string;
  /**
   * When the task rows stop being trustworthy at all: the end of tomorrow,
   * which is as far as `upcomingTasks` looks. Past it the widget asks to be
   * opened rather than showing a list that is missing a day's worth of tasks.
   */
  staleAfter: string;
  /**
   * Category names in the user's own order, for the Today widget's category
   * parameter. The widget filters rows it already has rather than asking for a
   * filtered snapshot — there is one snapshot and any number of placed
   * widgets, so the filter has to live on the reading side.
   */
  categories: string[];
  agenda: AgendaCounts;
  doneToday: number;
  /** Null when the grocery store has not been initialized in this process. */
  groceries: WidgetGroceries | null;
  meals: WidgetMeal[];
  kitchen: WidgetKitchenItem[];
  /**
   * Today's meetings still to start, soonest first, or **null when the
   * calendar wasn't read** (switched off, a failed read, or a background run,
   * which never reads it). The widget shows nothing for null, where an empty
   * list would be "no more meetings today".
   */
  upcomingEvents: WidgetEvent[] | null;
  /**
   * The as-needed medications the Medications widget offers a button for,
   * most recently taken first, or null when the medication log hasn't loaded
   * in this process (the widget asks for the app rather than saying "none").
   */
  medications: WidgetMedication[] | null;
}

/**
 * One as-needed medication on the Medications widget. `id` is its
 * `medicationKey`, the same id `LogMedicationIntent`'s entity carries, so the
 * widget's button can hand the intent an entity without reading the Siri
 * index. `dose` is what the button records (the last dose, `repeatDose`), so
 * the row can say so before it is tapped.
 */
export interface WidgetMedication {
  id: string;
  name: string;
  dose: string | null;
  lastTakenAt: string;
}

/** How many medications the widget carries. A medium widget shows six. */
export const MAX_WIDGET_MEDICATIONS = 6;

/**
 * The as-needed, non-archived medications, most recently taken first. Only
 * as-needed ones for the reason the Medications screen's quick button is only
 * on those: a scheduled dose is recorded by checking off its task, and the
 * Today widget already has that checkbox.
 */
export function buildWidgetMedications(
  logs: readonly MedicationLog[],
  archived: readonly string[],
): WidgetMedication[] {
  return medicationStats(logs)
    .filter(stat => stat.asNeeded && !archived.includes(stat.key))
    .slice(0, MAX_WIDGET_MEDICATIONS)
    .map(stat => ({
      id: stat.key,
      name: stat.name,
      dose: formatDose(repeatDose(logs, stat.name)),
      lastTakenAt: stat.lastTakenAt,
    }));
}

/**
 * The weekly meal-plan nudge (see mealPlanNudge.ts) fires as a stack of
 * seven — one bare "Sunday 08/17"-style task per day — which reads fine
 * under its stack header in the app but, flattened onto the widget with no
 * header or grouping to explain them, looked like seven nonsense date
 * titles crowding out the real tasks around them (#1726). The widget has no
 * notion of a stack to collapse them into instead, so they're left off
 * entirely; the stack is still one tap away inside the app.
 */
export function isWidgetWorthy(task: Task): boolean {
  // A negative habit's only control is "I slipped", and the widget's task rows
  // have one control: a checkbox that queues a completion. That completion is
  // refused (see the polarity guard in completeTask), so shipping the row would
  // put a checkbox on the home screen that does nothing at all when tapped —
  // and the one thing it *looks* like it would do is the opposite of what the
  // task means. Until the widget can draw a shield, it doesn't carry these.
  if (task.polarity === 'negative') return false;
  return task.generatedKind !== 'mealPlanNudge';
}

export function toWidgetTask(
  task: Task,
  events: readonly BusyEvent[] | null = null,
  // True by default, the answer that can't go wrong: an extra trip into the
  // app rather than a question skipped.
  mealLogPrompt = true,
): WidgetTask {
  return {
    id: task.id,
    title: displayTitleFor(task),
    priority: task.priority,
    pinned: task.pinned,
    dueDate: task.dueDate,
    category: task.category,
    streakCount: liveStreakCount(task),
    recurrenceType: task.recurrenceType,
    targetCount: task.targetCount,
    progressCount: task.progressCount,
    targetUnit: task.targetUnit,
    // Only the title crosses, never "Tomorrow 3 PM": a day word baked at write
    // time is wrong after midnight. Null when the event has left the window or
    // the calendar wasn't read (a background refresh).
    eventTitle: events ? eventTaskEventOf(task, events)?.title || null : null,
    reminderTime: task.reminderTime,
    needsApp: widgetTapNeedsApp(task, mealLogPrompt),
  };
}

export interface GroceryInput {
  lists: readonly GroceryList[];
  listEntries: readonly GroceryListEntry[];
  items: readonly GroceryItem[];
  activeListId: string | null;
  shops: readonly Shop[];
  tripShopId: string | null;
  tripStartedAt: string | null;
}

/** One list's unbought rows, as names and as rows the widget can tick. */
function groceryRows(input: GroceryInput, listId: string | null): Pick<WidgetGroceryList, 'items' | 'rows'> {
  const choiceIds = new Set(
    input.listEntries.filter(e => e.listId === listId && e.choiceGroup).map(e => e.itemId)
  );
  const rows = itemsOnList(input.items, input.listEntries, listId)
    .filter(item => !item.checked)
    .slice(0, MAX_GROCERY_ITEMS_PER_LIST)
    .map(item => ({ id: item.id, name: item.name, choice: choiceIds.has(item.id) }));
  return { items: rows.map(r => r.name), rows };
}

/**
 * Every list with its own count, active one first.
 *
 * All of them rather than only the active one, because a placed widget names
 * the list it was configured for and that is not necessarily the list the app
 * happens to have open — the whole point of configuring one is that the away
 * list stays on the home screen while the app is back on the home list.
 */
export function buildGroceries(input: GroceryInput, now: Date): WidgetGroceries {
  // The home list is not a row in `lists` (its id is null), so it is named
  // here rather than found — same shape `listPickerRows` builds.
  const ids: (string | null)[] = [null, ...input.lists.map(l => l.id)];
  const ordered = ids
    .slice()
    .sort((a, b) => Number(b === input.activeListId) - Number(a === input.activeListId));

  const lists = ordered.slice(0, MAX_GROCERY_LISTS).map(id => ({
    id,
    name: id === null ? HOME_LIST_NAME : listNameFor(id, input.lists),
    remaining: listRemainingCount(input.listEntries, id),
    total: listCount(input.listEntries, id),
    ...groceryRows(input, id),
  }));

  const shop = resolveActiveTrip(input.tripShopId, input.tripStartedAt, input.shops, now);
  return {
    lists,
    activeListId: input.activeListId,
    // Both or neither: a shop name with no stamp leaves Swift counting from
    // nothing, and a stamp with no name has nothing to label it with.
    tripShopName: shop ? shop.name : null,
    tripStartedAt: shop ? input.tripStartedAt : null,
  };
}

/** What's still to eat today, in the order the day is eaten. */
export function buildMeals(
  entries: readonly MealPlanEntry[],
  recipes: readonly Recipe[]
): WidgetMeal[] {
  const index = recipeIndex(recipes);
  return uncookedEntries([...entries])
    .slice(0, MAX_MEALS)
    .map(entry => ({
      slot: entry.slot,
      slotLabel: slotLabel(entry.slot),
      title: titleForEntry(entry, index),
    }));
}

/**
 * What's about to go off, most urgent first.
 *
 * `useUpEntries` rather than the whole inventory: a widget-sized list of "what
 * is in the kitchen" is a list nobody acts on, and the ladder already knows
 * which rows are the ones worth a home-screen slot.
 */
export function buildKitchen(entries: readonly KitchenEntry[]): WidgetKitchenItem[] {
  return useUpEntries([...entries])
    .slice()
    .sort(compareKitchenEntries)
    .slice(0, MAX_KITCHEN_ITEMS)
    .map(entry => ({ title: entry.title, useBy: entry.useBy }));
}

export interface SnapshotInput {
  now: Date;
  /** Everything `isTaskVisible` says is on Today, in list order. */
  visibleTasks: readonly Task[];
  pinnedTasks: readonly Task[];
  /** Every task row, for the counts that are about dates rather than about now. */
  allTasks: readonly Task[];
  categories: readonly string[];
  dayResetTime: string;
  doneToday: number;
  grocery: GroceryInput | null;
  meals: readonly MealPlanEntry[] | null;
  recipes: readonly Recipe[];
  kitchen: readonly KitchenEntry[] | null;
  /** The calendar read, or null when there isn't a trustworthy one. */
  events: readonly BusyEvent[] | null;
  /** The end of the logical day, so tonight's meetings count and tomorrow's don't. */
  dayEnd: Date;
  /**
   * Tasks not visible yet, each with the moment `getVisibleAt` puts it on
   * Today. Worked out by the caller because `getVisibleAt` reads the stores;
   * `buildUpcomingTasks` decides which of them cross.
   */
  upcoming: readonly { task: Task; visibleAt: Date }[];
  /** The "what did you eat?" setting, which decides whether a tap needs the app. */
  mealLogPrompt: boolean;
  /** The medication log and its archived names, or null before it has loaded. */
  medications?: { logs: readonly MedicationLog[]; archived: readonly string[] } | null;
}

/**
 * The tasks that will reach Today between now and `staleAfter`, soonest
 * first. Anything surfacing later than that would be drawn past the point the
 * widget stops trusting the snapshot anyway, so it isn't carried.
 */
export function buildUpcomingTasks(
  upcoming: readonly { task: Task; visibleAt: Date }[],
  now: Date,
  staleAfter: Date,
  events: readonly BusyEvent[] | null = null,
  mealLogPrompt = true,
): WidgetUpcomingTask[] {
  return upcoming
    .filter(({ task, visibleAt }) =>
      isWidgetWorthy(task) &&
      visibleAt.getTime() > now.getTime() &&
      visibleAt.getTime() < staleAfter.getTime()
    )
    .slice()
    .sort((a, b) => a.visibleAt.getTime() - b.visibleAt.getTime())
    .slice(0, MAX_UPCOMING_TASKS)
    .map(({ task, visibleAt }) => ({
      ...toWidgetTask(task, events, mealLogPrompt),
      visibleAt: visibleAt.toISOString(),
    }));
}

/**
 * The meetings still to start before the day ends, soonest first. Only events
 * that take time (`occupiesTime`), the same ones every busy reader counts.
 */
export function buildUpcomingEvents(
  events: readonly BusyEvent[],
  now: Date,
  dayEnd: Date,
): WidgetEvent[] {
  return events
    .filter(e => occupiesTime(e))
    .filter(e => {
      const start = Date.parse(e.start);
      return start > now.getTime() && start < dayEnd.getTime();
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, MAX_WIDGET_EVENTS)
    .map(e => ({ title: e.title.trim(), start: e.start, end: e.end }));
}

export function buildWidgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  const staleAfter = addDays(input.dayEnd, 1);
  return {
    updatedAt: input.now.toISOString(),
    visibleTasks: input.visibleTasks
      .filter(isWidgetWorthy)
      .slice(0, MAX_VISIBLE_TASKS)
      .map(t => toWidgetTask(t, input.events, input.mealLogPrompt)),
    pinnedTasks: input.pinnedTasks
      .filter(isWidgetWorthy)
      .slice(0, MAX_PINNED_TASKS)
      .map(t => toWidgetTask(t, input.events, input.mealLogPrompt)),
    upcomingTasks: buildUpcomingTasks(input.upcoming, input.now, staleAfter, input.events, input.mealLogPrompt),
    nextDayStart: input.dayEnd.toISOString(),
    staleAfter: staleAfter.toISOString(),
    categories: [...input.categories],
    // Withheld and held-back rows are filtered out first, exactly as the
    // daily notification does before calling this (`notifications.ts`). The
    // widget must not count work the app itself is currently withholding.
    agenda: agendaCounts(
      input.allTasks.filter(task => !isWithheld(task) && !isHeldBack(task)),
      input.now,
      input.dayResetTime
    ),
    doneToday: input.doneToday,
    groceries: input.grocery ? buildGroceries(input.grocery, input.now) : null,
    meals: input.meals ? buildMeals(input.meals, input.recipes) : [],
    kitchen: input.kitchen ? buildKitchen(input.kitchen) : [],
    upcomingEvents: input.events ? buildUpcomingEvents(input.events, input.now, input.dayEnd) : null,
    medications: input.medications
      ? buildWidgetMedications(input.medications.logs, input.medications.archived)
      : null,
  };
}
