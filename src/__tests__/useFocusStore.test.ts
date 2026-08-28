/**
 * Tests for src/store/useFocusStore.ts — the session in flight.
 *
 * The database and the step alarm are mocked; what's under test is the store's
 * own rules, and above all `syncWithTasks`, which is the single mechanism
 * behind completing a task from inside the session, completing it from the
 * task list while the session runs, and deleting it outright.
 */

import type { FocusSession, FocusSessionRecord, Task } from '../types';
import type { FocusPlanOptions } from '../utils/focusPlan';

const mockDb = {
  session: null as FocusSession | null,
  log: [] as FocusSessionRecord[],
};

jest.mock('../db/database', () => ({
  dbGetFocusSession: jest.fn(() => mockDb.session),
  dbSaveFocusSession: jest.fn((s: FocusSession) => { mockDb.session = s; }),
  dbClearFocusSession: jest.fn(() => { mockDb.session = null; }),
  dbGetFocusSessionLog: jest.fn(() => mockDb.log),
  dbPruneFocusSessionLog: jest.fn((cutoffIso: string) => {
    const before = mockDb.log.length;
    mockDb.log = mockDb.log.filter(r => r.endedAt >= cutoffIso);
    return before - mockDb.log.length;
  }),
  dbInsertFocusSessionRecord: jest.fn((r: FocusSessionRecord) => {
    mockDb.log = [r, ...mockDb.log.filter(existing => existing.id !== r.id)];
  }),
}));

const mockScheduleAlarm = jest.fn().mockResolvedValue(undefined);
const mockCancelAlarm = jest.fn().mockResolvedValue(undefined);

jest.mock('../utils/notifications', () => ({
  scheduleFocusStepAlarm: (...args: unknown[]) => mockScheduleAlarm(...args),
  cancelFocusStepAlarm: (...args: unknown[]) => mockCancelAlarm(...args),
}));

import { useFocusStore } from '../store/useFocusStore';
import { currentFocusStep, isFocusRunning, isFocusSessionFinished } from '../utils/focusPlan';
import { dbSaveFocusSession, dbPruneFocusSessionLog } from '../db/database';

const OPTIONS: FocusPlanOptions = {
  workCapMinutes: 25,
  defaultWorkMinutes: 25,
  restAfterTasks: null,
  restAfterMinutes: 25,
  restMinutes: 5,
  longRestEvery: 4,
  longRestMinutes: 15,
};

/** Only the fields the store and the plan builder actually read. */
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: id,
  estimatedMinutes: 25,
  effort: 0,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  completed: false,
  archived: false,
  ...over,
} as unknown as Task);

const state = () => useFocusStore.getState();
const live = (): FocusSession => {
  const { session } = state();
  if (!session) throw new Error('expected a session');
  return session;
};

beforeEach(() => {
  mockDb.session = null;
  mockDb.log = [];
  useFocusStore.setState({ session: null, history: [], initialized: false });
  mockScheduleAlarm.mockClear();
  mockCancelAlarm.mockClear();
  (dbSaveFocusSession as jest.Mock).mockClear();
  (dbPruneFocusSessionLog as jest.Mock).mockClear();
});

describe('startSession', () => {
  it('builds a plan, writes it, and starts it running', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    const session = live();
    expect(session.steps.map(s => s.taskId)).toEqual(['a', null, 'b']);
    expect(session.stepIndex).toBe(0);
    expect(isFocusRunning(session)).toBe(true);
    expect(dbSaveFocusSession).toHaveBeenCalledWith(session);
  });

  it('replaces a session already in flight — there is only ever one', () => {
    state().startSession([task('a')], OPTIONS);
    const first = live().id;
    state().startSession([task('b')], OPTIONS);
    expect(live().id).not.toBe(first);
    expect(live().steps.map(s => s.taskId)).toEqual(['b']);
  });

  it('does nothing at all for an empty queue', () => {
    state().startSession([], OPTIONS);
    expect(state().session).toBeNull();
    expect(dbSaveFocusSession).not.toHaveBeenCalled();
  });

  it('schedules the step alarm on the way out', () => {
    state().startSession([task('a')], OPTIONS);
    expect(mockScheduleAlarm).toHaveBeenCalledWith(live());
  });
});

describe('pause, resume and advance', () => {
  beforeEach(() => state().startSession([task('a'), task('b')], OPTIONS));

  it('pauses and resumes the clock', () => {
    state().pause();
    expect(isFocusRunning(live())).toBe(false);
    state().resume();
    expect(isFocusRunning(live())).toBe(true);
  });

  it('writes nothing for a pause that changes nothing', () => {
    state().pause();
    (dbSaveFocusSession as jest.Mock).mockClear();
    state().pause();
    expect(dbSaveFocusSession).not.toHaveBeenCalled();
  });

  it('advances one step at a time and finishes at the end', () => {
    expect(currentFocusStep(live())?.taskId).toBe('a');
    state().advance();
    expect(currentFocusStep(live())?.kind).toBe('rest');
    state().advance();
    expect(currentFocusStep(live())?.taskId).toBe('b');
    state().advance();
    expect(isFocusSessionFinished(live())).toBe(true);
  });

  it('reschedules the alarm on every move, including the one that finishes', () => {
    state().advance();
    state().advance();
    state().advance();
    expect(mockScheduleAlarm).toHaveBeenLastCalledWith(live());
  });
});

