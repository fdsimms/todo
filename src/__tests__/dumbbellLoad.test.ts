import type { Exercise } from '../types';
import { DUMBBELL_ENTRY_LABELS, dumbbellsUsed, entryFor, formatScaledWeight, storedKgFromTyped, weightHeadingSuffix, weightScale } from '../utils/dumbbellLoad';
import { parseSetCell } from '../utils/workoutCell';
import { formatSetLine } from '../utils/workoutSession';
import { proposalHeadline } from '../utils/workoutProgression';
import { EXERCISE_LIBRARY } from '../utils/exerciseLibrary';

const ex = (over: Partial<Pick<Exercise, 'id' | 'equipment' | 'dumbbells' | 'loadEntry'>> = {}) => ({
  id: 'c1', equipment: 'dumbbell' as const, dumbbells: null, loadEntry: null, ...over,
});

describe('dumbbellsUsed', () => {
  it('is two for a dumbbell exercise unless the library says one', () => {
    expect(dumbbellsUsed(ex({ id: 'lib:dumbbell-curl' }))).toBe(2);
    expect(dumbbellsUsed(ex({ id: 'lib:goblet-squat' }))).toBe(1);
    expect(dumbbellsUsed(ex({ id: 'lib:dumbbell-row' }))).toBe(1);
  });

  it('is two for a custom dumbbell exercise, and the person\'s own count wins', () => {
    expect(dumbbellsUsed(ex())).toBe(2);
    expect(dumbbellsUsed(ex({ dumbbells: 1 }))).toBe(1);
    expect(dumbbellsUsed(ex({ id: 'lib:goblet-squat', dumbbells: 2 }))).toBe(2);
  });

  it('is nothing for equipment that is not a dumbbell', () => {
    expect(dumbbellsUsed(ex({ equipment: 'barbell' as never }))).toBeNull();
  });

  it('names only built-in ids the library has', () => {
    for (const slug of ['dumbbell-pullover', 'dumbbell-row', 'one-arm-dumbbell-shoulder-press', 'concentration-curl',
      'overhead-dumbbell-triceps-extension', 'dumbbell-kickback', 'dumbbell-wrist-curl', 'suitcase-carry', 'goblet-squat',
      'single-leg-romanian-deadlift', 'single-leg-calf-raise', 'dumbbell-side-bend']) {
      const lib = EXERCISE_LIBRARY.find(e => e.id === `lib:${slug}`);
      expect(lib?.equipment).toBe('dumbbell');
    }
  });
});

describe('entryFor and weightScale', () => {
  it('follows the setting for two dumbbells and the exercise\'s own choice over it', () => {
    expect(entryFor(ex(), 'pair')).toBe('pair');
    expect(entryFor(ex(), 'each')).toBe('each');
    expect(entryFor(ex({ loadEntry: 'each' }), 'pair')).toBe('each');
    expect(entryFor(ex({ loadEntry: 'pair' }), 'each')).toBe('pair');
  });

  it('is each for one dumbbell and for anything else, whatever is set', () => {
    expect(entryFor(ex({ dumbbells: 1, loadEntry: 'pair' }), 'pair')).toBe('each');
    expect(entryFor(ex({ equipment: 'cable' as never }), 'pair')).toBe('each');
    expect(entryFor(null, 'pair')).toBe('each');
  });

  it('scales by two only for a pair total', () => {
    expect(weightScale(ex(), 'pair')).toBe(2);
    expect(weightScale(ex(), 'each')).toBe(1);
    expect(weightScale(ex({ dumbbells: 1 }), 'pair')).toBe(1);
  });
});

describe('typing and reading a pair total', () => {
  it('halves a typed pair total on the way in and doubles it on the way out', () => {
    expect(storedKgFromTyped(25, 'kg', 2)).toBe(12.5);
    expect(formatScaledWeight(12.5, 'kg', 2)).toBe('25');
    expect(formatScaledWeight(12.5, 'kg', 1)).toBe('12.5');
  });

  it('round-trips in pounds without drifting', () => {
    const stored = storedKgFromTyped(45, 'lb', 2);
    expect(formatScaledWeight(stored, 'lb', 2)).toBe('45');
    expect(formatScaledWeight(stored, 'lb', 1)).toBe('22.5');
  });

  it('is what a set cell writes', () => {
    expect(parseSetCell('weight', '25', 'kg', 2)).toEqual({ weightKg: 12.5 });
    expect(parseSetCell('weight', '25', 'kg')).toEqual({ weightKg: 25 });
    expect(parseSetCell('weight', '', 'kg', 2)).toEqual({ weightKg: null });
    expect(parseSetCell('reps', '10', 'kg', 2)).toEqual({ reps: 10 });
  });

  it('reads a set line and a proposal headline as the pair', () => {
    const set = { weightKg: 12.5, reps: 10, durationSeconds: null, distanceM: null };
    expect(formatSetLine(set, 'weight_reps', 'kg')).toBe('12.5 × 10');
    expect(formatSetLine(set, 'weight_reps', 'kg', false, 2)).toBe('25 × 10');
    const proposal = { sets: [{ kind: 'working', weightKg: 12.5, reps: 10 }], repsMin: 10, repsMax: 10 } as never;
    expect(proposalHeadline(proposal, 'kg')).toBe('Today 1 × 10 at 12.5 kg.');
    expect(proposalHeadline(proposal, 'kg', 2)).toBe('Today 1 × 10 at 25 kg.');
  });
});

describe('weightHeadingSuffix', () => {
  it('says which it is only where two dumbbells are in play', () => {
    expect(weightHeadingSuffix(ex(), 'each')).toBe(' each');
    expect(weightHeadingSuffix(ex(), 'pair')).toBe(' pair');
    expect(weightHeadingSuffix(ex({ dumbbells: 1 }), 'pair')).toBe('');
    expect(weightHeadingSuffix(ex({ equipment: 'barbell' as never }), 'pair')).toBe('');
    expect(DUMBBELL_ENTRY_LABELS.pair).toBe('Pair total');
  });
});
