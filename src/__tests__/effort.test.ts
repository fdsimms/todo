import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatClockDuration,
  formatDuration, formatStopwatch, applyMeasuredTime, measuredTimeAppliesTo, sumEstimatedMinutes, estimatedMinutesFor } from '../utils/effort';
import type { ChainItem, Effort } from '../types';

const step = (title: string, estimatedMinutes: number | null = null): ChainItem =>
  ({ id: title, title, estimatedMinutes });

describe('effortToMinutes', () => {
  it('returns null for the unknown bucket', () => {
    expect(effortToMinutes(0)).toBeNull();
  });

  it('returns the canonical minutes for each preset', () => {
    expect(effortToMinutes(1)).toBe(1);
    expect(effortToMinutes(2)).toBe(15);
    expect(effortToMinutes(3)).toBe(30);
    expect(effortToMinutes(4)).toBe(90);
    expect(effortToMinutes(5)).toBe(240);
    expect(effortToMinutes(6)).toBe(480);
  });
});

describe('minutesToEffort', () => {
  it('maps null / non-positive to the unknown bucket', () => {
    expect(minutesToEffort(null)).toBe(0);
    expect(minutesToEffort(0)).toBe(0);
    expect(minutesToEffort(-10)).toBe(0);
  });

  it('buckets values by threshold', () => {
    expect(minutesToEffort(1)).toBe(1);    // ≤5 → XXS
    expect(minutesToEffort(5)).toBe(1);
    expect(minutesToEffort(6)).toBe(2);    // ≤20 → XS
    expect(minutesToEffort(20)).toBe(2);
    expect(minutesToEffort(21)).toBe(3);   // ≤45 → S
    expect(minutesToEffort(45)).toBe(3);
    expect(minutesToEffort(46)).toBe(4);   // ≤150 → M
    expect(minutesToEffort(150)).toBe(4);
    expect(minutesToEffort(151)).toBe(5);  // ≤330 → L
    expect(minutesToEffort(330)).toBe(5);
    expect(minutesToEffort(331)).toBe(6);  // else → XL
    expect(minutesToEffort(1000)).toBe(6);
  });

  it('round-trips every preset back to itself', () => {
    for (const e of [1, 2, 3, 4, 5, 6] as Effort[]) {
      expect(minutesToEffort(EFFORT_MINUTES[e])).toBe(e);
    }
  });
});

describe('formatClockDuration', () => {
  it('shows minutes under an hour', () => {
    expect(formatClockDuration(15)).toBe('15m');
    expect(formatClockDuration(45)).toBe('45m');
  });

  it('drops the minutes on a whole hour', () => {
    expect(formatClockDuration(60)).toBe('1h');
    expect(formatClockDuration(120)).toBe('2h');
  });

  it('spells out the remainder rather than decimalising it', () => {
    // The whole point of the split: formatDuration says 1.3h here.
    expect(formatClockDuration(80)).toBe('1h 20m');
    expect(formatClockDuration(75)).toBe('1h 15m');
    expect(formatDuration(80)).toBe('1.3h');
  });

  it('reads zero and negatives as no time rather than going backwards', () => {
    expect(formatClockDuration(0)).toBe('0m');
    expect(formatClockDuration(-5)).toBe('0m');
  });
});

describe('formatDuration', () => {
  it('shows minutes under an hour', () => {
    expect(formatDuration(15)).toBe('15m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(59)).toBe('59m');
  });

  it('shows whole hours without a decimal', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(480)).toBe('8h');
  });

  it('shows fractional hours with one decimal', () => {
    expect(formatDuration(90)).toBe('1.5h');
    expect(formatDuration(240)).toBe('4h');
    expect(formatDuration(150)).toBe('2.5h');
  });
});

describe('formatStopwatch', () => {
  it('shows m:ss under an hour', () => {
    expect(formatStopwatch(0)).toBe('0:00');
    expect(formatStopwatch(5)).toBe('0:05');
    expect(formatStopwatch(65)).toBe('1:05');
    expect(formatStopwatch(600)).toBe('10:00');
  });

  it('shows h:mm:ss at or above an hour', () => {
    expect(formatStopwatch(3600)).toBe('1:00:00');
    expect(formatStopwatch(3723)).toBe('1:02:03');
  });

  it('floors fractional seconds and clamps negatives', () => {
    expect(formatStopwatch(5.9)).toBe('0:05');
    expect(formatStopwatch(-10)).toBe('0:00');
  });
});

