import { deflateRawSync } from 'zlib';
import type { RestTimer, Task, WorkoutProgram, WorkoutRoutine, WorkoutSession, WorkoutSet } from '../types';
import type { PlannedRoutineSet } from '../store/useWorkoutStore';

// tickOutcome lives beside tickSet, which reaches for the stores; the builder
// only ever calls the pure half, so the stores are fakes that are never read.
jest.mock('../store/useWorkoutStore', () => ({ useWorkoutStore: { getState: () => ({}) } }));
jest.mock('../store/useStepTimerStore', () => ({ useStepTimerStore: { getState: () => ({}) } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({ defaultRestSeconds: 90 }) } }));

import { DEFAULT_PLATE_INVENTORY, weightToDisplay } from '../utils/workoutData';
import { NO_WATCH_HEALTH_REQUESTS } from '../utils/watchHealthWorkout';
import {
  MAX_WATCH_LIVE_SETS,
  MAX_WATCH_PLAN_SETS,
  MAX_WATCH_RECENT,
  MAX_WATCH_ROUTINES,
  buildWatchWorkout,
  todaysWatchWorkout,
  watchSetRows,
  type WatchWorkoutInput,
} from '../utils/watchWorkout';

const BENCH = 'lib:barbell-bench-press';
const ROW = 'lib:barbell-row';
const PLANK = 'lib:plank';
const STARTED = '2026-10-18T09:00:00.000Z';

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
    weightKg: 60,
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

const routine = (id: string, extra: Partial<WorkoutRoutine> = {}): WorkoutRoutine => ({
  id,
  name: id,
  notes: '',
  programId: null,
  sortOrder: 0,
  createdAt: STARTED,
  items: [],
  ...extra,
});

const item = (exerciseId: string, restSeconds: number) =>
  ({ exerciseId, restSeconds, progression: 'none', targets: [] }) as unknown as WorkoutRoutine['items'][number];

const live = (extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
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
  healthWritePending: false, measuredOnWatch: false,
  ...extra,
});

const planned = (exerciseId: string, position: number, n: number, kind: WorkoutSet['kind'] = 'working'): PlannedRoutineSet[] =>
  Array.from({ length: n }, (_, setIndex) => ({
    exerciseId,
    position,
    setIndex,
    values: { kind, weightKg: 80, reps: 8, durationSeconds: null, distanceM: null, supersetKey: null },
  }));

const input = (extra: Partial<WatchWorkoutInput> = {}): WatchWorkoutInput => ({
  workoutsEnabled: true,
  healthWrite: false,
  watchRequests: NO_WATCH_HEALTH_REQUESTS,
  now: new Date(2026, 9, 18, 12),
  unit: 'kg',
  quietHoursStart: null,
  quietHoursEnd: null,
  exercises: [],
  defaultRestSeconds: 90,
  live: null,
  routines: [],
  todays: null,
  planFor: () => [],
  programs: [],
  sessions: [],
  plateInventory: DEFAULT_PLATE_INVENTORY,
  historyFor: () => [],
  recent: [],
  ...extra,
});

// A routine whose bench press moves up by double progression (6 to 8 reps),
// and a finished workout where every set reached 8 at 80 kg: workout mode's
// card proposes 82.5 kg for 6.
const doubleItem = {
  exerciseId: BENCH, supersetKey: null, restSeconds: 150, warmupRamp: false,
  progression: { scheme: 'double', incrementKg: null },
  targets: [0, 1, 2].map(() => ({ kind: 'working', repsMin: 6, repsMax: 8 })),
} as unknown as WorkoutRoutine['items'][number];
const finished = live({ id: 'old', routineId: 'r1', startedAt: '2026-10-15T09:00:00.000Z', endedAt: '2026-10-15T10:00:00.000Z' });
const lastTime = [0, 1, 2].map(i => set(BENCH, 0, i, { sessionId: 'old', weightKg: 80, reps: 8, completedAt: `2026-10-15T09:0${i}:00.000Z` }));
const PROPOSED = { weight: 82.5, use: 'Use 82.5', reason: 'All sets hit 8 last time', sets: [0, 1, 2].map(() => ({ weight: 82.5, reps: 6 })) };

