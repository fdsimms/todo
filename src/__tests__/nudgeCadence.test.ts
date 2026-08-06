import {
  CADENCE_UNIT_MAX,
  describeCadence,
  fromCadenceParts,
  toCadenceParts,
  withCadenceUnit,
} from '../utils/nudgeCadence';

describe('toCadenceParts', () => {
  it('reads back in the largest unit that divides evenly', () => {
    expect(toCadenceParts(30)).toEqual({ count: 1, unit: 'months' });
    expect(toCadenceParts(60)).toEqual({ count: 2, unit: 'months' });
    expect(toCadenceParts(7)).toEqual({ count: 1, unit: 'weeks' });
    expect(toCadenceParts(14)).toEqual({ count: 2, unit: 'weeks' });
    expect(toCadenceParts(3)).toEqual({ count: 3, unit: 'days' });
    expect(toCadenceParts(10)).toEqual({ count: 10, unit: 'days' });
  });

  it('treats 0 and anything below it as never', () => {
    expect(toCadenceParts(0).count).toBeNull();
    expect(toCadenceParts(-5).count).toBeNull();
  });
});

describe('fromCadenceParts', () => {
  it('multiplies out to days', () => {
    expect(fromCadenceParts({ count: 2, unit: 'weeks' })).toBe(14);
    expect(fromCadenceParts({ count: 3, unit: 'months' })).toBe(90);
    expect(fromCadenceParts({ count: 5, unit: 'days' })).toBe(5);
  });

  it('turns never into the stored 0', () => {
    expect(fromCadenceParts({ count: null, unit: 'weeks' })).toBe(0);
  });

  it('round-trips every value the picker can produce', () => {
    for (const unit of ['days', 'weeks', 'months'] as const) {
      for (let count = 1; count <= CADENCE_UNIT_MAX[unit]; count++) {
        const days = fromCadenceParts({ count, unit });
        // Not necessarily the same unit — 4 weeks is 28 days, but 2 weeks is
        // 14 and comes back as weeks. What has to hold is the day count.
        expect(fromCadenceParts(toCadenceParts(days))).toBe(days);
      }
    }
  });
});

describe('withCadenceUnit', () => {
  it('keeps the count and changes what it counts', () => {
    expect(withCadenceUnit({ count: 2, unit: 'weeks' }, 'months')).toEqual({ count: 2, unit: 'months' });
  });

  it('clamps a count the new unit cannot hold', () => {
    expect(withCadenceUnit({ count: 90, unit: 'days' }, 'months')).toEqual({ count: 24, unit: 'months' });
  });

  it('turns the nudge on when it was never', () => {
    expect(withCadenceUnit({ count: null, unit: 'days' }, 'weeks')).toEqual({ count: 1, unit: 'weeks' });
  });
});

describe('describeCadence', () => {
  it('names the cadence in its own unit', () => {
    expect(describeCadence(0)).toBe('Never');
    expect(describeCadence(1)).toBe('1 day');
    expect(describeCadence(3)).toBe('3 days');
    expect(describeCadence(7)).toBe('1 week');
    expect(describeCadence(14)).toBe('2 weeks');
    expect(describeCadence(30)).toBe('1 month');
    expect(describeCadence(90)).toBe('3 months');
  });
});
