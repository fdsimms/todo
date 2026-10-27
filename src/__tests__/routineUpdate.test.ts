import type { ExerciseKind, RoutineSetTarget, WorkoutRoutineItem, WorkoutSet } from '../types';
import { applyRoutineChanges, describeRoutineChange, routineChanges, type RoutineChange } from '../utils/routineUpdate';

const DONE = '2026-10-19T18:10:00.000Z';
const t = (kind: RoutineSetTarget['kind'], repsMin: number | null, repsMax: number | null, weightKg?: number): RoutineSetTarget =>
  ({ kind, repsMin, repsMax, ...(weightKg !== undefined ? { weightKg } : {}) });
const item = (exerciseId: string, targets: RoutineSetTarget[], extra: Partial<WorkoutRoutineItem> = {}): WorkoutRoutineItem =>
  ({ exerciseId, supersetKey: null, restSeconds: null, progression: null, targets, ...extra });

let n = 0;
const set = (exerciseId: string, position: number, setIndex: number, weightKg: number | null, reps: number | null, over: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id: `s${n++}`, sessionId: 's', exerciseId, position, setIndex, kind: 'working', weightKg, reps,
  durationSeconds: null, distanceM: null, rpe: null, completedAt: DONE, supersetKey: null, note: null, ...over,
});
const kindOf = (): ExerciseKind => 'weight_reps';
const name = (id: string) => id.toUpperCase();

const BENCH = [t('working', 8, 10, 60), t('working', 8, 10, 60), t('working', 8, 10, 60)];
const routine = [item('bench', BENCH), item('fly', [t('working', 10, 12, 20), t('working', 10, 12, 20)])];
const asPlanned = [
  set('bench', 0, 0, 60, 9), set('bench', 0, 1, 60, 9), set('bench', 0, 2, 60, 9),
  set('fly', 1, 0, 20, 11), set('fly', 1, 1, 20, 11),
];
const diff = (sets: WorkoutSet[], items = routine, suggestedKg?: (id: string) => number | null, rests: Record<string, number> = {}) =>
  routineChanges({ items, sets, kindOf, suggestedKg, restOverrides: rests, defaultRestSeconds: 90 });
const only = (cs: RoutineChange[], kind: RoutineChange['kind']) => cs.filter(c => c.kind === kind);

