import { format } from 'date-fns/format';
import type { MealPlanEntry, MealSlot, Task } from '../types';
import type { WeekStart } from '../store/useSettingsStore';
import { buildWeekDays } from './calendarGrid';
import { dayKeyOf } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { isKeyInRange } from './mealPlan';

/**
 * The opt-in "plan meals for the week" nudge (#1121) — a real Task, created
 * unattended once a week, the same shape as the project auto-schedule drip
 * (`dripCandidate`/`dripStalledProjects`, `src/utils/projectPull.ts`): a pure
 * decision lives here, the store performs the write. Off by default — an
 * existing install sees no new task until the user opts in from Settings,
 * same reasoning as `completedRetentionDays`.
 *
 * Deliberately a Task, not a banner. `ProjectNudgeBanner` works because it
 * rides `findProjectStalls`, which already runs on every Today render for the
 * accent-tint surfaces — there's no equivalent standing computation for "is
 * this week planned", and Today doesn't otherwise know or care about
 * the meal plan. A Task costs nothing extra to surface: it shows up wherever
 * a task already would (Today, widget, reminder), it's dismissible the same
 * way any task is, and CLAUDE.md's own caution about this — a task nobody
 * asked for is a stronger intrusion than a banner — is exactly why the
 * setting defaults off and the whole feature is opt-in rather than a banner
 * substituting for consent.
 *
 * Fires **at most once per week** (`lastFiredWeekKey`, persisted in Settings)
 * and only when the week it's about to nudge for has nothing planned yet
 * (`mealPlanNudgeSuppressed`) — a reminder to plan a week you already planned
 * from the Meal Plan screen directly is noise, not help.
 *
 * **Asks about the week it fires in, not the one after** (#1730 — this used
 * to plan a week ahead of time, on the theory that firing before a week
 * starts leaves room to plan it; in practice that meant a nudge on the 1st
 * asking about the week of the 8th, a full week before anyone would act on
 * it). Firing on a week's first day is what makes this line up cleanly — the
 * settings default to that (`DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY` matches the
 * app's own `weekStartsOn` default) — but nothing stops `weekday` from being
 * set to a day mid-week, in which case some of the seven day tasks land on
 * days already behind you. That's accepted as a consequence of the settings
 * mismatch, not specially handled.
 *
 * Unlike a real recurring task, this is a fresh write every week, not one row
 * that only spawns its successor on completion — so an unattended weekly write
 * with no further gate would pile up a "Plan meals for…" set a week for as long
 * as the user leaves the last one sitting there (`hasLiveMealPlanNudgeTask`).
 * One live nudge at a time is the rule: finishing or archiving this week's is
 * what lets next week's appear.
 *
 * **It fires as a stack of seven, one task per day of the week it's asking
 * about** (#1585), rather than the single "Plan meals for 17 – 23 Aug" task it
 * used to be. A week is planned a day at a time — that's what the Meal Plan
 * screen is, a column of days — so one task for the lot could only ever be
 * ticked when the whole week was done, and told the user nothing about how far
 * in they were. Seven rows under one stack header say it for free: the stack's
 * own "3/7" tally (see `TaskGroupHeader`) is how much of the week is dealt
 * with, and each row carries how much of its *day* is (`countPlannedSlots`).
 *
 * Three things follow from being a set rather than a task, and each is load-
 * bearing somewhere else in the app:
 *
 * - **Each task's `generatedSourceId` is its day key**, so a row knows which
 *   day it speaks for without parsing its own title or link. That's what every
 *   per-row read goes through (`mealPlanNudgeDayKey`), and it's why
 *   `hasLiveMealPlanNudgeTask` can't ask `liveGeneratedTask` any more — that
 *   matches `sourceId === null`, which no nudge task has had since.
 * - **They all share one `dueDate`, the day the nudge fires** — deliberately
 *   *not* the day each is about. The whole point is to plan the week right
 *   now; due dates spread across the week would hide however many of the
 *   seven are still ahead behind `isTaskVisible` until each of their own
 *   days arrived.
 * - **Nothing here ticks a task off.** A day reaching 3/3 planned makes the row
 *   say so and no more — same call `timer.ts` makes about a countdown that has
 *   run out, and for the same reason: the tick box is what the user decided
 *   they're done with, the counter is where the plan actually is, and letting
 *   either drive the other makes both wrong. Planning two meals and calling the
 *   day finished is a legitimate thing to do.
 */

/** date-fns `Date.getDay()` convention: 0 = Sunday .. 6 = Saturday. */
export const DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY = 0;
export const DEFAULT_MEAL_PLAN_NUDGE_TIME = '09:00';

/** What a recurring "Plan meals" task carries in `linkUrl` — opens the Meal Plan screen. */
export const MEAL_PLAN_NUDGE_LINK_URL = 'dundundun://mealplan';

/**
 * The link one day's nudge task carries: the Meal Plan screen, opened on that
 * day rather than on whatever week it was left showing.
 *
 * A query string rather than a path segment (`…/mealplan/2026-08-17`) because
 * `parseAddTaskUrl` already established the query form for this scheme and its
 * decoder is the one that's tested. Falls back to the bare link for an empty
 * key so a malformed call can't mint a URL that matches nothing.
 */
