import { format } from 'date-fns/format';
import type { Calendar as ReminderList, RecurrenceRule, Reminder } from 'expo-calendar';
import type { RecurrenceType, Task, TaskDraft } from '../types';
import { groceryNameKey, parseGroceryInput } from './groceryParse';
import {
  describeSchedule,
  dueAt,
  parseFromCompletionSuffix,
  parseTaskInput,
  segmentForHour,
  type ParsedSchedule,
} from './parseTaskInput';

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
 * The one place a reminder becomes a task, and it takes only what it can copy
 * *verbatim*: the title exactly as dictated, and the notes exactly as typed.
 *
 * Everything a reminder implies rather than states — a due date, a repeat, an
 * alarm, the schedule words still sitting in the title — is deliberately not
 * here. It goes to `pendingImportFor` instead and waits for the user to
 * approve it, because every one of those fields disqualifies `isInboxTask`,
 * and a capture that files itself onto Today before anyone has read it is the
 * failure this whole path exists to avoid. Notes are the exception that proves
 * the rule: they're a straight copy, and `isInboxTask` already declines to
 * treat them as filing metadata, so a task carrying them still waits in the
 * Inbox.
 *
 * Returns null when there's no title to use.
 */
export function draftFromReminder(reminder: Reminder): Partial<TaskDraft> | null {
  const title = reminder.title?.trim();
  if (!title) return null;
  const notes = reminder.notes?.trim();
  return notes ? { title, notes } : { title };
}

/**
 * EventKit hands dates back as strings carrying a *local* UTC offset rather
 * than a `Z` (see the note on creationTime below), and sometimes as real
 * `Date`s. Parse rather than compare, everywhere.
 */
function toDate(raw: string | Date | null | undefined): Date | null {
  if (!raw) return null;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms);
}

const RECURRENCE_TYPES: readonly string[] = ['daily', 'weekly', 'monthly', 'yearly'];

/**
 * A native repeating reminder ("Hey Siri, remind me to go running every day")
 * carries its repeat as an EventKit rule, not as words in the title — so this
 * is the only way to see it at all.
 *
 * Anything the rule says that this app has no field for is **dropped, and the
 * rest is still offered**: a second day-of-month anchor, `monthsOfTheYear`,
 * `weeksOfTheYear`. Refusing the whole suggestion because one clause didn't
 * survive would throw away the repeat the user actually asked for, and the
 * label shows them what they're accepting before it applies.
 */
export function recurrenceFromRule(rule: RecurrenceRule | null | undefined): Partial<Task> | null {
  if (!rule || !RECURRENCE_TYPES.includes(rule.frequency)) return null;

  const out: Partial<Task> = {
    recurrenceType: rule.frequency as RecurrenceType,
    recurrenceInterval: typeof rule.interval === 'number' && rule.interval > 0 ? rule.interval : 1,
  };

  // DayOfTheWeek is 1-based with Sunday = 1; Task.recurrenceDays is 0-based
  // with Sunday = 0. Getting this wrong shifts every weekly repeat by a day.
  const days = (rule.daysOfTheWeek ?? [])
    .map(d => d.dayOfTheWeek)
    .filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 7)
    .map(n => n - 1);
  if (days.length > 0) out.recurrenceDays = [...new Set(days)].sort((a, b) => a - b);

  // weekNumber documents 0 as "ignore this field", and we can only express
  // 1st-4th and last, so anything else is one of the clauses we drop.
  const ordinal = (rule.daysOfTheWeek ?? []).map(d => d.weekNumber).find(n => !!n);
  if (ordinal != null && ((ordinal >= 1 && ordinal <= 4) || ordinal === -1)) {
    out.recurrenceWeekOrdinal = ordinal;
  }

  // recurrenceMonthDay and recurrenceWeekOrdinal are mutually exclusive (see
  // types/index.ts); the Nth-weekday form is the more specific of the two, so
  // it wins when a rule somehow states both. Both spell the last day -1, and
  // both count negatives from the end, so the number carries across unchanged.
  if (out.recurrenceWeekOrdinal == null) {
    const monthDay = (rule.daysOfTheMonth ?? []).find(
      n => typeof n === 'number' && n !== 0 && n >= -31 && n <= 31
    );
    if (monthDay != null) out.recurrenceMonthDay = monthDay;
  }

  // "overrides `occurrence` if both are specified" — EventKit's own rule.
  const endDate = toDate(rule.endDate);
  if (endDate) out.recurrenceEndDate = endDate.toISOString();
  else if (typeof rule.occurrence === 'number' && rule.occurrence > 0) {
    out.recurrenceCount = rule.occurrence;
  }

  return out;
}