describe('routineChanges', () => {
  it('finds nothing when the workout went as planned', () => {
    expect(diff(asPlanned)).toEqual([]);
  });

  it('offers a lighter weight once for the exercise, not once per set', () => {
    const sets = asPlanned.map(s => (s.exerciseId === 'bench' ? { ...s, weightKg: 57.5 } : s));
    const got = diff(sets);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'weight', exerciseId: 'bench', from: 60, to: 57.5, weights: [57.5, 57.5, 57.5] });
    expect(describeRoutineChange(got[0], name, 'kg')).toEqual({
      title: 'BENCH: lighter',
      detail: 'From 60 kg to 57.5 kg on the working sets.',
    });
  });

  it('offers a rest set mid-workout, against the item\'s rest or the default, and nothing for one that matches', () => {
    const got = diff(asPlanned, routine, undefined, { bench: 150, fly: 90 });
    expect(got).toEqual([{ kind: 'rest', id: 'rest:bench', exerciseId: 'bench', from: 90, to: 150 }]);
    expect(describeRoutineChange(got[0], name, 'kg')).toEqual({
      title: 'BENCH: rest time',
      detail: 'From 1:30 to 2:30 between sets.',
    });
    const withOwn = [item('bench', BENCH, { restSeconds: 120 }), routine[1]];
    expect(diff(asPlanned, withOwn, undefined, { bench: 120 })).toEqual([]);
    expect(describeRoutineChange(diff(asPlanned, withOwn, undefined, { bench: 0 })[0], name, 'kg').detail).toBe('From 2:00 to no rest between sets.');
  });

  it('offers no rest for an exercise the workout never did, or one the routine lacks', () => {
    expect(diff(asPlanned.filter(s => s.exerciseId === 'bench'), routine, undefined, { fly: 30 })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: 'rest' })]),
    );
    expect(only(diff(asPlanned, routine, undefined, { squat: 30 }), 'rest')).toEqual([]);
  });

  it('does not offer back a load taken from the progression suggestion', () => {
    const sets = asPlanned.map(s => (s.exerciseId === 'bench' ? { ...s, weightKg: 62.5 } : s));
    expect(diff(sets, routine, id => (id === 'bench' ? 62.5 : null))).toEqual([]);
    expect(only(diff(sets, routine, () => 65), 'weight')).toHaveLength(1);
  });

  it('never offers a weight for a target that names none, since that means "as last time"', () => {
    const items = [item('bench', [t('working', 8, 10), t('working', 8, 10)])];
    const sets = [set('bench', 0, 0, 80, 9), set('bench', 0, 1, 85, 9)];
    expect(diff(sets, items)).toEqual([]);
  });

  it('offers a rep range only when every set missed it the same way', () => {
    const lower = asPlanned.map(s => (s.exerciseId === 'bench' ? { ...s, reps: s.setIndex === 0 ? 6 : 7 } : s));
    const got = only(diff(lower), 'reps');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ exerciseId: 'bench', from: { min: 8, max: 10 }, to: { min: 6, max: 7 } });
    const oneShort = asPlanned.map(s => (s.exerciseId === 'bench' && s.setIndex === 2 ? { ...s, reps: 6 } : s));
    expect(only(diff(oneShort), 'reps')).toEqual([]);
  });

  it('offers the number of sets, and the extra ones come with what was lifted', () => {
    const more = [...asPlanned, set('bench', 0, 3, 55, 8)];
    const got = only(diff(more), 'sets')[0];
    expect(got).toMatchObject({ exerciseId: 'bench', from: 3, to: 4 });
    expect(describeRoutineChange(got, name, 'kg').title).toBe('BENCH: add a set');
    const fewer = asPlanned.filter(s => !(s.exerciseId === 'fly' && s.setIndex === 1));
    expect(describeRoutineChange(only(diff(fewer), 'sets')[0], name, 'kg').title).toBe('FLY: remove a set');
  });

  it('ignores warm-ups and sets never ticked', () => {
    const noise = [
      ...asPlanned,
      set('bench', 0, 3, 20, 10, { kind: 'warmup' }),
      set('bench', 0, 4, 60, null, { completedAt: null }),
    ];
    expect(diff(noise)).toEqual([]);
  });

  it('reads an exercise added for the day as an add, placed after the one before it', () => {
    const sets = [...asPlanned, set('face-pull', 2, 0, 20, 12), set('face-pull', 2, 1, 20, 12)];
    const got = only(diff(sets), 'add');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ exerciseId: 'face-pull', afterExerciseId: 'fly' });
    expect(describeRoutineChange(got[0], name, 'kg').detail).toBe('2 sets of 12 at 20 kg, after FLY.');
  });

  it('reads an exercise in the same slot as one skipped as a swap, and one skipped alone as a removal', () => {
    const swapped = [...asPlanned.filter(s => s.exerciseId === 'fly'), ...[]].map(s => ({ ...s, position: 1 }));
    const sets = [set('db-press', 0, 0, 30, 10), set('db-press', 0, 1, 30, 10), ...swapped];
    const got = diff(sets);
    expect(only(got, 'swap')).toHaveLength(1);
    expect(only(got, 'swap')[0]).toMatchObject({ fromExerciseId: 'bench', toExerciseId: 'db-press' });
    expect(only(got, 'add')).toEqual([]);
    expect(only(got, 'remove')).toEqual([]);

    const skipped = asPlanned.filter(s => s.exerciseId === 'bench');
    expect(only(diff(skipped), 'remove')).toEqual([{ kind: 'remove', id: 'remove:fly', exerciseId: 'fly' }]);
  });

  it('offers the new running order as one change', () => {
    const swappedOrder = [
      ...asPlanned.filter(s => s.exerciseId === 'fly').map(s => ({ ...s, position: 0 })),
      ...asPlanned.filter(s => s.exerciseId === 'bench').map(s => ({ ...s, position: 1 })),
    ];
    const got = only(diff(swappedOrder), 'order');
    expect(got).toEqual([{ kind: 'order', id: 'order', exerciseIds: ['fly', 'bench'] }]);
  });
});

