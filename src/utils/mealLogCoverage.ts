import type { FoodLogEntry, MealPlanEntry, MealSlot } from '../types';
import { MEAL_SLOTS } from '../types';
import { foodLogTotals, type FoodLogTotals } from './foodLog';
import { mealSlotKey, slotLabel } from './mealPlan';
import { isWaterEntry } from './waterLog';

/**
 * What the meal plan and the food log have to say about the same meal.
 *
 * **The join is the (day, slot) pair, not `FoodLogEntry.mealPlanEntryId`.**
 * That column is a real record of provenance and stays exactly what it is — the
 * entry this food was logged *through* — but it was also, until now, the only
 * thing either feature consulted to decide whether a planned meal had been
 * dealt with. It is stamped on one path (`offerMealLog`'s prompt, plus
 * `matchMealPlanEntry`'s one confident guess in `FoodLogEntrySheet`) and left
 * null on every other way into the log: the estimate sheet, a scanned package,
 * a saved meal, a recalled food, a row typed straight into the day. So a person
 * who logged a whole lunch by hand had a plan that still read as unlogged, a
 * "Log lunch?" task the next morning, and a prompt offering to log it again.
 *
 * Asking the slot instead answers the question the user is actually asking. A
 * day and a meal is how both features already file things — `MealPlanEntry`
 * carries `date` + `slot` and `FoodLogEntry` carries `dayKey` + `slot`, and
 * `foodLogSections` already reads the day back out in those buckets. If there
 * is food in Tuesday's lunch, Tuesday's lunch has been logged, whatever route
 * it took to get there.
 *
 * **It derives and never writes.** Nothing here stamps `cookedAt`, fills in a
 * `mealPlanEntryId` or ticks anything: a slot match is good enough to stop
 * asking a question and good enough to caption a row, and not good enough to
 * assert that a particular planned dish was eaten — there is deliberately no
 * `UNIQUE(date, slot)` on the plan, so a dinner holding a chili and a salad has
 * two entries one logged row cannot choose between. That is the same call
 * `mealLog.ts` makes at the top of its own header ("it offers and never
 * writes") and `docs/arch/health-data.md` makes at length, applied one level
 * out: the read is cheap to be wrong about, the write is not.
 *
 * **Water is not a meal.** A `waterMl`-only row is an ordinary food log entry
 * (see `waterLog.ts`) and nothing stops one being dragged into the Lunch
 * section, but a glass of water is not an answer to "did you eat lunch". It is
 * excluded here rather than at the call sites, so every reader excludes it.
 *
 * Pure, like `foodLog.ts` and `mealLog.ts` either side of it: the caller reads
 * the plan and the log and hands both in, and this stays exercisable with no
 * database standing up behind it.
 */

/** One slot of one day: what was planned for it against what was logged in it. */
export interface SlotCoverage {
  slot: MealSlot;
  /** The plan entries filed under this slot, in the order the caller held them. */
  planned: MealPlanEntry[];
  /** The food log entries counted as this slot's — water already dropped. */
  logged: FoodLogEntry[];
  /**
   * Whether one of `logged` names one of `planned` outright.
   *
   * Kept apart from "something is logged here" because the two are different
   * claims and only this one is certain. Nothing gates on it today; it is what
   * a future caller needing to point at a specific dish would have to ask.
   */
  linked: boolean;
  /** What the slot's logged entries came to. */
  totals: FoodLogTotals;
}

/**
 * Whether a food log entry can stand for a meal having been eaten.
 *
 * A slot of `null` is the sheet's "no meal" answer — something eaten outside of
 * one — and says nothing about any square on the plan.
 */
export function countsAsMealLog(entry: FoodLogEntry): boolean {
  return entry.slot !== null && !isWaterEntry(entry);
}

/**
 * Every (day, slot) with food logged in it, as `mealSlotKey`s.
 *
 * The window-wide read, for a caller holding several days at once and asking
 * only the yes/no question — `checkMealLogNudgeTasks` reads a few days of the
 * log to decide which meals to stop asking about. A caller rendering one day
 * wants `mealDayCoverage` instead, which keeps the entries.
 */
export function loggedMealSlotKeys(entries: readonly FoodLogEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!countsAsMealLog(entry)) continue;
    keys.add(mealSlotKey(entry.dayKey, entry.slot as MealSlot));
  }
  return keys;
}

/**
 * One day's slots, keyed by slot — only the ones with something on either side.
 *
 * A slot nobody planned and nobody logged has nothing to say and is absent
 * rather than present and empty, the same call `foodLogSections` makes about a
 * meal with no entries in it.
 *
 * Both lists are filtered to `dayKey` here rather than trusted, so a caller
 * holding a whole week of either can pass it straight in.
 */
