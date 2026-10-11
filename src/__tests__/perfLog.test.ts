import {
  PERF_ENTRY_LIMIT,
  PERF_RUN_LIMIT,
  appendRun,
  currentEntries,
  formatPerfReport,
  markMilestone,
  parseRuns,
  recordTiming,
  resetPerfLog,
  takeEntries,
  timed,
  type PerfRun,
} from '../utils/perfLog';
import { runStartupStep } from '../utils/startup';

beforeEach(() => {
  resetPerfLog();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const run = (n: number): PerfRun => ({
  at: `2026-10-0${n}T09:00:00.000Z`,
  kind: 'launch',
  entries: [{ name: 'initialize tasks', ms: 100 * n }],
});

describe('recording', () => {
  it('keeps a step under its name, rounded to a tenth of a millisecond', () => {
    recordTiming('load settings', 12.3456);
    expect(currentEntries()).toEqual([{ name: 'load settings', ms: 12.3 }]);
  });

  it('marks a moment as a mark rather than a duration', () => {
    markMilestone('splash can hide');
    const [entry] = currentEntries();
    expect(entry.name).toBe('splash can hide');
    expect(entry.mark).toBe(true);
  });

  it('times a function and hands back its result', () => {
    expect(timed('work', () => 7)).toBe(7);
    expect(currentEntries()).toHaveLength(1);
    expect(currentEntries()[0].name).toBe('work');
  });

  it('still records a function that throws, and lets the error through', () => {
    expect(() => timed('boom', () => { throw new Error('x'); })).toThrow('x');
    expect(currentEntries().map(e => e.name)).toEqual(['boom']);
  });

  it('stops growing at the entry limit', () => {
    for (let i = 0; i < PERF_ENTRY_LIMIT + 20; i++) recordTiming(`s${i}`, 1);
    expect(currentEntries()).toHaveLength(PERF_ENTRY_LIMIT);
  });

  it('hands back what it has and starts over', () => {
    recordTiming('a', 1);
    expect(takeEntries()).toHaveLength(1);
    expect(currentEntries()).toHaveLength(0);
  });
});

describe('runStartupStep', () => {
  it('records how long a launch step took, under its own name', () => {
    expect(runStartupStep('load settings', () => {})).toBe(true);
    expect(currentEntries().map(e => e.name)).toEqual(['load settings']);
  });

  it('records a step that failed, and still reports the failure', () => {
    expect(runStartupStep('bad pass', () => { throw new Error('nope'); })).toBe(false);
    expect(currentEntries().map(e => e.name)).toEqual(['bad pass']);
  });
});

describe('runs', () => {
  it('keeps only the newest runs', () => {
    let runs: PerfRun[] = [];
    for (let n = 1; n <= PERF_RUN_LIMIT + 2; n++) runs = appendRun(runs, run(n));
    expect(runs).toHaveLength(PERF_RUN_LIMIT);
    expect(runs[runs.length - 1].at).toContain(`0${PERF_RUN_LIMIT + 2}`);
  });

  it('reads back what it saved', () => {
    expect(parseRuns(JSON.stringify([run(1)]))).toEqual([run(1)]);
  });

  it.each([null, '', 'not json', '{}', '[1, "a"]', '[{"at": 1}]'])(
    'treats %p as no history',
    raw => expect(parseRuns(raw)).toEqual([])
  );

  it('drops a malformed run and keeps the good ones', () => {
    const raw = JSON.stringify([run(1), { at: 'x', kind: 'weird', entries: [] }, run(2)]);
    expect(parseRuns(raw)).toEqual([run(1), run(2)]);
  });
});

describe('formatPerfReport', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');

  it('says so when nothing has been saved', () => {
    expect(formatPerfReport([], [], now)).toContain('No saved runs yet.');
  });

  it('lists the newest run first, with its steps and a total', () => {
    const text = formatPerfReport([run(1), run(2)], [], now);
    expect(text.indexOf('2026-10-02')).toBeLessThan(text.indexOf('2026-10-01'));
    expect(text).toContain('initialize tasks: 200 ms');
    expect(text).toContain('Total of steps: 200 ms');
  });

  it('leaves marks out of the total', () => {
    const marked: PerfRun = {
      at: '2026-10-03T09:00:00.000Z',
      kind: 'launch',
      entries: [{ name: 'a', ms: 10 }, { name: 'splash can hide', ms: 900, mark: true }],
    };
    const text = formatPerfReport([marked], [], now);
    expect(text).toContain('splash can hide: at 900 ms');
    expect(text).toContain('Total of steps: 10 ms');
  });

  it('shows what was recorded since the last saved run', () => {
    const text = formatPerfReport([run(1)], [{ name: 'sync reload: tasks', ms: 40 }], now);
    expect(text).toContain('Since the last saved run:');
    expect(text).toContain('sync reload: tasks: 40 ms');
  });

  it('labels a background run', () => {
    const text = formatPerfReport([{ ...run(1), kind: 'background' }], [], now);
    expect(text).toContain('Background run, 2026-10-01');
  });
});