describe('applyRoutineChanges', () => {
  it('writes an accepted rest onto the item and leaves the others', () => {
    const next = applyRoutineChanges(routine, [{ kind: 'rest', id: 'rest:bench', exerciseId: 'bench', from: 90, to: 0 }]);
    expect(next.map(i => i.restSeconds)).toEqual([0, null]);
  });

  it('writes only the changes given, each on its own', () => {
    const sets = [
      ...asPlanned.map(s => (s.exerciseId === 'bench' ? { ...s, weightKg: 57.5 } : s)),
      set('fly', 1, 2, 20, 11),
    ];
    const all = diff(sets);
    expect(all.map(c => c.kind).sort()).toEqual(['sets', 'weight']);

    const weightOnly = applyRoutineChanges(routine, only(all, 'weight'));
    expect(weightOnly[0].targets.map(x => x.weightKg)).toEqual([57.5, 57.5, 57.5]);
    expect(weightOnly[1].targets).toHaveLength(2);

    const setsOnly = applyRoutineChanges(routine, only(all, 'sets'));
    expect(setsOnly[0].targets.map(x => x.weightKg)).toEqual([60, 60, 60]);
    expect(setsOnly[1].targets).toHaveLength(3);
    expect(routine[1].targets).toHaveLength(2);
  });

  it('removes trailing working sets and sets the rep range', () => {
    const fewer = asPlanned.filter(s => !(s.exerciseId === 'bench' && s.setIndex === 2)).map(s => (s.exerciseId === 'bench' ? { ...s, reps: 12 } : s));
    const next = applyRoutineChanges(routine, diff(fewer));
    expect(next[0].targets).toEqual([t('working', 12, 12, 60), t('working', 12, 12, 60)]);
  });

  it('swaps, adds and removes, keeping the slot a swap was made in', () => {
    const swappedSets = [set('db-press', 0, 0, 30, 10), set('db-press', 0, 1, 30, 10), set('face-pull', 1, 0, 20, 12)];
    const next = applyRoutineChanges(routine, diff(swappedSets));
    expect(next.map(i => i.exerciseId)).toEqual(['db-press', 'face-pull']);
    expect(next[0].targets.map(x => x.weightKg)).toEqual([30, 30]);
  });

  it('keeps a ramp\'s warm-ups out of a swapped item\'s targets', () => {
    const ramped = [item('bench', BENCH, { warmupRamp: true })];
    const sets = [set('db-press', 0, 0, 10, 8, { kind: 'warmup' }), set('db-press', 0, 1, 30, 10), set('db-press', 0, 2, 30, 10)];
    const next = applyRoutineChanges(ramped, diff(sets, ramped));
    expect(next[0].warmupRamp).toBe(true);
    expect(next[0].targets.every(x => x.kind !== 'warmup')).toBe(true);
  });

  it('puts the matched exercises in the new order without disturbing the others', () => {
    const three = [item('a', [t('working', 5, 5, 50)]), item('b', [t('working', 5, 5, 50)]), item('c', [t('working', 5, 5, 50)])];
    const sets = [set('c', 0, 0, 50, 5), set('a', 1, 0, 50, 5), set('b', 2, 0, 50, 5)];
    const next = applyRoutineChanges(three, diff(sets, three));
    expect(next.map(i => i.exerciseId)).toEqual(['c', 'a', 'b']);
  });

  it('caps the sets an item grows to', () => {
    const grown = applyRoutineChanges([item('a', [t('working', 5, 5, 50)])], [
      { kind: 'sets', id: 'sets:a', exerciseId: 'a', from: 1, to: 4, added: [t('working', 5, 5, 50), t('working', 5, 5, 50), t('working', 5, 5, 50)] },
    ], 2);
    expect(grown[0].targets).toHaveLength(2);
  });
});
