import type { Exercise, MuscleGroup, WorkoutSet } from '../types';
import { catalogExercise } from '../utils/exerciseCatalog';
import {
  findGaps, gapReason, gapSuggestions, muscleCredit, priorWeeks, routineSessionIds, type GapContext,
} from '../utils/workoutGaps';
import type { MuscleInfo, MuscleWeek } from '../utils/workoutRecords';

const none: Exercise[] = [];
const infoOf = (id: string): MuscleInfo | null => {
  const e = catalogExercise(none, id);
  return e ? { kind: e.kind, primaryMuscles: e.primaryMuscles, secondaryMuscles: e.secondaryMuscles } : null;
};
const set = (exerciseId: string, kind: WorkoutSet['kind'] = 'working', done = true): Pick<WorkoutSet, 'exerciseId' | 'kind' | 'completedAt'> =>
  ({ exerciseId, kind, completedAt: done ? '2026-11-01T10:00:00' : null });
const times = <T,>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

const PULL = 'lib:lat-pulldown';
const PRESS = 'lib:dumbbell-shoulder-press';
const LATERAL = 'lib:dumbbell-lateral-raise';
const ctxOf = (over: Partial<GapContext> = {}): GapContext => ({ routineName: null, routineSessions: [], weeks: [], thisWeek: undefined, ...over });
const week = (sets: Partial<Record<MuscleGroup, number>>): Map<MuscleGroup, MuscleWeek> =>
  new Map(Object.entries(sets).map(([m, n]) => [m as MuscleGroup, { sets: n as number, volumeKg: 0 }]));

describe('muscleCredit', () => {
  it('gives a primary muscle a set and a helping one half, and ignores warm-ups and unknown exercises', () => {
    const got = muscleCredit([set(PULL), set(PULL), set(PULL, 'warmup'), set('lib:nobody')], infoOf);
    expect(got.get('lats')).toBe(2);
    expect(got.get('biceps')).toBe(1);
    expect(got.get('upper_back')).toBe(1);
  });
});

describe('findGaps from the routine', () => {
  const past = [...times(4, () => set(LATERAL)), ...times(3, () => set(PULL))];
  it('flags what the last sessions trained and this one has not, biggest shortfall first', () => {
    const { source, gaps } = findGaps(times(3, () => set(PULL)), ctxOf({ routineName: 'Upper A', routineSessions: [past, past] }), infoOf);
    expect(source).toBe('routine');
    expect(gaps.map(g => g.muscle)).toEqual(['side_delts', 'biceps', 'traps'].filter(m => gaps.some(g => g.muscle === m)));
    expect(gaps[0]).toMatchObject({ muscle: 'side_delts', usual: 4, have: 0 });
    expect(gaps.some(g => g.muscle === 'lats')).toBe(false);
  });

  it('ignores a muscle with too few usual sets, and one already half done', () => {
    const little = [set(LATERAL)];
    expect(findGaps([], ctxOf({ routineName: 'A', routineSessions: [little] }), infoOf).gaps).toEqual([]);
    const half = findGaps(times(2, () => set(LATERAL)), ctxOf({ routineName: 'A', routineSessions: [past] }), infoOf).gaps;
    expect(half.some(g => g.muscle === 'side_delts')).toBe(false);
  });

  it('counts planned sets as hit, and warm-ups of past sessions as nothing', () => {
    const planned = [set(LATERAL, 'working', false), set(LATERAL, 'working', false), set(LATERAL, 'working', false)];
    expect(findGaps(planned, ctxOf({ routineName: 'A', routineSessions: [past] }), infoOf).gaps.some(g => g.muscle === 'side_delts')).toBe(false);
    const warmups = times(6, () => set(LATERAL, 'warmup'));
    expect(findGaps([], ctxOf({ routineName: 'A', routineSessions: [warmups] }), infoOf).gaps).toEqual([]);
  });

  it('offers at most three muscles', () => {
    const wide = ['lib:dumbbell-bench-press', 'lib:dumbbell-curl', LATERAL, 'lib:back-squat', PULL].flatMap(id => times(4, () => set(id)));
    expect(findGaps([], ctxOf({ routineName: 'A', routineSessions: [wide] }), infoOf).gaps).toHaveLength(3);
  });
});