/**
 * The instant a reminder's alarm should fire, as an absolute ISO string.
 *
 * Past alarms are dropped rather than carried. `scheduleTaskReminder` refuses
 * to schedule anything already gone (see notifications.ts), so keeping one
 * would set a `reminderTime` that can never fire — and `reminderTime` is a
 * field that ejects a task from the Inbox, so a stale alarm on an old reminder
 * would quietly file the capture out of sight in exchange for nothing.
 */
export function reminderTimeFromAlarms(reminder: Reminder, now: Date = new Date()): string | null {
  const alarms = reminder.alarms ?? [];
  if (alarms.length === 0) return null;

  // relativeOffset is minutes from the item's own date, negative for "before".
  const anchor = toDate(reminder.dueDate) ?? toDate(reminder.startDate);
  const instants: number[] = [];
  for (const alarm of alarms) {
    // absoluteDate "overrides relativeOffset ... if specified alongside it".
    const absolute = toDate(alarm.absoluteDate);
    if (absolute) {
      instants.push(absolute.getTime());
      continue;
    }
    if (typeof alarm.relativeOffset === 'number' && anchor) {
      instants.push(anchor.getTime() + alarm.relativeOffset * 60_000);
    }
  }

  const upcoming = instants.filter(ms => ms > now.getTime()).sort((a, b) => a - b);
  return upcoming.length > 0 ? new Date(upcoming[0]).toISOString() : null;
}

/**
 * A ParsedSchedule in Task-field vocabulary. The mapping exists nowhere else as
 * a function — QuickAddModal and TaskEditor both fan a parse out across a dozen
 * `useState` setters instead, which they have to, being React state.
 *
 * Only fields that say something are included: an empty `timeSegments` or a
 * `recurrenceType: 'none'` would be indistinguishable from "the user cleared
 * this", and the suggestion is spread over a real task when it applies.
 */
export function scheduleToDraft(schedule: ParsedSchedule): Partial<Task> {
  const draft: Partial<Task> = { dueDate: schedule.dueDate.toISOString() };
  if (schedule.deadline) draft.deadline = schedule.deadline.toISOString();
  if (schedule.timeSegments.length > 0) draft.timeSegments = [...schedule.timeSegments];
  if (schedule.recurrenceType !== 'none') {
    draft.recurrenceType = schedule.recurrenceType;
    draft.recurrenceInterval = schedule.recurrenceInterval;
    if (schedule.recurrenceDays.length > 0) draft.recurrenceDays = [...schedule.recurrenceDays];
    if (schedule.recurrenceMonthDay != null) draft.recurrenceMonthDay = schedule.recurrenceMonthDay;
    if (schedule.recurrenceWeekOrdinal != null) draft.recurrenceWeekOrdinal = schedule.recurrenceWeekOrdinal;
    if (schedule.recurrenceEndDate != null) draft.recurrenceEndDate = schedule.recurrenceEndDate;
    if (schedule.recurrenceCount != null) draft.recurrenceCount = schedule.recurrenceCount;
  }
  if (schedule.recurrenceFromCompletion) draft.recurrenceFromCompletion = true;
  return draft;
}

/**
 * Everything a reminder implies about scheduling, as a suggestion to be shown
 * and approved rather than applied. Null when it implies nothing.
 *
 * Two sources, and the precedence between them is the whole design:
 *
 * - **EventKit is structured truth and wins where it speaks.** Siri understood
 *   "every day", so the repeat is a real rule and the title no longer contains
 *   the words.
 * - **The title fills the gaps and says what EventKit cannot.** There is no
 *   EKRecurrenceRule for "after completion", so that clause survives only as
 *   text — which is why it's peeled off separately when a rule already exists.
 *
 * Together those handle the case that motivated all of this: "go running every
 * day after completion" comes out as daily *and* from-completion whether Siri
 * parsed the repeat or left the whole phrase in the title.
 */
