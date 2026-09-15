import type { Task } from '../types';
import {
  calibratedAssumedMinutes,
  calibrationFrom,
  calibrationPairs,
  describeCalibration,
  MIN_CALIBRATION_SAMPLES,
} from '../utils/estimateCalibration';

function timed(estimateBeforeTiming: number | null, actualMinutes: number | null, id = 't'): Task {
  return { id, title: 'Task', estimateBeforeTiming, actualMinutes } as unknown as Task;
}

/** n pairs that each ran exactly `ratio` times their estimate. */
function pairsAt(ratio: number, n: number): Task[] {
  return Array.from({ length: n }, (_, i) => timed(60, 60 * ratio, `t${i}`));
}

describe('calibrationPairs', () => {
  it('takes only the tasks carrying both halves', () => {
    const tasks = [
      timed(30, 45, 'a'),
      timed(null, 45, 'b'),
      timed(30, null, 'c'),
      timed(null, null, 'd'),
    ];
    expect(calibrationPairs(tasks)).toEqual([{ estimated: 30, actual: 45 }]);
  });

  // A stopwatch left running overnight, or stopped eight seconds in, is a
  // broken reading rather than a slow or fast one.
  it('drops a reading outside the sane band rather than clamping it', () => {
    const tasks = [timed(60, 60 * 40, 'overnight'), timed(60, 1, 'misfire'), timed(60, 90, 'real')];
    expect(calibrationPairs(tasks)).toEqual([{ estimated: 60, actual: 90 }]);
  });

  it('ignores a zero or negative on either side', () => {
    expect(calibrationPairs([timed(0, 30, 'a'), timed(30, 0, 'b')])).toEqual([]);
  });
});

/**
 * The successor a completion spawns is `{ ...effective }`, and neither half of
 * the pair is overridden — so one timing rides into every later occurrence and
 * stays on every tombstone behind it. Counted per row, one measurement cleared
 * the sample floor by itself and kept climbing.
 */
describe('calibrationPairs collapses an occurrence family', () => {
  /** A row in a recurrence chain: `prev` is the occurrence it replaced. */
  function occurrence(
    id: string,
    prev: string | null,
    estimate: number | null,
    actual: number | null,
    completedAt: string | null,
  ): Task {
    return {
      id,
      title: 'Walk',
      previousOccurrenceId: prev,
      estimateBeforeTiming: estimate,
      actualMinutes: actual,
      completedAt,
    } as unknown as Task;
  }

  it('counts one timing once however many occurrences carried it forward', () => {
    const chain = [
      occurrence('d1', null, 20, 35, '2026-09-10T09:00:00Z'),
      occurrence('d2', 'd1', 20, 35, '2026-09-11T09:00:00Z'),
      occurrence('d3', 'd2', 20, 35, '2026-09-12T09:00:00Z'),
      occurrence('d4', 'd3', 20, 35, '2026-09-13T09:00:00Z'),
      occurrence('d5', 'd4', 20, 35, null),
    ];
    expect(calibrationPairs(chain)).toEqual([{ estimated: 20, actual: 35 }]);
  });

  // The floor exists so a ratio is never claimed off an anecdote. One reading
  // copied into five rows is the anecdote, dressed as five.
  it('does not let one carried-forward timing meet the sample floor', () => {
    const chain = Array.from({ length: MIN_CALIBRATION_SAMPLES + 3 }, (_, i) =>
      occurrence(`d${i}`, i === 0 ? null : `d${i - 1}`, 20, 35, `2026-09-${10 + i}T09:00:00Z`));
    expect(calibrationFrom(chain)).toBeNull();
  });

  it('counts the dates of one series once', () => {
    const series = ['s1', 's2', 's3'].map(id => ({
      id,
      title: 'Dog',
      seriesId: 'set-1',
      previousOccurrenceId: null,
      estimateBeforeTiming: 30,
      actualMinutes: 45,
      completedAt: '2026-09-10T09:00:00Z',
    } as unknown as Task));
    expect(calibrationPairs(series)).toEqual([{ estimated: 30, actual: 45 }]);
  });

  // Re-timing replaces the family's sample rather than adding one, and the
  // live row is the family's current state — so it has to beat the tombstone
  // whose superseded pair it had been carrying.
  it('takes the live occurrence when it has been timed again', () => {
    const chain = [
      occurrence('d1', null, 20, 35, '2026-09-10T09:00:00Z'),
      occurrence('d2', 'd1', 20, 50, null),
    ];
    expect(calibrationPairs(chain)).toEqual([{ estimated: 20, actual: 50 }]);
  });

  it('takes the most recently completed row when every row is history', () => {
    const chain = [
      occurrence('d1', null, 20, 35, '2026-09-10T09:00:00Z'),
      occurrence('d2', 'd1', 20, 50, '2026-09-11T09:00:00Z'),
    ];
    expect(calibrationPairs(chain)).toEqual([{ estimated: 20, actual: 50 }]);
  });

  it('still counts separate tasks separately', () => {
    const tasks = [
      occurrence('a1', null, 20, 35, '2026-09-10T09:00:00Z'),
      occurrence('a2', 'a1', 20, 35, '2026-09-11T09:00:00Z'),
      occurrence('b1', null, 60, 30, '2026-09-11T09:00:00Z'),
    ];
    expect(calibrationPairs(tasks)).toEqual([
      { estimated: 20, actual: 35 },
      { estimated: 60, actual: 30 },
    ]);
  });

  // A generator writes a fresh row per day with no pointer back, so nothing is
  // carried into it: two timed meal slots really are two measurements. This is
  // the branch occurrenceFamilyKey has and timingFamilyKey deliberately omits.
  it('counts generated tasks sharing a title separately', () => {
    const generated = ['g1', 'g2'].map(id => ({
      id,
      title: 'Lunch',
      generatedKind: 'mealSlot',
      previousOccurrenceId: null,
      estimateBeforeTiming: 15,
      actualMinutes: 25,
      completedAt: '2026-09-10T09:00:00Z',
    } as unknown as Task));
    expect(calibrationPairs(generated)).toHaveLength(2);
  });

  // The `seen` guard is about terminating, not about canonicalising a cycle —
  // each row's walk stops one step short of where it started, so the two keys
  // differ and neither is collapsed. That matches memberKey and
  // occurrenceFamilyKey exactly; a loop is not a state anything writes, and
  // the only requirement is that a render path doesn't hang on one.
  it('survives a previousOccurrenceId loop without hanging', () => {
    const a = occurrence('x', 'y', 20, 35, null);
    const b = occurrence('y', 'x', 20, 35, null);
    expect(calibrationPairs([a, b])).toHaveLength(2);
  });
});

