import type { MealPlanEntry, MealSlot, TaskDraft, TimeOfDay } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedBy, wantsGeneratedTask } from './generatedTasks';
import { resolveOffsetDate } from './templateUtils';
import { mealPlanNudgeLinkUrl } from './mealPlanNudge';

/**
 * Projecting a planned meal onto a "Cook X" task in the task list.
 *
 * The Today screen used to lead with a block of the day's meals, above every
 * task and set in the largest type on the page — which read as though meal
 * planning were the point of the day (#1402). Two things fixed that, and this
 * module is the second: the day's *menu* collapsed to one line, and the meals
 * that are actually **work** promoted into the task list, where work goes.
 *
 * **A meal is not a task and this doesn't make it one.** MealPlanEntry's own
 * doc comment lists the four concrete failures of a Task-with-a-marker (expiry
 * sweeps eat next week's plan, retention purges eat the history, recurrence
 * spawns phantom dinners, seriesId becomes a second way to say "on several
 * dates"), and every one of them still applies. What's created here is a
 * *separate* ordinary Task pointing back at the entry: the plan keeps its own
 * row, its own lifecycle and its own purge horizon, and deleting every cook
 * task in the app would leave the meal plan exactly as it was. Master and
 * replica, never one row wearing two hats — see Task.mealEntryId.
 *
 * The rules live here, apart from the store, because they're the part worth
 * testing: which meals qualify, what the task says, and which fields the entry
 * owns once it exists.
 */

/**
 * Which time-of-day segment a slot's cook task hides behind.
 *
 * **This is the mechanism that makes the feature quiet**, not a decoration. A
 * task segmented `evening` is invisible on Today until evening (see
 * isTaskVisible), so a dinner you're cooking at seven doesn't sit on the list
 * competing with work at nine in the morning — which is precisely the
 * complaint the old meals block drew. The visibility model already knew how to
 * do this; nothing new hides anything.
 *
 * Snack maps to no segment on purpose. The other three name a real part of the
 * day, and a snack doesn't — it's whenever — so segmenting it would be
 * inventing a time the user never said.
 */
export const MEAL_SLOT_SEGMENTS: Record<MealSlot, TimeOfDay[]> = {
  breakfast: ['morning'],
  lunch: ['afternoon'],
  dinner: ['evening'],
  snack: [],
};

/**
 * Whether this meal should have a cook task, given the global setting.
 *
 * The precedence — an explicit per-meal answer beats the setting, in both
 * directions — is `wantsGeneratedTask`'s, shared with the other generators.
 * What's written here is only the part that makes a *meal* qualify:
 *
 * 1. **Recipe-backed only, by default.** This is the whole reason the default
 *    is worth having: a Quest protein shake and a pot of frijoles were the two
 *    rows that used to get identical weight, and only one of them is work. A
 *    recipe is the app's own evidence that a meal is something you *make*, so
 *    it does the job a per-slot filter would do and does it more honestly —
 *    pancakes from a recipe qualify, a dinner typed as "takeaway" doesn't.
 * 2. **A leftover is never work by default.** Pointing at the fridge is the
 *    opposite of a thing to cook, and a night that plans to eat Tuesday's
 *    chilli should not acquire a chore. It stays overridable, for the reheat
 *    nobody wants to forget.
 */
export function wantsCookTask(entry: MealPlanEntry, enabled: boolean): boolean {
  return wantsGeneratedTask(entry.cookTask, enabled, !!entry.recipeId && !entry.leftoverId);
}

/**
 * What a cook task is called.
 *
 * Built off `entry.title` rather than the recipe's live name because the entry
 * already keeps that in step (it's captured at plan time and rewritten by
 * bulkReplaceItem), so this needs no recipe lookup and can't disagree with the
 * row the user sees on the meal plan.
 */
export function cookTaskTitle(entry: MealPlanEntry): string {
  return `Cook ${entry.title}`;
}

/**
 * The fields the meal owns on its task: what it's called, which day it's on,
 * which part of that day, and where tapping its link opens.
 *
 * **This is deliberately the complete list**, and reconciling writes exactly
 * these four. Everything else on the row belongs to the user — the category
 * they filed it under, the notes they added, the priority they set, the
 * subtasks they hung off it — and a reconcile that reset any of that would
 * make the task worthless as a task. So a meal edit rewrites the title, the
 * date, the segment and the link, and touches nothing else, for ever.
 *
 * The day resolves through resolveOffsetDate, the same noon-normalized anchor
 * this meal's *prep* tasks use, so a cook task and the prep steps leading up
 * to it can't land on subtly different instants of the same day.
 *
 * `linkUrl` reuses mealPlanNudgeLinkUrl (#1625) rather than restating the
 * `dundundun://mealplan?date=` scheme here — a cook task opening the meal
 * plan and landing on its own day is the same destination the nudge's own
 * day tasks already open, just reached from a different generator.
 */
export function cookTaskFields(entry: MealPlanEntry): {
  title: string;
  dueDate: string;
  timeSegments: TimeOfDay[];
  linkUrl: string;
} {
  return {
    title: cookTaskTitle(entry),
    // Never null: dayKeyToDate always yields a real Date, and the offset is 0.
    dueDate: resolveOffsetDate(dayKeyToDate(entry.date), 0)!,
    timeSegments: MEAL_SLOT_SEGMENTS[entry.slot] ?? [],
    linkUrl: mealPlanNudgeLinkUrl(entry.date),
  };
}

/**
 * The full draft for a newly spawned cook task, back-pointer included.
 *
 * `category` is applied here and nowhere else — on creation only, never on a
 * reconcile — because it isn't one of the three fields the meal owns. It
 * matters mostly for where the task lands: makeCategoryGroups renders
 * uncategorized tasks in a header-less block at the *top* of Today, so cook
 * tasks left with no category would collect exactly where the meals block used
 * to be. See the mealCookTaskCategory setting.
 */
export function cookTaskDraft(
  entry: MealPlanEntry,
  category: string | null = null
): Partial<TaskDraft> {
  return { ...cookTaskFields(entry), ...generatedBy('mealCook', entry.id), category };
}

/**
 * Whether an existing cook task has drifted from its meal — the guard that
 * keeps a reconcile from writing a row that already says the right thing.
 *
 * Worth having rather than writing unconditionally because reconciling runs on
 * every meal-plan mutation, several of which (a scale change, a choice change,
 * a re-sort within a slot) change nothing this task shows. A no-op write would
 * still hit SQLite, still replace the object in the store, and still re-render
 * every list holding it.
 */
export function cookTaskNeedsUpdate(
  task: { title: string; dueDate: string | null; timeSegments: TimeOfDay[]; linkUrl: string | null },
  entry: MealPlanEntry
): boolean {
  const next = cookTaskFields(entry);
  return (
    task.title !== next.title ||
    task.dueDate !== next.dueDate ||
    task.linkUrl !== next.linkUrl ||
    task.timeSegments.length !== next.timeSegments.length ||
    next.timeSegments.some((seg, i) => task.timeSegments[i] !== seg)
  );
}
