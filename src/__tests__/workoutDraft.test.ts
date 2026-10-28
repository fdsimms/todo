import {
  draftNames,
  readWorkoutDraft,
  routineFromDraft,
  sessionFromDraft,
  startOfDescribed,
  type WorkoutDraft,
} from '../utils/workoutDraft';
import { buildImportPlan } from '../utils/workoutCsv';
import type { ExerciseKind } from '../types';

const kinds = (id: string): ExerciseKind => (id === 'plank' ? 'duration' : 'weight_reps');
const set = (over: Record<string, unknown> = {}) => ({ kind: 'working', reps: 5, ...over });

describe('readWorkoutDraft', () => {
  it('reads sets, ranges and the fields around them', () => {
    const d = readWorkoutDraft({
      title: ' Push day ',
      notes: 'Finish with abs',
      exercises: [{
        name: 'Bench press',
        sets: [set({ weight: 185, weightUnit: 'lb' }), set({ reps: 8, repsMax: 12 })],
        restSeconds: 120,
        progression: 'double',
      }],
    });
    expect(d.title).toBe('Push day');
    expect(d.notes).toBe('Finish with abs');
    expect(d.exercises[0].sets[0]).toMatchObject({ reps: 5, repsMax: null, weight: 185, weightUnit: 'lb' });
    expect(d.exercises[0].sets[1]).toMatchObject({ reps: 8, repsMax: 12 });
    expect(d.exercises[0].restSeconds).toBe(120);
    expect(d.exercises[0].progression).toBe('double');
  });

  it('refuses a reply with no exercise in it', () => {
    expect(() => readWorkoutDraft({ exercises: [] })).toThrow('No answer returned');
    expect(() => readWorkoutDraft(null)).toThrow('No answer returned');
    expect(() => readWorkoutDraft({ exercises: [{ name: '  ', sets: [] }] })).toThrow('No answer returned');
  });

  it('turns a number out of range into nothing rather than a believable one', () => {
    const d = readWorkoutDraft({
      exercises: [{ name: 'Squat', sets: [set({ reps: 9999, weight: -5, rpe: 14, durationSeconds: 0 })], restSeconds: 99999 }],
    });
    expect(d.exercises[0].sets[0]).toMatchObject({ reps: null, weight: null, rpe: null, durationSeconds: null });
    expect(d.exercises[0].restSeconds).toBeNull();
  });

  it('ignores a made-up kind, unit or scheme', () => {
    const d = readWorkoutDraft({
      exercises: [{ name: 'Curl', sets: [set({ kind: 'superset', weightUnit: 'stone', weight: 10 })], progression: 'magic' }],
    });
    expect(d.exercises[0].sets[0]).toMatchObject({ kind: 'working', weightUnit: null });
    expect(d.exercises[0].progression).toBeNull();
  });

  it('keeps no more sets than the editor holds, and says so in the notes', () => {
    const many = Array.from({ length: 25 }, () => set());
    const d = readWorkoutDraft({ notes: 'Burnout', exercises: [{ name: 'Pushup', sets: many }] });
    expect(d.exercises[0].sets).toHaveLength(20);
    expect(d.notes).toBe('Burnout\nOnly the first sets of Pushup were kept.');
  });

  it('does not let the first exercise be a superset with nothing before it', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Bench', sets: [set()], supersetWithPrevious: true }] });
    expect(d.exercises[0].supersetWithPrevious).toBe(false);
  });

  it('reads a date and time only in their own shapes', () => {
    expect(readWorkoutDraft({ date: '2026-03-03', time: '7:30', exercises: [{ name: 'Run', sets: [] }] }))
      .toMatchObject({ date: '2026-03-03', time: '7:30' });
    expect(readWorkoutDraft({ date: 'yesterday', time: '25:00', exercises: [{ name: 'Run', sets: [] }] }))
      .toMatchObject({ date: null, time: null });
  });
});

describe('draftNames', () => {
  it('lists each name once, with every set that names it', () => {
    const d = readWorkoutDraft({
      exercises: [
        { name: 'Bench press', sets: [set(), set()] },
        { name: 'Cable fly', sets: [set()] },
        { name: 'bench  press', sets: [set()] },
      ],
    });
    expect(draftNames(d)).toEqual([
      { key: 'bench press', name: 'Bench press', sets: 3 },
      { key: 'cable fly', name: 'Cable fly', sets: 1 },
    ]);
  });
});