describe('watchSetRows', () => {
  const ctx = { exercises: [], unit: 'kg' as const, routine: null, defaultRestSeconds: 90 };

  it('words each set as workout mode numbers it, in walking order, warm-ups lettered', () => {
    const sets = [
      set(BENCH, 0, 0, { kind: 'warmup', weightKg: 40, reps: 10, completedAt: STARTED }),
      set(BENCH, 0, 1),
      set(BENCH, 0, 2),
    ];
    const rows = watchSetRows(sets, ctx);
    expect(rows.map(r => [r.label, r.badge, r.next])).toEqual([
      ['Warm-up', 'W', 'Next: Barbell bench press, warm-up'],
      ['Set 1 of 2', undefined, 'Next: Barbell bench press, set 1'],
      ['Set 2 of 2', undefined, 'Next: Barbell bench press, set 2'],
    ]);
    expect(rows[0]).toMatchObject({ weight: 40, reps: 10, doneAt: STARTED, rest: 0 });
    expect(rows[1].doneAt).toBeUndefined();
  });

  it('carries the rest each tick starts, the routine’s own over the default', () => {
    const sets = [set(BENCH, 0, 0), set(BENCH, 0, 1), set(PLANK, 1, 0, { weightKg: null, reps: null, durationSeconds: 45 })];
    const rows = watchSetRows(sets, { ...ctx, routine: { items: [item(BENCH, 150), item(PLANK, 0)] } });
    expect(rows.map(r => r.rest)).toEqual([150, 150, 0]);
    expect(rows[2]).toMatchObject({ durationSeconds: 45 });
    expect(rows[2].weight).toBeUndefined();
  });

  it('alternates a superset round by round, resting only after the round', () => {
    const sets = [
      set(BENCH, 0, 0, { supersetKey: 'ss' }),
      set(BENCH, 0, 1, { supersetKey: 'ss' }),
      set(ROW, 1, 0, { supersetKey: 'ss' }),
      set(ROW, 1, 1, { supersetKey: 'ss' }),
    ];
    const rows = watchSetRows(sets, ctx);
    expect(rows.map(r => [r.exerciseId, r.setIndex, r.rest])).toEqual([
      [BENCH, 0, -1],
      [ROW, 0, 90],
      [BENCH, 1, -1],
      [ROW, 1, 90],
    ]);
  });

  it('shows weights in the unit chosen', () => {
    const [row] = watchSetRows([set(BENCH, 0, 0, { weightKg: 61.235 })], { ...ctx, unit: 'lb' });
    expect(row.weight).toBe(135);
  });
});