export function mealDayCoverage(
  planned: readonly MealPlanEntry[],
  logged: readonly FoodLogEntry[],
  dayKey: string
): Map<MealSlot, SlotCoverage> {
  const coverage = new Map<MealSlot, SlotCoverage>();
  const plannedIds = new Set<string>();

  for (const slot of MEAL_SLOTS) {
    const inSlot = planned.filter(entry => entry.date === dayKey && entry.slot === slot);
    const loggedInSlot = logged.filter(
      entry => entry.dayKey === dayKey && entry.slot === slot && countsAsMealLog(entry)
    );
    if (inSlot.length === 0 && loggedInSlot.length === 0) continue;
    inSlot.forEach(entry => plannedIds.add(entry.id));
    coverage.set(slot, {
      slot,
      planned: inSlot,
      logged: loggedInSlot,
      linked: loggedInSlot.some(e => e.mealPlanEntryId !== null && plannedIds.has(e.mealPlanEntryId)),
      totals: foodLogTotals(loggedInSlot),
    });
  }
  return coverage;
}

/**
 * "Logged 640 cal", or "Logged" for a slot whose entries stated no calories —
 * the caption a planned meal carries once its slot has food in it.
 *
 * Null when nothing is logged there, so a caller can spread it into a line and
 * have an unlogged meal read exactly as it did before this existed.
 *
 * No separator inside it: the caption it joins already puts a ` · ` in front,
 * and a second one turned "Dinner · serrano, steamed rice · Logged · 640 cal"
 * into four things to read where there are three.
 *
 * The figure is the *slot's* total rather than one entry's, and deliberately
 * carries no "≈": it is a sum of what was recorded, not an estimate of what was
 * eaten. It also makes no claim that the planned dish is what those calories
 * came from — see the module header on why a slot match captions a row and
 * never writes to one.
 */
export function describeSlotLog(coverage: SlotCoverage | undefined): string | null {
  if (!coverage || coverage.logged.length === 0) return null;
  const calories = coverage.totals.total.calorieKcal;
  return calories === undefined ? 'Logged' : `Logged ${Math.round(calories)} cal`;
}

/**
 * "2 of 3 planned meals logged", or null when the day planned nothing.
 *
 * Counts **planned slots, not planned entries**, the same call
 * `countPlannedSlots` makes and for the same reason: a dinner holding two
 * dishes is one meal, and counting rows would report a day out of four.
 *
 * Says nothing about food logged in a slot nobody planned — that is not a
 * planned meal going unlogged, it is just eating, and folding it in would make
 * the figure mean two things at once.
 */
export function describeDayCoverage(
  planned: readonly MealPlanEntry[],
  logged: readonly FoodLogEntry[],
  dayKey: string
): string | null {
  const coverage = mealDayCoverage(planned, logged, dayKey);
  const slots = [...coverage.values()].filter(c => c.planned.length > 0);
  if (slots.length === 0) return null;
  const done = slots.filter(c => c.logged.length > 0).length;
  return `${done} of ${slots.length} planned ${slots.length === 1 ? 'meal' : 'meals'} logged`;
}

/**
 * The day's planned slots with nothing logged in them, in day order.
 *
 * What the food log offers to log from: a slot the plan has an answer for and
 * the log doesn't is exactly the row worth a one-tap "log the planned thing",
 * and once something is in the slot the offer has done its job and goes.
 */
export function unloggedPlannedSlots(
  planned: readonly MealPlanEntry[],
  logged: readonly FoodLogEntry[],
  dayKey: string
): SlotCoverage[] {
  return [...mealDayCoverage(planned, logged, dayKey).values()].filter(
    c => c.planned.length > 0 && c.logged.length === 0
  );
}

/**
 * "Lunch · Chicken salad", or "Lunch · Chili and 1 more" for a slot holding
 * two dishes — how an unlogged planned meal names itself in the food log.
 *
 * Names the extras by count rather than listing them: the row is an offer to
 * open a sheet, and a slot with three things in it would otherwise push the
 * button off the line (see CLAUDE.md on a data-derived string sharing a row
 * with an action).
 */
export function describePlannedSlot(coverage: SlotCoverage): string {
  const [first, ...rest] = coverage.planned;
  const name = first ? first.title : slotLabel(coverage.slot);
  const extra = rest.length > 0 ? ` and ${rest.length} more` : '';
  return `${slotLabel(coverage.slot)} · ${name}${extra}`;
}