describe('extendStep', () => {
  it('adds time to the current step only', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    state().extendStep(5);
    expect(live().steps.map(s => s.minutes)).toEqual([30, 5, 25]);
  });

  it('ignores a non-positive extension', () => {
    state().startSession([task('a')], OPTIONS);
    state().extendStep(0);
    expect(live().steps[0].minutes).toBe(25);
  });

  it('does nothing once the plan is finished', () => {
    state().startSession([task('a')], OPTIONS);
    state().advance();
    state().extendStep(5);
    expect(live().steps[0].minutes).toBe(25);
  });
});

describe('syncWithTasks', () => {
  it('drops a completed task’s stretches and counts it toward the summary', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    state().syncWithTasks([task('a', { completed: true }), task('b')]);

    expect(live().completedTaskIds).toEqual(['a']);
    // The break 'a' earned survives; its work does not.
    expect(live().steps.map(s => s.taskId)).toEqual([null, 'b']);
    expect(currentFocusStep(live())?.kind).toBe('rest');
  });

  it('drops a deleted task without crediting it as done', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    state().syncWithTasks([task('b')]);

    expect(live().completedTaskIds).toEqual([]);
    expect(live().steps.map(s => s.taskId)).toEqual([null, 'b']);
  });

  it('treats an archived task as gone, and not as done', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    state().syncWithTasks([task('a', { archived: true }), task('b')]);

    expect(live().completedTaskIds).toEqual([]);
    expect(live().steps.map(s => s.taskId)).toEqual([null, 'b']);
  });

  it('writes nothing when every task is still workable', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    (dbSaveFocusSession as jest.Mock).mockClear();
    state().syncWithTasks([task('a'), task('b')]);
    expect(dbSaveFocusSession).not.toHaveBeenCalled();
  });

  it('does not credit the same task twice across repeated syncs', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    const done = [task('a', { completed: true }), task('b')];
    state().syncWithTasks(done);
    state().syncWithTasks(done);
    expect(live().completedTaskIds).toEqual(['a']);
  });

  it('finishes the session when the last of the work goes', () => {
    state().startSession([task('a')], OPTIONS);
    state().syncWithTasks([task('a', { completed: true })]);
    expect(isFocusSessionFinished(live())).toBe(true);
    expect(live().completedTaskIds).toEqual(['a']);
  });

  it('leaves a finished session alone', () => {
    state().startSession([task('a')], OPTIONS);
    state().advance();
    (dbSaveFocusSession as jest.Mock).mockClear();
    state().syncWithTasks([]);
    expect(dbSaveFocusSession).not.toHaveBeenCalled();
  });
});

describe('skipTask', () => {
  it('drops a task without counting it as done', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    state().skipTask('a');
    expect(live().completedTaskIds).toEqual([]);
    expect(live().steps.map(s => s.taskId)).toEqual([null, 'b']);
  });

  it('ignores a task that is not in the plan', () => {
    state().startSession([task('a')], OPTIONS);
    (dbSaveFocusSession as jest.Mock).mockClear();
    state().skipTask('nope');
    expect(dbSaveFocusSession).not.toHaveBeenCalled();
  });
});

describe('finishForNow', () => {
  it('drops a task and counts it toward the summary anyway', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    state().finishForNow('a');
    expect(live().completedTaskIds).toEqual(['a']);
    expect(live().steps.map(s => s.taskId)).toEqual([null, 'b']);
  });

  it('ignores a task that is not in the plan', () => {
    state().startSession([task('a')], OPTIONS);
    (dbSaveFocusSession as jest.Mock).mockClear();
    state().finishForNow('nope');
    expect(dbSaveFocusSession).not.toHaveBeenCalled();
  });
});

describe('initialize', () => {
  it('picks a stored session back up and puts its alarm back', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    const stored = live();
    useFocusStore.setState({ session: null, initialized: false });
    mockScheduleAlarm.mockClear();

    state().initialize([task('a'), task('b')]);
    expect(live().id).toBe(stored.id);
    expect(mockScheduleAlarm).toHaveBeenCalledWith(stored);
  });

  it('reconciles against the tasks it comes back to', () => {
    state().startSession([task('a'), task('b')], OPTIONS);
    useFocusStore.setState({ session: null, initialized: false });

    // 'a' was completed from the task list while the app was shut.
    state().initialize([task('a', { completed: true }), task('b')]);
    expect(live().completedTaskIds).toEqual(['a']);
    expect(live().steps.map(s => s.taskId)).toEqual([null, 'b']);
  });

  it('cancels a stale alarm when there is no stored session', () => {
    state().initialize([task('a')]);
    expect(state().session).toBeNull();
    expect(state().initialized).toBe(true);
    expect(mockCancelAlarm).toHaveBeenCalled();
  });
});

