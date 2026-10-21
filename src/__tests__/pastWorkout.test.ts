import { buildPastWorkout, nextSetText, pastWorkoutTouched, type PastExerciseDraft } from '../utils/pastWorkout';

const now = new Date(2026, 9, 21, 20, 0);
const start = new Date(2026, 9, 20, 18, 15);
const bench: PastExerciseDraft = { exerciseId: 'bench', kind: 'weight_reps', sets: [{ weight: '60', reps: '8' }, { weight: '60', reps: '6' }] };

const build = (exercises: PastExerciseDraft[], over: Partial<Parameters<typeof buildPastWorkout>[0]> = {}) =>
  buildPastWorkout({ title: 'Push day', start, minutes: 45, exercises, unit: 'kg', now, ...over });

describe('buildPastWorkout', () => {
  it('ends the workout its length after the start and keeps the sets in order', () => {
    const result = build([bench]);
    if (!('input' in result)) throw new Error('refused');
    expect(result.input.startedAt).toBe(start.toISOString());
    expect(result.input.endedAt).toBe(new Date(start.getTime() + 45 * 60_000).toISOString());
    expect(result.input.sets).toEqual([
      { exerciseId: 'bench', weightKg: 60, reps: 8 },
      { exerciseId: 'bench', weightKg: 60, reps: 6 },
    ]);
  });

  it('reads weights in the unit shown', () => {
    const result = build([{ ...bench, sets: [{ weight: '135', reps: '5' }] }], { unit: 'lb' });
    if (!('input' in result)) throw new Error('refused');
    expect(result.input.sets[0].weightKg).toBeCloseTo(61.235, 3);
  });

  it('drops a set with nothing in it and refuses a workout with no sets at all', () => {
    const result = build([{ ...bench, sets: [{ weight: '60', reps: '8' }, {}, { weight: '', reps: ' ' }] }]);
    if (!('input' in result)) throw new Error('refused');
    expect(result.input.sets).toHaveLength(1);
    expect(build([{ ...bench, sets: [{}] }])).toEqual({ problem: 'empty' });
    expect(build([])).toEqual({ problem: 'empty' });
  });

  it('names the set whose text is not a number instead of dropping it', () => {
    expect(build([{ ...bench, sets: [{ weight: '60', reps: '8' }, { weight: 'heavy', reps: '8' }] }]))
      .toEqual({ problem: 'invalid', exerciseId: 'bench', setNumber: 2 });
  });

  it('refuses a workout that would end in the future', () => {
    expect(build([bench], { start: new Date(2026, 9, 21, 19, 30) })).toEqual({ problem: 'future' });
  });

  it('only reads the columns the exercise kind has', () => {
    const pushUp: PastExerciseDraft = { exerciseId: 'pushup', kind: 'bodyweight_reps', sets: [{ weight: 'junk', reps: '20' }] };
    const result = build([pushUp]);
    if (!('input' in result)) throw new Error('refused');
    expect(result.input.sets).toEqual([{ exerciseId: 'pushup', reps: 20 }]);
  });

  it('asks for the Health write only when told to', () => {
    const on = build([bench], { healthWritePending: true });
    const off = build([bench]);
    if (!('input' in on) || !('input' in off)) throw new Error('refused');
    expect(on.input.healthWritePending).toBe(true);
    expect(off.input.healthWritePending).toBe(false);
  });
});

describe('nextSetText', () => {
  it('repeats the last set, and starts blank under an exercise with none', () => {
    expect(nextSetText([{ weight: '50' }, { weight: '60', reps: '8' }])).toEqual({ weight: '60', reps: '8' });
    expect(nextSetText([])).toEqual({});
  });
});

describe('pastWorkoutTouched', () => {
  it('is true once there is a name or an exercise', () => {
    expect(pastWorkoutTouched('', [])).toBe(false);
    expect(pastWorkoutTouched(' x ', [])).toBe(true);
    expect(pastWorkoutTouched('', [bench])).toBe(true);
  });
});
