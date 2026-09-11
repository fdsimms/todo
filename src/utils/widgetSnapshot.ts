import type {
  GroceryItem,
  GroceryList,
  GroceryListEntry,
  MealSlot,
  Priority,
  RecurrenceType,
  Recipe,
  MealPlanEntry,
  Shop,
  Task,
} from '../types';
import { displayTitleFor, isHiddenForVacation } from './visibilityUtils';
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

export interface WidgetSnapshot {
  updatedAt: string;
  visibleTasks: WidgetTask[];
  pinnedTasks: WidgetTask[];
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

export function toWidgetTask(task: Task): WidgetTask {
  return {
    id: task.id,
    title: displayTitleFor(task),
    priority: task.priority,
    pinned: task.pinned,
    dueDate: task.dueDate,
    category: task.category,
    streakCount: task.streakCount,
    recurrenceType: task.recurrenceType,
    targetCount: task.targetCount,
    progressCount: task.progressCount,
    targetUnit: task.targetUnit,
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
    items: itemsOnList(input.items, input.listEntries, id)
      .filter(item => !item.checked)
      .slice(0, MAX_GROCERY_ITEMS_PER_LIST)
      .map(item => item.name),
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
}

export function buildWidgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  return {
    updatedAt: input.now.toISOString(),
    visibleTasks: input.visibleTasks
      .filter(isWidgetWorthy)
      .slice(0, MAX_VISIBLE_TASKS)
      .map(toWidgetTask),
    pinnedTasks: input.pinnedTasks
      .filter(isWidgetWorthy)
      .slice(0, MAX_PINNED_TASKS)
      .map(toWidgetTask),
    categories: [...input.categories],
    // Vacation-hidden rows are filtered out first, exactly as the daily
    // notification does before calling this (`notifications.ts`). The widget
    // must not count work the app itself is currently withholding.
    agenda: agendaCounts(
      input.allTasks.filter(task => !isHiddenForVacation(task)),
      input.now,
      input.dayResetTime
    ),
    doneToday: input.doneToday,
    groceries: input.grocery ? buildGroceries(input.grocery, input.now) : null,
    meals: input.meals ? buildMeals(input.meals, input.recipes) : [],
    kitchen: input.kitchen ? buildKitchen(input.kitchen) : [],
  };
}