describe('sumEstimatedMinutes', () => {
  it('sums precise estimates when present', () => {
    const tasks = [
      { estimatedMinutes: 30, effort: 0 as Effort },
      { estimatedMinutes: 45, effort: 0 as Effort },
    ];
    expect(sumEstimatedMinutes(tasks)).toBe(75);
  });

  it('falls back to the effort bucket when a task has no precise estimate', () => {
    const tasks = [
      { estimatedMinutes: null, effort: 3 as Effort }, // ~30
      { estimatedMinutes: null, effort: 4 as Effort }, // ~90
    ];
    expect(sumEstimatedMinutes(tasks)).toBe(120);
  });

  it('contributes 0 for tasks with no estimate and unknown effort', () => {
    const tasks = [{ estimatedMinutes: null, effort: 0 as Effort }];
    expect(sumEstimatedMinutes(tasks)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(sumEstimatedMinutes([])).toBe(0);
  });

  it('mixes precise and bucketed estimates', () => {
    const tasks = [
      { estimatedMinutes: 20, effort: 0 as Effort },
      { estimatedMinutes: null, effort: 2 as Effort }, // ~15
    ];
    expect(sumEstimatedMinutes(tasks)).toBe(35);
  });
});

describe('estimatedMinutesFor', () => {
  const chained = (over: Partial<{ estimatedMinutes: number | null; effort: Effort; chainItems: ChainItem[]; chainIndex: number; chainEnabled: boolean }> = {}) => ({
    estimatedMinutes: 90,
    effort: 0 as Effort,
    chainEnabled: true,
    chainIndex: 0,
    chainItems: [step('Warm up', 5), step('Main set', 45), step('Cool down')],
    ...over,
  });

  it('uses the active step\'s own estimate', () => {
    expect(estimatedMinutesFor(chained({ chainIndex: 0 }))).toBe(5);
    expect(estimatedMinutesFor(chained({ chainIndex: 1 }))).toBe(45);
  });

  it('falls back to the task estimate for a step that has none', () => {
    expect(estimatedMinutesFor(chained({ chainIndex: 2 }))).toBe(90);
  });

  it('falls back to the effort bucket when neither the step nor the task has an estimate', () => {
    expect(estimatedMinutesFor(chained({ chainIndex: 2, estimatedMinutes: null, effort: 3 }))).toBe(30);
  });

  it('wraps the index the way a repeating chain does', () => {
    expect(estimatedMinutesFor(chained({ chainIndex: 4 }))).toBe(45);
  });

  it('ignores step estimates when the chain is off or has a single step', () => {
    expect(estimatedMinutesFor(chained({ chainEnabled: false }))).toBe(90);
    expect(estimatedMinutesFor(chained({ chainItems: [step('Warm up', 5)] }))).toBe(90);
  });

  it('is null when nothing anywhere has an estimate', () => {
    expect(estimatedMinutesFor({ estimatedMinutes: null, effort: 0, chainEnabled: false, chainIndex: 0, chainItems: [] })).toBeNull();
  });

  it('takes the loose shape too, for callers with no chain fields', () => {
    expect(estimatedMinutesFor({ estimatedMinutes: 20, effort: 0 })).toBe(20);
  });
});

describe('sumEstimatedMinutes with chains', () => {
  // The bug this exists for: without per-step estimates a chained task charges
  // its whole estimate at every step, and since completing a step spawns the
  // next onto the same day, the day's total never falls as the chain is worked.
  it('charges the active step, not the whole chain', () => {
    const task = {
      estimatedMinutes: 90, effort: 0 as Effort, chainEnabled: true,
      chainItems: [step('Warm up', 5), step('Main set', 45)],
      chainIndex: 0,
    };
    expect(sumEstimatedMinutes([task])).toBe(5);
    expect(sumEstimatedMinutes([{ ...task, chainIndex: 1 }])).toBe(45);
  });
});

describe('applyMeasuredTime', () => {
  it('sets actual and estimate to the rounded minutes and derives effort', () => {
    expect(applyMeasuredTime(10)).toEqual({ actualMinutes: 10, estimatedMinutes: 10, effort: 2 });
    expect(applyMeasuredTime(90)).toEqual({ actualMinutes: 90, estimatedMinutes: 90, effort: 4 });
  });

  it('rounds and floors to a minimum of one minute', () => {
    expect(applyMeasuredTime(9.4)).toEqual({ actualMinutes: 9, estimatedMinutes: 9, effort: 2 });
    expect(applyMeasuredTime(0.2)).toEqual({ actualMinutes: 1, estimatedMinutes: 1, effort: 1 });
  });

  // The old rule was "don't overwrite a typed estimate", which meant a task
  // estimated once kept that guess however many times it was timed.
  it('overwrites an existing estimate — the measurement is the better number', () => {
    const timed = applyMeasuredTime(45);
    expect(timed.estimatedMinutes).toBe(45);
    expect(timed.actualMinutes).toBe(timed.estimatedMinutes);
  });

  it('never leaves the two disagreeing', () => {
    [1, 9.4, 25, 90, 240].forEach(m => {
      const r = applyMeasuredTime(m);
      expect(r.actualMinutes).toBe(r.estimatedMinutes);
    });
  });
});

describe('measuredTimeAppliesTo', () => {
  it('is true for a plain, non-chained task', () => {
    expect(measuredTimeAppliesTo({ estimatedMinutes: 30, effort: 0, chainEnabled: false, chainIndex: 0, chainItems: [] })).toBe(true);
  });

  it('is true on a chain step that carries no estimate of its own', () => {
    const task = {
      estimatedMinutes: 90, effort: 0 as Effort, chainEnabled: true,
      chainIndex: 2, chainItems: [step('Warm up', 5), step('Main set', 45), step('Cool down')],
    };
    expect(measuredTimeAppliesTo(task)).toBe(true);
  });

  it('is false when the active chain step has its own estimate — applyMeasuredTime would write fields estimatedMinutesFor never reads back', () => {
    const task = {
      estimatedMinutes: 90, effort: 0 as Effort, chainEnabled: true,
      chainIndex: 0, chainItems: [step('Warm up', 5), step('Main set', 45)],
    };
    expect(measuredTimeAppliesTo(task)).toBe(false);
    // Proof, not just assertion: the task-level field this would write is
    // never what estimatedMinutesFor reads back while that step is active.
    expect(estimatedMinutesFor({ ...task, estimatedMinutes: 999 })).toBe(5);
  });
});