export function pendingImportFor(reminder: Reminder, now: Date = new Date()): Partial<Task> | null {
  const suggestion: Partial<Task> = {};

  const fromRule = recurrenceFromRule(reminder.recurrenceRule);
  if (fromRule) Object.assign(suggestion, fromRule);

  const due = toDate(reminder.dueDate);
  if (due) {
    // Noon on the day, never the raw instant: a midnight timestamp lands in the
    // previous logical day for anyone whose dayResetTime is after midnight.
    // See ParsedSchedule.dueDate, which stores it this way for the same reason.
    suggestion.dueDate = dueAt(due).toISOString();
    // A due date carrying a real clock time also names a part of the day, the
    // same way "at 9am" does in quick add.
    if (reminder.allDay !== true && (due.getHours() !== 0 || due.getMinutes() !== 0)) {
      suggestion.timeSegments = [segmentForHour(due.getHours())];
    }
  }

  const reminderTime = reminderTimeFromAlarms(reminder, now);
  if (reminderTime) suggestion.reminderTime = reminderTime;

  const title = reminder.title?.trim() ?? '';
  const parsed = title ? parseTaskInput(title, now) : null;
  if (parsed) {
    const fromText = scheduleToDraft(parsed.schedule);
    // EventKit wins field by field rather than wholesale: a reminder can carry
    // a native repeat and still have a date phrase left in its title.
    for (const [key, value] of Object.entries(fromText)) {
      if (!(key in suggestion)) (suggestion as Record<string, unknown>)[key] = value;
    }
    // The stripped title is itself an interpretation, so it rides along in the
    // suggestion and only replaces the dictated one on approval.
    suggestion.title = parsed.cleanTitle;
  } else if (suggestion.recurrenceType != null && title) {
    // No schedule phrase left in the title, but EventKit gave us a repeat — so
    // a trailing "after completion" is now meaningful on its own, and
    // parseTaskInput won't match it without a recurrence phrase in front.
    const fromCompletion = parseFromCompletionSuffix(title);
    if (fromCompletion) {
      suggestion.recurrenceFromCompletion = true;
      suggestion.title = fromCompletion.cleanTitle;
    }
  }

  return Object.keys(suggestion).length > 0 ? suggestion : null;
}

/**
 * The chip label — what the user is agreeing to before they tap.
 *
 * Reuses describeSchedule rather than restating its vocabulary, because those
 * labels are pinned by a wall of assertions in parseTaskInput.test.ts and two
 * copies would drift. It only reads `dueDate` for yearly and one-off
 * schedules, so a repeat-only suggestion needs no date to describe itself.
 *
 * The suffixes are here rather than there on purpose: describeSchedule drives
 * quick add's tooltip, where recurrenceFromCompletion and the end conditions
 * are deliberately left unsaid. Here they're the difference between two
 * schedules the user would want to tell apart.
 */
export function describePendingImport(
  pending: Partial<Task> | null | undefined,
  now: Date = new Date()
): string | null {
  if (!pending) return null;

  const due = toDate(pending.dueDate);
  const recurrenceType = pending.recurrenceType ?? 'none';
  if (recurrenceType === 'none' && !due && !pending.reminderTime) return null;

  const parts: string[] = [];

  if (recurrenceType !== 'none' || due) {
    parts.push(
      describeSchedule(
        {
          // Only read when the schedule is yearly or one-off, and both of those
          // imply a date; `now` is a harmless stand-in for the repeats that
          // never look at it.
          dueDate: due ?? now,
          timeSegments: pending.timeSegments ?? [],
          recurrenceType,
          recurrenceInterval: pending.recurrenceInterval ?? 1,
          recurrenceDays: pending.recurrenceDays ?? [],
          recurrenceMonthDay: pending.recurrenceMonthDay ?? null,
          recurrenceWeekOrdinal: pending.recurrenceWeekOrdinal ?? null,
        },
        now
      )
    );
  }

  if (pending.recurrenceFromCompletion) parts.push('after completion');
  if (pending.recurrenceCount != null) parts.push(`${pending.recurrenceCount}×`);
  else if (pending.recurrenceEndDate) {
    const until = toDate(pending.recurrenceEndDate);
    if (until) parts.push(`until ${format(until, 'MMM d')}`);
  }
  if (pending.reminderTime) parts.push('reminder');

  return parts.length > 0 ? parts.join(' · ') : null;
}