describe('buildWatchWorkout', () => {
  it('is null with the Workouts area off', () => {
    expect(buildWatchWorkout(input({ workoutsEnabled: false }))).toBeNull();
  });

  it('carries the unit, the Crown’s step and the quiet hours, or none when they are off', () => {
    expect(buildWatchWorkout(input({ unit: 'lb', quietHoursStart: '22:00', quietHoursEnd: '07:00' })))
      .toMatchObject({ unit: 'lb', weightStep: 5, quietHours: { start: '22:00', end: '07:00' } });
    expect(buildWatchWorkout(input({ quietHoursStart: '22:00', quietHoursEnd: '22:00' }))!.quietHours).toBeNull();
    expect(buildWatchWorkout(input({ quietHoursStart: '22:00' }))!.quietHours).toBeNull();
  });

  // Phase 9: what the watch's HealthKit session reads.
  it('carries whether the watch may measure and save, what finished lately, and what to retract or throw away', () => {
    const now = new Date(2026, 9, 18, 12);
    const out = buildWatchWorkout(input({
      healthWrite: true,
      now,
      sessions: [
        live({ id: 'old', startedAt: new Date(2026, 9, 16, 9).toISOString(), endedAt: new Date(2026, 9, 16, 10).toISOString() }),
        live({ id: 'today', startedAt: new Date(2026, 9, 18, 9).toISOString(), endedAt: new Date(2026, 9, 18, 10).toISOString() }),
        live({ id: 'going', startedAt: new Date(2026, 9, 18, 11).toISOString(), endedAt: null }),
      ],
      watchRequests: {
        retract: [{ id: 'HK-1', at: new Date(2026, 9, 10).toISOString() }],
        drop: [
          { id: 'gone', at: new Date(2026, 9, 18, 11, 30).toISOString() },
          { id: 'stale', at: new Date(2026, 9, 16).toISOString() },
        ],
      },
    }))!;
    expect(out).toMatchObject({
      healthWrite: true,
      finished: [{ sessionId: 'today', endedAt: new Date(2026, 9, 18, 10).toISOString() }],
      retractWorkouts: ['HK-1'],
      dropSessions: ['gone'],
    });
    expect(buildWatchWorkout(input())!).toMatchObject({ healthWrite: false, finished: [], retractWorkouts: [], dropSessions: [] });
  });

  describe('with a workout going on the phone', () => {
    const sets = [set(BENCH, 0, 0, { completedAt: STARTED }), set(BENCH, 0, 1)];
    const rest: RestTimer = {
      kind: 'rest', id: 'rest-1', sessionId: 'w1', exerciseId: BENCH, sessionTitle: 'Push A', label: 'After set 1',
      durationSeconds: 90, startedAt: '2026-10-18T09:05:00.000Z', elapsedSeconds: 0, createdAt: '2026-10-18T09:05:00.000Z',
    };

    it('carries the workout with its sets and the phone’s rest, and no start list', () => {
      const planFor = jest.fn(() => planned(BENCH, 0, 3));
      const out = buildWatchWorkout(input({ live: { session: live(), sets, routine: null, rest }, routines: [routine('r1')], planFor }))!;
      expect(out.routines).toEqual([]);
      expect(planFor).not.toHaveBeenCalled();
      expect(out.live).toMatchObject({
        sessionId: 'w1',
        title: 'Push A',
        startedAt: STARTED,
        exercises: [{ id: BENCH, name: 'Barbell bench press', kind: 'weight_reps' }],
        moreSets: 0,
        rest: { id: 'rest-1', startedAt: '2026-10-18T09:05:00.000Z', endsAt: '2026-10-18T09:06:30.000Z' },
      });
      expect(out.live!.sets.map(s => s.id)).toEqual(sets.map(s => s.id));
    });

    it('carries no rest that belongs to another workout or isn’t running', () => {
      const other = { ...rest, sessionId: 'w0' };
      expect(buildWatchWorkout(input({ live: { session: live(), sets, routine: null, rest: other } }))!.live!.rest).toBeNull();
      const paused = { ...rest, startedAt: null };
      expect(buildWatchWorkout(input({ live: { session: live(), sets, routine: null, rest: paused } }))!.live!.rest).toBeNull();
    });

    it('carries each exercise’s rest, and its suggestion while workout mode would offer it', () => {
      const r1 = routine('r1', { items: [doubleItem] });
      const open = [0, 1, 2].map(i => set(BENCH, 0, i, { weightKg: 80, reps: 8 }));
      const at = (sets: WorkoutSet[]) => buildWatchWorkout(input({
        live: { session: live({ routineId: 'r1' }), sets, routine: r1, rest: null },
        routines: [r1],
        sessions: [finished, live({ routineId: 'r1' })],
        historyFor: id => (id === BENCH ? lastTime : []),
      }))!.live!.exercises[0];
      expect(at(open)).toMatchObject({ id: BENCH, rest: 150, suggestion: PROPOSED });
      // Gone once a working set is logged, and once the planned sets ask for it.
      expect(at([{ ...open[0], completedAt: STARTED }, ...open.slice(1)]).suggestion).toBeUndefined();
      expect(at(open.map(x => ({ ...x, weightKg: 82.5, reps: 6 }))).suggestion).toBeUndefined();
      // A logged warm-up isn't work yet.
      const warmup = set(BENCH, 0, 0, { kind: 'warmup', weightKg: 40, completedAt: STARTED });
      expect(at([warmup, ...open]).suggestion).toEqual(PROPOSED);
    });

    it('carries a set’s note', () => {
      const out = buildWatchWorkout(input({ live: { session: live(), sets: [set(BENCH, 0, 0, { note: 'Felt the left shoulder' })], routine: null, rest: null } }))!;
      expect(out.live!.sets[0].note).toBe('Felt the left shoulder');
    });

    it('stops at the cap and says how many more the phone has', () => {
      const many = Array.from({ length: MAX_WATCH_LIVE_SETS + 3 }, (_, i) => set(BENCH, 0, i));
      const out = buildWatchWorkout(input({ live: { session: live(), sets: many, routine: null, rest: null } }))!;
      expect(out.live!.sets).toHaveLength(MAX_WATCH_LIVE_SETS);
      expect(out.live!.moreSets).toBe(3);
    });
  });

  describe('with none going', () => {
    it('lists today’s workout first with its task, then the rest in the Routines list’s order', () => {
      const routines = [
        routine('Legs', { sortOrder: 2 }),
        routine('Pull A', { sortOrder: 1, programId: 'p1' }),
        routine('Push A', { sortOrder: 0, programId: 'p1' }),
      ];
      const out = buildWatchWorkout(input({
        routines,
        todays: { routineId: 'Legs', taskId: 't1', programId: null },
        planFor: id => (id === 'Legs' ? planned(BENCH, 0, 2) : planned(ROW, 0, 3)),
      }))!;
      expect(out.live).toBeNull();
      expect(out.routines.map(r => [r.id, r.fromToday, r.taskId, r.programId, r.exerciseCount, r.plan.length])).toEqual([
        ['Legs', true, 't1', undefined, 1, 2],
        ['Push A', false, undefined, 'p1', 1, 3],
        ['Pull A', false, undefined, 'p1', 1, 3],
      ]);
      // A plan's sets carry no id (the watch makes its own) and nothing done.
      expect(out.routines[0].plan[0]).toEqual({
        exerciseId: BENCH, position: 0, setIndex: 0, kind: 'working', label: 'Set 1 of 2',
        next: 'Next: Barbell bench press, set 1', rest: 90, weight: 80, reps: 8,
      });
    });

    it('carries the suggestion on a routine’s exercises, against what starting it lays out', () => {
      const r1 = routine('r1', { items: [doubleItem] });
      const out = buildWatchWorkout(input({
        routines: [r1],
        sessions: [finished],
        planFor: () => planned(BENCH, 0, 3),
        historyFor: () => lastTime,
      }))!;
      expect(out.routines[0].exercises).toEqual([{ id: BENCH, name: 'Barbell bench press', kind: 'weight_reps', rest: 150, suggestion: PROPOSED }]);
    });

    it('leaves out a routine with nothing in it, and stops at the routine cap', () => {
      const routines = Array.from({ length: MAX_WATCH_ROUTINES + 2 }, (_, i) => routine(`r${i}`, { sortOrder: i }));
      const out = buildWatchWorkout(input({ routines, planFor: id => (id === 'r0' ? [] : planned(BENCH, 0, 4)) }))!;
      expect(out.routines).toHaveLength(MAX_WATCH_ROUTINES);
      expect(out.routines.map(r => r.id)).not.toContain('r0');
      expect(out.routines[0].moreSets).toBeUndefined();
    });

    it('cuts a long routine between whole exercises, and says how many sets it left off', () => {
      const ids = Array.from({ length: 12 }, (_, i) => `lib:exercise-${i}`);
      const out = buildWatchWorkout(input({
        routines: [routine('r1')],
        planFor: () => ids.flatMap((id, position) => planned(id, position, 7)),
      }))!;
      // 12 exercises of 7 is 84 sets: eight whole exercises (56) fit in 60.
      expect(out.routines[0].plan).toHaveLength(56);
      expect(new Set(out.routines[0].plan.map(p => p.exerciseId)).size).toBe(8);
      expect(out.routines[0].moreSets).toBe(28);
      expect(out.routines[0].exerciseCount).toBe(12);
    });

    it('keeps a superset whole, and keeps the first exercise even when it alone is over the cap', () => {
      const pair = (position: number, key: string) => [BENCH, ROW].flatMap((id, k) => planned(id, position + k, 4)
        .map(p => ({ ...p, values: { ...p.values, supersetKey: key } })));
      const rows = [...planned(PLANK, 0, MAX_WATCH_PLAN_SETS - 6), ...pair(1, 'ss-1')];
      const out = buildWatchWorkout(input({ routines: [routine('r1')], planFor: () => rows }))!;
      // The superset's eight sets don't fit beside the plank's 54, so both go.
      expect(out.routines[0].plan.every(p => p.exerciseId === PLANK)).toBe(true);
      expect(out.routines[0].moreSets).toBe(8);
      const huge = buildWatchWorkout(input({ routines: [routine('r1')], planFor: () => planned(BENCH, 0, MAX_WATCH_PLAN_SETS + 5) }))!;
      expect(huge.routines[0].plan).toHaveLength(MAX_WATCH_PLAN_SETS + 5);
    });

    it('carries a set’s superset, which a workout on the watch brings back', () => {
      const rows = [BENCH, ROW].flatMap((id, k) => planned(id, k, 2).map(p => ({ ...p, values: { ...p.values, supersetKey: 'ss-1' } })));
      const out = buildWatchWorkout(input({ routines: [routine('r1')], planFor: () => rows }))!;
      expect(out.routines[0].plan.map(p => [p.exerciseId, p.supersetKey])).toEqual([
        [BENCH, 'ss-1'], [ROW, 'ss-1'], [BENCH, 'ss-1'], [ROW, 'ss-1'],
      ]);
    });

    it('stays well under the watch context’s size at the caps', () => {
      const exercises = [
        'lib:barbell-bench-press', 'lib:barbell-row', 'lib:back-squat', 'lib:deadlift', 'lib:overhead-press',
        'lib:lat-pulldown', 'lib:barbell-curl', 'lib:triceps-pushdown', 'lib:romanian-deadlift', 'lib:leg-press',
      ];
      // Every routine different and every load different, so the compression
      // has as little repetition to work with as a real start list would.
      const planOf = (r: number) => exercises.flatMap((id, position) => planned(id, position, MAX_WATCH_PLAN_SETS / exercises.length)
        .map((p, k) => ({ ...p, values: { ...p.values, weightKg: 20 + r * 7.5 + position * 5 + k * 2.5, reps: 5 + ((r + k) % 8) } })));
      // Every exercise of every routine with a suggestion, ramp included.
      const items = exercises.map(exerciseId => ({ ...doubleItem, exerciseId, warmupRamp: true }));
      const routines = Array.from({ length: MAX_WATCH_ROUTINES }, (_, i) => routine(`Routine number ${i}`, { sortOrder: i, items }));
      // A full "Add exercise" list, each with five sets of last time.
      const recent = Array.from({ length: MAX_WATCH_RECENT }, (_, i) => ({
        exerciseId: `custom-${i}`,
        lastTime: Array.from({ length: 5 }, (_, k) => set(`custom-${i}`, 0, k, { sessionId: 'old', weightKg: 10 + i * 2.5 + k, reps: 5 + k })),
      }));
      const out = buildWatchWorkout(input({
        routines,
        sessions: [finished],
        planFor: id => planOf(Number(id.split(' ').pop())),
        historyFor: id => lastTime.map(x => ({ ...x, exerciseId: id })),
        recent,
        exercises: recent.map(({ exerciseId }, i) => ({ id: exerciseId, name: `My exercise number ${i}`, kind: 'weight_reps' }) as never),
      }))!;
      expect(out.routines[0].plan).toHaveLength(MAX_WATCH_PLAN_SETS);
      expect(out.routines[0].exercises.every(e => e.suggestion?.ramp)).toBe(true);
      expect(out.recent).toHaveLength(MAX_WATCH_RECENT);
      const json = JSON.stringify(out);
      // About 128 KB written out and 5.4 KB deflated (zlib standing in for
      // the LZFSE the phone sends, which is what travels), against a context
      // the rest of the snapshot already fills a good part of. Before the
      // suggestions, the Add exercise list and the 60-set plans it was 60 KB
      // and 2.5 KB.
      expect(json.length).toBeLessThan(150_000);
      expect(deflateRawSync(json).length).toBeLessThan(9_000);
    });
  });
});

