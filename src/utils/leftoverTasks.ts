import type { Leftover, TaskDraft } from '../types';
import { generatedBy, wantsGeneratedTask } from './generatedTasks';
import { needsAttention } from './leftovers';
import { resolveOffsetDate } from './templateUtils';

/**
 * Projecting a leftover onto a "Use up X" task in the task list.
 *
 * Same master/replica split as mealTasks.ts and groceryExpiry.ts, and for the
 * same reason: LeftoversCard's own history explains why a leftover isn't a
 * Task (a name key, an aisle, a purchase count — none of it applies to a
 * container in the fridge), and none of that changes here. What's created is
 * a *separate* ordinary Task pointing back at the leftover via
 * Task.leftoverId — the fridge card keeps its own lifecycle (finished/eaten/
 * tossed), and deleting every use-up task in the app would leave it
 * untouched.
 *
 * The trigger is `needsAttention()` from utils/leftovers.ts — "soon", "due"
 * or "over" while still live — rather than a threshold re-derived here. That
 * function is already the one place the yellow/red line is drawn (the fridge
 * card's own badge reads it), and a second copy of the cutoff is exactly the
 * kind of drift the two features would eventually disagree about.
 */

/**
 * Whether this leftover should have a use-up task, given the global setting.
 *
 * The precedence is `wantsGeneratedTask`'s, shared with the other generators —
 * which is what stops a leftover already flagged once from nagging a second
 * time as it drifts from "soon" back into range on a keep-days edit. What
 * qualifies a *leftover*:
 *
 * **`needsAttention` is the whole trigger.** A fresh leftover gets no task; one
 * about to go bad does. No separate lead-time setting — unlike groceries, which
 * stamp a use-by date days ahead of the trip, a leftover is already tracked
 * from the moment it's logged, so "soon" already means "look at this now".
 */
export function wantsUseUpTask(leftover: Leftover, enabled: boolean): boolean {
  return wantsGeneratedTask(leftover.useUpTask, enabled, needsAttention(leftover));
}

/** What a use-up task is called. Built off `leftover.title`, same as the other two. */
export function useUpTaskTitle(leftover: Leftover): string {
  return `Use up ${leftover.title}`;
}

/**
 * The fields the leftover owns on its task: what it's called, when it comes
 * up, and the day it's actually about.
 *
 * **This is deliberately the complete list**, and reconciling writes exactly
 * these three — same discipline as the grocery and meal analogs, for the same
 * reason: the category, notes, reminder and subtasks belong to the user.
 *
 * `dueDate` is today (`now`), not some lead time back from `keepUntil` — the
 * task exists because `needsAttention` just turned true, so the moment it
 * starts mattering *is* the day it should surface. `deadline` carries
 * `keepUntil` itself, the same way a grocery use-up task's deadline carries
 * the expiry: due is when to act, deadline is the day the food is answerable
 * to.
 */
export function useUpTaskFields(
  leftover: Leftover,
  now: Date = new Date()
): { title: string; dueDate: string; deadline: string } {
  return {
    title: useUpTaskTitle(leftover),
    // Never null: `now` is a real Date and the offset is 0.
    dueDate: resolveOffsetDate(now, 0)!,
    deadline: leftover.keepUntil,
  };
}

/**
 * The full draft for a newly spawned use-up task, back-pointer included.
 *
 * `category` is applied here and nowhere else — on creation only, never on a
 * reconcile — same as cookTaskDraft/useUpTaskDraft (grocery). See
 * leftoverUseUpTaskCategory.
 */
export function useUpTaskDraft(
  leftover: Leftover,
  category: string | null = null,
  now: Date = new Date()
): Partial<TaskDraft> {
  return { ...useUpTaskFields(leftover, now), ...generatedBy('leftoverUseUp', leftover.id), category };
}

/**
 * Whether an existing use-up task has drifted from its leftover — the guard
 * that keeps a reconcile from writing a row that already says the right
 * thing. Same shape as cookTaskNeedsUpdate/useUpTaskNeedsUpdate (grocery).
 */
export function useUpTaskNeedsUpdate(
  task: { title: string; dueDate: string | null; deadline: string | null },
  leftover: Leftover,
  now: Date = new Date()
): boolean {
  const next = useUpTaskFields(leftover, now);
  return (
    task.title !== next.title ||
    task.dueDate !== next.dueDate ||
    task.deadline !== next.deadline
  );
}
