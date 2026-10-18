import type { RestTimer, WorkoutSession, WorkoutSet } from '../types';
import { buildWorkoutRun, workoutActivitySessionId, type WorkoutRun } from '../utils/workoutLiveActivity';

const BENCH = 'lib:barbell-bench-press';
const PUSH_UP = 'lib:push-up';
const STARTED = '2026-10-18T09:00:00.000Z';
const DONE = '2026-10-18T09:10:00.000Z';
const ON = { enabled: true, workoutsEnabled: true };

let seq = 0;
function set(exerciseId: string, position: number, setIndex: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  seq += 1;
  return {
    id: `s${seq}`,
    sessionId: 'w1',
    exerciseId,
    position,
    setIndex,
    kind: 'working',
    weightKg: 82.5,
    reps: 8,
    durationSeconds: null,
    distanceM: null,
    rpe: null,
    completedAt: null,
    supersetKey: null,
    note: null,
    ...extra,
  };
}

const session = (extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'w1',
  routineId: null,
  programId: null,
  taskId: null,
  title: 'Push A',
  startedAt: STARTED,
  endedAt: null,
  notes: '',
  effort: null,
  healthWorkoutId: null,
  healthWritePending: false,
  ...extra,
});

const rest = (extra: Partial<RestTimer> = {}): RestTimer => ({
  kind: 'rest',
  id: 'r1',
  sessionId: 'w1',
  exerciseId: BENCH,
  sessionTitle: 'Push A',
  label: 'After set 2 of Barbell bench press',
  durationSeconds: 90,
  startedAt: '2026-10-18T09:20:00.000Z',
  elapsedSeconds: 0,
  createdAt: '2026-10-18T09:20:00.000Z',
  ...extra,
});

/** A warm-up and four working sets of bench, two done. */
function benchSets(): WorkoutSet[] {
  return [
    set(BENCH, 0, 0, { kind: 'warmup', weightKg: 40, completedAt: DONE }),
    set(BENCH, 0, 1, { completedAt: DONE }),
    set(BENCH, 0, 2, { completedAt: DONE }),
    set(BENCH, 0, 3),
    set(BENCH, 0, 4),
  ];
}

function build(
  sets: WorkoutSet[],
  restTimer: RestTimer | null = null,
  extra: Partial<Parameters<typeof buildWorkoutRun>[0]> = {},
): WorkoutRun {
  const run = buildWorkoutRun({ session: session(), sets, exercises: [], unit: 'kg', rest: restTimer, ...extra }, ON);
  if (!run) throw new Error('expected a run');
  return run;
}

