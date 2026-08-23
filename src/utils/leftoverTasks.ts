import type { Leftover, Task, TaskDraft } from '../types';
import { generatedBy, wantsGeneratedTask } from './generatedTasks';
import { kitchenEntryId, kitchenLinkUrl } from './kitchenInventory';
import { needsAttention } from './leftovers';
import { resolveOffsetDate } from './templateUtils';
import { getCurrentDayStart } from './dateUtils';

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
 * up, the day it's actually about, and where tapping its link opens.
 *
 * **This is deliberately the complete list**, and reconciling writes exactly
 * these four — same discipline as the grocery and meal analogs, for the same
 * reason: the category, notes, reminder and subtasks belong to the user.
 *
 * `dueDate` is today (`now`), not some lead time back from `keepUntil` — the
 * task exists because `needsAttention` just turned true, so the moment it
 * starts mattering *is* the day it should surface. **It is a creation-time
 * value only**, which is why `useUpTaskDrift` below withholds it: see that
 * function's note. `deadline` carries `keepUntil` itself, the same way a
 * grocery use-up task's deadline carries the expiry: due is when to act,
 * deadline is the day the food is answerable to. `linkUrl` opens straight to
 * this container's own row — `kitchenLinkUrl(kitchenEntryId('leftover',
 * leftover.id))` — the same link shape the grocery use-up task carries for
 * its own row.
 */
export function useUpTaskFields(
  leftover: Leftover,
  now: Date = getCurrentDayStart()
): { title: string; dueDate: string; deadline: string; linkUrl: string } {
  return {
    title: useUpTaskTitle(leftover),
    // Never null: `now` is a real Date and the offset is 0.
    dueDate: resolveOffsetDate(now, 0)!,
    deadline: leftover.keepUntil,
    linkUrl: kitchenLinkUrl(kitchenEntryId('leftover', leftover.id)),
  };
}

/**
 * The full draft for a newly spawned use-up task, back-pointer included.
 *
 * `category` is applied here and nowhere else — on creation only, never on a
 * reconcile — same as mealSlotTaskDraft/useUpTaskDraft (grocery). See
 * leftoverUseUpTaskCategory.
 */
export function useUpTaskDraft(
  leftover: Leftover,
  category: string | null = null,
  now: Date = getCurrentDayStart()
): Partial<TaskDraft> {
  return { ...useUpTaskFields(leftover, now), ...generatedBy('leftoverUseUp', leftover.id), category };
}

/**
 * What an existing use-up task should be brought into line with — or null when
 * it already says the right thing, which is how a caller tells
 * `reconcileGeneratedTask` to leave the row alone rather than write it back
 * unchanged. Same shape as `mealSlotDrift`.
 *
 * **Deliberately not the date, and that's the whole reason this is a drift
 * rather than a `needsUpdate` + `useUpTaskFields` pair.** `dueDate` is stamped
 * once at creation from `getCurrentDayStart()` — it is not projected from
 * anything the leftover holds, so the only thing that can ever move it is the
 * user. Chased, it recomputed to *today* on every reconcile, and
 * `reconcileAllLeftoverTasks` runs on startup and on every app foreground
 * (`needsAttention` is a function of the wall clock, so it has to) — which
 * meant a task deferred to tomorrow was dragged back onto Today the next time
 * the app came up, for as long as the container stayed in the fridge. The
 * grocery use-up task's date genuinely is projected (`expiresAt` minus the
 * lead), so chasing it there is a real correction; here it was chasing the
 * clock. `mealSlotDrift` and `projectReview` draw the same line for the same
 * reason.
 *
 * `deadline` is still chased, because that one *is* the leftover's: editing a
 * container's keep-for moves the day the food is answerable to, and the row
 * should say so.
 */
export function useUpTaskDrift(
  task: Pick<Task, 'title' | 'deadline' | 'linkUrl'>,
  leftover: Leftover
): Partial<Task> | null {
  const next = useUpTaskFields(leftover);
  const updates: Partial<Task> = {};
  if (task.title !== next.title) updates.title = next.title;
  if (task.deadline !== next.deadline) updates.deadline = next.deadline;
  if (task.linkUrl !== next.linkUrl) updates.linkUrl = next.linkUrl;
  return Object.keys(updates).length > 0 ? updates : null;
}