describe('endSession', () => {
  it('clears the row and the alarm', () => {
    state().startSession([task('a')], OPTIONS);
    state().endSession();
    expect(state().session).toBeNull();
    expect(mockDb.session).toBeNull();
    expect(mockScheduleAlarm).toHaveBeenLastCalledWith(null);
  });
});

describe('session history', () => {
  /**
   * Puts real time on the current step, since the log deliberately refuses a
   * session too short to be one (see MIN_LOGGED_SESSION_SECONDS).
   */
  const runCurrentStepFor = (seconds: number) => {
    const session = live();
    useFocusStore.setState({
      session: { ...session, stepStartedAt: null, stepElapsedSeconds: seconds },
    });
  };

  it('loads what is already logged on initialize', () => {
    mockDb.log = [{
      id: 'old', startedAt: 'x', endedAt: 'y', workedSeconds: 600, restedSeconds: 0,
      plannedWorkMinutes: 10, steps: [], completedTaskIds: [],
    }];
    state().initialize([]);
    expect(state().history.map(r => r.id)).toEqual(['old']);
  });

  it('logs a session when it ends, newest first', () => {
    state().startSession([task('a')], OPTIONS);
    const id = live().id;
    runCurrentStepFor(20 * 60);
    state().endSession();

    expect(state().session).toBeNull();
    expect(state().history.map(r => r.id)).toEqual([id]);
    expect(state().history[0].workedSeconds).toBe(1200);
  });

  it('logs the session a new one replaces, so an hour of work is not lost', () => {
    state().startSession([task('a')], OPTIONS);
    const first = live().id;
    runCurrentStepFor(45 * 60);
    state().startSession([task('b')], OPTIONS);

    expect(state().history.map(r => r.id)).toEqual([first]);
    expect(live().id).not.toBe(first);
  });

  it('does not log the session in flight when a start produces no plan', () => {
    state().startSession([task('a')], OPTIONS);
    runCurrentStepFor(45 * 60);
    state().startSession([], OPTIONS);

    // Nothing changed, so nothing finished — the session is still running.
    expect(state().history).toEqual([]);
    expect(state().session).not.toBeNull();
  });

  it('writes nothing for a session ended before it amounted to anything', () => {
    state().startSession([task('a')], OPTIONS);
    runCurrentStepFor(4);
    state().endSession();

    expect(state().history).toEqual([]);
    expect(state().session).toBeNull();
  });

  it('ending with no session at all is a no-op rather than a null row', () => {
    state().endSession();
    expect(state().history).toEqual([]);
  });

  it('keeps one row for a session somehow closed twice', () => {
    state().startSession([task('a')], OPTIONS);
    const session = live();
    runCurrentStepFor(20 * 60);
    state().endSession();
    // The same session restored and ended again, as a relaunch could.
    useFocusStore.setState({ session });
    state().endSession();

    expect(state().history.filter(r => r.id === session.id)).toHaveLength(1);
  });
});

describe('purgeHistoryBefore', () => {
  const record = (id: string, endedAt: string): FocusSessionRecord => ({
    id, startedAt: endedAt, endedAt, workedSeconds: 600, restedSeconds: 0,
    plannedWorkMinutes: 10, steps: [], completedTaskIds: [],
  });

  const seed = () => {
    mockDb.log = [
      record('old', new Date(2026, 6, 1, 10).toISOString()),
      record('recent', new Date(2026, 7, 25, 10).toISOString()),
    ];
    state().initialize([]);
  };

  it('drops what is outside the window from both the log and the store', () => {
    seed();
    expect(state().purgeHistoryBefore(new Date(2026, 7, 20))).toBe(1);
    expect(state().history.map(r => r.id)).toEqual(['recent']);
    expect(mockDb.log.map(r => r.id)).toEqual(['recent']);
  });

  it('writes nothing when everything is inside the window', () => {
    seed();
    expect(state().purgeHistoryBefore(new Date(2020, 0, 1))).toBe(0);
    expect(state().history).toHaveLength(2);
    expect(dbPruneFocusSessionLog).not.toHaveBeenCalled();
  });

  it('deletes by date rather than by the ids it happened to load', () => {
    // The store's copy is what was read at launch; a session synced in from
    // another device since is equally out of the window, so the SQL is what
    // decides. Asserted through the argument, since this store cannot see a
    // row it never loaded.
    seed();
    const cutoff = new Date(2026, 7, 20);
    state().purgeHistoryBefore(cutoff);
    expect(dbPruneFocusSessionLog).toHaveBeenCalledWith(cutoff.toISOString());
  });
});
