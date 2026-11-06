import { EXERCISE_LIBRARY } from '../utils/exerciseLibrary';
import {
  DEFAULT_BODYWEIGHT_FRACTION,
  LIBRARY_BODYWEIGHT_FRACTIONS,
  bodyweightFractionFor,
  bodyweightFractionOf,
  readBodyweightFraction,
  sessionBodyweightVolumeKg,
} from '../utils/bodyweightLoad';
import type { Exercise, WorkoutSet } from '../types';

describe('the library table', () => {
  it('has an entry for every built-in bodyweight or assisted exercise, so adding one forces a decision', () => {
    const missing = EXERCISE_LIBRARY
      .filter(e => e.kind === 'bodyweight_reps' || e.kind === 'assisted_reps')
      .filter(e => !(e.id in LIBRARY_BODYWEIGHT_FRACTIONS))
      .map(e => e.id);
    expect(missing).toEqual([]);
  });

  it('names no exercise the library does not have, or one that is not bodyweight work', () => {
    const kinds = new Map(EXERCISE_LIBRARY.map(e => [e.id, e.kind]));
    for (const id of Object.keys(LIBRARY_BODYWEIGHT_FRACTIONS)) {
      expect(['bodyweight_reps', 'assisted_reps']).toContain(kinds.get(id));
    }
  });

  it('keeps every share between 0 and 1', () => {
    for (const v of Object.values(LIBRARY_BODYWEIGHT_FRACTIONS)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('bodyweightFractionOf', () => {
  it('takes the person\'s own figure over the library\'s', () => {
    expect(bodyweightFractionOf('lib:push-up', 0.5)).toBe(0.5);
    expect(bodyweightFractionOf('lib:push-up', 0)).toBe(0);
  });

  it('falls back to the library, then to the whole body for a custom exercise', () => {
    expect(bodyweightFractionOf('lib:push-up', null)).toBe(0.64);
    expect(bodyweightFractionOf('lib:push-up')).toBe(0.64);
    expect(bodyweightFractionOf('custom-id', null)).toBe(DEFAULT_BODYWEIGHT_FRACTION);
  });

  it('ignores a stored figure outside 0 to 1', () => {
    expect(bodyweightFractionOf('lib:push-up', 3)).toBe(0.64);
    expect(bodyweightFractionOf('custom-id', -1)).toBe(1);
  });

  it('reads an exercise row that may be missing', () => {
    expect(bodyweightFractionFor(undefined, 'lib:pull-up')).toBe(1);
    expect(bodyweightFractionFor(null, 'lib:push-up')).toBe(0.64);
    expect(bodyweightFractionFor({ bodyweightFraction: 0.3 }, 'lib:push-up')).toBe(0.3);
  });
});

describe('readBodyweightFraction', () => {
  it('rounds to a whole percent and refuses what is not a share', () => {
    expect(readBodyweightFraction(0.6449)).toBe(0.64);
    expect(readBodyweightFraction('0.5')).toBe(0.5);
    expect(readBodyweightFraction(null)).toBeNull();
    expect(readBodyweightFraction(undefined)).toBeNull();
    expect(readBodyweightFraction('')).toBeNull();
    expect(readBodyweightFraction('abc')).toBeNull();
    expect(readBodyweightFraction(1.5)).toBeNull();
    expect(readBodyweightFraction(-0.1)).toBeNull();
  });
});

describe('sessionBodyweightVolumeKg', () => {
  const done = (exerciseId: string, weightKg: number | null, reps: number): Pick<WorkoutSet, 'exerciseId' | 'weightKg' | 'reps' | 'completedAt' | 'kind'> =>
    ({ exerciseId, weightKg, reps, completedAt: '2026-01-01T10:00:00.000Z', kind: 'working' });

  it('reads each exercise\'s kind and share from the catalog, and a custom row\'s own figure', () => {
    const custom = { id: 'c1', name: 'Ring row', kind: 'bodyweight_reps', bodyweightFraction: 0.5 } as unknown as Exercise;
    const kg = sessionBodyweightVolumeKg(
      [done('lib:pull-up', null, 10), done('lib:push-up', null, 10), done('c1', null, 10)],
      [custom],
      80,
    );
    // 80 x 1 x 10 + 80 x 0.64 x 10 + 80 x 0.5 x 10
    expect(kg).toBeCloseTo(800 + 512 + 400, 6);
  });

  it('is null without a stamped body weight', () => {
    expect(sessionBodyweightVolumeKg([done('lib:pull-up', null, 10)], [], null)).toBeNull();
    expect(sessionBodyweightVolumeKg([done('lib:pull-up', null, 10)], [], undefined)).toBeNull();
  });
});