export function mealPlanNudgeLinkUrl(dayKey: string): string {
  return dayKey ? `${MEAL_PLAN_NUDGE_LINK_URL}?date=${dayKey}` : MEAL_PLAN_NUDGE_LINK_URL;
}

/**
 * The meals a day is counted out of — breakfast, lunch and dinner.
 *
 * Deliberately not `MEAL_SLOTS`, which has a fourth member (`snack`). A snack
 * is something you add to a day, not something a day is incomplete without, so
 * counting it would put 3/4 on a fully planned day and make the full state
 * unreachable for anyone who doesn't plan snacks — which is nearly everyone.
 * Planning one still works exactly as it did; it just isn't scored.
 */
export const MEAL_PLAN_NUDGE_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/** How many meals a nudge task's day is counted out of — the "3" in "2/3 planned". */
export const MEAL_PLAN_NUDGE_SLOT_COUNT = MEAL_PLAN_NUDGE_SLOTS.length;

/**
 * How many of the day's three meals have something planned — the row's counter.
 *
 * Counts **distinct slots, not entries**: there is deliberately no
 * `UNIQUE(date, slot)` on `meal_plan_entries` (two things on one dinner is a
 * legal plan), so counting rows would report 4/3 for a day with two dinners and
 * nothing else. A slot is planned or it isn't.
 *
 * Cooked-ness is not consulted. This asks whether the day has been *planned*,
 * which is the job the nudge is nudging about; a meal already eaten is still a
 * meal that was planned, and dropping it would walk the counter backwards
 * through the week the user is being congratulated for finishing.
 */
export function countPlannedSlots(
  entries: readonly Pick<MealPlanEntry, 'date' | 'slot'>[],
  dayKey: string
): number {
  const planned = new Set<MealSlot>();
  for (const entry of entries) {
    if (entry.date !== dayKey) continue;
    if (MEAL_PLAN_NUDGE_SLOTS.includes(entry.slot)) planned.add(entry.slot);
  }
  return planned.size;
}

/**
 * The day a nudge task speaks for, or null for any other task.
 *
 * Thin, and deliberately just `generatedSourceOf` under a name that says what
 * the string means here — the kind check is the whole point of that helper and
 * restating it inline is how the two would come to disagree. One column holds
 * four generators' source ids now, and a grocery item's id read as a day key
 * would quietly count meals for a day that doesn't exist.
 */
export function mealPlanNudgeDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'mealPlanNudge');
}

export interface MealPlanNudgeDue {
  /**
   * Idempotency key: the day-key of the first day of the week the trigger
   * armed in. Stored back as `mealPlanNudgeLastFiredWeekKey` the moment this
   * is returned — whether or not the caller goes on to create a task (see
   * `mealPlanNudgeSuppressed`) — so a week already planned doesn't get
   * re-checked (and re-decided the same way) on every later launch.
   */
  weekKey: string;
  /** Day-key of the first day of the week the nudge is asking about. */
  targetWeekStartKey: string;
  /** Day-key of the last day of that week, inclusive. */
  targetWeekEndKey: string;
  /**
   * The seven days the nudge is asking about, in week order — one task each,
   * and the order they're laid down in the stack.
   */
  days: MealPlanNudgeDay[];
  /**
   * "Plan this week's meals" — a fixed string rather than the date range
   * mealPlan.ts's own wording would give it (#1727): the nudge always fires
   * about the week it's asking you to plan (#1730), so naming which week it
   * is doesn't add anything the reader doesn't already know from "this".
   */
  title: string;
  /** Noon on the day the nudge fires — where the created task's `dueDate` lands. */
  dueDate: Date;
}

/** One day of the week a nudge is asking about — one task in its stack. */
export interface MealPlanNudgeDay {
  /** `2026-08-17`. The task's `generatedSourceId`, and what its link opens on. */
  dayKey: string;
  /**
   * "Monday 08/17" — the task's title.
   *
   * Doesn't repeat "Plan": the stack header above it already says "Plan this
   * week's meals", and seven rows each opening with the same verb is a
   * column of prefixes to read past. The weekday leads because that's what a
   * person picks a day by; the date follows for the week that straddles a
   * month, where three of the rows would otherwise be ambiguous. Numeric
   * rather than "17 Aug" (#1727) — next to a plain task title on Today or the
   * widget, a bare "Monday 17 Aug" reads like a date someone typed as a
   * title, not a link to a day.
   */
  title: string;
}

/**
 * Whether the nudge should fire right now, and for which week — or null when
 * either this week's trigger (`weekday`/`time`) hasn't arrived yet, or it
 * already has (`lastFiredWeekKey` matches).
 *
 * The week the nudge asks about is the same one the trigger fires in (#1730)
 * — firing on a week's first day, which is what the default `weekday`
 * matches `weekStartsOn` to, means "get this week planned" the moment it
 * starts rather than eight days ahead of anyone acting on it.
 *
 * Doesn't know about "already planned" — see `mealPlanNudgeSuppressed`, which
 * needs a real database read this module can't make and stays free of, the
 * same split `dripCandidate` draws from `findProjectStalls`.
 */