describe('findGaps from the week', () => {
  const usual = week({ quads: 8, lats: 10 });
  it('flags a muscle well behind its usual week, counting earlier workouts this week and this one', () => {
    const ctx = ctxOf({ weeks: [usual, usual, usual] });
    expect(findGaps([], ctx, infoOf).gaps.map(g => g.muscle)).toEqual(['lats', 'quads']);
    const done = ctxOf({ weeks: [usual, usual], thisWeek: week({ lats: 8 }) });
    expect(findGaps([], done, infoOf).gaps.map(g => g.muscle)).toEqual(['quads']);
    expect(findGaps(times(5, () => set('lib:back-squat')), ctx, infoOf).gaps.map(g => g.muscle)).toEqual(['lats']);
  });

  it('says nothing with fewer than two trained weeks, and skips a week with no training', () => {
    expect(findGaps([], ctxOf({ weeks: [usual] }), infoOf).gaps).toEqual([]);
    expect(findGaps([], ctxOf({ weeks: [usual, new Map(), usual] }), infoOf).gaps.length).toBeGreaterThan(0);
  });

  it('prefers the routine when it has history', () => {
    expect(findGaps([], ctxOf({ routineName: 'A', routineSessions: [[set(PULL), set(PULL)]], weeks: [usual, usual] }), infoOf).source).toBe('routine');
    expect(findGaps([], ctxOf({ routineName: 'A', routineSessions: [], weeks: [usual, usual] }), infoOf).source).toBe('week');
  });
});

describe('priorWeeks and routineSessionIds', () => {
  it('takes the four weeks before this one, newest first', () => {
    const m = new Map([['2026-10-05', week({})], ['2026-10-12', week({})], ['2026-10-19', week({})], ['2026-10-26', week({})], ['2026-11-02', week({})], ['2026-11-09', week({})]]);
    const got = priorWeeks(m, '2026-11-09');
    expect(got).toHaveLength(4);
    expect(got[0]).toBe(m.get('2026-11-02'));
  });

  it('takes the routine\'s last three finished sessions, not the live one', () => {
    const s = (id: string, startedAt: string, routineId: string | null = 'r', endedAt: string | null = 'x') => ({ id, routineId, startedAt, endedAt });
    const ids = routineSessionIds([
      s('a', '2026-10-01'), s('b', '2026-10-08'), s('c', '2026-10-15'), s('d', '2026-10-22'), s('live', '2026-11-01', 'r', null),
      s('other', '2026-10-29', 'q'), s('self', '2026-11-02'),
    ], 'r', 'self');
    expect(ids).toEqual(['d', 'c', 'b']);
  });
});

describe('gapReason', () => {
  it('names the muscle and how far behind it is', () => {
    expect(gapReason({ muscle: 'chest', usual: 6, have: 0 }, 'routine', 'Upper A')).toBe('Chest: usually 6 sets in Upper A');
    expect(gapReason({ muscle: 'chest', usual: 1, have: 0 }, 'routine', 'Upper A')).toBe('Chest: usually 1 set in Upper A');
    expect(gapReason({ muscle: 'quads', usual: 8, have: 0 }, 'week', null)).toBe('Quads: none yet this week');
    expect(gapReason({ muscle: 'quads', usual: 8, have: 2.5 }, 'week', null)).toBe('Quads: 2.5 of your usual 8 sets this week');
  });
});

describe('gapSuggestions', () => {
  const gaps = [{ muscle: 'side_delts' as const, usual: 4, have: 0 }, { muscle: 'triceps' as const, usual: 5, have: 0 }];
  it('offers one exercise per gap muscle that trains it, none twice, never what the workout has', () => {
    const got = gapSuggestions(none, gaps, 'routine', 'Upper A', { exceptIds: [PULL] });
    expect(got.map(g => g.muscle)).toEqual(['side_delts', 'triceps']);
    expect(new Set(got.map(g => g.exerciseId)).size).toBe(2);
    expect(catalogExercise(none, got[0].exerciseId)!.primaryMuscles).toContain('side_delts');
    const without = gapSuggestions(none, gaps, 'routine', 'Upper A', { exceptIds: [got[0].exerciseId] });
    expect(without[0].exerciseId).not.toBe(got[0].exerciseId);
  });

  it('leads with an exercise the person has logged', () => {
    const got = gapSuggestions(none, gaps, 'routine', 'A', { exceptIds: [], knownIds: new Set(['lib:cable-lateral-raise']) });
    expect(got[0].exerciseId).toBe('lib:cable-lateral-raise');
  });

  it('leaves out what the gym cannot do', () => {
    const gym = { equipment: ['dumbbell' as const] };
    const got = gapSuggestions(none, gaps, 'routine', 'A', { exceptIds: [], gym });
    for (const g of got) expect(catalogExercise(none, g.exerciseId)!.equipment).not.toBe('cable');
  });

  it('says what a swap gives up', () => {
    const leaving = { info: infoOf(PRESS)!, haveAfter: new Map<MuscleGroup, number>() };
    const known = new Set(['lib:triceps-pushdown']);
    const got = gapSuggestions(none, [gaps[1]], 'routine', 'A', { exceptIds: [], knownIds: known, leaving });
    expect(got[0].reason).toContain('would drop to 0');
    expect(got[0].reason).toContain('Front delts');
    const kept = gapSuggestions(none, [gaps[1]], 'routine', 'A', { exceptIds: [], knownIds: known, leaving: { info: leaving.info, haveAfter: new Map([['front_delts', 3]]) } });
    expect(kept[0].reason).not.toContain('drop');
  });
});
