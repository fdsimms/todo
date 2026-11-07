import type { FoodLogEntry, MealPlanEntry, MealSlot } from '../types';
import { MEAL_SLOTS } from '../types';
import { mealDayCoverage } from './mealLogCoverage';
import { DEFAULT_MEAL_SLOTS_ENABLED, MEAL_SLOT_TASK_DAYS } from './mealSlotTasks';
import { shiftDayKey } from './mealPlan';
import { baseCoinsFor } from './rewards';

/**
 * The meal strip on Today (`mealsOnToday: 'top'`): one line for the day's
 * meals instead of a meal task per meal.
 *
 * It exists for someone who doesn't plan ahead. The meal-slot tasks
 * (`mealSlotTasks.ts`) ask Choose → Prepare → Eat of every meal, and for a
 * breakfast nobody planned that chain gets ticked three times in a row after
 * eating, while the food log already holds the real answer. The strip reads
 * the answer instead of asking for it: a meal with food logged in its slot is
 * done, whatever route the food took in.
 *
 * Pure: the component reads the plan and the log and hands both in, and the
 * coin pass (`useTaskStore.syncMealStripCoins`) asks `mealStripDoneSlots` the
 * same question the strip draws, so the coins can't disagree with the ticks.
 */

/** Whether Today shows the strip, and so whether the meal tasks stand down. */
export function mealStripOn(s: { kitchenEnabled: boolean; mealsOnToday: string }): boolean {
  return s.kitchenEnabled && s.mealsOnToday === 'top';
}

/**
 * The meals the strip has a cell for, in the order of the day.
 *
 * The same set the meal tasks were written for (`mealSlotsEnabled`), since the
 * strip replaces them. An empty set falls back to the default three rather than
 * drawing an empty card: picking the strip is asking to see the day's meals.
 */
export function mealStripSlots(enabled: readonly MealSlot[]): MealSlot[] {
  const slots = MEAL_SLOTS.filter(slot => enabled.includes(slot));
  return slots.length > 0 ? slots : [...DEFAULT_MEAL_SLOTS_ENABLED];
}

/**
 * Whether the strip stands in for this meal's task, for a reader that used to
 * ask "is there a live meal task for this day and slot" (`plannedMealRowFor`,
 * which holds back "Use up X" for a leftover already planned into a meal).
 *
 * The same reach the tasks had: a meal the strip has a cell for, from today to
 * the end of the week the meal tasks were written for (`MEAL_SLOT_TASK_DAYS`).
 * The strip only draws today, but the tasks sat on Later for the days ahead,
 * and a planned leftover past that week still gets its use-up task.
 */
export function mealStripCoversMeal(
  s: { kitchenEnabled: boolean; mealsOnToday: string; mealSlotsEnabled: readonly MealSlot[] },
  dayKey: string,
  slot: MealSlot,
  todayKey: string,
): boolean {
  if (!mealStripOn(s)) return false;
  if (dayKey < todayKey || dayKey > shiftDayKey(todayKey, MEAL_SLOT_TASK_DAYS - 1)) return false;
  return mealStripSlots(s.mealSlotsEnabled).includes(slot);
}

/**
 * What one meal of the day shows, most settled first:
 * - `logged`: food is in its slot in the food log. The strongest answer, and
 *   the one most meals get, since logging is what someone who doesn't plan
 *   already does.
 * - `eaten`: a planned meal marked cooked (from the strip's Ate it, or the
 *   meal plan's own toggle) with nothing logged yet.
 * - `skipped`: marked skipped (`MealSkip`) with nothing logged or eaten.
 *   Settled, so it stops asking Choose, but not eaten, so it pays nothing.
 *   It outranks a plan: skipping a planned lunch is saying the plan didn't
 *   happen. Food logged in the slot outranks the skip, since the log is what
 *   was actually eaten.
 * - `planned`: on the plan, not yet eaten.
 * - `empty`: nothing planned or logged.
 */
export type MealStripState = 'logged' | 'eaten' | 'skipped' | 'planned' | 'empty';

export interface MealStripCell {
  slot: MealSlot;
  state: MealStripState;
  /** The line under the meal's name: what was logged, or what's planned. Null for `empty` and `skipped`. */
  text: string | null;
  /** The slot's plan entries, in plan order. The first is the one the menu acts on. */
  planned: MealPlanEntry[];
  /** The slot's food log entries, water left out (see `countsAsMealLog`). */
  logged: FoodLogEntry[];
}

/**
 * Each strip slot's cell for one day.
 *
 * Built on `mealDayCoverage`, the join every other "was this meal logged"
 * reader uses, so the strip can't call a meal logged that the Meal plan and
 * the log nudge call unlogged. `titleOf` is `titleForEntry` with the recipe
 * map bound, passed in so this stays free of the recipe store.
 */
export function mealStripCells(
  slots: readonly MealSlot[],
  planned: readonly MealPlanEntry[],
  logged: readonly FoodLogEntry[],
  dayKey: string,
  titleOf: (entry: MealPlanEntry) => string,
  logLabelOf: (entry: FoodLogEntry) => string = e => e.label,
  skipped: readonly MealSlot[] = [],
): MealStripCell[] {
  const coverage = mealDayCoverage(planned, logged, dayKey);
  return slots.map(slot => {
    const c = coverage.get(slot);
    const inPlan = c ? [...c.planned].sort((a, b) => a.sortOrder - b.sortOrder) : [];
    const inLog = c?.logged ?? [];
    const join = (names: string[]) => [...new Set(names.map(n => n.trim()).filter(Boolean))].join(', ') || null;
    if (inLog.length > 0) {
      return { slot, state: 'logged', text: join(inLog.map(logLabelOf)), planned: inPlan, logged: inLog };
    }
    const eaten = inPlan.some(e => e.cookedAt);
    if (!eaten && skipped.includes(slot)) {
      return { slot, state: 'skipped', text: null, planned: inPlan, logged: inLog };
    }
    if (inPlan.length > 0) {
      const state: MealStripState = eaten ? 'eaten' : 'planned';
      return { slot, state, text: join(inPlan.map(titleOf)), planned: inPlan, logged: inLog };
    }
    return { slot, state: 'empty', text: null, planned: inPlan, logged: inLog };
  });
}

/** Whether a cell counts as the meal having been eaten: the tick on the strip, and the coins. */
export function isMealStripDone(cell: Pick<MealStripCell, 'state'>): boolean {
  return cell.state === 'logged' || cell.state === 'eaten';
}

/** The strip slots of one day that count as eaten. What `syncMealStripCoins` pays for. */
export function mealStripDoneSlots(
  slots: readonly MealSlot[],
  planned: readonly MealPlanEntry[],
  logged: readonly FoodLogEntry[],
  dayKey: string,
): MealSlot[] {
  return mealStripCells(slots, planned, logged, dayKey, e => e.title)
    .filter(isMealStripDone)
    .map(cell => cell.slot);
}

/**
 * What one eaten meal earns while the strip is on.
 *
 * Priced as the meal task's Eat step was (an easy, 30-minute task), and paid
 * once per meal however it was settled. The chain paid its Choose and Prepare
 * steps as well, but those were the ticks the strip exists to stop asking
 * for, so paying for them would be paying for nothing.
 */
export function mealStripCoins(): number {
  return baseCoinsFor({ estimatedMinutes: 30, effort: 0, difficulty: 'easy' });
}
