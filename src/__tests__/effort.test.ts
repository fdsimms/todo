import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import type { Effort } from '../types';

describe('effortToMinutes', () => {
  it('returns null for the unknown bucket', () => {
    expect(effortToMinutes(0)).toBeNull();
  });

  it('returns the canonical minutes for each preset', () => {
    expect(effortToMinutes(1)).toBe(15);
    expect(effortToMinutes(2)).toBe(30);
    expect(effortToMinutes(3)).toBe(90);
    expect(effortToMinutes(4)).toBe(240);
    expect(effortToMinutes(5)).toBe(480);
  });
});

describe('minutesToEffort', () => {
  it('maps null / non-positive to the unknown bucket', () => {
    expect(minutesToEffort(null)).toBe(0);
    expect(minutesToEffort(0)).toBe(0);
    expect(minutesToEffort(-10)).toBe(0);
  });

  it('buckets values by threshold', () => {
    expect(minutesToEffort(10)).toBe(1);   // ≤20 → XS
    expect(minutesToEffort(20)).toBe(1);
    expect(minutesToEffort(21)).toBe(2);   // ≤45 → S
    expect(minutesToEffort(45)).toBe(2);
    expect(minutesToEffort(46)).toBe(3);   // ≤150 → M
    expect(minutesToEffort(150)).toBe(3);
    expect(minutesToEffort(151)).toBe(4);  // ≤330 → L
    expect(minutesToEffort(330)).toBe(4);
    expect(minutesToEffort(331)).toBe(5);  // else → XL
    expect(minutesToEffort(1000)).toBe(5);
  });

  it('round-trips every preset back to itself', () => {
    for (const e of [1, 2, 3, 4, 5] as Effort[]) {
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