describe('the Add exercise list', () => {
  it('lists what was logged lately A to Z, each with last time’s sets in the unit shown', () => {
    const out = buildWatchWorkout(input({
      unit: 'lb',
      recent: [
        { exerciseId: ROW, lastTime: [set(ROW, 0, 0, { weightKg: 60, reps: 10 }), set(ROW, 0, 1, { weightKg: 60, reps: 9 })] },
        { exerciseId: PLANK, lastTime: [set(PLANK, 0, 0, { weightKg: null, reps: null, durationSeconds: 60 })] },
        { exerciseId: BENCH, lastTime: [set(BENCH, 0, 0, { kind: 'warmup', weightKg: 40, reps: 5 })] },
      ],
    }))!;
    expect(out.recent.map(r => r.name)).toEqual(['Barbell bench press', 'Barbell row', 'Plank']);
    expect(out.recent[1]).toEqual({
      id: ROW, name: 'Barbell row', kind: 'weight_reps', rest: 90,
      sets: [{ kind: 'working', weight: weightToDisplay(60, 'lb'), reps: 10 }, { kind: 'working', weight: weightToDisplay(60, 'lb'), reps: 9 }],
    });
    expect(out.recent[2].sets).toEqual([{ kind: 'working', durationSeconds: 60 }]);
    expect(out.recent[0].sets[0].kind).toBe('warmup');
  });

  it('stops at the cap, and travels with a live workout too', () => {
    const recent = Array.from({ length: MAX_WATCH_RECENT + 5 }, (_, i) => ({ exerciseId: `custom-${i}`, lastTime: [] }));
    expect(buildWatchWorkout(input({ recent }))!.recent).toHaveLength(MAX_WATCH_RECENT);
    const out = buildWatchWorkout(input({ recent, live: { session: live(), sets: [set(BENCH, 0, 0)], routine: null, rest: null } }))!;
    expect(out.recent).toHaveLength(MAX_WATCH_RECENT);
  });
});