/** True for a list we may both read from and delete out of. */
export function isImportableList(list: ReminderList | undefined): boolean {
  // `allowsModifications` is load-bearing rather than hygiene. A subscribed or
  // shared read-only list imports perfectly well and then fails every single
  // delete — so its whole contents would come back on every foreground, for
  // ever. It's the one unbounded failure mode this feature has, and the
  // cheapest place to kill it is before the list can be picked.
  //
  // Still required with "Delete after importing" off, even though nothing is
  // deleted then and the name index would hold the same line: that setting is
  // one tap away from coming back on, and a list picked while it was off would
  // strand the drain the moment it did.
  return !!list && list.allowsModifications === true;
}

/**
 * The picker's options: reminder lists we could actually import from.
 *
 * `excludeId` is how the two destinations (tasks, groceries) stay disjoint.
 * They must be, and it isn't cosmetic: the handled record is read as one set
 * across every list, so a list wired
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
 * strings is wrong the moment a clock change sits between them. Parse instead
 * — which is what toDate is for, and why every other EventKit date in this
 * file goes through it too. It's also optional: the native serializer only
 * sets it when EventKit has one.
 */
function creationTime(reminder: Reminder): number | null {
  return toDate(reminder.creationDate)?.getTime() ?? null;
}

/**
 * Everything in a fetched list we're willing to import *and then delete*,
 * oldest first. Nothing outside this array is ever touched.
 *
 * `skipIds` is the drain's in-session record of reminders whose task already
 * exists but which are still sitting in the list — a delete that failed, or one
 * that was never attempted because the user asked for them to be left in place.
 * Without it the retry loop re-imports them immediately, and keeps doing it.
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

/**
 * The durable record of reminders this app has already dealt with — imported,
 * or deliberately left alone — keyed by the list they were found in.
 *
 * **This is what makes editing an imported task safe.** The name index below
 * used to be the only thing standing between "delete after importing" being off
 * and a capture arriving twice, and it was wrong in the one way a user notices:
 * it infers "already imported" from a task *title*, so renaming that task, or
 * deleting it, destroys the evidence. The reminder is still sitting in
 * Reminders, so the next foreground imports it again — and again, because
 * nothing the user does to the task can ever stop it. A synced item you can't
 * delete or rename is a sync loop, not a sync.
 *
 * An id is the right handle for that because EventKit never reuses one. A
 * re-created reminder gets a new id, so a genuinely fresh capture is never
 * mistaken for a handled one however it's titled, which is exactly the
 * confusion the name index is capable of.
 *
 * **It is bounded by the list, not by time.** A record only says anything while
 * the reminder it names is still there to be re-read, so every drain rewrites
 * its list's bucket as "what we still see of what we knew, plus what we just
 * handled" — see `reconcileHandledReminders`. With deletion on the imported
 * reminder is gone by the next pass and its id goes with it, so this
 * self-empties rather than growing for ever; the same discipline the
 * completed-task retention window exists to impose.
 *
 * Per list rather than one flat set so a list that *wasn't* drained this pass —
 * the other destination switched off, or gone from the device — keeps its
 * bucket instead of having it pruned to nothing by a fetch that never covered
 * it. Ids are unique across lists, so the read side flattens it again.
 */
export type HandledReminderIndex = Record<string, string[]>;

/** Tolerant of anything: a record that won't parse is a record we don't have. */
export function parseHandledReminders(raw: string | null | undefined): HandledReminderIndex {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: HandledReminderIndex = {};
  for (const [listId, ids] of Object.entries(parsed as Record<string, unknown>)) {
    if (!listId || !Array.isArray(ids)) continue;
    const kept = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
    if (kept.length > 0) out[listId] = kept;
  }
  return out;
}

export function serializeHandledReminders(index: HandledReminderIndex): string {
  return JSON.stringify(index);
}

/** Every id the record holds, whichever list it came from. */
export function handledReminderIds(index: HandledReminderIndex): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(index)) {
    for (const id of list) ids.add(id);
  }
  return ids;
}