export function dueMealPlanNudge(
  now: Date,
  weekStartsOn: WeekStart,
  weekday: number,
  time: string,
  lastFiredWeekKey: string | null
): MealPlanNudgeDue | null {
  const days = buildWeekDays(now, weekStartsOn);
  const weekKey = dayKeyOf(days[0]);
  if (weekKey === lastFiredWeekKey) return null;

  const triggerDay = days.find(d => d.getDay() === weekday) ?? days[0];
  const [hh, mm] = time.split(':').map(Number);
  const triggerInstant = new Date(triggerDay);
  triggerInstant.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (now.getTime() < triggerInstant.getTime()) return null;

  // The trigger's own week, not the one after (#1730) — see this function's
  // doc comment for why, and the module comment for the mid-week-`weekday`
  // caveat.
  const targetDays = days;
  const dueDate = new Date(now);
  dueDate.setHours(12, 0, 0, 0);

  return {
    weekKey,
    targetWeekStartKey: dayKeyOf(targetDays[0]),
    targetWeekEndKey: dayKeyOf(targetDays[targetDays.length - 1]),
    days: targetDays.map(day => ({
      dayKey: dayKeyOf(day),
      title: format(day, 'EEEE MM/dd'),
    })),
    title: "Plan this week's meals",
    dueDate,
  };
}

/**
 * True when the week the nudge is about to ask for already has at least one
 * meal planned — planned directly on the Meal Plan screen, with the nudge
 * never touched. Any entry counts, the same binary "has a date signal at
 * all" the project drip uses (`hasNoDateSignal`) rather than judging how
 * *much* of the week is filled in: this is a reminder to start, not a
 * completeness check.
 */
export function mealPlanNudgeSuppressed(
  due: Pick<MealPlanNudgeDue, 'targetWeekStartKey' | 'targetWeekEndKey'>,
  entriesInTargetWeek: readonly Pick<MealPlanEntry, 'date'>[]
): boolean {
  return entriesInTargetWeek.some(e => isKeyInRange(e.date, due.targetWeekStartKey, due.targetWeekEndKey));
}

/**
 * True when a previous firing's nudge task is still live — incomplete and
 * not archived.
 *
 * Keyed on `generatedKind`, the marker every generator now carries, rather
 * than on `linkUrl` as it used to be. The link was the only stable thing about
 * this task before there was a kind (the title and dueDate both move week to
 * week), but it was never actually a claim about *provenance* — a task the
 * user wrote themselves pointing at the meal plan counted as the app's nudge.
 * Legacy rows are backfilled off exactly that link, so the set this matches
 * doesn't change; what changes is that it can't be joined by a hand-written
 * task from here on.
 *
 * **The kind alone identifies them, and that's now the only thing that can.**
 * This used to be one `liveGeneratedTask` call, which defaults to matching
 * `generatedSourceId === null` — true of every nudge task back when the week
 * got one. Each task carries its day key there now, so that call would match
 * nothing and report "no live nudge" every week, handing out a second stack of
 * seven on top of the one already sitting on Today. `liveGeneratedTasksOfKind`
 * is the read that doesn't care which day each task speaks for.
 *
 * **`current` blocks the next firing; `stale` gets deleted by it.** The split
 * is the whole reason this returns two lists rather than a boolean, and it
 * replaces a rule that stopped working when the nudge became a set. One task
 * for the week meant "left it untouched? then no new one" cost the user one
 * ignored row. Seven mean that a week where six days got planned and Saturday
 * was left alone would block *every* future nudge on the strength of one row
 * nobody minded — and that row is asking about a week which, by the time the
 * next nudge is due, has already been and gone. So a live task whose day has
 * fallen outside the week now being asked about is cleared rather than
 * honoured, and only the week actually in question can suppress a re-fire.
 *
 * That does mean an unread nudge no longer survives the week it was written
 * for. It shouldn't: "Plan Saturday 15 Aug" on the 17th is not a task anyone
 * can do. Anything the user *did* act on is untouched either way — see below.
 *
 * A completed task is in neither list (the user did the thing, and the row
 * stays as the record of it), and neither is an archived one (archiving is
 * this app's other explicit "I've dealt with this, stop showing it to me" —
 * see the note on `archiveTask` in CLAUDE.md). Only rows still sitting there
 * untouched are anybody's business here.
 */
export function partitionMealPlanNudgeTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  due: Pick<MealPlanNudgeDue, 'targetWeekStartKey' | 'targetWeekEndKey'>
): { current: T[]; stale: T[] } {
  const current: T[] = [];
  const stale: T[] = [];
  for (const task of liveGeneratedTasksOfKind(tasks, 'mealPlanNudge')) {
    const dayKey = mealPlanNudgeDayKey(task);
    // A task from before the day keys existed has no day to place, so it can
    // only be last week's — the set being laid down now has one per day.
    const inTargetWeek =
      !!dayKey && isKeyInRange(dayKey, due.targetWeekStartKey, due.targetWeekEndKey);
    (inTargetWeek ? current : stale).push(task);
  }
  return { current, stale };
}