describe('calibrationFrom', () => {
  it('says nothing below the sample floor', () => {
    expect(calibrationFrom(pairsAt(1.5, MIN_CALIBRATION_SAMPLES - 1))).toBeNull();
  });

  it('reports the ratio once there are enough', () => {
    const calibration = calibrationFrom(pairsAt(1.5, MIN_CALIBRATION_SAMPLES));
    expect(calibration).toEqual({ ratio: 1.5, samples: MIN_CALIBRATION_SAMPLES });
  });

  // The whole reason it is a median: one task left running must not move the
  // number every day's workload is scaled by.
  it('is not moved by a single wild reading', () => {
    const tasks = [...pairsAt(1, 6), timed(60, 60 * 9, 'left-running')];
    expect(calibrationFrom(tasks)?.ratio).toBe(1);
  });

  it('reads an even sample count as the midpoint of the middle two', () => {
    const tasks = [
      timed(60, 60, 'a'), timed(60, 60, 'b'), timed(60, 60, 'c'),
      timed(60, 120, 'd'), timed(60, 120, 'e'), timed(60, 120, 'f'),
    ];
    expect(calibrationFrom(tasks)?.ratio).toBe(1.5);
  });

  it('answers null for an install that has never timed anything', () => {
    expect(calibrationFrom([])).toBeNull();
  });
});

describe('calibratedAssumedMinutes', () => {
  it('leaves the base untouched when there is no calibration', () => {
    expect(calibratedAssumedMinutes(30, null)).toBe(30);
  });

  it('scales the gap-filling assumption by the measured ratio', () => {
    expect(calibratedAssumedMinutes(30, { ratio: 1.5, samples: 8 })).toBe(45);
    expect(calibratedAssumedMinutes(30, { ratio: 0.5, samples: 8 })).toBe(15);
  });

  it('never returns less than a minute', () => {
    expect(calibratedAssumedMinutes(1, { ratio: 0.1, samples: 8 })).toBe(1);
  });
});

describe('describeCalibration', () => {
  it('says nothing without a calibration', () => {
    expect(describeCalibration(null)).toBeNull();
  });

  // Said about the work, never about the person doing it.
  it('describes the work rather than the estimator', () => {
    expect(describeCalibration({ ratio: 1.4, samples: 9 }))
      .toBe('Timed work takes about 40% longer than estimated, across 9 tasks.');
    expect(describeCalibration({ ratio: 0.7, samples: 6 }))
      .toBe('Timed work takes about 30% less than estimated, across 6 tasks.');
  });

  it('calls a near-match close rather than quoting a meaningless percentage', () => {
    expect(describeCalibration({ ratio: 1.04, samples: 12 }))
      .toBe('Timed work lands close to its estimate, across 12 tasks.');
  });
});
