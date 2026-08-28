import { create } from 'zustand';
import type { FocusSession, FocusSessionRecord, Task } from '../types';
import {
  dbClearFocusSession,
  dbGetFocusSession,
  dbGetFocusSessionLog,
  dbInsertFocusSessionRecord,
  dbPruneFocusSessionLog,
  dbSaveFocusSession,
} from '../db/database';
import { generateId } from '../utils/id';
import { selectPurgeableFocusSessionIds } from '../utils/retention';
import {
  advanceFocusSession,
  buildFocusPlan,
  closeFocusSession,
  currentFocusStep,
  isFocusSessionFinished,
  pauseFocusSession,
  pruneFocusPlan,
  resumeFocusSession,
  type FocusPlanOptions,
} from '../utils/focusPlan';
import { cancelFocusStepAlarm, scheduleFocusStepAlarm } from '../utils/notifications';

/**
 * The one focus session in flight.
 *
 * Deliberately knows nothing about `useTaskStore`: every action that needs the
 * task list takes it as an argument. That's not squeamishness about coupling,
 * it's the import cycle — `useTaskStore.initialize` fans out to this store, so
 * an import back the other way would close the loop. It also makes the whole
 * store testable with plain task objects and no store to stand up.
 *
 * Completing a task is likewise not this store's job. The caller completes it
 * through `useTaskStore` as it would from anywhere else, then hands the fresh
 * list to `syncWithTasks`, which notices the task can no longer be worked and
 * takes its remaining stretches out of the plan. One mechanism covers
 * completing from inside the session, completing the same task from the Today
 * list while the session runs, and deleting it outright — three ways to reach
 * the same state, rather than three code paths that have to agree.
 */
interface FocusStore {
  session: FocusSession | null;
  /**
   * Finished sessions, most recent first — what Stats reads. Loaded once and
   * appended to as sessions end, rather than re-read on every render: the rows
   * only ever change when this store writes one.
   */
  history: FocusSessionRecord[];
  initialized: boolean;

  /** Load the stored session and reconcile it against the task list. */
  initialize: (tasks: readonly Task[]) => void;

  /**
   * Build a plan from `tasks`, in the order given, and start running it.
   * Replaces any session already in flight — there is only ever one.
   */
  startSession: (tasks: readonly Task[], options: FocusPlanOptions) => void;

  pause: () => void;
  resume: () => void;
  /** Move to the next step, whether or not the current one has run out. */
  advance: () => void;
  /** Give the current step more time, for when it's nearly there. */
  extendStep: (minutes: number) => void;
  /** Drop a task's remaining stretches without counting it as done. */
  skipTask: (taskId: string) => void;
  /**
   * Drop a quota task's remaining stretches, same as `skipTask`, but count it
   * toward the closing summary anyway — for a task that's on pace, where
   * there's nothing left to do right now rather than something left undone.
   */
  finishForNow: (taskId: string) => void;
  /** Reconcile the plan against the task list. Cheap, and safe to over-call. */
  syncWithTasks: (tasks: readonly Task[]) => void;
  /** End the session and forget it. */
  endSession: () => void;
  /**
   * Drop finished sessions that ended before `cutoff`, returning how many
   * went. Driven by the completed-task retention window — see
   * `purgeOldCompletedTasks`, which is the one caller.
   */
  purgeHistoryBefore: (cutoff: Date) => number;
}

/**
 * Write the session (or its absence) through to SQLite, then to state, then
 * fix up the step alarm.
 *
 * The alarm is rescheduled on *every* write rather than only on the writes
 * that obviously move the clock. Pausing, advancing, extending, pruning and
 * finishing all change when (or whether) the chime should land, and a
 * conditional list of which ones do is exactly the thing that goes stale as
 * actions are added. Scheduling is idempotent and identifier-keyed, so the
 * cost of the blanket call is one cancelled notification.
 */
function persist(session: FocusSession | null, set: (s: { session: FocusSession | null }) => void): void {
  if (session === null) dbClearFocusSession();
  else dbSaveFocusSession(session);
  set({ session });
  void scheduleFocusStepAlarm(session);
}

/**
 * Write a session that is going away into the history log, if it amounted to
 * anything (see `closeFocusSession`).
 *
 * Both ways a session ends come through here — the user ending it, and a new
 * one replacing it — because "start a session, work for an hour, start another
 * without ending the first" is an ordinary thing to do and the hour is real
 * either way. Deliberately *not* folded into `persist`: that runs on every
 * tick, and a log written from there would need to know why it was called.
 */
