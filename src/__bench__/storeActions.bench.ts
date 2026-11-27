/**
 * What one tap costs in the task store, over a database the size of a phone in
 * long use. Run with `npm run bench`; like the selector benchmark beside it,
 * it is deliberately not part of `npm test`.
 *
 * Unlike that one, this runs the real store over a real SQLite (better-sqlite3
 * standing in for expo-sqlite, as `useDemoStore.test.ts` does), because what a
 * tap costs is everything the action does on the way: the row write, the
 * passes over the task array, the notifications it sends every subscriber, and
 * the selectors the screen re-runs afterwards. Each line reports the action's
 * own time, how many store notifications it sent (each one runs every mounted
 * selector), and the time to re-run Today's selectors after it.
 *
 * Numbers are for comparing two checkouts on the same machine, not for
 * predicting a phone: Hermes on a device is slower than Node, the database is
 * in memory (so a commit costs nothing, where a phone appends to the WAL once
 * per transaction), and the native bridges (notifications, calendar, widget)
 * are stubbed out here.
 */
import { benchBaseTask } from './benchTask';
import type { Task } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDb: any = null;

jest.mock('../utils/checkInRecording', () => ({ cancelCheckInFor: jest.fn() }));
jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  const raw = () => {
    if (!mockDb) mockDb = new BS(':memory:');
    return mockDb;
  };
  // Compiled on every call, as expo-sqlite's runSync, getAllSync and
  // getFirstSync do (prepare, run, finalize: it keeps no statement cache), so
  // a write's cost here includes what it costs on a phone to prepare it.
  const stmt = (sql: string) => raw().prepare(sql);
  return {
    openDatabaseSync: () => ({
      execSync(sql: string) { raw().exec(sql); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) { stmt(sql).run(...params); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] { return stmt(sql).all(...params) as T[]; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null { return (stmt(sql).get(...params) as T) ?? null; },
      withTransactionSync(fn: () => void) { raw().transaction(fn)(); },
      closeSync() {},
    }),
    deleteDatabaseSync: () => {},
  };
});

jest.mock('../utils/notifications', () => ({
  rescheduleAllPlaceReminders: jest.fn(() => Promise.resolve()),
  scheduleTaskReminder: jest.fn(),
  scheduleFastGoal: jest.fn(() => Promise.resolve()),
  cancelFastGoal: jest.fn(() => Promise.resolve()),
  cancelTaskReminder: jest.fn(),
  scheduleQuotaNudges: jest.fn(),
  cancelQuotaNudges: jest.fn(),
  rescheduleAllReminders: jest.fn(),
  scheduleFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  scheduleFocusMeetingHeadsUp: jest.fn().mockResolvedValue(undefined),
  cancelFocusMeetingHeadsUp: jest.fn().mockResolvedValue(undefined),
  scheduleTripReminder: jest.fn(),
  cancelTripReminder: jest.fn(),
  scheduleStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelStepAlarm: jest.fn().mockResolvedValue(undefined),
  scheduleCompletionTimer: jest.fn().mockResolvedValue(undefined),
  cancelCompletionTimer: jest.fn().mockResolvedValue(undefined),
  cancelTimerAlarm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/alarmSoundDevice', () => ({
  pickSoundFile: jest.fn().mockResolvedValue({ status: 'canceled' }),
  installImportedSound: jest.fn().mockResolvedValue(false),
  removeImportedSound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/alarmSchedule', () => ({
  syncAlarmToDevice: jest.fn().mockResolvedValue(false),
  removeAlarmFromDevice: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/calendarSync', () => ({
  deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/deadlineCalendarSync', () => ({
  syncDeadlineEvent: jest.fn().mockResolvedValue({ eventId: null, externalId: null }),
}));
jest.mock('../store/useCalendarStore', () => ({
  useCalendarStore: { getState: () => ({ events: [], pastEvents: [], gridEvents: [], loaded: false }), subscribe: jest.fn() },
}));
jest.mock('../store/useWeatherStore', () => ({
  useWeatherStore: { getState: () => ({ snapshot: null, snapshotDayKey: null, refreshing: false }) },
}));
jest.mock('../store/useScreenTimeStore', () => ({
  useScreenTimeStore: { getState: () => ({ crossings: [], refreshing: false, consume: () => {} }) },
}));
jest.mock('../store/useHealthStore', () => ({
  useHealthStore: { getState: () => ({ today: null, history: null, refreshing: false }) },
}));
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => null,
  isHealthSupported: () => false,
}));

import { dbInsertTask, dbTransaction, initDatabase } from '../db/database';
import { useTaskStore } from '../store/useTaskStore';
import { getCurrentDayStart } from '../utils/dateUtils';

const TASK_COUNT = Number(process.env.BENCH_TASKS ?? 8000);
// Open rows out of TASK_COUNT. The default is a list in long use with history
// kept forever: a few hundred open tasks over thousands of finished ones.
const OPEN_COUNT = Number(process.env.BENCH_OPEN ?? 400);
const ITERATIONS = Number(process.env.BENCH_RUNS ?? 30);
const CATEGORIES = ['Home', 'Work', 'Health', 'Errands', 'Finance'];

