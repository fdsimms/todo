import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Calendar as ReminderList, Reminder } from 'expo-calendar';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  draftFromReminder,
  findReminderList,
  importableReminders,
  isImportableList,
  pendingImportFor,
  reminderListOptions,
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
  reason,
});

/**
 * Every reminder this process has already turned into a task, whether or not
 * deleting it afterwards worked. Both halves matter, and for different reasons:
 *
 * - a *failed* delete leaves the reminder sitting there, so without this it
 *   would be re-imported on every single trigger, for ever;
 * - a *successful* delete is committed to EventKit asynchronously, so a fetch
 *   that lands immediately after one — which the replay below can cause — may
 *   still be handed a reminder we've already imported.
 *
 * Ids are never reused (a re-created reminder gets a new one), so nothing is
 * lost by remembering them. In-memory is the right scope: a fresh launch
 * retries a failed delete, since the usual cause is transient.
 */
const handledIds = new Set<string>();

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
 * fetchImportable with the drain itself so the number the confirmation names
 * is exactly the set that gets deleted — if they diverge the alert is a lie.
 *
 * Returns null when the list couldn't be read at all.
 */
export async function countImportableReminders(listId: string): Promise<number | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const reminders = await fetchImportable(listId);
    return reminders.length;
  } catch {
    return null;
  }
}

async function fetchImportable(listId: string): Promise<Reminder[]> {
  // `status` must be null. Passing ReminderStatus.INCOMPLETE makes the JS
  // wrapper throw without a date window, and the window it then demands is
  // matched against the *due date* — which a reminder dictated to Siri hasn't
  // got. See the header comment in remindersImport.ts.
  const reminders = await calendar().getRemindersAsync([listId], null, null, null);
  return importableReminders(reminders, handledIds);
}

/**
 * Reads the chosen Reminders list, turns each reminder into a task, and deletes
 * it. See the notes on ordering and isolation inside — this is the one thing in
 * the app that destroys data the user owns somewhere else.
 */
async function drainOnce(): Promise<ImportOutcome> {
  if (Platform.OS !== 'ios') return NOTHING('unsupported');

  const {
    remindersImportEnabled,
    remindersImportListId,
    remindersImportConfirmedListId,
    remindersImportReview,
  } = useSettingsStore.getState();

  if (!remindersImportEnabled) return NOTHING('off');
  // The confirmation names a count and a list, and it's keyed on the list id —
  // so switching list re-asks rather than silently swallowing a fresh backlog.
  if (!remindersImportListId || remindersImportConfirmedListId !== remindersImportListId) {
    return NOTHING('no-list');
  }
  if ((await getRemindersPermission()) !== 'granted') return NOTHING('no-permission');

  try {
    // Never pass an unvalidated id to getRemindersAsync. A stale one doesn't
    // hit the native "no ids means every list" branch, but it does reach
    // predicateForReminders(in: []) — undocumented territory whose downside, if
    // an empty array behaved like nil, is deleting every reminder on the
    // device. Cheap to rule out, not worth inferring.
    const lists = await calendar().getCalendarsAsync(calendar().EntityTypes.REMINDER);
    const list = findReminderList(lists, remindersImportListId);
    if (!list) return NOTHING('list-missing');
    // Permissions on a shared list can change after it was picked.
    if (!isImportableList(list)) return NOTHING('list-readonly');

    const reminders = await fetchImportable(remindersImportListId);
    if (reminders.length === 0) return NOTHING('ok');

    const { addTask } = useTaskStore.getState();
    let imported = 0;
    let deleteFailed = 0;

    // Sequential, never Promise.all: addTask derives sortOrder from max + 1
    // over the current array, so concurrency scrambles the order things were
    // dictated in, and one commit at a time bounds the damage if something goes
    // wrong at item 40 of 200.
    const now = new Date();
    for (const reminder of reminders) {
      const draft = draftFromReminder(reminder);
      if (!draft) continue;

      // Everything the reminder implies about scheduling. Pure and synchronous,
      // and done before the create so a parse that somehow threw could never
      // leave a deleted reminder behind — though it can't: the whole path is
      // string and date arithmetic over data already in hand.
      const pending = pendingImportFor(reminder, now);
      // With review on, the schedule waits beside the task as a suggestion and
      // the row stays bare enough for isInboxTask — a capture nobody has read
      // must not file itself onto Today. With review off the user has said
      // they trust the parse, so it applies on the way in.
      const scheduled = pending ? (remindersImportReview ? { pendingImport: pending } : pending) : null;

      // Create first, delete second, and never the other way round. A failed
      // delete leaves a duplicate — visible, understandable, fixable by hand. A
      // failed create *after* a delete destroys a capture with no trace and no
      // error anyone will ever see. addTask is synchronous runSync + a set, so
      // it has either thrown or committed by the time we get here; the delete
      // is async EventKit against an iCloud-backed store and can genuinely
      // fail. The reliable half goes first.
      addTask({ ...draft, ...scheduled });
      // Recorded the moment the task exists, before the delete is even
      // attempted — that's what makes it cover both failure modes above.
      handledIds.add(reminder.id!);
      imported += 1;

      try {
        await calendar().deleteReminderAsync(reminder.id!);
      } catch {
        // Isolated on purpose: one reminder in a strange state must not strand
        // the rest of the batch.
        deleteFailed += 1;
      }
    }

    return { imported, deleteFailed, reason: 'ok' };
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
// flight read the old one. It is only safe because handledIds is recorded at
// creation rather than at deletion; a replay re-fetches reminders the previous
// pass has already imported, and without that set it would import them twice.
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
    // missed, turning the feature on (which should feel immediate), and
    // switching list. Same subscribe-to-the-store call useDailyAgendaSync
    // makes, for the same reason — a handful of separate call sites would
    // eventually miss one.
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.remindersImportEnabled !== prev.remindersImportEnabled ||
        state.remindersImportListId !== prev.remindersImportListId ||
        state.remindersImportConfirmedListId !== prev.remindersImportConfirmedListId
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