function logFinishedSession(
  session: FocusSession | null,
  set: (s: { history: FocusSessionRecord[] }) => void,
  history: readonly FocusSessionRecord[],
): void {
  if (!session) return;
  const record = closeFocusSession(session);
  if (!record) return;
  dbInsertFocusSessionRecord(record);
  // Prepended rather than re-read: the table is ordered by end date descending
  // and this row is the newest there is. Filtered by id first so a session
  // somehow closed twice replaces its row here the same way INSERT OR REPLACE
  // does in SQLite, rather than showing up as two sessions.
  set({ history: [record, ...history.filter(r => r.id !== record.id)] });
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  session: null,
  history: [],
  initialized: false,

  initialize(tasks) {
    const stored = dbGetFocusSession();
    set({ session: stored, history: dbGetFocusSessionLog(), initialized: true });
    if (stored === null) {
      void cancelFocusStepAlarm();
      return;
    }
    // Reconciled rather than trusted: the app may have been shut for a day,
    // and the tasks it was pointing at completed or deleted from anywhere.
    get().syncWithTasks(tasks);
    // syncWithTasks only writes when something changed, so a session that came
    // back intact still needs its alarm put back — the pending notification
    // did not survive whatever ended the last run.
    if (get().session === stored) void scheduleFocusStepAlarm(stored);
  },

  startSession(tasks, options) {
    const steps = buildFocusPlan([...tasks], options);
    // Before the empty-plan bail: a start that produces no plan changes
    // nothing, so the session already in flight is still in flight and must
    // not be logged as finished.
    if (steps.length === 0) return;
    logFinishedSession(get().session, set, get().history);
    persist({
      id: generateId(),
      startedAt: new Date().toISOString(),
      steps,
      stepIndex: 0,
      // Starts running. The setup sheet is the deliberate step before this, so
      // landing in a paused session would be one more tap to do what the user
      // just said they wanted.
      stepStartedAt: new Date().toISOString(),
      stepElapsedSeconds: 0,
      completedTaskIds: [],
      stepLog: [],
    }, set);
  },

  pause() {
    const { session } = get();
    if (!session) return;
    const next = pauseFocusSession(session);
    if (next !== session) persist(next, set);
  },

  resume() {
    const { session } = get();
    if (!session) return;
    const next = resumeFocusSession(session);
    if (next !== session) persist(next, set);
  },

  advance() {
    const { session } = get();
    if (!session) return;
    const next = advanceFocusSession(session);
    if (next !== session) persist(next, set);
  },

  extendStep(minutes) {
    const { session } = get();
    if (!session || minutes <= 0) return;
    const step = currentFocusStep(session);
    if (!step) return;
    const steps = session.steps.map((s, i) =>
      i === session.stepIndex ? { ...s, minutes: s.minutes + minutes } : s
    );
    persist({ ...session, steps }, set);
  },

  skipTask(taskId) {
    const { session } = get();
    if (!session) return;
    // Skipped, not finished: nothing is added to completedTaskIds, so the
    // closing summary counts what actually got done.
    const next = pruneFocusPlan(session, id => id === taskId);
    if (next !== session) persist(next, set);
  },

  finishForNow(taskId) {
    const { session } = get();
    if (!session) return;
    const next = pruneFocusPlan(session, id => id === taskId);
    if (next === session) return;
    persist({ ...next, completedTaskIds: [...next.completedTaskIds, taskId] }, set);
  },

  syncWithTasks(tasks) {
    const { session } = get();
    if (!session || isFocusSessionFinished(session)) return;

    const byId = new Map(tasks.map(t => [t.id, t]));
    const doneIds = new Set<string>();
    const isGone = (taskId: string): boolean => {
      const task = byId.get(taskId);
      // A task that vanished from the list was deleted; one that's completed
      // or archived is finished with, either way. Only completion counts
      // toward the summary — a deleted task was not an achievement.
      if (!task) return true;
      if (task.completed) {
        doneIds.add(taskId);
        return true;
      }
      return task.archived;
    };

    const pruned = pruneFocusPlan(session, isGone);
    const newlyDone = [...doneIds].filter(id => !session.completedTaskIds.includes(id));
    if (pruned === session && newlyDone.length === 0) return;

    persist({ ...pruned, completedTaskIds: [...pruned.completedTaskIds, ...newlyDone] }, set);
  },

  endSession() {
    logFinishedSession(get().session, set, get().history);
    persist(null, set);
  },

  purgeHistoryBefore(cutoff) {
    const doomed = new Set(selectPurgeableFocusSessionIds(get().history, cutoff));
    if (doomed.size === 0) return 0;
    // The delete is by date rather than by the ids just collected: this store's
    // copy is what was loaded at launch, and a session logged by another device
    // and synced in since is equally out of the window. The in-memory filter
    // then only has to agree about the rows it can see.
    dbPruneFocusSessionLog(cutoff.toISOString());
    set({ history: get().history.filter(r => !doomed.has(r.id)) });
    return doomed.size;
  },
}));
