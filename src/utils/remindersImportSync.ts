import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Calendar as ReminderList, Reminder } from 'expo-calendar';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { useTaskStore } from '../store/useTaskStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  draftFromReminder,
  findReminderList,
  groceryItemKey,
  groceryItemKeys,
  handledReminderIds,
  importableReminders,
  isImportableList,
  isReminderAlreadyPresent,
  parseHandledReminders,
  pendingImportFor,
  reconcileHandledReminders,
  reminderListOptions,
  serializeHandledReminders,
  taskTitleKey,
  taskTitleKeys,
  type HandledReminderIndex,
} from './remindersImport';

/**
 * Required where it's used rather than imported at the top. `expo-calendar`
 * resolves its native half with `requireNativeModule` at module scope, which
 * throws when that half isn't in the binary — and a static import here would
 * hoist that throw into the app's own bundle evaluation, killing the whole
 * bundle before React mounts rather than just this feature. The type-only
 * import above is erased at compile time and carries no such risk.
 *
 * Every caller below already runs inside a try/catch that reports 'unsupported'
 * or 'error', which is exactly the right answer for a device whose Reminders
 * bridge isn't there.
 */
function calendar(): typeof import('expo-calendar') {
  return require('expo-calendar');
}

export type RemindersPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface ImportOutcome {
  imported: number;
  /** Tasks created whose reminder wouldn't delete — the duplicate-producing case. */
  deleteFailed: number;
  /**
   * Reminders left where they were because their name is already on a task or
   * in the grocery catalog. Only ever non-zero with deletion off, which is the
   * mode where a reminder is read again on every foreground.
   */
  skipped: number;
  reason:
    | 'ok'
    | 'unsupported'
    | 'off'
    | 'no-list'
    | 'no-permission'
    | 'list-missing'
    | 'list-readonly'
    | 'error';
}

const NOTHING = (reason: ImportOutcome['reason']): ImportOutcome => ({
  imported: 0,
  deleteFailed: 0,
  skipped: 0,
  reason,
});

/**
 * Every reminder this app has already dealt with — turned into a task or a
 * grocery row, or deliberately left because its name was taken — whether or not
 * deleting it afterwards worked. Three things depend on it:
 *
 * - a *failed* delete — or a delete the user switched off — leaves the reminder
 *   sitting there, so without this it comes back on every single trigger;
 * - a *successful* delete is committed to EventKit asynchronously, so a fetch
 *   that lands immediately after one — which the replay below can cause — may
 *   still be handed a reminder we've already imported;
 * - and the one the user actually feels: with the reminder left in place,
 *   **this is the only record that survives editing the task**. Everything else
 *   is inferred from the task's title, so renaming or deleting it used to hand
 *   the capture straight back to the next foreground, for ever.
 *
 * **Persisted**, which the third of those requires — a relaunch used to reset
 * this to empty and fall back to the title guess. It lives in the settings table
 * beside the rest of the import's configuration rather than in a store: no
 * screen renders it, and a Zustand slice for it would be state nothing
 * subscribes to. `handledIndex` is the in-process copy, read through once and
 * written through on every change, so a drain never goes back to SQLite
 * per reminder. See the note on HandledReminderIndex for why it's per list and
 * why it doesn't grow without bound.
 */
const HANDLED_SETTING_KEY = 'remindersImportHandled';

let handledIndex: HandledReminderIndex | null = null;
let handledSerialized = '';

function handled(): HandledReminderIndex {
  if (!handledIndex) {
    // A record we can't read is a record we don't have — the name index still
    // catches the common case, and the alternative is a drain that throws on a
    // corrupt settings row and imports nothing ever again.
    let raw: string | null = null;
    try {
      raw = dbGetSetting(HANDLED_SETTING_KEY);
    } catch {
      raw = null;
    }
    handledIndex = parseHandledReminders(raw);
    handledSerialized = serializeHandledReminders(handledIndex);
  }
  return handledIndex;
}

/**
 * Folds one list's pass into the record. Called for every list a drain reaches,
 * including one that turned out to have nothing importable in it — that pass is
 * still what proves which of the ids we were holding are still real.
 */
