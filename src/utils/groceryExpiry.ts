import type { GroceryItem, Task, TaskDraft } from '../types';
import { GROCERY_USE_UP_LEAD_DAYS_MAX, GROCERY_USE_UP_LEAD_DAYS_MIN } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedBy, wantsGeneratedTask } from './generatedTasks';
import { liveExpiresAt } from './groceryShelfLife';
import { kitchenEntryId, kitchenLinkUrl } from './kitchenInventory';
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
 * The precedence is `wantsGeneratedTask`'s, shared with the other generators.
 * What qualifies an *item*:
 *
 * 1. **A *live* use-by date is the whole trigger.** No date, no task: the
 *    shelf-life lexicon is a whitelist of things that actually go off, so a
 *    catalog of hundreds contributes a handful of dates and the rest stay
 *    silent. Live, because a frozen item's date is suspended rather than
 *    cleared — read through `liveUseBy` and it goes quiet for exactly as long
 *    as it's in the freezer, then counts again from a fresh shelf life on the
 *    thaw. This is the case the whole freezer feature is for: the lexicon is at
 *    its shortest precisely where a freezer is most used (chicken 2 days,
 *    ground beef 2), so without it a month of meat is a fistful of tasks due
 *    Monday about food under an inch of ice.
 * 2. **Nothing about being on the list matters.** A row can be both in the
 *    fridge and back on this week's list; the old bag still needs eating.
 *
 * Deliberately *not* an item-level opt-out (`useUpTask: false`), which was the
 * only way to say this before: that's permanent, so silencing this month's
 * frozen chicken would silence next month's fresh chicken too.
 */
export function wantsUseUpTask(item: GroceryItem, enabled: boolean): boolean {
  // A precondition rather than `wantsGeneratedTask`'s `qualifies` argument,
  // which an explicit `true` deliberately outranks. That ordering is right for
  // a *preference* — "I do want reminding about this one" should beat the
  // global setting — but a live date isn't a preference, it's whether there is
  // anything to remind about. No countdown, no task to want: `useUpTaskFields`
  // dates the task off `expiresAt!`, so reaching it here would either
  // dereference a null or, for a frozen row, date a task off a day the app has
  // undertaken to ignore.
  //
  // An opt-in isn't lost by this, only deferred — it's still sitting on the row
  // when the item thaws or is bought again, and takes effect then.
  if (liveExpiresAt(item) === null) return false;
  return wantsGeneratedTask(item.useUpTask, enabled, true);
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
 * the day it's actually about, and where tapping its link opens.
 *
 * **This is deliberately the complete list**, and reconciling writes exactly
 * these four. Everything else on the row belongs to the user — the category,
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
 *
 * `linkUrl` opens straight to this item's own row in the kitchen view —
 * `kitchenLinkUrl(kitchenEntryId('grocery', item.id))` — the same link
 * shape leftoverTasks.ts's use-up task carries for its own row, since "Use
 * up spinach" and "Use up last night's chili" both mean "take me to that
 * one thing", not the bare grocery list.
 */
export function useUpTaskFields(
  item: GroceryItem,
  leadDays: number
): { title: string; dueDate: string; deadline: string; linkUrl: string } {
  const expiry = dayKeyToDate(item.expiresAt!);
  return {
    title: useUpTaskTitle(item),
    // Never null: expiry is a real Date and the offset is a real number.
    dueDate: resolveOffsetDate(expiry, -clampUseUpLeadDays(leadDays))!,
    deadline: resolveOffsetDate(expiry, 0)!,
    linkUrl: kitchenLinkUrl(kitchenEntryId('grocery', item.id)),
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
  return { ...useUpTaskFields(item, leadDays), ...generatedBy('groceryUseUp', item.id), category };
}

/**
 * What an existing use-up task should be brought into line with — or null when
 * it already says the right thing, which is how a caller tells
 * `reconcileGeneratedTask` to leave the row alone rather than write it back
 * unchanged. Worth having for the same reason `cookTaskNeedsUpdate` was: a
 * no-op write would still hit SQLite, still replace the object in the store,
 * and still re-render every list holding it.
 *
 * **The date is chased only when the item's use-by day has actually moved, and
 * `deadline` is how that's known.** Unlike the leftover use-up task's day (see
 * `leftoverTasks.useUpTaskDrift`, which never chases at all), this one really
 * is projected from the item — `expiresAt` minus the lead — so a fresher bag
 * pushing the use-by out *should* carry the task with it, and
 * `reconcileGeneratedTask` passes `skipPostponeCount` precisely because that
 * move isn't the user ducking anything.
 *
 * What was wrong was chasing it on every reconcile rather than on a move.
 * `reconcileUseUpTask` also fires on mutations that leave `expiresAt` exactly
 * where it was — un-opening a jar (`setOpened(false)` re-dates nothing), and
 * the item's own use-up switch — and there the recomputed day is the same day
 * it always was, so writing it back only undid a date the *user* had chosen.
 * A task deferred to Thursday snapped to Wednesday for no reason anyone could
 * see.
 *
 * `deadline` is the item's `expiresAt`, stamped at the same moment the day was
 * derived from it, so a task whose deadline still matches the item is a task
 * whose day is still derived from the current expiry — nothing to correct. It
 * follows that hand-editing a generated task's deadline re-dates it on the next
 * reconcile; that was already true when this wrote all four fields, and a
 * deadline the app owns is a thin place to be defending a hand edit.
 *
 * The one thing `deadline` can't see is the *lead* changing, since the row
 * records the expiry it was derived from and not the offset. That costs
 * nothing today: `setGroceryUseUpLeadDays` writes the setting and reconciles
 * nothing, so existing tasks have never re-dated on a lead change. A future
 * caller that wants them to has to sweep the items itself, the way
 * `reconcileAllLeftoverTasks` does.
 */
export function useUpTaskDrift(
  task: Pick<Task, 'title' | 'deadline' | 'linkUrl'>,
  item: GroceryItem,
  leadDays: number
): Partial<Task> | null {
  const next = useUpTaskFields(item, leadDays);
  const expiryMoved = task.deadline !== next.deadline;
  const updates: Partial<Task> = {};
  if (task.title !== next.title) updates.title = next.title;
  if (expiryMoved) {
    updates.deadline = next.deadline;
    updates.dueDate = next.dueDate;
  }
  if (task.linkUrl !== next.linkUrl) updates.linkUrl = next.linkUrl;
  return Object.keys(updates).length > 0 ? updates : null;
}
