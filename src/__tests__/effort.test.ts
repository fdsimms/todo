import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration, formatStopwatch, applyMeasuredTime } from '../utils/effort';
import type { Effort } from '../types';

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

describe('applyMeasuredTime', () => {
  it('sets actual and estimate to the rounded minutes and derives effort', () => {
    expect(applyMeasuredTime(10)).toEqual({ actualMinutes: 10, estimatedMinutes: 10, effort: 2 });
    expect(applyMeasuredTime(90)).toEqual({ actualMinutes: 90, estimatedMinutes: 90, effort: 4 });
  });

  it('rounds and floors to a minimum of one minute', () => {
    expect(applyMeasuredTime(9.4)).toEqual({ actualMinutes: 9, estimatedMinutes: 9, effort: 2 });
    expect(applyMeasuredTime(0.2)).toEqual({ actualMinutes: 1, estimatedMinutes: 1, effort: 1 });
  });
});
