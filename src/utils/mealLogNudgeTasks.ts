import { format } from 'date-fns/format';
import type { MealPlanEntry, MealSlot, Task } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { mealPlanNudgeLinkUrl } from './mealPlanNudge';
import { shiftDayKey, slotLabel, slotRank } from './mealPlan';

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
 * **Modelled on `mealShortfallTasks.ts`.** Same shape: a want/stale pair run
 * off the creation predicate re-run rather than a mutation intercepted, a row
 * per `MealPlanEntry`, a cap, and — the one thing borrowed outright — "a
 * finished one blocks for ever" (`blocksOnFinished` in `checkMealLogNudgeTasks`):
 * a meal is one event, and having addressed today's ask about Monday's
 * breakfast, a second row asking again would be inventing a reason nothing
 * changed to raise.
 *
 * **Bounded on both ends, the reverse of a shopping task's window.**
 * `mealShortfallTasks` looks ahead because the meal hasn't happened yet; this
 * looks a few days back because the meal already has, and both windows exist
 * for the same reason `mealShortfallTasks.ts`'s own note gives: the window is
 * the reason, not a grace period. Ask about breakfast from three months ago
 * and the honest answer is "I don't remember", which is not a question worth
 * a row on Today.
 */

/** Row ceiling, matching `MAX_MEAL_SHORTFALL_TASKS`. */
export const MAX_MEAL_LOG_NUDGE_TASKS = 3;

/**
 * How many days in the past a meal is still worth asking about — not a
 * setting, unlike `mealShortfallLeadDays`, because there is no direction here
 * to trade off against a lead time: a longer window only ever adds rows
 * naming staler meals, never earlier warning of anything.
 */
export const MEAL_LOG_NUDGE_LOOKBACK_DAYS = 3;

/** The row's title — the verb and the meal together, like `mealShortfallTitle`. */
export function mealLogNudgeTitle(dayKey: string, slot: MealSlot, title: string): string {
  return `Log ${title} (${format(dayKeyToDate(dayKey), 'EEE')} ${slotLabel(slot)})`;
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
 * `loggedEntryIds` is every `FoodLogEntry.mealPlanEntryId` already on file for
 * the window, read by the caller rather than here — same split
 * `wantedMealShortfalls` draws from the grocery catalog, keeping this module
 * free of a database read. An entry logged by hand with no `mealPlanEntryId`
 * attached (typed in from the plain food log rather than through the offer
 * this pairs with) is not caught by this — a known, accepted gap, the same
 * shape `FoodLogEntry.mealPlanEntryId`'s own doc comment already calls
 * "resolve-or-shrug".
 */
export function wantedMealLogNudges(
  entries: readonly MealPlanEntry[],
  loggedEntryIds: ReadonlySet<string>,
  todayKey: string,
  lookbackDays: number = MEAL_LOG_NUDGE_LOOKBACK_DAYS,
  cap: number = MAX_MEAL_LOG_NUDGE_TASKS
): MealLogNudgeWant[] {
  const wants: { entry: MealPlanEntry; title: string }[] = [];
  for (const entry of entries) {
    if (declinedLog(entry)) continue;
    if (!isWithinLogNudgeWindow(entry.date, todayKey, lookbackDays)) continue;
    if (loggedEntryIds.has(entry.id)) continue;
    wants.push({ entry, title: mealLogNudgeTitle(entry.date, entry.slot, entry.title) });
  }
  return wants
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) ||
        slotRank(a.entry.slot) - slotRank(b.entry.slot) ||
        a.title.localeCompare(b.title)
    )
    .slice(0, Math.max(0, cap))
    .map(({ entry, title }) => ({ entryId: entry.id, title, dayKey: entry.date }));
}

/**
 * The log-nudge tasks sitting there whose reason has gone — the entry was
 * deleted, told not to ask (from either moment that can write it), moved out
 * of the window in either direction, or logged since (through this very task
 * or otherwise). Judged on the predicate alone, never on the cap, the same
 * split `staleMealShortfallTasks` draws and for its reason: losing a contest
 * for one of three slots must not delete a row the user already deferred.
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
  loggedEntryIds: ReadonlySet<string>,
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
    return loggedEntryIds.has(entry.id);
  });
}
