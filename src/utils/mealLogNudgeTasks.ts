import { format } from 'date-fns/format';
import type { MealPlanEntry, MealSlot, Task } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { mealPlanNudgeLinkUrl } from './mealPlanNudge';
import { mealSlotKey, shiftDayKey, slotLabel, slotRank } from './mealPlan';

/**
 * "Log breakfast? (Mon 9/8)" — the half of `mealLog.ts`'s offer that a
 * completion-time prompt can never reach.
 *
 * The prompt in `mealLog.ts`/`LogMealPrompt.tsx` only ever fires the moment a
 * meal's Eat step is ticked. A meal whose step never got ticked at all — the
 * dinner that got skipped, the lunch eaten standing at the counter with the
 * task left sitting there, an install that turns this generator on with a
 * week of planning already behind it — has no completion to hang an offer
 * off, and until now had no way back into the log either. This asks the
 * question a few days later instead of not asking it at all.
 *
 * **It does not try to tell whether the meal happened.** `cookedAt` is never
 * consulted — deliberately, unlike `mealShortfallRows`, which refuses a meal
 * already cooked. A meal with nothing logged and no tick either is exactly
 * the case this exists for, so narrowing to "was ticked, wasn't logged" would
 * throw away most of what it's for. The task itself asks generically ("Log
 * breakfast?") rather than assuming the answer, and completing it without
 * having actually opened the log sheet is a legitimate way to say "I know,
 * I'm not bothering" — the same shrug swiping away any other generated task
 * already is.
 *
 * **Completing it opens the exact offer completing the Eat step would have**
 * — see `useTaskStore.ts`'s `completeTask`, which reads a completed
 * `mealLogNudge` task's source entry through the same branch a mealSlot
 * completion does: the auto-computed prompt for a recipe-backed meal,
 * `pendingManualMealLog`'s search sheet for anything else.
 *
 * **Its per-meal "no" is the same field the completion prompt's "Don't ask
 * for this meal" already writes** (`MealPlanEntry.logMeal`), not a field of
 * its own. Declining either one means the same thing about the same meal —
 * stop asking about logging it — so answering "no" once, from whichever
 * moment it was asked, has to hold for the other.
 *
 * **A meal counts as logged when its *slot* has food in it**, not only when a
 * food log row names the entry outright. That was the whole of this
 * generator's idea of "logged" to begin with, and `FoodLogEntry.mealPlanEntryId`
 * is stamped on one route into the log out of several — so a person who typed
 * a whole lunch in by hand was asked the next morning to log the lunch they had
 * just logged. `mealLogCoverage.ts` is where that join now lives and why it is
 * the slot; both readings are kept here, because the id still catches the one
 * case the slot can't (a planned lunch eaten late and logged as a snack).
 *
 * **Modelled on `mealShortfallTasks.ts`.** Same shape: a want/stale pair run
 * off the creation predicate re-run rather than a mutation intercepted, a row
 * per `MealPlanEntry`, and — the one thing borrowed outright — "a finished one
 * blocks for ever" (`blocksOnFinished` in `checkMealLogNudgeTasks`): a meal is
 * one event, and having addressed today's ask about Monday's breakfast, a
 * second row asking again would be inventing a reason nothing changed to
 * raise. **Unlike `mealShortfallTasks.ts`, there is no row cap** — a shortfall
 * is competing for shelf space against every other thing the shopping list
 * could ask about, where a meal log nudge is bounded by the window alone: a
 * cap on top of that window just staggered a day's meals into batches,
 * dribbling the next one in only once the current batch was cleared.
 *
 * **Bounded on both ends, the reverse of a shopping task's window.**
 * `mealShortfallTasks` looks ahead because the meal hasn't happened yet; this
 * looks a few days back because the meal already has, and both windows exist
 * for the same reason `mealShortfallTasks.ts`'s own note gives: the window is
 * the reason, not a grace period. Ask about breakfast from three months ago
 * and the honest answer is "I don't remember", which is not a question worth
 * a row on Today.
 */

/**
 * How many days in the past a meal is still worth asking about — not a
 * setting, unlike `mealShortfallLeadDays`, because there is no direction here
 * to trade off against a lead time: a longer window only ever adds rows
 * naming staler meals, never earlier warning of anything.
 */
export const MEAL_LOG_NUDGE_LOOKBACK_DAYS = 1;

/** The row's title — the verb and the meal together, like `mealShortfallTitle`. */
export function mealLogNudgeTitle(dayKey: string, slot: MealSlot, title: string): string {
  return `Log ${title} (${format(dayKeyToDate(dayKey), 'EEEE')} ${slotLabel(slot)})`;
}

/** The meal plan entry a log-nudge task speaks for, or null for any other task. */
export function mealLogNudgeEntryId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'mealLogNudge');
}