describe('routineFromDraft', () => {
  const draft = (): WorkoutDraft => readWorkoutDraft({
    title: 'Push day',
    notes: 'Finish with abs',
    exercises: [
      {
        name: 'Bench press',
        sets: [
          set({ kind: 'warmup', reps: 10 }),
          set({ weight: 185, weightUnit: 'lb' }), set({ weight: 185, weightUnit: 'lb' }), set({ weight: 185, weightUnit: 'lb' }),
        ],
        restSeconds: 120,
      },
      { name: 'Incline press', sets: [set({ reps: 8, repsMax: 12 })], supersetWithPrevious: false },
      { name: 'Cable fly', sets: [set({ reps: 12, repsMax: 15 })], supersetWithPrevious: true },
    ],
  });
  const resolved = {
    'bench press': { kind: 'exercise' as const, exerciseId: 'bench' },
    'incline press': { kind: 'exercise' as const, exerciseId: 'incline' },
    'cable fly': { kind: 'exercise' as const, exerciseId: 'fly' },
  };

  it('halves a pair total for an exercise held in two dumbbells, when the person types pair totals', () => {
    const d = readWorkoutDraft({
      title: 'Dumbbells',
      exercises: [
        { name: 'DB bench', sets: [set({ weight: 100, weightUnit: 'lb' })] },
        { name: 'Dumbbell row', sets: [set({ weight: 60, weightUnit: 'lb' })] },
        { name: 'Bench press', sets: [set({ weight: 185, weightUnit: 'lb' })] },
      ],
    });
    const settled = {
      'db bench': { kind: 'exercise' as const, exerciseId: 'lib:dumbbell-bench-press' },
      'dumbbell row': { kind: 'create' as const },
      'bench press': { kind: 'exercise' as const, exerciseId: 'lib:barbell-bench-press' },
    };
    const each = routineFromDraft(d, settled, () => 'weight_reps', 'kg');
    const pair = routineFromDraft(d, settled, () => 'weight_reps', 'kg', { pairTotals: true, exercises: [] });
    expect(pair.items[0].targets[0].weightKg).toBeCloseTo(each.items[0].targets[0].weightKg! / 2, 2);
    expect(pair.items[1].targets[0].weightKg).toBeCloseTo(each.items[1].targets[0].weightKg! / 2, 2);
    // A barbell isn't two dumbbells.
    expect(pair.items[2].targets[0].weightKg).toBe(each.items[2].targets[0].weightKg);
  });

  it('puts warm-ups first and converts the weight from the unit it was given in', () => {
    const r = routineFromDraft(draft(), resolved, kinds, 'kg');
    const bench = r.items[0];
    expect(bench.targets.map(t => t.kind)).toEqual(['warmup', 'working', 'working', 'working']);
    expect(bench.targets[1].weightKg).toBeCloseTo(83.915, 3);
    expect(bench.restSeconds).toBe(120);
    expect(r.name).toBe('Push day');
    expect(r.notes).toBe('Finish with abs');
  });

  it('reads a weight with no unit in the unit the person uses', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Squat', sets: [set({ weight: 100 })] }] });
    const kg = routineFromDraft(d, { squat: { kind: 'exercise', exerciseId: 'squat' } }, kinds, 'kg');
    const lb = routineFromDraft(d, { squat: { kind: 'exercise', exerciseId: 'squat' } }, kinds, 'lb');
    expect(kg.items[0].targets[0].weightKg).toBe(100);
    expect(lb.items[0].targets[0].weightKg).toBeCloseTo(45.359, 3);
  });

  it('leaves out what was not said instead of filling it in', () => {
    const r = routineFromDraft(draft(), resolved, kinds, 'kg');
    const incline = r.items[1];
    expect(incline.restSeconds).toBeNull();
    expect(incline.progression).toBeNull();
    expect(incline.targets[0].weightKg).toBeNull();
    expect(incline.targets[0]).toMatchObject({ repsMin: 8, repsMax: 12 });
  });

  it('joins both halves of a superset under one key', () => {
    const r = routineFromDraft(draft(), resolved, kinds, 'kg');
    expect(r.items[0].supersetKey).toBeNull();
    expect(r.items[1].supersetKey).toBeTruthy();
    expect(r.items[2].supersetKey).toBe(r.items[1].supersetKey);
  });

  it('does not join a superset to an exercise that was left out', () => {
    const r = routineFromDraft(draft(), { ...resolved, 'incline press': { kind: 'skip' } }, kinds, 'kg');
    expect(r.items.map(i => i.exerciseId)).toEqual(['bench', 'fly']);
    expect(r.items[1].supersetKey).toBeNull();
  });

  it('names an exercise to be created by a `new:` id and describes it, creating nothing', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Landmine press', sets: [set({ weight: 40 })] }] });
    const r = routineFromDraft(d, { 'landmine press': { kind: 'create' } }, kinds, 'kg');
    expect(r.items[0].exerciseId).toBe('new:landmine press');
    expect(r.newExercises['landmine press']).toMatchObject({ name: 'Landmine press', kind: 'weight_reps', primaryMuscles: [] });
  });

  it('asks for a ramp only where one can be laid out, and only without warm-ups of its own', () => {
    const d = readWorkoutDraft({
      exercises: [
        { name: 'Squat', sets: [set({ weight: 100 })], warmupRamp: true },
        { name: 'Plank', sets: [set({ reps: null, durationSeconds: 60 })], warmupRamp: true },
        { name: 'Bench', sets: [set({ kind: 'warmup' }), set()], warmupRamp: true },
      ],
    });
    const r = routineFromDraft(d, {
      squat: { kind: 'exercise', exerciseId: 'squat' },
      plank: { kind: 'exercise', exerciseId: 'plank' },
      bench: { kind: 'exercise', exerciseId: 'bench' },
    }, kinds, 'kg');
    expect(r.items.map(i => i.warmupRamp === true)).toEqual([true, false, false]);
  });

  it('keeps only what the exercise records, and gives a time-based one its seconds', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Plank', sets: [set({ reps: 3, weight: 20, durationSeconds: 60 })] }] });
    const t = routineFromDraft(d, { plank: { kind: 'exercise', exerciseId: 'plank' } }, kinds, 'kg').items[0].targets[0];
    expect(t).toMatchObject({ repsMin: null, repsMax: null, durationSeconds: 60 });
    expect(t.weightKg).toBeUndefined();
  });

  it('gives an exercise with no sets the three the editor gives one added by hand', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Pull-up', sets: [] }] });
    const r = routineFromDraft(d, { 'pull-up': { kind: 'exercise', exerciseId: 'pullup' } }, kinds, 'kg');
    expect(r.items[0].targets).toHaveLength(3);
  });

  it('never leaves an exercise with only warm-ups', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Squat', sets: [set({ kind: 'warmup' })] }] });
    const targets = routineFromDraft(d, { squat: { kind: 'exercise', exerciseId: 'squat' } }, kinds, 'kg').items[0].targets;
    expect(targets.map(t => t.kind)).toEqual(['warmup', 'working']);
  });

  it('collapses an AMRAP range to its low end, as the editor does', () => {
    const d = readWorkoutDraft({ exercises: [{ name: 'Squat', sets: [set({ kind: 'amrap', reps: 5, repsMax: 8 })] }] });
    const t = routineFromDraft(d, { squat: { kind: 'exercise', exerciseId: 'squat' } }, kinds, 'kg').items[0].targets[0];
    expect(t).toMatchObject({ repsMin: 5, repsMax: 5 });
  });
});

