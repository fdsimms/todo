import { nextPurchaseIntervalDays } from '@/utils/purchaseInterval';

const at = (day: number) => new Date(2026, 7, day, 12).toISOString();

describe('nextPurchaseIntervalDays', () => {
  it('has nothing to measure on a first purchase', () => {
    expect(nextPurchaseIntervalDays(null, null, at(10))).toBeNull();
  });

  it('takes the first gap as it is', () => {
    expect(nextPurchaseIntervalDays(null, at(3), at(10))).toBeCloseTo(7);
  });

  it('moves halfway towards each later gap', () => {
    expect(nextPurchaseIntervalDays(7, at(10), at(13))).toBeCloseTo(5);
  });

  it('ignores a second shop on the same day', () => {
    expect(nextPurchaseIntervalDays(7, at(10), at(10))).toBe(7);
  });

  it('caps one long gap at three times the average so far', () => {
    // 60 days away counts as 21, so the average goes 7 -> 14 rather than 7 -> 33.5.
    expect(nextPurchaseIntervalDays(7, at(1), new Date(2026, 8, 30, 12).toISOString())).toBeCloseTo(14);
  });

  it('keeps the previous figure when a date does not parse', () => {
    expect(nextPurchaseIntervalDays(7, 'not a date', at(10))).toBe(7);
  });
});
