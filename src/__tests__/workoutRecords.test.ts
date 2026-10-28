import type { WorkoutSet } from '../types';
import {
  E1RM_MAX_REPS,
  SECONDARY_MUSCLE_WEIGHT,
  analyzeAll,
  analyzeExercise,
  countsForRecords,
  estimatedOneRepMax,
  isNewRecord,
  isNewRecordRow,
  liftVolumeKg,
  liveSetRecords,
  metricsFor,
  muscleWeeks,
  recentRecords,
  recentWeekBars,
  recordSessions,
  recordsInSession,
  sessionDayKey,
  sessionRecordSummary,
  sessionsPerWeek,
  setVolume,
  summarizeRecords,
  topMuscles,
  trainingDays,
  volumeUnit,
  weekKeyOf,
  type MuscleInfo,
  type RecordSession,
} from '../utils/workoutRecords';

const BENCH = 'lib:barbell-bench-press';

/** A session on a local day at noon, so a day key never depends on the zone. */
function session(id: string, month: number, day: number, hour = 12): RecordSession {
  const d = new Date(2026, month - 1, day, hour);
  return { id, startedAt: d.toISOString(), dayKey: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

let n = 0;
function set(sessionId: string, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  n += 1;
  return {
    id: `set-${n}`, sessionId, exerciseId: BENCH, position: 0, setIndex: n, kind: 'working',
    weightKg: 80, reps: 8, durationSeconds: null, distanceM: null, rpe: null,
    completedAt: '2026-10-01T10:00:00.000Z', supersetKey: null, note: null, ...extra,
  };
}

describe('estimatedOneRepMax', () => {
  it('is Epley: weight times one plus reps over thirty, to the nearest tenth of a kilogram', () => {
    expect(estimatedOneRepMax(82.5, 8)).toBe(104.5);
    expect(estimatedOneRepMax(80, 8)).toBe(101.3);
    expect(estimatedOneRepMax(100, 5)).toBe(116.7);
  });

  it('takes a single as the weight itself, since Epley would add a thirtieth to a lift that was done', () => {
    expect(estimatedOneRepMax(140, 1)).toBe(140);
  });

  it(`reads only sets of ${E1RM_MAX_REPS} reps or fewer`, () => {
    expect(estimatedOneRepMax(60, E1RM_MAX_REPS)).toBe(80);
    expect(estimatedOneRepMax(60, E1RM_MAX_REPS + 1)).toBeNull();
    expect(estimatedOneRepMax(20, 25)).toBeNull();
  });

  it('says nothing without a weight and reps', () => {
    expect(estimatedOneRepMax(null, 5)).toBeNull();
    expect(estimatedOneRepMax(80, null)).toBeNull();
    expect(estimatedOneRepMax(0, 5)).toBeNull();
    expect(estimatedOneRepMax(80, 0)).toBeNull();
  });
});

describe('what counts', () => {
  it('counts done working sets and leaves out warm-ups and planned sets', () => {
    expect(countsForRecords({ kind: 'working', completedAt: 'x' })).toBe(true);
    expect(countsForRecords({ kind: 'drop', completedAt: 'x' })).toBe(true);
    expect(countsForRecords({ kind: 'amrap', completedAt: 'x' })).toBe(true);
    expect(countsForRecords({ kind: 'warmup', completedAt: 'x' })).toBe(false);
    expect(countsForRecords({ kind: 'working', completedAt: null })).toBe(false);
  });
});

describe('liftVolumeKg', () => {
  const kinds: Record<string, 'weight_reps' | 'bodyweight_reps'> = { pullup: 'bodyweight_reps' };
  const kindOf = (id: string) => kinds[id] ?? 'weight_reps';

  it('sums weight times reps over the done working sets of weighted lifts', () => {
    const sets = [set('s1'), set('s1', { weightKg: 100, reps: 5 })];
    expect(liftVolumeKg(sets, kindOf)).toBe(80 * 8 + 100 * 5);
  });

  it('leaves out warm-ups, planned sets, other kinds of exercise and sets missing a figure', () => {
    const sets = [
      set('s1', { kind: 'warmup' }),
      set('s1', { completedAt: null }),
      set('s1', { exerciseId: 'pullup', weightKg: null, reps: 10 }),
      set('s1', { reps: null }),
      set('s1', { weightKg: 50, reps: 10 }),
    ];
    expect(liftVolumeKg(sets, kindOf)).toBe(500);
  });

  it('is null, not zero, when nothing qualifies', () => {
    expect(liftVolumeKg([], kindOf)).toBeNull();
    expect(liftVolumeKg([set('s1', { exerciseId: 'pullup' })], kindOf)).toBeNull();
  });
});

describe('setVolume', () => {
  const s = { weightKg: 50, reps: 10, durationSeconds: 45, distanceM: 400 };

  it('is weight times reps for a weighted lift and reps alone for a bodyweight one', () => {
    expect(setVolume(s, 'weight_reps')).toBe(500);
    expect(setVolume(s, 'bodyweight_reps')).toBe(10);
  });

  it('never multiplies an assisted set by its assistance', () => {
    expect(setVolume(s, 'assisted_reps')).toBe(10);
  });

  it('is seconds for a hold and metres for a distance or a carry', () => {
    expect(setVolume(s, 'duration')).toBe(45);
    expect(setVolume(s, 'distance')).toBe(400);
    expect(setVolume(s, 'weight_distance')).toBe(400);
  });

  it('is null when the set lacks what the kind needs', () => {
    expect(setVolume({ ...s, reps: null }, 'weight_reps')).toBeNull();
    expect(setVolume({ ...s, weightKg: null }, 'weight_reps')).toBeNull();
  });

  it('names a unit per kind, and a one-rep max only for weight and reps', () => {
    expect(volumeUnit('weight_reps')).toBe('kg');
    expect(volumeUnit('bodyweight_reps')).toBe('reps');
    expect(volumeUnit('duration')).toBe('seconds');
    expect(volumeUnit('weight_distance')).toBe('m');
    expect(metricsFor('weight_reps')).toEqual(['e1rm', 'best', 'volume']);
    expect(metricsFor('bodyweight_reps')).toEqual(['best', 'volume']);
  });
});

describe('analyzeExercise, weight and reps', () => {
  const s1 = session('s1', 9, 1);
  const s2 = session('s2', 9, 8);
  const s3 = session('s3', 9, 15);
  const sessions = [s1, s2, s3];

  it('draws one point per session with its best estimated 1RM, heaviest set and volume', () => {
    const sets = [
      set('s1', { weightKg: 80, reps: 8 }), set('s1', { weightKg: 80, reps: 6 }),
      set('s2', { weightKg: 82.5, reps: 8 }),
    ];
    const { points } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(points.map(p => p.dayKey)).toEqual(['2026-09-01', '2026-09-08']);
    expect(points[0].e1rm).toBe(101.3);
    expect(points[0].best).toMatchObject({ value: 80 });
    expect(points[0].volume).toBe(80 * 8 + 80 * 6);
    expect(points[0].sets).toBe(2);
    expect(points[1].e1rm).toBe(104.5);
  });

  it('keeps a warm-up and a planned set out of every figure', () => {
    const sets = [
      set('s1', { kind: 'warmup', weightKg: 140, reps: 3 }),
      set('s1', { completedAt: null, weightKg: 200, reps: 1 }),
      set('s1', { weightKg: 80, reps: 8 }),
    ];
    const { points, records } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(points[0].best?.value).toBe(80);
    expect(points[0].volume).toBe(640);
    expect(records.find(r => r.type === 'weight')?.value).toBe(80);
  });

  it('takes the estimate from sets of ten or fewer only, so a long set leaves a gap rather than a number', () => {
    const sets = [set('s1', { weightKg: 40, reps: 20 })];
    const { points } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(points[0].e1rm).toBeNull();
    expect(points[0].best?.value).toBe(40);
  });

  it('announces a new estimated 1RM, heaviest weight and volume against everything before the session', () => {
    const sets = [
      set('s1', { weightKg: 80, reps: 8 }),
      set('s2', { weightKg: 82.5, reps: 8 }), set('s2', { weightKg: 82.5, reps: 8 }),
    ];
    const { events } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    const types = events.filter(e => e.sessionId === 's2').map(e => e.type);
    expect(types).toEqual(expect.arrayContaining(['e1rm', 'weight', 'repsAt', 'volume']));
    const e1rm = events.find(e => e.type === 'e1rm')!;
    expect(e1rm).toMatchObject({ value: 104.5, previous: 101.3, dayKey: '2026-09-08' });
  });

  it('does not call a first time a record', () => {
    const { events } = analyzeExercise(BENCH, 'weight_reps', [set('s1', { weightKg: 100, reps: 5 })], sessions);
    expect(events).toEqual([]);
  });

  it('judges a session as a whole: three improving sets are one record, at the best figure', () => {
    const sets = [
      set('s1', { weightKg: 80, reps: 8 }),
      set('s2', { weightKg: 82.5, reps: 5 }), set('s2', { weightKg: 85, reps: 5 }), set('s2', { weightKg: 87.5, reps: 5 }),
    ];
    const { events } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(events.filter(e => e.type === 'weight')).toEqual([expect.objectContaining({ value: 87.5, previous: 80 })]);
  });

  it('holds no record and fires no event for a set with no reps (a failed 140 x 0)', () => {
    const sets = [set('s1', { weightKg: 100, reps: 5 }), set('s2', { weightKg: 140, reps: 0 }), set('s3', { weightKg: 140, reps: null })];
    const a = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(a.events).toEqual([]);
    expect(a.records.find(r => r.type === 'weight')?.value).toBe(100);
    expect(a.points.find(p => p.sessionId === 's2')?.best).toBeNull();
    expect(a.points.find(p => p.sessionId === 's3')?.best).toBeNull();
  });

  it('holds no record for a loaded carry with no distance', () => {
    const sets = [
      set('s1', { exerciseId: 'c', weightKg: 32, reps: null, distanceM: 40 }),
      set('s2', { exerciseId: 'c', weightKg: 60, reps: null, distanceM: 0 }),
    ];
    const a = analyzeExercise('c', 'weight_distance', sets, sessions);
    expect(a.events).toEqual([]);
    expect(a.records.find(r => r.type === 'weight')?.value).toBe(32);
  });

  it('announces nothing for a session that only ties', () => {
    const sets = [set('s1'), set('s2')];
    expect(analyzeExercise(BENCH, 'weight_reps', sets, sessions).events).toEqual([]);
  });

  it('is chronological whatever order the sessions arrive in, once they go through recordSessions', () => {
    const sets = [set('s2', { weightKg: 90, reps: 3 }), set('s1', { weightKg: 80, reps: 8 })];
    const ordered = recordSessions([s2, s1, s3], '00:00');
    expect(ordered.map(s => s.id)).toEqual(['s1', 's2', 's3']);
    const { events } = analyzeExercise(BENCH, 'weight_reps', sets, ordered);
    expect(events.map(e => e.type)).toContain('weight');
    expect(events.every(e => e.dayKey === '2026-09-08')).toBe(true);
  });

  it('lists a best set of N only while the set holding it has exactly N reps', () => {
    const sets = [
      set('s1', { weightKg: 80, reps: 8 }), set('s1', { weightKg: 90, reps: 3 }),
      set('s2', { weightKg: 80, reps: 10 }),
    ];
    const { records } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    const reps = records.filter(r => r.type === 'repsAt');
    // 80 x 10 dominates 80 x 8, so there is no separate "best of 8", and 90 x 3 dominates every count up to 3.
    expect(reps.map(r => r.reps)).toEqual([3, 10]);
    expect(reps.find(r => r.reps === 3)).toMatchObject({ value: 90 });
    expect(reps.find(r => r.reps === 10)).toMatchObject({ value: 80 });
  });

  it('announces a best set of N only where an earlier set had done N or more reps', () => {
    const sets = [
      set('s1', { weightKg: 80, reps: 8 }),
      set('s2', { weightKg: 82.5, reps: 8 }),
      set('s3', { weightKg: 60, reps: 12 }),
    ];
    const { events } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(events.filter(e => e.type === 'repsAt')).toEqual([
      expect.objectContaining({ sessionId: 's2', reps: 8, value: 82.5, previous: 80 }),
    ]);
  });

  it('puts the personal records in display order with the day each was set', () => {
    const sets = [
      set('s1', { weightKg: 80, reps: 8 }),
      set('s2', { weightKg: 90, reps: 3 }),
    ];
    const { records } = analyzeExercise(BENCH, 'weight_reps', sets, sessions);
    expect(records.map(r => r.type)).toEqual(['e1rm', 'weight', 'repsAt', 'repsAt', 'volume']);
    expect(records[0]).toMatchObject({ value: 101.3, dayKey: '2026-09-01' });
    expect(records[1]).toMatchObject({ value: 90, dayKey: '2026-09-08' });
    expect(records[records.length - 1]).toMatchObject({ type: 'volume', value: 640, set: null });
  });

  it('is empty for an exercise with no sets and ignores sets of sessions nobody knows', () => {
    expect(analyzeExercise(BENCH, 'weight_reps', [], sessions)).toMatchObject({ points: [], records: [], events: [] });
    expect(analyzeExercise(BENCH, 'weight_reps', [set('gone')], sessions).points).toEqual([]);
  });

  it('is memoized per array of sets', () => {
    const sets = [set('s1')];
    expect(analyzeExercise(BENCH, 'weight_reps', sets, sessions)).toBe(analyzeExercise(BENCH, 'weight_reps', sets, sessions));
    expect(analyzeExercise(BENCH, 'bodyweight_reps', sets, sessions)).not.toBe(analyzeExercise(BENCH, 'weight_reps', sets, sessions));
  });
});

describe('analyzeExercise, the other kinds', () => {
  const sessions = [session('s1', 9, 1), session('s2', 9, 8)];
  const PULLUP = 'lib:pull-up';

  it('ranks a bodyweight exercise by reps and adds no body weight to its volume', () => {
    const sets = [
      set('s1', { exerciseId: PULLUP, weightKg: null, reps: 8 }), set('s1', { exerciseId: PULLUP, weightKg: null, reps: 7 }),
      set('s2', { exerciseId: PULLUP, weightKg: null, reps: 10 }),
    ];
    const a = analyzeExercise(PULLUP, 'bodyweight_reps', sets, sessions);
    expect(a.points[0]).toMatchObject({ e1rm: null, volume: 15 });
    expect(a.points[0].best?.value).toBe(8);
    expect(a.records.map(r => r.type)).toEqual(['best', 'volume']);
    expect(a.events.map(e => e.type)).toEqual(['best']);
    expect(a.events[0]).toMatchObject({ value: 10, previous: 8 });
  });

  it('ranks a hold by its longest set and sums seconds', () => {
    const sets = [
      set('s1', { exerciseId: 'p', weightKg: null, reps: null, durationSeconds: 40 }),
      set('s2', { exerciseId: 'p', weightKg: null, reps: null, durationSeconds: 55 }),
      set('s2', { exerciseId: 'p', weightKg: null, reps: null, durationSeconds: 30 }),
    ];
    const a = analyzeExercise('p', 'duration', sets, sessions);
    expect(a.points.map(p => p.best?.value)).toEqual([40, 55]);
    expect(a.points[1].volume).toBe(85);
    expect(a.records).toEqual([
      expect.objectContaining({ type: 'best', value: 55 }),
      expect.objectContaining({ type: 'volume', value: 85 }),
    ]);
  });

  it('ranks a carry by its heaviest load and sums the metres', () => {
    const sets = [
      set('s1', { exerciseId: 'c', weightKg: 32, reps: null, distanceM: 40 }),
      set('s2', { exerciseId: 'c', weightKg: 40, reps: null, distanceM: 40 }),
    ];
    const a = analyzeExercise('c', 'weight_distance', sets, sessions);
    expect(a.records.map(r => [r.type, r.value])).toEqual([['weight', 40], ['volume', 40]]);
    expect(a.events.map(e => e.type)).toEqual(['weight']);
  });
});

describe('analyzeAll and the readings of it', () => {
  const sessions = [session('s1', 9, 1), session('s2', 9, 8), session('s3', 10, 6)];
  const ROW = 'lib:barbell-row';
  const sets = [
    set('s1', { weightKg: 80, reps: 8 }),
    set('s1', { exerciseId: ROW, weightKg: 60, reps: 8 }),
    set('s2', { weightKg: 82.5, reps: 8 }),
    set('s3', { exerciseId: ROW, weightKg: 70, reps: 8 }),
  ];
  const kindOf = () => 'weight_reps' as const;

  it('keys an analysis per exercise and is memoized per array and kind function', () => {
    const all = analyzeAll(sets, sessions, kindOf);
    expect([...all.keys()].sort()).toEqual([ROW, BENCH].sort());
    expect(analyzeAll(sets, sessions, kindOf)).toBe(all);
  });

  it('finds the records a session broke, across exercises', () => {
    const all = analyzeAll(sets, sessions, kindOf);
    expect(recordsInSession(all.values(), 's2').every(e => e.exerciseId === BENCH)).toBe(true);
    expect(recordsInSession(all.values(), 's3').map(e => e.exerciseId)).toContain(ROW);
    expect(recordsInSession(all.values(), 's1')).toEqual([]);
  });

  it('summarizes a session by exercise, most notable first and capped', () => {
    const events = recordsInSession(analyzeAll(sets, sessions, kindOf).values(), 's2');
    const [bench] = summarizeRecords(events);
    expect(bench.exerciseId).toBe(BENCH);
    expect(bench.records[0].type).toBe('e1rm');
    expect(bench.records.length).toBeLessThanOrEqual(3);
  });

  it('lists recent records newest first, one per exercise and session, within a month', () => {
    const all = analyzeAll(sets, sessions, kindOf);
    const recent = recentRecords(all.values(), '2026-10-10');
    expect(recent.map(e => e.sessionId)).toEqual(['s3']);
    expect(recent[0].type).toBe('e1rm');
    // Two months on, the same records are no longer recent.
    expect(recentRecords(all.values(), '2026-12-20')).toEqual([]);
    expect(recentRecords(all.values(), '2026-10-10', 0)).toEqual([]);
  });

  it('calls a record new for two weeks after the day it was set', () => {
    expect(isNewRecord('2026-10-14', '2026-10-14')).toBe(true);
    expect(isNewRecord('2026-10-01', '2026-10-14')).toBe(true);
    expect(isNewRecord('2026-09-29', '2026-10-14')).toBe(false);
    expect(isNewRecord('2026-10-20', '2026-10-14')).toBe(false);
  });
});

describe('sessionRecordSummary', () => {
  const ROW = 'lib:barbell-row';
  // Raw sessions, as the store holds them: the helper works out the days itself.
  const sessions = [
    { id: 's1', startedAt: new Date(2026, 8, 1, 18).toISOString() },
    { id: 's2', startedAt: new Date(2026, 8, 8, 18).toISOString() },
    { id: 's3', startedAt: new Date(2026, 9, 6, 18).toISOString() },
  ];
  const history: Record<string, WorkoutSet[]> = {
    [BENCH]: [set('s1', { weightKg: 80, reps: 8 }), set('s2', { weightKg: 82.5, reps: 8 }), set('s3', { weightKg: 90, reps: 8 })],
    [ROW]: [set('s1', { exerciseId: ROW, weightKg: 60, reps: 8 }), set('s2', { exerciseId: ROW, weightKg: 55, reps: 8 })],
  };
  const kindOf = () => 'weight_reps' as const;
  const historyOf = (id: string) => history[id] ?? [];

  it('lists what the session beat, grouped by exercise, as the finish summary does', () => {
    const [bench, ...rest] = sessionRecordSummary('s2', [BENCH, ROW], kindOf, historyOf, sessions, '00:00');
    expect(rest).toEqual([]);
    expect(bench.exerciseId).toBe(BENCH);
    expect(bench.records[0]).toMatchObject({ type: 'e1rm', previous: 101.3, value: 104.5 });
    expect(bench.records.length).toBeLessThanOrEqual(3);
  });

  it('keeps an old workout\'s records although a later one has beaten them', () => {
    expect(sessionRecordSummary('s2', [BENCH], kindOf, historyOf, sessions, '00:00')).toHaveLength(1);
    expect(sessionRecordSummary('s3', [BENCH], kindOf, historyOf, sessions, '00:00')).toHaveLength(1);
  });

  it('is empty for a first time, a session that beat nothing, and no exercises', () => {
    expect(sessionRecordSummary('s1', [BENCH, ROW], kindOf, historyOf, sessions, '00:00')).toEqual([]);
    expect(sessionRecordSummary('s2', [ROW], kindOf, historyOf, sessions, '00:00')).toEqual([]);
    expect(sessionRecordSummary('s2', [], kindOf, historyOf, sessions, '00:00')).toEqual([]);
  });

  it('reads each exercise as its own kind', () => {
    // As a bodyweight exercise the weight is not looked at, so a heavier set
    // at the same reps is no record at all.
    const asBodyweight = sessionRecordSummary('s2', [BENCH], () => 'bodyweight_reps', historyOf, sessions, '00:00');
    expect(asBodyweight).toEqual([]);
  });
});

describe('liveSetRecords', () => {
  const sessions = [
    { id: 's1', startedAt: new Date(2026, 8, 1, 18).toISOString() },
    { id: 's2', startedAt: new Date(2026, 8, 8, 18).toISOString() },
  ];
  const live = (history: WorkoutSet[]) => liveSetRecords('s2', BENCH, 'weight_reps', history, sessions, '00:00');

  it('marks the set that beat the earlier sessions, most notable record first', () => {
    const old = set('s1', { weightKg: 80, reps: 8 });
    const best = set('s2', { weightKg: 90, reps: 8 });
    const warm = set('s2', { weightKg: 40, reps: 8 });
    const marks = live([old, warm, best]);
    expect([...marks.keys()]).toEqual([best.id]);
    expect(marks.get(best.id)![0].type).toBe('e1rm');
  });

  it('moves the mark to a later set that beats the first', () => {
    const old = set('s1', { weightKg: 80, reps: 8 });
    const first = set('s2', { weightKg: 85, reps: 8 });
    const second = set('s2', { weightKg: 90, reps: 8 });
    expect([...live([old, first, second]).keys()]).toEqual([second.id]);
  });

  it('marks nothing for a first time, an unticked set, or a session volume', () => {
    expect(live([set('s2', { weightKg: 90, reps: 8 })]).size).toBe(0);
    const old = set('s1', { weightKg: 80, reps: 8 });
    expect(live([old, set('s2', { weightKg: 100, reps: 8, completedAt: null })]).size).toBe(0);
    // Same weight and reps over more sets raises the volume only.
    expect(live([old, set('s2', { weightKg: 80, reps: 8 }), set('s2', { weightKg: 80, reps: 8 })]).size).toBe(0);
  });
});

describe('isNewRecordRow', () => {
  const s1 = session('s1', 10, 1);
  const s2 = session('s2', 10, 8);
  const today = '2026-10-10';
  const badged = (sets: WorkoutSet[]) => {
    const a = analyzeExercise(BENCH, 'weight_reps', sets, [s1, s2]);
    return a.records.filter(r => isNewRecordRow(r, a.events, today)).map(r => r.type + (r.reps ?? ''));
  };

  it('badges nothing after a first session, however recent', () => {
    expect(badged([set('s1', { weightKg: 100, reps: 5 })])).toEqual([]);
  });

  it('does not badge heaviest weight when the same weight was done for more reps', () => {
    const rows = badged([set('s1', { weightKg: 100, reps: 3 }), set('s2', { weightKg: 100, reps: 5 })]);
    expect(rows).not.toContain('weight');
    expect(rows).toContain('e1rm');
  });

  it('badges the rows a recent session really broke', () => {
    const rows = badged([set('s1', { weightKg: 100, reps: 3 }), set('s2', { weightKg: 105, reps: 3 })]);
    expect(rows).toEqual(expect.arrayContaining(['weight', 'e1rm', 'repsAt3']));
  });

  it('keeps the badge when a later session equals the record with more reps', () => {
    const s3 = session('s3', 10, 9);
    const sets = [set('s1', { weightKg: 100, reps: 5 }), set('s2', { weightKg: 105, reps: 5 }), set('s3', { weightKg: 105, reps: 6 })];
    const a = analyzeExercise(BENCH, 'weight_reps', sets, [s1, s2, s3]);
    const weight = a.records.find(r => r.type === 'weight')!;
    expect(weight.sessionId).toBe('s3');
    expect(isNewRecordRow(weight, a.events, today)).toBe(true);
  });

  it('lets the badge lapse once the record is older than the window', () => {
    const a = analyzeExercise(BENCH, 'weight_reps', [set('s1', { weightKg: 100, reps: 3 }), set('s2', { weightKg: 105, reps: 3 })], [s1, s2]);
    expect(a.records.some(r => isNewRecordRow(r, a.events, '2026-11-30'))).toBe(false);
  });
});

describe('days and weeks', () => {
  it('puts a small-hours session on the previous logical day', () => {
    const at = new Date(2026, 9, 14, 1, 30).toISOString();
    expect(sessionDayKey(at, '00:00')).toBe('2026-10-14');
    expect(sessionDayKey(at, '04:00')).toBe('2026-10-13');
  });

  it('counts only finished workouts as training days, never a live one', () => {
    const finished = { id: 'a', startedAt: new Date(2026, 9, 12, 18).toISOString(), endedAt: new Date(2026, 9, 12, 19).toISOString() };
    const live = { id: 'b', startedAt: new Date(2026, 9, 13, 18).toISOString(), endedAt: null };
    expect([...trainingDays([finished, live], '00:00')]).toEqual(['2026-10-12']);
  });

  it('starts a week on the weekday the person chose', () => {
    // 2026-10-14 is a Wednesday.
    expect(weekKeyOf('2026-10-14', 1)).toBe('2026-10-12');
    expect(weekKeyOf('2026-10-14', 0)).toBe('2026-10-11');
    expect(weekKeyOf('2026-10-12', 1)).toBe('2026-10-12');
  });

  it('counts finished workouts per week and leaves empty weeks out', () => {
    const w = (id: string, d: number, ended = true) => ({
      id, startedAt: new Date(2026, 9, d, 18).toISOString(), endedAt: ended ? new Date(2026, 9, d, 19).toISOString() : null,
    });
    const weeks = sessionsPerWeek([w('a', 12), w('b', 14), w('c', 15, false), w('d', 21)], '00:00', 1);
    expect([...weeks.entries()]).toEqual([['2026-10-12', 2], ['2026-10-19', 1]]);
  });

  it('memoizes the session list per array and reset time', () => {
    const list = [{ id: 'a', startedAt: new Date(2026, 9, 12, 18).toISOString() }];
    expect(recordSessions(list, '00:00')).toBe(recordSessions(list, '00:00'));
    expect(recordSessions(list, '04:00')).not.toBe(recordSessions(list, '00:00'));
  });
});

describe('muscleWeeks', () => {
  const sessions = [session('s1', 10, 12), session('s2', 10, 14), session('s3', 10, 21)];
  const info: Record<string, MuscleInfo> = {
    [BENCH]: { kind: 'weight_reps', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'front_delts'] },
    'lib:pull-up': { kind: 'bodyweight_reps', primaryMuscles: ['lats'], secondaryMuscles: ['biceps', 'lats'] },
  };
  const infoOf = (id: string) => info[id] ?? null;

  it('credits a primary muscle one set and a helper half a set, per week', () => {
    const sets = [set('s1'), set('s2'), set('s3')];
    const weeks = muscleWeeks(sets, sessions, infoOf, 1);
    expect([...weeks.keys()]).toEqual(['2026-10-12', '2026-10-19']);
    const first = weeks.get('2026-10-12')!;
    expect(first.get('chest')).toEqual({ sets: 2, volumeKg: 2 * 80 * 8 });
    expect(first.get('triceps')).toEqual({ sets: 2 * SECONDARY_MUSCLE_WEIGHT, volumeKg: 2 * 80 * 8 * SECONDARY_MUSCLE_WEIGHT });
    expect(weeks.get('2026-10-19')!.get('chest')?.sets).toBe(1);
  });

  it('leaves warm-ups and planned sets out', () => {
    const sets = [set('s1', { kind: 'warmup' }), set('s1', { completedAt: null }), set('s1')];
    expect(muscleWeeks(sets, sessions, infoOf, 1).get('2026-10-12')!.get('chest')?.sets).toBe(1);
  });

  it('counts sets for a bodyweight exercise but adds no weight volume, and a muscle listed twice counts once, as primary', () => {
    const sets = [set('s1', { exerciseId: 'lib:pull-up', weightKg: null, reps: 8 })];
    const week = muscleWeeks(sets, sessions, infoOf, 1).get('2026-10-12')!;
    expect(week.get('lats')).toEqual({ sets: 1, volumeKg: 0 });
    expect(week.get('biceps')).toEqual({ sets: 0.5, volumeKg: 0 });
  });

  it('credits no muscle for an exercise it cannot resolve', () => {
    expect(muscleWeeks([set('s1', { exerciseId: 'gone' })], sessions, infoOf, 1).size).toBe(0);
  });

  it('moves a session between weeks with the week start', () => {
    const sets = [set('s1')];
    // 2026-10-12 is a Monday: a Sunday-start week holds it with the Sunday before.
    expect([...muscleWeeks(sets, sessions, infoOf, 0).keys()]).toEqual(['2026-10-11']);
  });

  it('is memoized per array of sets', () => {
    const sets = [set('s1')];
    expect(muscleWeeks(sets, sessions, infoOf, 1)).toBe(muscleWeeks(sets, sessions, infoOf, 1));
  });
});

describe('recentWeekBars', () => {
  it('lists the last weeks oldest first, ending with the running one, zeros included', () => {
    // 2026-10-14 is a Wednesday; the week starts Monday the 12th.
    const bars = recentWeekBars(new Map([['2026-10-12', 2], ['2026-09-28', 3]]), '2026-10-14', 1, 4);
    expect(bars).toEqual([
      { weekKey: '2026-09-21', count: 0, current: false },
      { weekKey: '2026-09-28', count: 3, current: false },
      { weekKey: '2026-10-05', count: 0, current: false },
      { weekKey: '2026-10-12', count: 2, current: true },
    ]);
  });

  it('steps whole weeks across a daylight-saving change', () => {
    const bars = recentWeekBars(new Map(), '2026-11-04', 1, 3);
    expect(bars.map(b => b.weekKey)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });

  it('follows the week start setting', () => {
    expect(recentWeekBars(new Map(), '2026-10-14', 0, 1)[0].weekKey).toBe('2026-10-11');
  });
});

describe('topMuscles', () => {
  const week = new Map<'chest' | 'triceps' | 'biceps' | 'lats', { sets: number; volumeKg: number }>([
    ['triceps', { sets: 9.5, volumeKg: 0 }], ['chest', { sets: 12, volumeKg: 0 }],
    ['lats', { sets: 4, volumeKg: 0 }], ['biceps', { sets: 4, volumeKg: 0 }],
  ]);

  it('lists the most trained first and breaks a tie by name', () => {
    expect(topMuscles(week).map(r => [r.muscle, r.sets])).toEqual([
      ['chest', 12], ['triceps', 9.5], ['biceps', 4], ['lats', 4],
    ]);
  });

  it('caps the list and handles no week', () => {
    expect(topMuscles(week, 2)).toHaveLength(2);
    expect(topMuscles(undefined)).toEqual([]);
  });
});