describe('startOfDescribed', () => {
  const now = new Date(2026, 9, 21, 14, 30);

  it('puts a day with no time at noon', () => {
    expect(startOfDescribed('2026-10-20', null, '2026-10-21', now)).toEqual(new Date(2026, 9, 20, 12, 0));
  });

  it('holds a no-time workout today to now when noon is still ahead', () => {
    const morning = new Date(2026, 9, 21, 9, 0);
    expect(startOfDescribed(null, null, '2026-10-21', morning)).toEqual(morning);
  });

  it('uses the time it was given', () => {
    expect(startOfDescribed('2026-10-19', '7:05', '2026-10-21', now)).toEqual(new Date(2026, 9, 19, 7, 5));
  });

  it('reads no date as the logical day, which is not always the calendar one', () => {
    const grace = new Date(2026, 9, 21, 1, 30);
    expect(startOfDescribed(null, '22:00', '2026-10-20', grace)).toEqual(new Date(2026, 9, 20, 22, 0));
  });

  it('puts a time before the day starts in the small hours at the end of the day', () => {
    // 1:30 AM with the day starting at 4 AM: still the 20th, and "1am" was half an hour ago.
    const grace = new Date(2026, 9, 21, 1, 30);
    expect(startOfDescribed(null, '1:00', '2026-10-20', grace, { dayResetTime: '04:00' })).toEqual(new Date(2026, 9, 21, 1, 0));
    expect(startOfDescribed(null, '22:00', '2026-10-20', grace, { dayResetTime: '04:00' })).toEqual(new Date(2026, 9, 20, 22, 0));
  });

  it('moves an untimed workout off a minute another workout already starts in', () => {
    const taken = [new Date(2026, 9, 20, 12, 0).toISOString(), new Date(2026, 9, 20, 12, 1, 30).toISOString()];
    expect(startOfDescribed('2026-10-20', null, '2026-10-21', now, { taken })).toEqual(new Date(2026, 9, 20, 12, 2));
    // A time that was said is kept, even when it is taken: that is the duplicate it looks like.
    expect(startOfDescribed('2026-10-20', '12:00', '2026-10-21', now, { taken })).toEqual(new Date(2026, 9, 20, 12, 0));
  });
});