/**
 * The record after one list has been drained: what we still see of what we
 * knew, plus what this pass handled.
 *
 * `present` is every id the *raw* fetch returned, not just the importable ones
 * — a completed or blank reminder is still sitting in the list, and a reminder
 * can be un-completed. Pruning against the importable set would forget those
 * and re-import them the moment they came back.
 *
 * `handledNow` survives unconditionally rather than being intersected with
 * `present`: it always comes from the same fetch, and with deletion on the
 * reminder is destroyed moments later, so the one thing this must never do is
 * fail to remember a row it just created. It drops out on the next pass, when
 * the list no longer holds it.
 *
 * An empty bucket is deleted rather than stored as `[]`, so a list that has
 * been emptied leaves nothing behind.
 */
export function reconcileHandledReminders(
  index: HandledReminderIndex,
  listId: string,
  present: ReadonlySet<string>,
  handledNow: ReadonlySet<string> = new Set()
): HandledReminderIndex {
  const next = { ...index };
  const kept = [
    ...new Set([...(index[listId] ?? []).filter(id => present.has(id)), ...handledNow]),
  ];
  if (kept.length > 0) next[listId] = kept;
  else delete next[listId];
  return next;
}

/**
 * Names already spoken for — the *first* answer about a reminder we have no
 * record of, and nothing more than that since the record above exists.
 *
 * It still earns its place twice. On the first launch after this shipped there
 * is no record at all, so every reminder already imported into a task would
 * come across a second time; the name index recognises them, and the drain
 * writes each one into the record as it skips it, which is the whole backfill.
 * And with "Delete after importing" off, a dictated name that already exists as
 * a task is one the user almost certainly doesn't want twice.
 *
 * **The match is deliberately wide, and the asymmetry is the reason.** With
 * nothing being deleted, a false match costs a skip the user can undo by hand —
 * the reminder is still sitting in Reminders, untouched — while a false miss
 * re-imports the same capture on every foreground, for ever. Unbounded beats
 * recoverable, so the index counts *every* task row (completed, archived and
 * subtasks alike) and every name the grocery catalog knows, not just what's on
 * the list today. A completed "buy milk" still answers "yes, that one came
 * across already", which is the question being asked.
 *
 * None of it runs while reminders are being deleted: there the delete is the
 * record, and two genuinely separate captures that happen to share a title
 * should both come in.
 */
export function taskTitleKey(title: string | null | undefined): string {
  return (title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function taskTitleKeys(tasks: readonly { title: string }[]): Set<string> {
  const keys = new Set<string>();
  for (const task of tasks) {
    const key = taskTitleKey(task.title);
    if (key) keys.add(key);
  }
  return keys;
}

/** True when this name is one the index already holds. Empty names never match. */
export function isTitleTaken(
  title: string | null | undefined,
  keys: ReadonlySet<string>
): boolean {
  const key = taskTitleKey(title);
  return key !== '' && keys.has(key);
}

/**
 * The key `addByName` would file this reminder under, so a skip lines up
 * exactly with the row that would otherwise have been created or re-listed.
 * Mirrors that function's derivation, empty-name fallback included — quantities
 * are split off first, so "2 lb chicken" and "chicken" are the same item.
 */
export function groceryItemKey(raw: string): string {
  const { name } = parseGroceryInput(raw);
  return groceryNameKey(name) || name.trim().toLowerCase();
}

export function groceryItemKeys(items: readonly { nameKey: string }[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.nameKey) keys.add(item.nameKey);
  }
  return keys;
}

/**
 * Whether a drain consulting `keys` would leave this reminder alone.
 *
 * The task side tests two names, not one: an import with review off saves the
 * *stripped* title ("pay rent tmrw" is filed as "pay rent"), so matching only
 * the dictated one would re-import the capture the moment that setting changed
 * under it. Shared with the count behind the confirmation alert, so the number
 * it names is the set that actually comes across.
 */
export function isReminderAlreadyPresent(
  reminder: Reminder,
  sink: 'task' | 'grocery',
  keys: ReadonlySet<string>,
  now: Date = new Date()
): boolean {
  if (sink === 'grocery') {
    const key = groceryItemKey(reminder.title ?? '');
    return key !== '' && keys.has(key);
  }
  return (
    isTitleTaken(reminder.title, keys) ||
    isTitleTaken(pendingImportFor(reminder, now)?.title, keys)
  );
}