function rememberHandled(
  listId: string,
  present: ReadonlySet<string>,
  handledNow: ReadonlySet<string>
): void {
  const next = reconcileHandledReminders(handled(), listId, present, handledNow);
  const serialized = serializeHandledReminders(next);
  handledIndex = next;
  if (serialized === handledSerialized) return;
  handledSerialized = serialized;
  try {
    dbSetSetting(HANDLED_SETTING_KEY, serialized);
  } catch {
    // The in-memory copy still holds, so the rest of this session behaves; only
    // durability is lost, which is where this feature was before it persisted.
  }
}

let lastOutcome: ImportOutcome | null = null;

/** The most recent run, for the Settings warning rows. Deliberately in-memory. */
export function lastImportOutcome(): ImportOutcome | null {
  return lastOutcome;
}

/**
 * Mirrors getNotificationPermission() in notifications.ts, including the
 * canAskAgain line — that's what lets Settings show "Allow" for a prompt that
 * hasn't been answered and "Open Settings" for one that has.
 */
export async function getRemindersPermission(): Promise<RemindersPermission> {
  if (Platform.OS !== 'ios') return 'unsupported';
  try {
    const existing = await calendar().getRemindersPermissionsAsync();
    if (existing.granted) return 'granted';
    return existing.status === 'undetermined' || existing.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestRemindersPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const existing = await calendar().getRemindersPermissionsAsync();
    if (existing.granted) return true;
    const result = await calendar().requestRemindersPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/** Reminder lists we could import from — modifiable ones only, title-sorted. */
export async function listReminderLists(): Promise<ReminderList[]> {
  if (Platform.OS !== 'ios') return [];
  try {
    // EntityTypes.REMINDER must be passed explicitly: with no argument the
    // native module asks for calendar permission as well as reminders, and
    // this app never wants the former.
    const lists = await calendar().getCalendarsAsync(calendar().EntityTypes.REMINDER);
    return reminderListOptions(lists);
  } catch {
    return [];
  }
}

/**
 * Everything in a list that a drain would import right now. Shares
 * fetchList with the drain itself so the number the confirmation names
 * is exactly the set that gets deleted — if they diverge the alert is a lie.
 *
 * `sink` is why the name index is consulted here too: with deletion off the
 * drain leaves anything already on a task or in the catalog alone, so counting
 * those would over-promise on the one alert that has to be exact.
 *
 * Returns null when the list couldn't be read at all.
 */
export async function countImportableReminders(
  listId: string,
  sink: Sink = 'task'
): Promise<number | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const { importable: reminders } = await fetchList(listId);
    const { remindersImportDelete, groceryImportDelete } = useSettingsStore.getState();
    const taken = takenNames(
      sink,
      sink === 'grocery' ? groceryImportDelete : remindersImportDelete
    );
    if (!taken) return reminders.length;
    const now = new Date();
    return reminders.filter(r => !isReminderAlreadyPresent(r, sink, taken, now)).length;
  } catch {
    return null;
  }
}

/**
 * One fetch, read two ways: what a drain would take, and every id the list
 * still holds. The second is what `rememberHandled` prunes against, and it has
 * to come from the *raw* result — a completed or blank reminder is excluded
 * from `importable` but is still sitting in the list, and can stop being either.
 */
async function fetchList(listId: string): Promise<{ importable: Reminder[]; present: Set<string> }> {
  // `status` must be null. Passing ReminderStatus.INCOMPLETE makes the JS
  // wrapper throw without a date window, and the window it then demands is
  // matched against the *due date* — which a reminder dictated to Siri hasn't
  // got. See the header comment in remindersImport.ts.
  const reminders = await calendar().getRemindersAsync([listId], null, null, null);
  const present = new Set<string>();
  for (const reminder of reminders) {
    if (reminder.id) present.add(reminder.id);
  }
  return { importable: importableReminders(reminders, handledReminderIds(handled())), present };
}

type Sink = 'task' | 'grocery';

/**
 * Where a drained list's reminders go. Two destinations exist because a
 * dictated "buy milk" and a dictated "call the dentist" want different homes,
 * and Siri can only tell them apart by which list you named.
 */
