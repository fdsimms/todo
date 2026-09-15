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
