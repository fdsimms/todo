import type { MealSkip, MealSlot } from '../types';
import { MEAL_SLOTS } from '../types';
import type { SlotCoverage } from './mealLogCoverage';
import { slotLabel } from './mealPlan';

/**
 * What a skipped meal (`MealSkip`) means to the screens that show one: the
 * meal strip on Today and the Meal plan's days. Pure, so both read one rule.
 *
 * **A skip stands only while nothing says the meal happened.** Food logged in
 * the slot, or a planned entry marked cooked, outranks it: the log is what
 * was eaten, and "skipped" over a logged lunch would be the app contradicting
 * the record. The row stays (un-skipping is a separate tap), it just stops
 * being what the screen says.
 */

/** Whether a skip on this slot is what the screen should say. */
export function skipStands(coverage: Pick<SlotCoverage, 'planned' | 'logged'> | undefined): boolean {
  if (!coverage) return true;
  return coverage.logged.length === 0 && !coverage.planned.some(e => e.cookedAt);
}

/** The slots skipped on one day, in the order of the day. */
export function skippedSlotsOn(skips: readonly Pick<MealSkip, 'dayKey' | 'slot'>[], dayKey: string): MealSlot[] {
  const slots = new Set(skips.filter(s => s.dayKey === dayKey).map(s => s.slot));
  return MEAL_SLOTS.filter(slot => slots.has(slot));
}

export interface DaySkips {
  /** Skipped slots that have planned entries: each of those rows says "Skipped". */
  inRows: ReadonlySet<MealSlot>;
  /** Skipped slots with nothing planned, which have no row and so get the day's line. */
  unplanned: MealSlot[];
}

/**
 * One day's skips, split by where the Meal plan shows them. A skip that no
 * longer stands (`skipStands`) is in neither.
 */
export function daySkips(
  coverage: ReadonlyMap<MealSlot, Pick<SlotCoverage, 'planned' | 'logged'>> | undefined,
  skipped: readonly MealSlot[],
): DaySkips {
  const inRows = new Set<MealSlot>();
  const unplanned: MealSlot[] = [];
  for (const slot of skipped) {
    const c = coverage?.get(slot);
    if (!skipStands(c)) continue;
    if (c && c.planned.length > 0) inRows.add(slot);
    else unplanned.push(slot);
  }
  return { inRows, unplanned };
}

/** "Skipped breakfast", "Skipped breakfast and lunch". Null when there is nothing to say. */
export function skippedLine(slots: readonly MealSlot[]): string | null {
  if (slots.length === 0) return null;
  const names = slots.map(s => slotLabel(s).toLowerCase());
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Skipped ${joined}`;
}