const day = (offset: number) => {
  const d = new Date(getCurrentDayStart());
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

/**
 * Finished history first, then the open rows spread over every list. The
 * measurements act on the first rows of each open kind, so their ids are
 * fixed: `one-<n>` a one-off due today, `daily-<n>` a daily repeat due today,
 * `later-<n>` deferred, and `sub-<n>` a subtask of `one-<n>`.
 */
function buildTasks(count: number, open: number): Task[] {
  const tasks: Task[] = [];
  const counters = { one: 0, daily: 0, later: 0 };
  for (let i = 0; i < count; i++) {
    const base: Task = {
      ...benchBaseTask,
      id: `t${i}`,
      title: `Task ${i}`,
      sortOrder: i,
      category: CATEGORIES[i % CATEGORIES.length],
      createdAt: day(-(i % 400)),
      tags: i % 4 === 0 ? ['home'] : [],
    };
    if (i < count - open) {
      tasks.push({ ...base, completed: true, completedAt: day(-1 - (i % 300)), dueDate: day(-1 - (i % 300)) });
    } else if (i % 4 === 0) {
      tasks.push({ ...base, id: `one-${counters.one++}`, dueDate: day(0) });
    } else if (i % 4 === 1) {
      tasks.push({ ...base, id: `daily-${counters.daily++}`, dueDate: day(0), recurrenceType: 'daily' });
    } else if (i % 4 === 2) {
      tasks.push({ ...base, id: `later-${counters.later++}`, dueDate: day(3 + (i % 20)), deferUntil: day(1 + (i % 5)) });
    } else {
      tasks.push({ ...base, dueDate: null });
    }
  }
  for (let n = 0; n < ITERATIONS * 2; n++) {
    tasks.push({ ...benchBaseTask, id: `sub-${n}`, title: `Step ${n}`, parentId: `one-${n}`, sortOrder: n });
  }
  return tasks;
}

interface Result { name: string; median: number; p95: number; sets: number; reread: number }
const results: Result[] = [];

const median = (times: number[]) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
const p95 = (times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

/** Today's own reads after a write: the lists its four sub-views and its header are built from. */
function rereadLists(): void {
  const s = useTaskStore.getState();
  s.visibleTasks();
  s.deferredTasks();
  s.unscheduledTasks();
  s.inboxTasks();
  s.pinnedTasks();
}

/** Times `act(n)` for n in 0..ITERATIONS-1, each on a row no earlier run touched. */
function bench(name: string, act: (n: number) => void): void {
  const times: number[] = [];
  const rereads: number[] = [];
  let sets = 0;
  const unsubscribe = useTaskStore.subscribe(() => { sets += 1; });
  for (let n = 0; n < ITERATIONS; n++) {
    rereadLists();
    const start = performance.now();
    act(n);
    const mid = performance.now();
    rereadLists();
    times.push(mid - start);
    rereads.push(performance.now() - mid);
  }
  unsubscribe();
  results.push({ name, median: median(times), p95: p95(times), sets: sets / ITERATIONS, reread: median(rereads) });
}

it('measures the task store actions a tap runs', () => {
  initDatabase();
  const seed = buildTasks(TASK_COUNT, Math.max(OPEN_COUNT, ITERATIONS * 8));
  dbTransaction(() => seed.forEach(dbInsertTask));
  useTaskStore.getState().initialize();
  const store = () => useTaskStore.getState();
  expect(store().tasks.length).toBe(seed.length);

  bench('completeTask, one-off', n => { store().completeTask(`one-${n}`); });
  bench('uncompleteTask, one-off', n => { store().uncompleteTask(`one-${n}`); });
  bench('completeTask, daily repeat (spawns the next)', n => { store().completeTask(`daily-${n}`); });
  bench('uncompleteTask, daily repeat (removes the next)', n => { store().uncompleteTask(`daily-${n}`); });
  bench('updateTask, title', n => { store().updateTask(`one-${n}`, { title: `Renamed ${n}` }); });
  bench('updateTask, due date', n => { store().updateTask(`one-${n}`, { dueDate: day(2) }); });
  bench('deferTask', n => { store().deferTask(`daily-${n}`, new Date(day(1))); });
  bench('toggleSubtask', n => { store().toggleSubtask(`sub-${n}`); });
  bench('togglePin', n => { store().togglePin(`later-${n}`); });
  bench('addTask', n => { store().addTask({ title: `New ${n}`, category: 'Home', dueDate: day(0) }); });
  bench('deleteTask', n => { store().deleteTask(`later-${n}`); });

  const open = seed.filter(t => !t.completed).length;
  const header = `\nBenchmark: task store over ${seed.length} rows (${open} open), ${ITERATIONS} runs each, times in ms\n` +
    `  ${''.padEnd(50)} ${'median'.padStart(8)} ${'p95'.padStart(8)} ${'sets'.padStart(6)} ${'re-read'.padStart(8)}\n`;
  const rows = results.map(r =>
    `  ${r.name.padEnd(50)} ${r.median.toFixed(2).padStart(8)} ${r.p95.toFixed(2).padStart(8)} ${r.sets.toFixed(1).padStart(6)} ${r.reread.toFixed(2).padStart(8)}`);
  process.stdout.write(`${header}${rows.join('\n')}\n\n`);

  expect(results.every(r => Number.isFinite(r.median))).toBe(true);
}, 300000);
