import type { Calendar as ReminderList, Reminder } from 'expo-calendar';
import type { TaskDraft } from '../types';

/**
 * The rules deciding what gets pulled out of the Reminders app — and, because
 * an imported reminder is deleted, what gets destroyed. Kept pure and free of
 * `expo-calendar`'s runtime (only its types) so every one of them is testable
 * under the node jest env; the effectful half lives in remindersImportSync.ts.
 *
 * More of this file is filtering than mapping, and that isn't an accident:
 * `getRemindersAsync` can't do the filtering for us. Passing a `ReminderStatus`
 * makes the JS wrapper demand a start and end date, and natively "incomplete"
 * becomes `predicateForIncompleteReminders(withDueDateStarting:ending:)` —
 * which filters on *due date*. A reminder dictated to Siri has no due date, so
 * a status query drops exactly the reminders this feature exists to catch. The
 * only usable call is the unfiltered one, which returns completed reminders
 * too, so "which of these may we touch" is a JS problem now.
 */

/**
 * The one place a reminder becomes a task. Deliberately only the title: nothing
 * carries a date, so an imported task satisfies `isInboxTask` and waits in the
 * Inbox for triage. Adding `dueDate` or `notes` later is a line here and
 * nothing else — that's the point of it being one function.
 *
 * Returns null when there's no title to use.
 */
export function draftFromReminder(reminder: Reminder): Partial<TaskDraft> | null {
  const title = reminder.title?.trim();
  if (!title) return null;
  return { title };
}

/** True for a list we may both read from and delete out of. */
export function isImportableList(list: ReminderList | undefined): boolean {
  // `allowsModifications` is load-bearing rather than hygiene. A subscribed or
  // shared read-only list imports perfectly well and then fails every single
  // delete — so its whole contents would come back on every foreground, for
  // ever. It's the one unbounded failure mode this feature has, and the
  // cheapest place to kill it is before the list can be picked.
  return !!list && list.allowsModifications === true;
}

/**
 * The picker's options: reminder lists we could actually import from.
 *
 * `excludeId` is how the two destinations (tasks, groceries) stay disjoint.
 * They must be, and it isn't cosmetic: `handledIds` is global, so a list wired
 * to both would send each reminder to whichever drain reached it first — a
 * coin toss between the Inbox and the grocery list.
 */
export function reminderListOptions(
  lists: ReminderList[],
  excludeId: string | null = null
): ReminderList[] {
  return lists
    .filter(isImportableList)
    .filter(list => !excludeId || list.id !== excludeId)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function findReminderList(
  lists: ReminderList[],
  id: string | null
): ReminderList | undefined {
  if (!id) return undefined;
  return lists.find(list => list.id === id);
}

/**
 * `creationDate` comes back as a string formatted with a *local* UTC offset
 * (`yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ`), not a `Z`, so comparing two of them as
 * strings is wrong the moment a clock change sits between them. Parse instead.
 * It's also optional — the native serializer only sets it when EventKit has
 * one.
 */
function creationTime(reminder: Reminder): number | null {
  const raw = reminder.creationDate;
  if (!raw) return null;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Everything in a fetched list we're willing to import *and then delete*,
 * oldest first. Nothing outside this array is ever touched.
 *
 * `skipIds` is the drain's in-session record of reminders whose task was
 * created but whose delete failed. Without it the retry loop re-imports them
 * immediately, and keeps doing it.
 */
export function importableReminders(
  reminders: Reminder[],
  skipIds: ReadonlySet<string> = new Set()
): Reminder[] {
  const kept = reminders.filter(reminder => {
    // No id means no handle to delete it by, so importing it would duplicate
    // the task on every foreground from now on.
    if (!reminder.id) return false;
    // Never read as importable, so never deleted. A finished reminder isn't a
    // capture waiting to be triaged, and this feature's licence to delete comes
    // entirely from having taken custody of an open one.
    if (reminder.completed) return false;
    // A reminder someone created and hasn't typed into yet. Importing an empty
    // task and deleting their half-made row is hostile.
    if (!reminder.title?.trim()) return false;
    if (skipIds.has(reminder.id)) return false;
    return true;
  });

  // Two things said in a row should land in the order they were said. Anything
  // undated sorts last rather than to the epoch, keeping its relative order.
  return kept
    .map((reminder, index) => ({ reminder, index, at: creationTime(reminder) }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.index - b.index;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return a.at === b.at ? a.index - b.index : a.at - b.at;
    })
    .map(entry => entry.reminder);
}