describe('todaysWatchWorkout', () => {
  const routines = [routine('r1'), routine('r2', { programId: 'p1' }), routine('r3')];
  const program = (extra: Partial<WorkoutProgram> = {}): WorkoutProgram => ({
    id: 'p1', name: 'PPL', weeks: null, rotation: ['r1', 'r2'], scheme: 'double', trainingMaxes: [],
    startedAt: null, archived: false, createdAt: STARTED, ...extra,
  });
  const task = (id: string, extra: Partial<Task> = {}): Task =>
    ({ id, title: id, completed: false, archived: false, workoutRoutineId: null, workoutProgramId: null, ...extra }) as Task;

  it('reads a routine task as that routine, for that task', () => {
    expect(todaysWatchWorkout({ routines, programs: [], sessions: [], todayTasks: [task('t1', { workoutRoutineId: 'r2' })] }))
      .toEqual({ routineId: 'r2', taskId: 't1', programId: 'p1' });
  });

  it('turns a program into its next routine', () => {
    const done = live({ id: 'old', routineId: 'r1', programId: 'p1', endedAt: '2026-10-18T10:00:00.000Z' });
    expect(todaysWatchWorkout({ routines, programs: [program()], sessions: [done], todayTasks: [task('t1', { workoutProgramId: 'p1' })] }))
      .toEqual({ routineId: 'r2', taskId: 't1', programId: 'p1' });
    expect(todaysWatchWorkout({ routines, programs: [program()], sessions: [], todayTasks: [] }))
      .toEqual({ routineId: 'r1', taskId: null, programId: 'p1' });
  });

  it('is null with nothing to start', () => {
    expect(todaysWatchWorkout({ routines, programs: [], sessions: [], todayTasks: [] })).toBeNull();
  });
});
