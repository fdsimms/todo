import {
  CADENCE_UNIT_MAX,
  FALLBACK_CADENCE_DAYS,
  NUDGE_MODES,
  describeCadence,
  describeNudge,
  fromCadenceParts,
  nudgeFieldsFor,
  nudgeModeOf,
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

describe('nudgeModeOf', () => {
  const project = (nudgeOptIn: boolean, nudgeCadenceDays: number) => ({ nudgeOptIn, nudgeCadenceDays });

  it('reads an opted-out project as never, whatever cadence it is carrying', () => {
    // A project seeded from the Settings default carries a cadence while still
    // opted out, and that project is out of every surface — which is exactly
    // the combination the merged control exists to stop anyone reaching.
    expect(nudgeModeOf(project(false, 0))).toBe('never');
    expect(nudgeModeOf(project(false, 14))).toBe('never');
  });

  it('splits the opted-in projects on whether the cadence can fire', () => {
    expect(nudgeModeOf(project(true, 0))).toBe('on-ask');
    expect(nudgeModeOf(project(true, 14))).toBe('scheduled');
  });
});

describe('nudgeFieldsFor', () => {
  it('round-trips every mode through the two stored fields', () => {
    NUDGE_MODES.forEach(mode => {
      expect(nudgeModeOf(nudgeFieldsFor(mode, 14))).toBe(mode);
    });
  });

  it('clears the cadence on the two modes that never fire one', () => {
    expect(nudgeFieldsFor('never', 14)).toEqual({ nudgeOptIn: false, nudgeCadenceDays: 0 });
    expect(nudgeFieldsFor('on-ask', 14)).toEqual({ nudgeOptIn: true, nudgeCadenceDays: 0 });
  });

  it('never stores a scheduled project with a cadence that cannot fire', () => {
    expect(nudgeFieldsFor('scheduled', 0)).toEqual({ nudgeOptIn: true, nudgeCadenceDays: FALLBACK_CADENCE_DAYS });
    expect(nudgeFieldsFor('scheduled', -3)).toEqual({ nudgeOptIn: true, nudgeCadenceDays: FALLBACK_CADENCE_DAYS });
    expect(nudgeFieldsFor('scheduled', 7)).toEqual({ nudgeOptIn: true, nudgeCadenceDays: 7 });
  });
});

describe('describeNudge', () => {
  it('names the answer, spelling out the cadence only when there is one', () => {
    expect(describeNudge({ nudgeOptIn: false, nudgeCadenceDays: 0 })).toBe('Never');
    expect(describeNudge({ nudgeOptIn: true, nudgeCadenceDays: 0 })).toBe('When I ask');
    expect(describeNudge({ nudgeOptIn: true, nudgeCadenceDays: 14 })).toBe('Every 2 weeks');
  });
});
