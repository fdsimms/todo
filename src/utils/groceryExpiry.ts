import type { GroceryItem, TaskDraft } from '../types';
import { GROCERY_USE_UP_LEAD_DAYS_MAX, GROCERY_USE_UP_LEAD_DAYS_MIN } from '../types';
import { dayKeyToDate } from './dateUtils';
import { resolveOffsetDate } from './templateUtils';

/**
 * Projecting a perishable grocery item onto a "Use up X" task.
 *
 * The problem is the one nothing in the app answered: a bag of spinach bought
 * on Saturday is invisible until it's slime on Thursday. The grocery catalog
 * already knows what was bought and when, so the missing half was a *date it
 * should be eaten by* and a way for that date to reach the list where the
 * user's other intentions live.
 *
 * **A grocery item is not a task and this doesn't make it one.** What's
 * created is a separate ordinary Task pointing back at the item, exactly the
 * master/replica split mealTasks.ts describes: the catalog row keeps its own
 * lifecycle, and deleting every use-up task in the app would leave the
 * groceries untouched. Going through a real Task rather than a bespoke nudge
 * is the point — reminders, Today, snoozing, categories and the notification
 * path are all Task-typed already, and a second mechanism would have to
 * reimplement each of them worse.
 *
 * The rules live here, apart from the store, because they're the part worth
 * testing: which items qualify, what the task says, and which fields the item
 * owns once it exists.
 */

/**
 * Whether this item should have a use-up task, given the global setting.
 *
 * Three inputs collapse to one answer, the same shape `wantsCookTask` has:
 *
 * 1. **An explicit per-item answer always wins**, in both directions. `true`
 *    spawns a task with the setting off ("I keep wasting this one"), `false`
 *    suppresses it with the setting on — and `false` is what deleting the task
 *    records, so a staple bought every week can be told once and stays told.
 * 2. **A use-by date is the whole trigger.** No date, no task: the shelf-life
 *    lexicon is a whitelist of things that actually go off, so a catalog of
 *    hundreds contributes a handful of dates and the rest stay silent.
 * 3. **Nothing about being on the list matters.** A row can be both in the
 *    fridge and back on this week's list; the old bag still needs eating.
 */
export function wantsUseUpTask(item: GroceryItem, enabled: boolean): boolean {
  if (item.useUpTask !== null && item.useUpTask !== undefined) return item.useUpTask;
  return enabled && item.expiresAt !== null;
}

/**
 * What a use-up task is called.
 *
 * Built off `item.name` — the label the user typed, which is what the grocery
 * row and every sheet already show — so the task can't disagree with the item
 * it came from. Renaming the item doesn't chase the task, for the same reason
 * the aisle lexicon doesn't: reconciling runs on the expiry, not on every
 * edit, and a task the user may have since filed and annotated is not worth
 * rewriting over a spelling.
 */
export function useUpTaskTitle(item: GroceryItem): string {
  return `Use up ${item.name}`;
}

/** A lead time forced into the sayable range, mirroring clampKeepDays. */
export function clampUseUpLeadDays(days: number): number {
  if (!Number.isFinite(days)) return GROCERY_USE_UP_LEAD_DAYS_MIN;
  return Math.max(
    GROCERY_USE_UP_LEAD_DAYS_MIN,
    Math.min(GROCERY_USE_UP_LEAD_DAYS_MAX, Math.round(days))
  );
}

/**
 * The fields the item owns on its task: what it's called, when it comes up,
 * and the day it's actually about.
 *
 * **This is deliberately the complete list**, and reconciling writes exactly
 * these three. Everything else on the row belongs to the user — the category,
 * the notes, the reminder they added, the subtasks — and a reconcile that
 * reset any of it would make the task worthless as a task.
 *
 * The date resolves through `resolveOffsetDate`, the same noon-normalized
 * anchor cook and prep tasks use, so a use-up task can't land on a subtly
 * different instant of the same day from everything else on the list.
 *
 * **`deadline` carries the expiry itself, and that's why the lead time can be
 * generous.** The due date is when to *do* something about it; the deadline is
 * the day the food is answerable to, and it renders as the quiet countdown the
 * field already exists for. Without it a task due Thursday would say nothing
 * about what happens on Friday.
 */
export function useUpTaskFields(
  item: GroceryItem,
  leadDays: number
): { title: string; dueDate: string; deadline: string } {
  const expiry = dayKeyToDate(item.expiresAt!);
  return {
    title: useUpTaskTitle(item),
    // Never null: expiry is a real Date and the offset is a real number.
    dueDate: resolveOffsetDate(expiry, -clampUseUpLeadDays(leadDays))!,
    deadline: resolveOffsetDate(expiry, 0)!,
  };
}

/**
 * The full draft for a newly spawned use-up task, back-pointer included.
 *
 * `category` is applied here and nowhere else — on creation only, never on a
 * reconcile — because it isn't one of the fields the item owns. It matters
 * mostly for where the task lands: makeCategoryGroups renders uncategorized
 * tasks in a header-less block at the *top* of Today, so a use-up task left
 * with no category would sit above everything the user actually planned. See
 * the groceryUseUpTaskCategory setting.
 */
export function useUpTaskDraft(
  item: GroceryItem,
  leadDays: number,
  category: string | null = null
): Partial<TaskDraft> {
  return { ...useUpTaskFields(item, leadDays), groceryItemId: item.id, category };
}

/**
 * Whether an existing use-up task has drifted from its item — the guard that
 * keeps a reconcile from writing a row that already says the right thing.
 *
 * Worth having for the same reason `cookTaskNeedsUpdate` is: a no-op write
 * would still hit SQLite, still replace the object in the store, and still
 * re-render every list holding it.
 */
export function useUpTaskNeedsUpdate(
  task: { title: string; dueDate: string | null; deadline: string | null },
  item: GroceryItem,
  leadDays: number
): boolean {
  const next = useUpTaskFields(item, leadDays);
  return (
    task.title !== next.title ||
    task.dueDate !== next.dueDate ||
    task.deadline !== next.deadline
  );
}
