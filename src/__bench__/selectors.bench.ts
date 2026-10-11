/**
 * How long the hot list work takes over a task list the size of a phone in
 * long use. Run with `npm run bench`; it is deliberately not part of `npm test`
 * (timings are too noisy to gate on, and it takes a few seconds).
 *
 * It runs the same filter chains the store selectors do (`visibleTasks`,
 * `deferredTasks`, `expiredTasks`: openTasksOf, then the visibility gate, then
 * the sort) and the search, rather than the store itself, which needs a few
 * hundred lines of mocks to stand up. If a selector's body changes, change it
 * here too. Numbers are for comparing two checkouts on the same machine, not
 * for predicting a phone: Hermes on a device is slower than Node.
 */
import { benchBaseTask } from './benchTask';
import { openTasksOf } from '../utils/openTasks';
import { isTaskVisible, isTaskDeferred, isTaskExpired } from '../utils/visibilityUtils';
import { fuzzySearch } from '../utils/fuzzySearch';
import { getCurrentDayStart } from '../utils/dateUtils';
import type { Task } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  weekStartsOn: 1,
  vacationMode: false,
  sunLocation: null as { latitude: number; longitude: number } | null,
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ categories: [], getCategoryByName: () => null }),
  },
}));

const TASK_COUNT = Number(process.env.BENCH_TASKS ?? 5000);
const ITERATIONS = 30;
const WARMUP = 5;

const WORDS = ['groceries', 'call', 'plumber', 'invoice', 'dentist', 'laundry', 'report', 'gym', 'water', 'plants'];

/** A deterministic spread: mostly finished history, the rest across every state a gate cares about. */
function buildTasks(count: number): Task[] {
  const today = getCurrentDayStart();
  const day = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  const tasks: Task[] = [];
  for (let i = 0; i < count; i++) {
    const word = WORDS[i % WORDS.length];
    const base: Task = {
      ...benchBaseTask,
      id: `t${i}`,
      title: `${word} ${i}`,
      notes: i % 3 === 0 ? `Remember to ${word} before the end of the week, see the thread` : '',
      sortOrder: i,
      createdAt: day(-(i % 400)),
      tags: i % 4 === 0 ? ['home'] : [],
    };
    if (i % 10 < 6) {
      tasks.push({ ...base, completed: true, completedAt: day(-1 - (i % 300)), dueDate: day(-1 - (i % 300)) });
      continue;
    }
    switch (i % 10) {
      case 6: tasks.push({ ...base, dueDate: day(0) }); break;
      case 7: tasks.push({ ...base, dueDate: day(-2) }); break;
      case 8: tasks.push({ ...base, dueDate: day(3 + (i % 20)), deferUntil: day(1 + (i % 5)) }); break;
      default: tasks.push({ ...base, dueDate: day(0), recurrenceType: 'daily', windowStart: '09:00', windowEnd: '23:00' });
    }
  }
  // A tenth of the open rows are subtasks, as in a list in real use.
  return tasks.map((t, i) => (i % 10 === 5 ? { ...t, parentId: `t${i - 1}` } : t));
}

interface Result { name: string; median: number; p95: number }
const results: Result[] = [];

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < WARMUP; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({
    name,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
  });
}

it('measures the list selectors and search', () => {
  const tasks = buildTasks(TASK_COUNT);
  const bySort = (a: Task, b: Task) => a.sortOrder - b.sortOrder;

  bench('visibleTasks (open rows, visibility gate, sort)', () =>
    openTasksOf(tasks).filter(t => !t.parentId && isTaskVisible(t)).sort(bySort));
  bench('deferredTasks', () =>
    openTasksOf(tasks).filter(t => !t.parentId && isTaskDeferred(t)).sort(bySort));
  bench('expiredTasks', () =>
    openTasksOf(tasks).filter(t => !t.parentId && isTaskExpired(t)).sort(bySort));
  bench('getCurrentDayStart x10,000', () => {
    for (let i = 0; i < 10000; i++) getCurrentDayStart();
  });
  bench('fuzzySearch, one word', () => fuzzySearch(tasks, 'plumber'));
  bench('fuzzySearch, two words', () => fuzzySearch(tasks, 'call dentist'));

  const open = openTasksOf(tasks).length;
  const header = `\nBenchmark: ${tasks.length} tasks (${open} open), ${ITERATIONS} runs each, times in ms\n`;
  const rows = results.map(r =>
    `  ${r.name.padEnd(54)} median ${r.median.toFixed(2).padStart(8)}   p95 ${r.p95.toFixed(2).padStart(8)}`);
  process.stdout.write(`${header}${rows.join('\n')}\n\n`);

  expect(results.every(r => Number.isFinite(r.median))).toBe(true);
}, 120000);