describe('sessionFromDraft', () => {
  const now = new Date(2026, 9, 21, 14, 30);
  const d = (extra: Record<string, unknown> = {}, exercises?: unknown[]) => readWorkoutDraft({
    title: 'Legs',
    date: '2026-10-20',
    durationMinutes: 50,
    exercises: exercises ?? [
      { name: 'Back squat', sets: [set({ weight: 225, weightUnit: 'lb' }), set({ weight: 225, weightUnit: 'lb' })] },
      { name: 'Bike', sets: [set({ reps: null, durationSeconds: 1200 })] },
    ],
    ...extra,
  });

  it('builds one session with its sets in order, started on the day named', () => {
    const r = sessionFromDraft(d(), 'kg', '2026-10-21', now);
    if (!r.ok) throw new Error(r.error);
    expect(r.session.source).toBe('text');
    expect(r.session.title).toBe('Legs');
    expect(new Date(r.session.startedAt)).toEqual(new Date(2026, 9, 20, 12, 0));
    expect(new Date(r.session.endedAt).getTime() - new Date(r.session.startedAt).getTime()).toBe(50 * 60_000);
    expect(r.session.sets.map(s => s.exerciseName)).toEqual(['Back squat', 'Back squat', 'Bike']);
    expect(r.session.sets[0].weightKg).toBeCloseTo(102.058, 3);
    expect(r.session.sets[2].durationSeconds).toBe(1200);
  });

  it('refuses a date in the future', () => {
    const r = sessionFromDraft(d({ date: '2026-10-25' }), 'kg', '2026-10-21', now);
    expect(r.ok).toBe(false);
  });

  it('leaves out a set that records nothing, and counts it', () => {
    const r = sessionFromDraft(d({}, [{ name: 'Curl', sets: [set({ reps: null }), set()] }]), 'kg', '2026-10-21', now);
    if (!r.ok) throw new Error(r.error);
    expect(r.session.sets).toHaveLength(1);
    expect(r.skippedSets).toBe(1);
  });

  it('refuses a description with no numbers to log', () => {
    const r = sessionFromDraft(d({}, [{ name: 'Curl', sets: [set({ reps: null })] }]), 'kg', '2026-10-21', now);
    expect(r.ok).toBe(false);
  });

  it('gives both halves of a superset the same key', () => {
    const r = sessionFromDraft(d({}, [
      { name: 'Curl', sets: [set()] },
      { name: 'Pushdown', sets: [set()], supersetWithPrevious: true },
      { name: 'Row', sets: [set()] },
    ]), 'kg', '2026-10-21', now);
    if (!r.ok) throw new Error(r.error);
    const [a, b, c] = r.session.sets.map(s => s.supersetKey);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).toBeNull();
  });

  it('goes through the import plan like a file does: names settled, then one session', () => {
    const r = sessionFromDraft(d(), 'kg', '2026-10-21', now);
    if (!r.ok) throw new Error(r.error);
    const plan = buildImportPlan([r.session], {
      'back squat': { kind: 'exercise', exerciseId: 'squat' },
      bike: { kind: 'create' },
    }, []);
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].sets).toHaveLength(3);
    expect(plan.createKeys).toEqual(['bike']);
  });

  it('is a duplicate of a workout already logged at the same minute', () => {
    const r = sessionFromDraft(d(), 'kg', '2026-10-21', now);
    if (!r.ok) throw new Error(r.error);
    const plan = buildImportPlan([r.session], { 'back squat': { kind: 'create' }, bike: { kind: 'create' } },
      [{ id: 'other', startedAt: r.session.startedAt }]);
    expect(plan.duplicates).toBe(1);
    expect(plan.sessions).toHaveLength(0);
  });
});
