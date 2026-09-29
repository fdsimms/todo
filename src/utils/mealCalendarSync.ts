import type { MealPlanEntry } from '../types';
import { MEAL_SLOT_LABELS, MEAL_PLAN_RETENTION_DAYS } from '../types';
import { dayKeyToDate } from './dateUtils';
import { deleteCalendarEvent } from './calendarSync';
import { NO_EVENT_LINK, writeAllDayEvent, type CalendarEventLink } from './calendarEventLink';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';
import { mealPlanPurgeCutoffKey, mealTitleOffPlan } from './mealPlan';
import type { ApplyReport } from './syncMerge';

/**
 * What a planned meal should look like on the device calendar right now, and
 * the device write to get there — #1494. The raw EventKit calls live in
 * `calendarSync.ts`; this file owns the rule for when to create, update or
 * delete one, exactly as `deadlineCalendarSync.ts` does for a deadline.
 *
 * This is a *third* replica of a master that already has two: the entry is
 * the plan, `mealTasks.ts` projects it into a "Make X" task, and this
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
 * persisting the link onto the entry is the caller's job.
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
 * title in step (captured at plan time, rewritten by `bulkReplaceItem`, and by
 * `retitleRecipeEntries` when the recipe itself is renamed), so this needs no
 * recipe lookup and stays free of the recipe store. A leftover
 * says so (`mealTitleOffPlan`), since the snowflake that marks one on the plan
 * row doesn't travel to a calendar.
 */
export function mealEventTitle(entry: MealPlanEntry): string {
  const label = MEAL_SLOT_LABELS[entry.slot] ?? 'Meal';
  const title = entry.title.trim();
  return title ? `${label}: ${mealTitleOffPlan(entry, title)}` : label;
}

/**
 * The two things the meal owns on the device event, and the complete list —
 * a meal edit rewrites the title and the day (and, since #2949, which of the
 * user's calendars it sits in, the one they picked) and nothing else. Whoever
 * they invited, and a location, a note or an alert added by hand, survive
 * every reconcile. The last three only because the rewrite reads them back
 * first and sends them with it: expo-calendar's save resets them otherwise
 * (see `rewriteEvent` in `calendarSync.ts`).
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
 * Creates, updates or deletes this meal's calendar event, and returns what it
 * should now be linked to: the event's device id and the calendar server's id
 * for it, both null when it shouldn't have one.
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
 * Leftovers stay too, for the same reason: "Dinner: Stir-fry (leftovers)" is
 * a complete answer to the question the calendar is being asked. `cookTaskFor`
 * skips them because there is nothing to cook, which is a different question.
 */
export async function syncMealEvent(entry: MealPlanEntry): Promise<CalendarEventLink> {
  // Same guard notifications.ts uses: demo mode seeds a full week of meals
  // through the real planMeal action, and without this every one of them
  // would write a real all-day event to whatever calendar the user had
  // picked before switching demo mode on.
  if (isDemoModeActive()) return NO_EVENT_LINK;

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
    return NO_EVENT_LINK;
  }

  // Into the calendar picked *now*, not the one it was first written to: a
  // meal written before "Write meals to" was switched moves across the next
  // time it's reconciled, rather than going on being rewritten in the old
  // calendar while new meals land in the new one (#2949). Still no sweep, for
  // setMealCalendarId's reason: a meal nobody touches keeps its event where it
  // is. An id that no longer resolves (deleted by hand, the calendar gone, or
  // a backup restored on a new phone, #2950) falls back to the event found by
  // its server id and then to a fresh one; `writeAllDayEvent` has the order.
  return writeAllDayEvent(
    { eventId: entry.calendarEventId, externalId: entry.calendarEventExternalId ?? null },
    mealCalendarId,
    mealEventFields(entry)
  );
}

/**
 * How many days inside the purge horizon a removal from another device is
 * still read as that device's purge rather than as somebody removing the meal.
 * The purge anchors to the calendar date (`mealPlanPurgeCutoffKey`), so a peer
 * whose date is ahead of this one's purges meals this one still counts as
 * inside the horizon. Two, because two time zones are at most 26 hours apart
 * (UTC-12 against UTC+14), which is at most two calendar dates.
 */
const SYNC_PURGE_MARGIN_DAYS = 2;

/** What a sync apply asks of this device's meal events. */
export interface MealEventSyncPlan {
  /** Meals holding an event this device wrote, to bring in line through `syncMealEvent`. */
  reconcile: MealPlanEntry[];
  /** Events whose meal another device removed, to delete. */
  remove: string[];
}

/**
 * Which of this device's meal events a sync apply has left stale, and what to
 * do about each (#2950).
 *
 * A meal's event belongs to the device that wrote it: its id is kept off the
 * wire (`SYNC_DEVICE_LOCAL_COLUMNS`), and nothing but this device can rewrite
 * or delete it. Before this, a meal moved or renamed on another device kept
 * its old day and title on the calendar until this device next edited it, and
 * one removed there stayed on the calendar for good. So a sync is treated
 * exactly like the local edit it stands in for, and goes through the same path.
 *
 * - **A meal the apply changed is reconciled only when it already holds an
 *   event of this device's.** A meal with none is left alone, including every
 *   meal that arrived new (a synced row never carries the id). Writing one here
 *   would put a second event for the same dinner on a household calendar the
 *   device that planned it may already have written to, and turning "Write
 *   meals to" on has never swept the plan either. With no calendar picked the
 *   reconcile deletes the event, the same as a local edit does.
 * - **A meal the apply deleted takes its event with it**, as removing it here
 *   would (`dropMealEvent`), with one exception: the 180-day purge. Every
 *   device runs it, and it deliberately leaves events on the calendar as the
 *   household's record of what was eaten; its deletions sync like any other.
 *   So a removed meal older than the horizon (less the margin above) is read as
 *   the purge, and its event stays.
 * - **Nothing at all in demo mode.** A sync never runs there, and this carries
 *   its own gate rather than trusting that, per the rule for anything that
 *   writes outside the database.
 *
 * A meal changed twice across a sync's transports is reconciled once, and one
 * the same sync then deleted is not reconciled (it no longer resolves), only
 * its event deleted.
 */
export function mealEventsAfterSync(
  applied: Pick<ApplyReport, 'mealEntryIds' | 'removedMealEvents'>,
  resolve: (id: string) => MealPlanEntry | null,
  now: Date = new Date()
): MealEventSyncPlan {
  if (isDemoModeActive()) return { reconcile: [], remove: [] };

  const reconcile: MealPlanEntry[] = [];
  for (const id of new Set(applied.mealEntryIds)) {
    const entry = resolve(id);
    if (entry?.calendarEventId) reconcile.push(entry);
  }

  const purgedBefore = mealPlanPurgeCutoffKey(now, MEAL_PLAN_RETENTION_DAYS - SYNC_PURGE_MARGIN_DAYS);
  const remove = [...new Set(
    applied.removedMealEvents.filter(m => m.date >= purgedBefore).map(m => m.eventId)
  )];

  return { reconcile, remove };
}
