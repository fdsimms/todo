import type { MealPlanEntry } from '../types';
import { MEAL_SLOT_LABELS } from '../types';
import { dayKeyToDate } from './dateUtils';
import { createAllDayEvent, updateAllDayEvent, deleteCalendarEvent } from './calendarSync';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';

/**
 * What a planned meal should look like on the device calendar right now, and
 * the device write to get there — #1494. The raw EventKit calls live in
 * `calendarSync.ts`; this file owns the rule for when to create, update or
 * delete one, exactly as `deadlineCalendarSync.ts` does for a deadline.
 *
 * This is a *third* replica of a master that already has two: the entry is
 * the plan, `mealTasks.ts` projects it into a "Cook X" task, and this
 * projects it into an event. It invents no new rules — the entry owns the
 * title, the day and the slot, and nothing flows back.
 *
 * Why it exists at all: a household shares a calendar, and "what's for dinner
 * Thursday" is a question the other people in the house ask. A local task
 * can't answer it.
 *
 * Deliberately free of any dependency on `useMealPlanStore` — it's the store
 * that calls this (see `reconcileMealEvent`), so a dependency back would be
 * circular. This function only reports what the device write produced;
 * persisting the id onto the entry is the caller's job.
 */

/**
 * "Dinner: Weeknight chicken stir-fry".
 *
 * The slot rides in the title because the event carries no time to say it
 * with (see `mealEventFields`), and a shared calendar showing three untitled
 * dishes on a Thursday answers a worse question than one showing which meal
 * each is.
 *
 * Built off `entry.title` and not the live recipe name, the same call
 * `cookTaskTitle` makes and for the same reason: the entry keeps its own
 * title in step (captured at plan time, rewritten by `bulkReplaceItem`), so
 * this needs no recipe lookup and stays free of the recipe store.
 */
export function mealEventTitle(entry: MealPlanEntry): string {
  const label = MEAL_SLOT_LABELS[entry.slot] ?? 'Meal';
  const title = entry.title.trim();
  return title ? `${label}: ${title}` : label;
}

/**
 * The two things the meal owns on the device event, and the complete list —
 * a meal edit rewrites the title and the day, and touches nothing else, for
 * ever. Anything the user adds to the event by hand (a location, an alert,
 * whoever they invited) survives every reconcile.
 *
 * **All-day, not a timed event, and that's the one new decision here.**
 * `MEAL_SLOT_SEGMENTS` maps a slot to a time-of-day *visibility* segment —
 * when a cook task surfaces on Today, not when anyone eats — so borrowing it
 * for a start time would state a plan the app never recorded, and state it to
 * everyone else in the house. A dinner pinned at 17:00 on a shared calendar
 * reads as a commitment; an all-day banner reads as the answer to "what's for
 * dinner", which is the question. Same refusal `recipeScale` makes about "a
 * pinch" and `unitConvert` makes about a unit it doesn't know: the app
 * declines to invent the number and says the part it actually knows.
 */
export function mealEventFields(entry: MealPlanEntry): { title: string; date: Date } {
  return { title: mealEventTitle(entry), date: dayKeyToDate(entry.date) };
}

/**
 * Creates, updates or deletes this meal's calendar event, and returns the id
 * it should now be linked to (null when it shouldn't have one).
 *
 * Which meals get an event: every one in the plan, once a calendar is picked.
 * There is deliberately no per-meal opt-out to match `cookTask`'s tri-state —
 * that field exists because deleting a spawned task is an instruction the app
 * can hear, and there's no such gesture here: expo-calendar has no
 * `EKEventStoreChanged` bridge, so an event deleted on the device is
 * invisible from this side. A flag nothing can ever write is a flag that
 * shouldn't exist.
 *
 * Nor is a *cooked* meal dropped, unlike a cook task, which a cooked meal has
 * no use for. Thursday's dinner having been eaten doesn't stop it being what
 * was for dinner on Thursday, and taking it off the shared calendar would
 * quietly rewrite the household's own record of the week.
 *
 * Leftovers stay too, for the same reason: "Dinner: Leftover stir-fry" is a
 * complete answer to the question the calendar is being asked. `cookTaskFor`
 * skips them because there is nothing to cook, which is a different question.
 */
export async function syncMealEvent(entry: MealPlanEntry): Promise<string | null> {
  // Same guard notifications.ts uses: demo mode seeds a full week of meals
  // through the real planMeal action, and without this every one of them
  // would write a real all-day event to whatever calendar the user had
  // picked before switching demo mode on.
  if (isDemoModeActive()) return null;

  const { mealCalendarId } = useSettingsStore.getState();

  // No target calendar picked — the event (if one exists) goes away, and
  // there's nothing to link.
  //
  // `kitchenEnabled` is deliberately *not* read here, the same call
  // `reconcileCookTask` makes. It gates the settings section instead (see
  // MealCalendarSettings and the `kitchen` flag in settingsIndex), because
  // there is no sweep over the plan anywhere in this feature: reconciling
  // only ever happens on the entry being mutated, so reading the flag here
  // would delete the events of whichever meals happened to be edited while
  // the area was off and leave the rest, and switching it back on would
  // restore none of them. That breaks kitchenEnabled's own rule — turning
  // the area back on restores exactly what was there.
  if (!mealCalendarId) {
    if (entry.calendarEventId) await deleteCalendarEvent(entry.calendarEventId);
    return null;
  }

  const fields = mealEventFields(entry);

  if (entry.calendarEventId) {
    if (await updateAllDayEvent(entry.calendarEventId, fields)) return entry.calendarEventId;
    // The id didn't resolve to a live event — deleted by hand, or the calendar
    // itself is gone. Resolve-or-shrug: fall through and write a fresh one
    // rather than leaving the entry pointing at nothing.
  }

  return createAllDayEvent(mealCalendarId, fields);
}