interface DrainTarget {
  listId: string;
  sink: Sink;
  /** False when the user has asked for the reminders to be left in place. */
  deleteAfterImport: boolean;
}

/**
 * The configured destinations, in order. Each is gated exactly as the single
 * one used to be — enabled, a list picked, and that same list confirmed (the
 * confirmation is keyed on the id, so switching list re-asks rather than
 * silently swallowing a fresh backlog).
 */
function drainTargets(): DrainTarget[] {
  const {
    remindersImportEnabled, remindersImportListId, remindersImportConfirmedListId,
    remindersImportDelete,
    groceryImportEnabled, groceryImportListId, groceryImportConfirmedListId,
    groceryImportDelete,
    kitchenEnabled,
  } = useSettingsStore.getState();

  const targets: DrainTarget[] = [];
  if (remindersImportEnabled && remindersImportListId
      && remindersImportConfirmedListId === remindersImportListId) {
    targets.push({
      listId: remindersImportListId,
      sink: 'task',
      deleteAfterImport: remindersImportDelete,
    });
  }
  // The grocery sink goes with the area it feeds. Dropping the target rather
  // than clearing the setting is what makes it resume on its own: the list id
  // and its confirmation are still there, so turning groceries back on picks
  // up where it left off instead of re-asking. And nothing is lost meanwhile —
  // a reminder that isn't drained stays in the Reminders list.
  if (kitchenEnabled && groceryImportEnabled && groceryImportListId
      && groceryImportConfirmedListId === groceryImportListId) {
    targets.push({
      listId: groceryImportListId,
      sink: 'grocery',
      deleteAfterImport: groceryImportDelete,
    });
  }
  return targets;
}

/**
 * The name index a drain consults for this sink, or null when it doesn't need
 * one. Null is the normal case: with the reminder being deleted the delete
 * *is* the record, and two separate captures that happen to share a title
 * should both come across.
 *
 * Read from the store at the top of each target rather than once per reminder,
 * then kept current as rows are added — so two reminders saying the same thing
 * in one batch can't both land either.
 */
function takenNames(sink: Sink, deleteAfterImport: boolean): Set<string> | null {
  if (deleteAfterImport) return null;
  // Grocery dedup is scoped to what's currently on the list, not the whole
  // catalog: an item bought once and now sitting off-list is exactly what a
  // dictated reminder should be able to re-add, same as typing it would.
  return sink === 'grocery'
    ? groceryItemKeys(useGroceryStore.getState().items.filter(i => i.onList))
    : taskTitleKeys(useTaskStore.getState().tasks);
}

/**
 * Reads each configured Reminders list, turns every reminder into a task or a
 * grocery item, and deletes it. See the notes on ordering and isolation inside
 * — this is the one thing in the app that destroys data the user owns
 * somewhere else.
 */