describe('buildWorkoutRun', () => {
  it('is null with no workout going, the setting off, or the Workouts area off', () => {
    const input = { session: session(), sets: benchSets(), exercises: [], unit: 'kg' as const, rest: null };
    expect(buildWorkoutRun({ ...input, session: null }, ON)).toBeNull();
    expect(buildWorkoutRun({ ...input, session: session({ endedAt: DONE }) }, ON)).toBeNull();
    expect(buildWorkoutRun(input, { enabled: false, workoutsEnabled: true })).toBeNull();
    expect(buildWorkoutRun(input, { enabled: true, workoutsEnabled: false })).toBeNull();
  });

  it('during a set: the exercise, which set of how many with its numbers, and Done set for that set', () => {
    const sets = benchSets();
    const run = build(sets);
    expect(run).toMatchObject({
      sessionId: 'w1',
      startedAtMs: Date.parse(STARTED),
      phase: 'set',
      title: 'Barbell bench press',
      subtitle: 'Set 3 of 4 · 82.5 kg × 8',
      compact: '3 / 4',
      restStartedAtMs: null,
      restEndsAtMs: null,
      primaryLabel: 'Done set',
      primaryUrl: `dundundun://workout?do=set-done&session=w1&set=${sets[3].id}`,
      primarySymbol: 'checkmark',
      secondaryLabel: '',
      overLabel: '',
    });
  });

  it('shows the set in the workout unit', () => {
    expect(build(benchSets(), null, { unit: 'lb' }).subtitle).toBe('Set 3 of 4 · 181.9 lb × 8');
  });

  it('names a warm-up and a drop set rather than numbering them', () => {
    const warm = build([set(BENCH, 0, 0, { kind: 'warmup', weightKg: 40, reps: 10 }), set(BENCH, 0, 1)]);
    expect(warm.subtitle).toBe('Warm-up · 40 kg × 10');
    expect(warm.compact).toBe('Warm-up');
    const drop = build([set(BENCH, 0, 0, { completedAt: DONE }), set(BENCH, 0, 1, { kind: 'drop', weightKg: 60, reps: 12 })]);
    expect(drop.subtitle).toBe('Drop set · 60 kg × 12');
  });

  it('says only which set when the set records nothing yet, and reads a bodyweight set as reps', () => {
    expect(build([set(BENCH, 0, 0, { weightKg: null, reps: null })]).subtitle).toBe('Set 1 of 1');
    expect(build([set(PUSH_UP, 0, 0, { weightKg: null, reps: 12 })]).subtitle).toBe('Set 1 of 1 · 12 reps');
  });

  it('follows the walking order, so a superset’s next set is the partner’s', () => {
    const sets = [
      set(BENCH, 0, 0, { supersetKey: 'ss', completedAt: DONE }),
      set(BENCH, 0, 1, { supersetKey: 'ss' }),
      set(PUSH_UP, 1, 0, { supersetKey: 'ss', weightKg: null, reps: 15 }),
    ];
    const run = build(sets);
    expect(run.title).toBe('Push-up');
    expect(run.primaryUrl).toContain(`set=${sets[2].id}`);
  });

  it('resting: what is next, the countdown, +30 s and Skip rest for that rest', () => {
    const sets = benchSets();
    const run = build(sets, rest());
    const startMs = Date.parse('2026-10-18T09:20:00.000Z');
    expect(run).toMatchObject({
      phase: 'rest',
      title: 'Rest',
      subtitle: 'Next: Barbell bench press, set 3 of 4',
      compact: '',
      restStartedAtMs: startMs,
      restEndsAtMs: startMs + 90_000,
      primaryLabel: 'Skip rest',
      primaryUrl: 'dundundun://workout?do=skip-rest&session=w1&rest=r1',
      primarySymbol: '',
      secondaryLabel: '+30 s',
      secondaryUrl: 'dundundun://workout?do=rest-add&session=w1&rest=r1',
      overTitle: 'Rest is over',
      overLabel: 'Done set',
      overUrl: `dundundun://workout?do=set-done&session=w1&set=${sets[3].id}`,
      overSymbol: 'checkmark',
    });
  });

  it('moves the rest’s end with a nudge, so the native side sees a change', () => {
    const sets = benchSets();
    const before = build(sets, rest());
    const after = build(sets, rest({ durationSeconds: 120 }));
    expect(after.restEndsAtMs! - before.restEndsAtMs!).toBe(30_000);
    expect(after.key).not.toBe(before.key);
  });

  it('counts what was already banked into the end, and never ends before it starts', () => {
    const banked = build(benchSets(), rest({ elapsedSeconds: 30 }));
    expect(banked.restEndsAtMs! - banked.restStartedAtMs!).toBe(60_000);
    const overdue = build(benchSets(), rest({ elapsedSeconds: 500 }));
    expect(overdue.restEndsAtMs).toBe(overdue.restStartedAtMs);
  });

  it('offers to clear a rest with nothing after it once it runs out', () => {
    const allDone = benchSets().map(s => ({ ...s, completedAt: DONE }));
    const run = build(allDone, rest());
    expect(run.subtitle).toBe('All sets done');
    expect(run.overLabel).toBe('Dismiss');
    expect(run.overUrl).toBe('dundundun://workout?do=skip-rest&session=w1&rest=r1');
    expect(run.overSymbol).toBe('');
  });

  it('ignores a rest that belongs to another session or is paused', () => {
    expect(build(benchSets(), rest({ sessionId: 'w0' })).phase).toBe('set');
    expect(build(benchSets(), rest({ startedAt: null })).phase).toBe('set');
  });

  it('names the workout when there is no set to name, with no button', () => {
    const empty = build([]);
    expect(empty).toMatchObject({ title: 'Push A', subtitle: 'No sets yet', compact: '', primaryLabel: '' });
    const finished = build(benchSets().map(s => ({ ...s, completedAt: DONE })));
    expect(finished).toMatchObject({ title: 'Push A', subtitle: 'All sets done', primaryLabel: '' });
  });

  it('truncates a long exercise name', () => {
    const run = build([set('custom-1', 0, 0)], null, {
      exercises: [{
        id: 'custom-1', name: 'A'.repeat(80), kind: 'weight_reps', primaryMuscles: [], secondaryMuscles: [],
        equipment: 'barbell', barKg: null, notes: '', archived: false, isCustom: true,
      } as never],
    });
    expect(run.title).toHaveLength(60);
    expect(run.title.endsWith('…')).toBe(true);
  });

  it('keys on the whole payload, and reads no clock: the same state gives the same key', () => {
    const sets = benchSets();
    const a = build(sets, rest());
    const b = build(sets.map(s => ({ ...s })), rest());
    expect(a.key).toBe(b.key);
    const { key, ...rest_ } = a;
    expect(JSON.parse(key)).toEqual(rest_);
  });
});

describe('workoutActivitySessionId', () => {
  it('names the live session while the workout activity is wanted', () => {
    expect(workoutActivitySessionId(session(), ON)).toBe('w1');
    expect(workoutActivitySessionId(null, ON)).toBeNull();
    expect(workoutActivitySessionId(session({ endedAt: DONE }), ON)).toBeNull();
    expect(workoutActivitySessionId(session(), { enabled: false, workoutsEnabled: true })).toBeNull();
    expect(workoutActivitySessionId(session(), { enabled: true, workoutsEnabled: false })).toBeNull();
  });
});