/** Where the row's link goes — the Meal Plan screen, on the day in question. */
export function mealLogNudgeLinkUrl(dayKey: string): string {
  return mealPlanNudgeLinkUrl(dayKey);
}

/**
 * Whether this meal has been told not to ask — the same field the
 * completion-time prompt's "Don't ask for this meal" writes. See the module
 * header for why this generator doesn't get a field of its own.
 */
function declinedLog(entry: Pick<MealPlanEntry, 'logMeal'>): boolean {
  return entry.logMeal === false;
}

/**
 * Whether this day is far enough behind today to raise the question, and not
 * so far behind that asking it is pointless — `[today - lookbackDays,
 * today)`, half-open: today's own meals still have all day to be logged
 * without a task piling on.
 */
export function isWithinLogNudgeWindow(
  dayKey: string,
  todayKey: string,
  lookbackDays: number = MEAL_LOG_NUDGE_LOOKBACK_DAYS
): boolean {
  if (dayKey >= todayKey) return false;
  return dayKey >= shiftDayKey(todayKey, -Math.max(0, lookbackDays));
}

/**
 * What the food log has on file for the window the nudge is judging.
 *
 * Two readings of "this meal has been logged", deliberately both kept:
 *
 * - `slotKeys` is every (day, slot) with food in it (`loggedMealSlotKeys`), and
 *   is the one that answers the question a person would ask. A lunch logged is
 *   a lunch logged however it got there.
 * - `entryIds` is every `FoodLogEntry.mealPlanEntryId` on file, and catches the
 *   case the slot cannot: a meal planned for lunch, eaten at four and filed
 *   under snack, still names its plan entry.
 *
 * One object rather than two positional sets, because they are both
 * `ReadonlySet<string>` and swapping them at a call site would typecheck.
 */
export interface MealLogRecord {
  entryIds: ReadonlySet<string>;
  slotKeys: ReadonlySet<string>;
}

/** Whether the food log has this planned meal covered, by either reading. */
export function isMealLogged(
  entry: Pick<MealPlanEntry, 'id' | 'date' | 'slot'>,
  logged: MealLogRecord
): boolean {
  return logged.entryIds.has(entry.id) || logged.slotKeys.has(mealSlotKey(entry.date, entry.slot));
}

/** One meal that should have a log-nudge task sitting on today's list. */
export interface MealLogNudgeWant {
  entryId: string;
  title: string;
  dayKey: string;
}

/**
 * Which meals should have a log-nudge task right now, oldest first — the
 * meal furthest from falling out of the window is the one that most needs
 * asking about before it does.
 *
 * `logged` is what the food log has to say about the window, read by the caller
 * rather than here — same split `wantedMealShortfalls` draws from the grocery
 * catalog, keeping this module free of a database read.
 */
export function wantedMealLogNudges(
  entries: readonly MealPlanEntry[],
  logged: MealLogRecord,
  todayKey: string,
  lookbackDays: number = MEAL_LOG_NUDGE_LOOKBACK_DAYS
): MealLogNudgeWant[] {
  const wants: { entry: MealPlanEntry; title: string }[] = [];
  for (const entry of entries) {
    if (declinedLog(entry)) continue;
    if (!isWithinLogNudgeWindow(entry.date, todayKey, lookbackDays)) continue;
    if (isMealLogged(entry, logged)) continue;
    wants.push({ entry, title: mealLogNudgeTitle(entry.date, entry.slot, entry.title) });
  }
  return wants
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) ||
        slotRank(a.entry.slot) - slotRank(b.entry.slot) ||
        a.title.localeCompare(b.title)
    )
    .map(({ entry, title }) => ({ entryId: entry.id, title, dayKey: entry.date }));
}

/**
 * The log-nudge tasks sitting there whose reason has gone — the entry was
 * deleted, told not to ask (from either moment that can write it), moved out
 * of the window in either direction, or logged since (through this very task
 * or otherwise). There is no cap here to draw the split against (see the
 * module header) — every live task is judged on this predicate alone.
 *
 * A completed task is in neither reading, and neither is an archived one —
 * `blocksOnFinished` is what keeps a finished one from being replaced, not
 * this pass.
 */
export function staleMealLogNudgeTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  entries: readonly MealPlanEntry[],
  logged: MealLogRecord,
  todayKey: string,
  lookbackDays: number = MEAL_LOG_NUDGE_LOOKBACK_DAYS
): T[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return liveGeneratedTasksOfKind(tasks, 'mealLogNudge').filter(task => {
    const entryId = mealLogNudgeEntryId(task);
    const entry = entryId ? byId.get(entryId) : undefined;
    if (!entry) return true;
    if (declinedLog(entry)) return true;
    if (!isWithinLogNudgeWindow(entry.date, todayKey, lookbackDays)) return true;
    return isMealLogged(entry, logged);
  });
}
