import {
  breakUse,
  focusAccuracy,
  focusMinutesByDay,
  focusRecordsSince,
  focusSummary,
  MIN_ACCURACY_SAMPLES,
} from '../utils/focusStats';
import type { FocusSessionRecord, FocusStepRecord } from '../types';

/**
 * Local-time ISO string, so a test asserting "ended at 5pm on the 20th" means
 * 5pm on the machine running it. `new Date('...Z')` would shift by the TZ
 * offset and put the session on the wrong side of a day boundary outside UTC —
 * the same trap rhythms.test.ts documents.
 */
function at(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function workStep(overrides: Partial<FocusStepRecord> = {}): FocusStepRecord {
  return {
    kind: 'work',
    taskId: 'task-1',
    plannedMinutes: 25,
    actualSeconds: 25 * 60,
    part: 1,
    partCount: 1,
    long: false,
    ...overrides,
  };
}

function restStep(overrides: Partial<FocusStepRecord> = {}): FocusStepRecord {
  return {
    kind: 'rest',
    taskId: null,
    plannedMinutes: 5,
    actualSeconds: 5 * 60,
    part: 1,
    partCount: 1,
    long: false,
    ...overrides,
  };
}

let nextId = 1;

function makeRecord(overrides: Partial<FocusSessionRecord> = {}): FocusSessionRecord {
  const steps = overrides.steps ?? [workStep()];
  return {
    id: `session-${nextId++}`,
    startedAt: at(2026, 8, 20, 9),
    endedAt: at(2026, 8, 20, 10),
    workedSeconds: steps.filter(s => s.kind === 'work').reduce((t, s) => t + s.actualSeconds, 0),
    restedSeconds: steps.filter(s => s.kind === 'rest').reduce((t, s) => t + s.actualSeconds, 0),
    plannedWorkMinutes: steps.filter(s => s.kind === 'work').reduce((t, s) => t + s.plannedMinutes, 0),
    completedTaskIds: [],
    ...overrides,
    steps,
  };
}

beforeEach(() => {
  nextId = 1;
});

describe('focusMinutesByDay', () => {
  it('returns a fixed run of days oldest first, with the empty ones as zeroes', () => {
    const days = focusMinutesByDay([], 7, new Date(2026, 7, 20, 15));

    expect(days).toHaveLength(7);
    expect(days[0].dayKey).toBe('2026-08-14');
    expect(days[6].dayKey).toBe('2026-08-20');
    expect(days.every(d => d.minutes === 0)).toBe(true);
  });

  it('sums several sessions onto the day they ended', () => {
    const records = [
      makeRecord({ endedAt: at(2026, 8, 20, 10), steps: [workStep({ actualSeconds: 25 * 60 })] }),
      makeRecord({ endedAt: at(2026, 8, 20, 16), steps: [workStep({ actualSeconds: 35 * 60 })] }),
      makeRecord({ endedAt: at(2026, 8, 18, 11), steps: [workStep({ actualSeconds: 10 * 60 })] }),
    ];

    const days = focusMinutesByDay(records, 7, new Date(2026, 7, 20, 18));
    const minutesOn = (key: string) => days.find(d => d.dayKey === key)?.minutes;

    expect(minutesOn('2026-08-20')).toBe(60);
    expect(minutesOn('2026-08-18')).toBe(10);
    expect(minutesOn('2026-08-19')).toBe(0);
  });

  it('ignores a session older than the window rather than folding it into the first day', () => {
    const records = [makeRecord({ endedAt: at(2026, 8, 1, 10), steps: [workStep()] })];

    const days = focusMinutesByDay(records, 7, new Date(2026, 7, 20, 18));

    expect(days.every(d => d.minutes === 0)).toBe(true);
  });

  it('counts rest time on neither day — the chart is focused minutes', () => {
    const records = [makeRecord({
      endedAt: at(2026, 8, 20, 10),
      steps: [workStep({ actualSeconds: 20 * 60 }), restStep({ actualSeconds: 5 * 60 })],
    })];

    const days = focusMinutesByDay(records, 7, new Date(2026, 7, 20, 18));

    expect(days[6].minutes).toBe(20);
  });

  it('puts a small-hours session on the previous logical day under a late reset', () => {
    // 1:30am on the 21st, with the day starting at 04:00, is still the 20th —
    // the grace-window rule from CLAUDE.md, which is why dayResetTime is a
    // parameter here rather than this module reading the clock itself.
    const records = [makeRecord({ endedAt: at(2026, 8, 21, 1, 30), steps: [workStep({ actualSeconds: 30 * 60 })] })];

    const days = focusMinutesByDay(records, 7, new Date(2026, 7, 20, 22), '04:00');
    const minutesOn = (key: string) => days.find(d => d.dayKey === key)?.minutes;

    expect(minutesOn('2026-08-20')).toBe(30);
    expect(minutesOn('2026-08-21')).toBeUndefined();
  });
});

describe('focusSummary', () => {
  it('is all zeroes rather than NaN with nothing to summarize', () => {
    expect(focusSummary([])).toEqual({
      sessions: 0,
      workedMinutes: 0,
      restedMinutes: 0,
      averageSessionMinutes: 0,
      longestSessionMinutes: 0,
      tasksCompleted: 0,
    });
  });

  it('totals work, rest, the average and the longest single session', () => {
    const records = [
      makeRecord({ steps: [workStep({ actualSeconds: 20 * 60 }), restStep({ actualSeconds: 5 * 60 })] }),
      makeRecord({ steps: [workStep({ actualSeconds: 40 * 60 })] }),
    ];

    expect(focusSummary(records)).toMatchObject({
      sessions: 2,
      workedMinutes: 60,
      restedMinutes: 5,
      averageSessionMinutes: 30,
      longestSessionMinutes: 40,
    });
  });

  it('counts tasks completed across sessions', () => {
    const records = [
      makeRecord({ completedTaskIds: ['a', 'b'] }),
      makeRecord({ completedTaskIds: ['c'] }),
    ];

    expect(focusSummary(records).tasksCompleted).toBe(3);
  });
});

describe('focusRecordsSince', () => {
  it('keeps a record ending exactly on the boundary', () => {
    const boundary = new Date(2026, 7, 20, 9);
    const records = [
      makeRecord({ endedAt: at(2026, 8, 20, 9) }),
      makeRecord({ endedAt: at(2026, 8, 19, 23) }),
    ];

    const kept = focusRecordsSince(records, boundary);

    expect(kept).toHaveLength(1);
    expect(kept[0].endedAt).toBe(at(2026, 8, 20, 9));
  });
});

describe('focusAccuracy', () => {
  it('abstains below the sample floor rather than reporting one afternoon as a habit', () => {
    const records = [makeRecord({ steps: [workStep(), workStep()] })];

    expect(focusAccuracy(records)).toBeNull();
    expect(MIN_ACCURACY_SAMPLES).toBe(3);
  });

  it('reports a ratio of 1 when stretches run exactly as planned', () => {
    const records = [makeRecord({ steps: [workStep(), workStep(), workStep()] })];

    expect(focusAccuracy(records)).toMatchObject({ steps: 3, plannedMinutes: 75, actualMinutes: 75, ratio: 1 });
  });

  it('reports below 1 when stretches end early', () => {
    const steps = [
      workStep({ plannedMinutes: 20, actualSeconds: 10 * 60 }),
      workStep({ plannedMinutes: 20, actualSeconds: 10 * 60 }),
      workStep({ plannedMinutes: 20, actualSeconds: 10 * 60 }),
    ];

    expect(focusAccuracy([makeRecord({ steps })])?.ratio).toBeCloseTo(0.5);
  });

  it('reports above 1 when stretches run over, which the session allows', () => {
    const steps = [
      workStep({ plannedMinutes: 10, actualSeconds: 15 * 60 }),
      workStep({ plannedMinutes: 10, actualSeconds: 15 * 60 }),
      workStep({ plannedMinutes: 10, actualSeconds: 15 * 60 }),
    ];

    expect(focusAccuracy([makeRecord({ steps })])?.ratio).toBeCloseTo(1.5);
  });

  it('counts the parts of a split task separately — the question is about a stretch, not a task', () => {
    const steps = [
      workStep({ part: 1, partCount: 3 }),
      workStep({ part: 2, partCount: 3 }),
      workStep({ part: 3, partCount: 3 }),
    ];

    expect(focusAccuracy([makeRecord({ steps })])?.steps).toBe(3);
  });

  it('ignores rest steps entirely', () => {
    const steps = [workStep(), workStep(), workStep(), restStep({ actualSeconds: 60 * 60 })];

    expect(focusAccuracy([makeRecord({ steps })])).toMatchObject({ steps: 3, actualMinutes: 75 });
  });
});

describe('breakUse', () => {
  it('counts a break advanced straight past as offered but not taken', () => {
    const steps = [restStep({ actualSeconds: 2 }), restStep({ actualSeconds: 5 * 60 })];

    expect(breakUse([makeRecord({ steps })])).toEqual({ total: 2, taken: 1 });
  });

  it('scores a long break and a short one the same way — skipping is one act', () => {
    // 20 idle seconds is a tap-through of either, so a proportional test (which
    // would score this as 6% of the long break and 20% of the short) is the
    // wrong shape. Both are untaken.
    const steps = [
      restStep({ plannedMinutes: 15, long: true, actualSeconds: 20 }),
      restStep({ plannedMinutes: 5, actualSeconds: 20 }),
    ];

    expect(breakUse([makeRecord({ steps })])).toEqual({ total: 2, taken: 0 });
  });

  it('is zero of zero when a plan never reached a break', () => {
    expect(breakUse([makeRecord({ steps: [workStep()] })])).toEqual({ total: 0, taken: 0 });
  });
});