async function drainOnce(): Promise<ImportOutcome> {
  if (Platform.OS !== 'ios') return NOTHING('unsupported');

  const { remindersImportEnabled, groceryImportEnabled, kitchenEnabled, remindersImportReview } =
    useSettingsStore.getState();
  // The grocery half only counts while the area it feeds exists — the same
  // gate drainTargets applies below, repeated here so the two can't disagree.
  // Without it, turning the groceries area off reported 'no-list' ("the list
  // you chose has gone") for a list that is still perfectly there.
  if (!remindersImportEnabled && !(groceryImportEnabled && kitchenEnabled)) return NOTHING('off');

  const targets = drainTargets();
  if (targets.length === 0) return NOTHING('no-list');
  if ((await getRemindersPermission()) !== 'granted') return NOTHING('no-permission');

  try {
    // Never pass an unvalidated id to getRemindersAsync. A stale one doesn't
    // hit the native "no ids means every list" branch, but it does reach
    // predicateForReminders(in: []) — undocumented territory whose downside, if
    // an empty array behaved like nil, is deleting every reminder on the
    // device. Cheap to rule out, not worth inferring.
    const lists = await calendar().getCalendarsAsync(calendar().EntityTypes.REMINDER);

    const { addTask } = useTaskStore.getState();
    let imported = 0;
    let deleteFailed = 0;
    let skipped = 0;
    let sawList = false;
    let sawWritableList = false;
    // One clock for the whole drain, so a batch of reminders parsed together
    // can't straddle a minute boundary and land on different days.
    const now = new Date();

    // Each target is drained in full before the next. The handled record,
    // `draining` and `rerunRequested` stay global and stay correct: EventKit
    // ids are unique across lists, and those guards always guarded the whole
    // drain. The record is keyed by list only so an un-drained list's ids
    // aren't pruned by a fetch that never covered them — the read side of it
    // flattens back to one set.
    for (const target of targets) {
      const list = findReminderList(lists, target.listId);
      if (!list) continue;
      sawList = true;
      // Permissions on a shared list can change after it was picked.
      if (!isImportableList(list)) continue;
      sawWritableList = true;

      const { importable: reminders, present } = await fetchList(target.listId);

      // Null whenever reminders are being deleted — see takenNames.
      const taken = takenNames(target.sink, target.deleteAfterImport);

      // What this pass decided about, folded into the durable record below.
      // Written in a finally so a throw part-way through a batch still records
      // the rows that were created before it — otherwise those import a second
      // time on the next trigger, which is the failure this record exists for.
      const decided = new Set<string>();
      try {
        // Sequential, never Promise.all: addTask derives sortOrder from max + 1
        // over the current array, so concurrency scrambles the order things were
        // dictated in, and one commit at a time bounds the damage if something goes
        // wrong at item 40 of 200.
        for (const reminder of reminders) {
          const draft = draftFromReminder(reminder);
          if (!draft) continue;

          // Recorded exactly like an import, and that is the fix for the sync
          // loop: a skip is a decision about this reminder, but the *reason* for
          // it — a task with a matching name — is something the user is free to
          // rename or delete. Left unrecorded, doing either handed the reminder
          // straight back to the next foreground with nothing able to stop it.
          // The cost is that a name collision the user meant to resolve later
          // stays resolved, which is recoverable by hand: the reminder is still
          // sitting untouched in Reminders.
          if (taken && isReminderAlreadyPresent(reminder, target.sink, taken, now)) {
            decided.add(reminder.id!);
            skipped += 1;
            continue;
          }

          // Create first, delete second, and never the other way round. A failed
          // delete leaves a duplicate — visible, understandable, fixable by hand. A
          // failed create *after* a delete destroys a capture with no trace and no
          // error anyone will ever see. addTask is synchronous runSync + a set, so
          // it has either thrown or committed by the time we get here; the delete
          // is async EventKit against an iCloud-backed store and can genuinely
          // fail. The reliable half goes first.
          if (target.sink === 'grocery') {
            // draftFromReminder already guarantees a non-empty title; skipping
            // rather than passing '' through keeps that contract explicit, and
            // leaves the reminder in place rather than deleting it for a row we
            // didn't create.
            const name = draft.title?.trim();
            if (!name) continue;
            // Nothing schedule-shaped is read here, and that's deliberate: a
            // grocery item has no dueDate, recurrence or reminder for a parsed
            // schedule to land on. "Milk every Tuesday" means buy milk, and the
            // list already remembers that you buy it weekly.
            //
            // addByName rather than a raw insert, so a dictated "2 lb chicken"
            // splits its quantity off and a name already in the catalog is
            // re-listed instead of duplicated — same as typing it.
            useGroceryStore.getState().addByName(name);
            if (taken) {
              const key = groceryItemKey(name);
              if (key) taken.add(key);
            }
          } else {
            // Everything the reminder implies about scheduling. Pure and
            // synchronous, and done before the create so a parse that somehow
            // threw could never leave a deleted reminder behind — though it
            // can't: the whole path is string and date arithmetic over data
            // already in hand.
            const pending = pendingImportFor(reminder, now);
            // With review on, the schedule waits beside the task as a suggestion
            // and the row stays bare enough for isInboxTask — a capture nobody
            // has read must not file itself onto Today. With review off the user
            // has said they trust the parse, so it applies on the way in.
            const scheduled = pending
              ? (remindersImportReview ? { pendingImport: pending } : pending)
              : null;
            const saved = { ...draft, ...scheduled };
            addTask(saved);
            // The title as *stored*, which is the one a later pass will find in
            // the store — with review off that's the stripped one, not what was
            // dictated.
            if (taken) {
              const key = taskTitleKey(saved.title);
              if (key) taken.add(key);
            }
          }
          // Recorded the moment the row exists, before the delete is even
          // attempted — that's what makes it cover both failure modes above.
          decided.add(reminder.id!);
          imported += 1;

          if (!target.deleteAfterImport) continue;
          try {
            await calendar().deleteReminderAsync(reminder.id!);
          } catch {
            // Isolated on purpose: one reminder in a strange state must not strand
            // the rest of the batch.
            deleteFailed += 1;
          }
        }
      } finally {
        rememberHandled(target.listId, present, decided);
      }
    }

    if (imported === 0) {
      if (!sawList) return NOTHING('list-missing');
      if (!sawWritableList) return NOTHING('list-readonly');
    }
    return { imported, deleteFailed, skipped, reason: 'ok' };
  } catch {
    // Nothing was deleted that wasn't first imported, so the next trigger
    // simply tries again.
    return NOTHING('error');
  }
}

// EventKit is *not* consumed on read — unlike the widget's queue file, which a
// drain empties as it goes. Two overlapping drains would each fetch the same
// reminders before either's deletes committed, and both would import them, so
// this guard is a correctness requirement rather than a way to avoid wasted
// work. The replay matters because a trigger that arrives mid-drain is usually
// the interesting one — the user just picked a different list, and the run in
// flight read the old one. It is only safe because the handled record is
// written at creation rather than at deletion, and committed before each target
// returns; a replay re-fetches reminders the previous pass has already
// imported, and without that record it would import them twice.
let draining = false;
let rerunRequested = false;

export async function importReminders(): Promise<ImportOutcome> {
  if (draining) {
    rerunRequested = true;
    return lastOutcome ?? NOTHING('ok');
  }

  draining = true;
  try {
    let outcome: ImportOutcome;
    do {
      rerunRequested = false;
      outcome = await drainOnce();
    } while (rerunRequested);
    lastOutcome = outcome;
    return outcome;
  } finally {
    draining = false;
  }
}

/**
 * Pulls reminders from the chosen list into the Inbox. Call once from the root
 * component, after the store's initialize() has run so the SQLite DB exists —
 * the same requirement useTaskDeepLinks has.
 *
 * Three triggers, none of which is a poll: expo-calendar exposes no
 * EKEventStoreChanged bridge, so there is nothing to subscribe to on the OS
 * side and Settings carries a manual "Import now" for the gap.
 */
export function useRemindersImportSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    // Cold launch. Guarded on `initialized` because settings are loaded in an
    // effect of their own and this one can win the race.
    if (useSettingsStore.getState().initialized) importReminders();

    // Covers three things at once: the settings load that mount may have
    // missed, turning either destination on (which should feel immediate —
    // the confirmation alert already told the user what's about to move),
    // and switching list. Same subscribe-to-the-store call useDailyAgendaSync
    // makes, for the same reason — a handful of separate call sites would
    // eventually miss one. Both destinations are listed here, not just the
    // tasks one: confirming the grocery list used to sit un-drained until the
    // next foreground or a manual "Import now", which left its own
    // confirmation alert describing something that hadn't happened yet.
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.remindersImportEnabled !== prev.remindersImportEnabled ||
        state.remindersImportListId !== prev.remindersImportListId ||
        state.remindersImportConfirmedListId !== prev.remindersImportConfirmedListId ||
        state.groceryImportEnabled !== prev.groceryImportEnabled ||
        state.groceryImportListId !== prev.groceryImportListId ||
        state.groceryImportConfirmedListId !== prev.groceryImportConfirmedListId
      ) {
        importReminders();
      }
    });

    // The workhorse: said it to Siri, came back to the app.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') importReminders();
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
