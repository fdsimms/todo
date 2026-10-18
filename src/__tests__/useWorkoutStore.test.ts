/**
 * Against a real schema (expo-sqlite swapped for an in-memory better-sqlite3,
 * as database.test.ts does), because half of what this store promises is
 * about the rows: that a reload reads back what was written, that a deleted
 * session takes its sets with it, and that a renumber after a delete lands in
 * the database and not only in memory.
 */
import { initDatabase, dbGetWorkoutSets, dbGetAllExercises, dbGetWorkoutSession, dbSaveWorkoutSession } from '../db/database';
import { useSettingsStore } from '../store/useSettingsStore';
import { logWorkoutToHealth, retractWorkoutFromHealth, workoutHealthWriteOn } from '../utils/healthWorkoutSync';
import { useWorkoutStore, workoutContentCount } from '../store/useWorkoutStore';
import { catalogExercise } from '../utils/exerciseCatalog';
import { newTaskFromDraft } from '../utils/taskDraft';
import type { Task, TaskDraft } from '../types';
import {
  buildImportPlan,
  distinctExerciseNames,
  parseWorkoutCsv,
  workoutExportCsv,
  type PlannedImportSession,
} from '../utils/workoutCsv';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockRawDb: any;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockRawDb = new BS(':memory:');
  return {
    openDatabaseSync: () => ({
      execSync(sql: string) { mockRawDb.exec(sql); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) { return mockRawDb.prepare(sql).run(...params); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] { return mockRawDb.prepare(sql).all(...params) as T[]; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null { return (mockRawDb.prepare(sql).get(...params) as T) ?? null; },
      withTransactionSync(fn: () => void) {
        mockRawDb.exec('BEGIN');
        try { fn(); mockRawDb.exec('COMMIT'); } catch (e) { mockRawDb.exec('ROLLBACK'); throw e; }
      },
    }),
  };
});

// The task store as a fake: the real one loads the notification and native
// bridges, and what is under test here is only that finishing asks it to
// complete the right task.
const mockCompleteTask = jest.fn();
const mockLogQuotaUnit = jest.fn();
let mockTasks: Task[] = [];
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: mockTasks, completeTask: mockCompleteTask, logQuotaUnit: mockLogQuotaUnit }) },
}));
// The Health writer's two native calls and its switch, as fakes: what is
// under test here is what the store does with each answer. The pure rules
// (`pendingWorkoutWriteAction`) stay real.
jest.mock('../utils/healthWorkoutSync', () => ({
  ...jest.requireActual('../utils/healthWorkoutSync'),
  logWorkoutToHealth: jest.fn(),
  retractWorkoutFromHealth: jest.fn(),
  workoutHealthWriteOn: jest.fn(),
}));
const mockWrite = logWorkoutToHealth as jest.Mock;
const mockRetract = retractWorkoutFromHealth as jest.Mock;
const mockWriteOn = workoutHealthWriteOn as jest.Mock;
const written = (workoutId: string | null) => ({ outcome: 'written', workoutId, sampleIds: [] });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

const task = (id: string, draft: Partial<TaskDraft> = {}, extra: Partial<Task> = {}): Task =>
  ({ ...newTaskFromDraft({ title: id, dueDate: new Date(2026, 0, 1).toISOString(), ...draft }, new Date(2026, 0, 1).toISOString(), 0, false, id), ...extra });

beforeAll(() => {
  initDatabase();
});

beforeEach(() => {
  for (const t of ['exercises', 'workout_routines', 'workout_programs', 'workout_sessions', 'workout_sets']) {
    mockRawDb.exec(`DELETE FROM ${t}`);
  }
  useWorkoutStore.getState().initialize();
  useWorkoutStore.setState({ pendingHealthWriteRefusal: false });
  mockTasks = [];
  jest.clearAllMocks();
  mockWrite.mockResolvedValue({ outcome: 'off', workoutId: null, sampleIds: [] });
  mockRetract.mockResolvedValue(true);
  mockWriteOn.mockReturnValue(false);
});

const state = () => useWorkoutStore.getState();
const reload = () => state().initialize();
const ok = <T,>(v: T | string): T => {
  if (typeof v === 'string') throw new Error(`refused: ${v}`);
  return v;
};

describe('custom exercises', () => {
  const fly = { name: 'Cable fly crossover', kind: 'weight_reps' as const, equipment: 'cable' as const, primaryMuscles: ['chest' as const] };

  it('adds one that survives a reload', () => {
    const e = ok(state().addExercise({ ...fly, secondaryMuscles: ['front_delts'], notes: ' Low pulleys ' }));
    reload();
    expect(state().exercises).toEqual([e]);
    expect(e).toMatchObject({ isCustom: true, notes: 'Low pulleys', archived: false });
  });

  it('refuses a blank name, and one already on offer, built-in or custom', () => {
    expect(state().addExercise({ ...fly, name: '  ' })).toBe('blank');
    expect(state().addExercise({ ...fly, name: 'cable FLY' })).toBe('taken');
    ok(state().addExercise(fly));
    expect(state().addExercise({ ...fly, name: 'Cable  fly crossover ' })).toBe('taken');
  });

  // Archiving keeps the exercise and its history, so its name stays its own.
  it('keeps an archived custom exercise\'s name taken, but frees an archived built-in\'s', () => {
    const e = ok(state().addExercise(fly));
    ok(state().updateExercise(e.id, { archived: true }));
    expect(state().addExercise(fly)).toBe('taken');
    ok(state().updateExercise('lib:pec-deck', { archived: true }));
    expect(state().addExercise({ ...fly, name: 'Pec deck' })).not.toBe('taken');
  });

  it('edits every field of a custom exercise, refusing a taken name', () => {
    const e = ok(state().addExercise(fly));
    const edited = ok(state().updateExercise(e.id, { name: 'Standing fly', equipment: 'band', primaryMuscles: ['chest', 'front_delts'] }));
    expect(edited).toMatchObject({ name: 'Standing fly', equipment: 'band', primaryMuscles: ['chest', 'front_delts'] });
    expect(state().updateExercise(e.id, { name: 'Pec deck' })).toBe('taken');
    expect(state().updateExercise('nobody', { name: 'x' })).toBe('notFound');
  });

  it('refuses to change what a set records once a set is logged, but not before', () => {
    const e = ok(state().addExercise(fly));
    // No sets yet: the kind can still change.
    expect(ok(state().updateExercise(e.id, { kind: 'duration' })).kind).toBe('duration');
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: e.id, durationSeconds: 45 }));
    expect(state().updateExercise(e.id, { kind: 'weight_reps' })).toBe('hasHistory');
    expect(state().exercises.find(x => x.id === e.id)?.kind).toBe('duration');
    // Naming the kind it already has is not a change, and the rest stays editable.
    expect(ok(state().updateExercise(e.id, { kind: 'duration', equipment: 'band', primaryMuscles: ['lats'], name: 'Standing fly' })))
      .toMatchObject({ kind: 'duration', equipment: 'band', primaryMuscles: ['lats'], name: 'Standing fly' });
  });

  it('archives a custom exercise rather than removing it, with or without sets here', () => {
    // Another device's sets never arrive over iCloud, so "no sets" on this
    // device is not evidence there are none: a removal would sync out and
    // leave them pointing at nothing.
    const unused = ok(state().addExercise(fly));
    expect(state().deleteExercise(unused.id)).toBe(true);
    expect(dbGetAllExercises()).toEqual([expect.objectContaining({ id: unused.id, archived: true })]);
    expect(state().deleteExercise(unused.id)).toBe(true);

    const used = ok(state().addExercise({ ...fly, name: 'Landmine row' }));
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: used.id, weightKg: 20, reps: 12 }));
    expect(state().deleteExercise(used.id)).toBe(true);
    reload();
    expect(state().exercises.find(e => e.id === used.id)).toMatchObject({ archived: true });
    expect(dbGetAllExercises()).toHaveLength(2);
  });
});

describe('changes to a built-in exercise', () => {
  it('writes one row under the built-in id, carrying only what the person changed', () => {
    ok(state().updateExercise('lib:barbell-bench-press', { name: 'Flat bench', notes: 'Pause on the chest', primaryMuscles: ['calves'] }));
    reload();
    expect(state().exercises).toHaveLength(1);
    expect(state().exercises[0]).toMatchObject({ id: 'lib:barbell-bench-press', isCustom: false });
    const bench = catalogExercise(state().exercises, 'lib:barbell-bench-press')!;
    expect(bench).toMatchObject({ name: 'Flat bench', notes: 'Pause on the chest' });
    // The muscles stay the library's.
    expect(bench.primaryMuscles).toEqual(['chest']);
  });

  it('puts the library back when the changes are deleted', () => {
    ok(state().updateExercise('lib:back-squat', { notes: 'High bar' }));
    expect(state().deleteExercise('lib:back-squat')).toBe(true);
    expect(state().exercises).toEqual([]);
    expect(catalogExercise([], 'lib:back-squat')?.notes).toBe('');
  });

  it('does not count as content the person made', () => {
    ok(state().updateExercise('lib:back-squat', { notes: 'High bar' }));
    expect(workoutContentCount(state())).toBe(0);
  });
});

describe('routines and programs', () => {
  const item = { exerciseId: 'lib:back-squat', restSeconds: 180, progression: null, targets: [{ kind: 'working' as const, repsMin: 5, repsMax: 5, weightKg: 100 }] };

  it('adds routines in order, with their items, surviving a reload', () => {
    const a = ok(state().addRoutine('Push A', [item]));
    const b = ok(state().addRoutine('Pull A'));
    reload();
    expect(state().routines.map(r => r.name)).toEqual(['Push A', 'Pull A']);
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    expect(state().routines[0].items).toEqual([{ ...item, supersetKey: null }]);
    expect(state().addRoutine('   ')).toBe('blank');
  });

  it('edits a routine', () => {
    const r = ok(state().addRoutine('Push A'));
    const edited = ok(state().updateRoutine(r.id, { name: 'Push B', notes: 'Shoulders first', items: [item] }));
    expect(edited).toMatchObject({ name: 'Push B', notes: 'Shoulders first' });
    expect(edited.items).toHaveLength(1);
    expect(state().updateRoutine(r.id, { name: '' })).toBe('blank');
  });

  it('takes a deleted routine out of every rotation it was in', () => {
    const a = ok(state().addRoutine('Upper'));
    const b = ok(state().addRoutine('Lower'));
    const p = ok(state().addProgram({ name: 'Upper and lower', rotation: [a.id, b.id, a.id] }));
    state().deleteRoutine(a.id);
    reload();
    expect(state().programs.find(x => x.id === p.id)?.rotation).toEqual([b.id]);
  });

  it('leaves a deleted program\'s routines as routines on their own', () => {
    const p = ok(state().addProgram({ name: '5x5', weeks: 12, scheme: 'linear', trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 120 }] }));
    expect(p).toMatchObject({ weeks: 12, scheme: 'linear', trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 120 }] });
    const r = ok(state().addRoutine('Day A', [], p.id));
    state().deleteProgram(p.id);
    reload();
    expect(state().programs).toEqual([]);
    expect(state().routines.find(x => x.id === r.id)?.programId).toBeNull();
  });

  it('files a rotation\'s routines under the program, and frees the ones taken out of it', () => {
    const a = ok(state().addRoutine('Upper'));
    const b = ok(state().addRoutine('Lower'));
    const other = ok(state().addProgram({ name: 'Other' }));
    const c = ok(state().addRoutine('Elsewhere', [], other.id));
    const p = ok(state().addProgram({ name: 'Upper and lower', rotation: [a.id, b.id, c.id] }));
    const programOf = (id: string) => state().routines.find(r => r.id === id)?.programId;
    expect([programOf(a.id), programOf(b.id), programOf(c.id)]).toEqual([p.id, p.id, other.id]);
    ok(state().updateProgram(p.id, { rotation: [a.id] }));
    reload();
    expect([programOf(a.id), programOf(b.id), programOf(c.id)]).toEqual([p.id, null, other.id]);
  });

  it('adds a built-in program as routines and a program of the person\'s own', () => {
    const added = ok(state().addLibraryProgram('push-pull-legs'));
    reload();
    const program = state().programs.find(x => x.id === added.program.id)!;
    expect(program).toMatchObject({ name: 'Push / Pull / Legs', scheme: 'double', trainingMaxes: [], startedAt: null });
    expect(program.rotation.map(id => state().routines.find(r => r.id === id)?.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(state().routines.every(r => r.programId === program.id && r.items.length > 0)).toBe(true);
    expect(state().routines.find(r => r.name === 'Legs')!.items[0]).toMatchObject({ exerciseId: 'lib:back-squat', warmupRamp: true });
    expect(state().addLibraryProgram('nope')).toBe('notFound');
  });

  it('names a second copy of a library program apart rather than writing twins', () => {
    const first = ok(state().addLibraryProgram('push-pull-legs'));
    const second = ok(state().addLibraryProgram('push-pull-legs'));
    const third = ok(state().addLibraryProgram('push-pull-legs'));
    expect(first.program.name).toBe('Push / Pull / Legs');
    expect(second.program.name).toBe('Push / Pull / Legs (2)');
    expect(third.program.name).toBe('Push / Pull / Legs (3)');
    expect(second.routines.map(r => r.name)).toEqual(['Push (2)', 'Pull (2)', 'Legs (2)']);
    reload();
    const names = state().routines.map(r => r.name);
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
    // A name held with other spacing or case still counts as taken.
    ok(state().updateRoutine(second.routines[0].id, { name: 'Chest day' }));
    ok(state().updateRoutine(third.routines[0].id, { name: '  PUSH   (2) ' }));
    expect(ok(state().addLibraryProgram('push-pull-legs')).routines[0].name).toBe('Push (3)');
  });

  it('refuses a warm-up ramp on an exercise that does not record weight and reps', () => {
    const ramp = (exerciseId: string) => [{ exerciseId, supersetKey: null, restSeconds: null, progression: null, warmupRamp: true, targets: [{ kind: 'working' as const, repsMin: 8, repsMax: 8 }] }];
    expect(state().addRoutine('Assisted', ramp('lib:assisted-pull-up'))).toBe('rampKind');
    expect(state().addRoutine('Plank', ramp('lib:plank'))).toBe('rampKind');
    expect(state().routines).toEqual([]);
    const ok1 = ok(state().addRoutine('Squat', ramp('lib:back-squat')));
    expect(ok1.items[0].warmupRamp).toBe(true);
    expect(state().updateRoutine(ok1.id, { items: ramp('lib:assisted-pull-up') })).toBe('rampKind');
    expect(state().routines[0].items[0].exerciseId).toBe('lib:back-squat');
    // Without the ramp the same exercise is fine.
    expect(ok(state().addRoutine('Pull-ups', [{ ...ramp('lib:assisted-pull-up')[0], warmupRamp: undefined }])).items).toHaveLength(1);
  });

  it('edits a program, and refuses one nobody knows', () => {
    const p = ok(state().addProgram({ name: 'Wave' }));
    expect(ok(state().updateProgram(p.id, { weeks: 4, archived: true }))).toMatchObject({ weeks: 4, archived: true });
    expect(state().updateProgram('nope', { weeks: 4 })).toBe('notFound');
    expect(state().addProgram({ name: '' })).toBe('blank');
  });
});

describe('a live session', () => {
  it('starts one at a time, titled after its routine', () => {
    const r = ok(state().addRoutine('Push A'));
    const s = ok(state().startSession({ routineId: r.id }));
    expect(s).toMatchObject({ title: 'Push A', endedAt: null, routineId: r.id });
    expect(state().liveSession()?.id).toBe(s.id);
    expect(state().startSession()).toBe('live');
  });

  it('lays out a ramp ahead of the work, from the working weight, on loadable plates', () => {
    const r = ok(state().addRoutine('Squat day', [{
      exerciseId: 'lib:back-squat', restSeconds: null, progression: null, warmupRamp: true,
      targets: [{ kind: 'working', repsMin: 5, repsMax: 5, weightKg: 100 }],
    }]));
    const s = ok(state().startSession({ routineId: r.id }));
    expect(state().loadSets(s.id).map(x => [x.kind, x.weightKg, x.reps, x.completedAt])).toEqual([
      ['warmup', 40, 8, null], ['warmup', 60, 5, null], ['warmup', 80, 3, null], ['working', 100, 5, null],
    ]);
  });

  it('lays out no ramp for an exercise whose kind changed away from weight and reps', () => {
    // The kind can still change before any set is logged, and the routine's
    // ramp was accepted while it was weight and reps.
    const e = ok(state().addExercise({ name: 'Garage press variant', kind: 'weight_reps', equipment: 'barbell', primaryMuscles: ['front_delts'] }));
    const r = ok(state().addRoutine('Press day', [{
      exerciseId: e.id, restSeconds: null, progression: null, warmupRamp: true,
      targets: [{ kind: 'working', repsMin: 8, repsMax: 8, weightKg: 30 }],
    }]));
    ok(state().updateExercise(e.id, { kind: 'assisted_reps' }));
    const s = ok(state().startSession({ routineId: r.id }));
    expect(state().loadSets(s.id).map(x => x.kind)).toEqual(['working']);
  });

  it('reloads with the live session\'s sets already loaded', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    useWorkoutStore.setState({ setsBySession: {} });
    reload();
    expect(state().setsBySession[s.id]).toHaveLength(1);
    expect(state().setCounts[s.id]).toBe(1);
  });

  it('keeps an exercise in its place and counts its sets from 0', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:romanian-deadlift', weightKg: 80, reps: 8 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    const sets = dbGetWorkoutSets(s.id);
    expect(sets.map(x => [x.exerciseId, x.position, x.setIndex])).toEqual([
      ['lib:back-squat', 0, 0], ['lib:back-squat', 0, 1], ['lib:romanian-deadlift', 1, 0],
    ]);
  });

  it('cleans what a set records, and refuses an unknown session or exercise', () => {
    const s = ok(state().startSession());
    const set = ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: -5, reps: 5.4, rpe: 8.3, note: '  ' }));
    expect(set).toMatchObject({ weightKg: null, reps: 5, rpe: 8.5, note: null, kind: 'working' });
    expect(set.completedAt).not.toBeNull();
    expect(state().logSet('nope', { exerciseId: 'lib:back-squat' })).toBe('notFound');
    expect(state().logSet(s.id, { exerciseId: 'nobody' })).toBe('notFound');
  });

  it('lays a set out as planned when completedAt is null', () => {
    const s = ok(state().startSession());
    expect(ok(state().logSet(s.id, { exerciseId: 'lib:plank', durationSeconds: 60, completedAt: null })).completedAt).toBeNull();
  });

  it('edits a set, and the edit is what reloads', () => {
    const s = ok(state().startSession());
    const set = ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    ok(state().editSet(s.id, set.id, { weightKg: 102.5, reps: 4, kind: 'amrap' }));
    expect(dbGetWorkoutSets(s.id)[0]).toMatchObject({ weightKg: 102.5, reps: 4, kind: 'amrap' });
    expect(state().editSet(s.id, 'nope', { reps: 1 })).toBe('notFound');
  });

  it('closes the gap a deleted set leaves, in the database too', () => {
    const s = ok(state().startSession());
    const first = ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    const only = ok(state().logSet(s.id, { exerciseId: 'lib:leg-press', reps: 10 }));
    state().deleteSet(s.id, first.id);
    expect(dbGetWorkoutSets(s.id).map(x => [x.exerciseId, x.position, x.setIndex])).toEqual([
      ['lib:back-squat', 0, 0], ['lib:leg-press', 1, 0],
    ]);
    state().deleteSet(s.id, only.id);
    expect(state().setCounts[s.id]).toBe(1);
  });

  it('puts exercises in a new order, keeping the ones not named after', () => {
    const s = ok(state().startSession());
    for (const id of ['lib:back-squat', 'lib:leg-press', 'lib:leg-extension']) ok(state().logSet(s.id, { exerciseId: id, reps: 5 }));
    state().reorderExercises(s.id, ['lib:leg-extension', 'lib:back-squat']);
    expect(dbGetWorkoutSets(s.id).map(x => x.exerciseId)).toEqual(['lib:leg-extension', 'lib:back-squat', 'lib:leg-press']);
  });

  it('finishes once, with the effort typed and nothing derived', () => {
    const s = ok(state().startSession());
    const done = ok(state().finishSession(s.id, { effort: 7.6, notes: ' Felt strong ' }));
    expect(done).toMatchObject({ effort: 8, notes: 'Felt strong' });
    expect(done.endedAt).not.toBeNull();
    expect(state().liveSession()).toBeNull();
    expect(state().finishSession(s.id)).toBe('finished');
  });

  it('keeps the planned sets when a finish is refused for ending before it started', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5, completedAt: null }));
    const early = new Date(new Date(s.startedAt).getTime() - 60000).toISOString();
    expect(state().finishSession(s.id, { endedAt: early })).toBe('order');
    expect(state().liveSession()?.id).toBe(s.id);
    expect(dbGetWorkoutSets(s.id)).toHaveLength(2);
    expect(state().loadSets(s.id)).toHaveLength(2);
  });

  it('throws the live session away with its sets', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    state().discardSession();
    expect(state().sessions).toEqual([]);
    expect(dbGetWorkoutSets(s.id)).toEqual([]);
    expect(state().setCounts[s.id]).toBeUndefined();
  });
});

describe('a session from a routine', () => {
  const bench = 'lib:barbell-bench-press';
  const fly = 'lib:cable-fly';
  const items = [
    { exerciseId: bench, supersetKey: null, restSeconds: 150, progression: null, targets: [
      { kind: 'warmup' as const, repsMin: null, repsMax: null },
      { kind: 'working' as const, repsMin: 6, repsMax: 8 },
      { kind: 'working' as const, repsMin: 6, repsMax: 8, weightKg: 85 },
    ] },
    { exerciseId: fly, supersetKey: 'ss', restSeconds: null, progression: null, targets: [
      { kind: 'working' as const, repsMin: 12, repsMax: 15 },
    ] },
    { exerciseId: 'not-an-exercise', supersetKey: null, restSeconds: null, progression: null, targets: [
      { kind: 'working' as const, repsMin: 5, repsMax: 5 },
    ] },
  ];

  it('lays the routine\'s sets out as planned, from the routine and from last time', () => {
    const r = ok(state().addRoutine('Push A', items));
    const before = ok(state().startSession({ routineId: r.id, at: new Date(2026, 9, 1, 18) }));
    for (const s of state().loadSets(before.id)) {
      ok(state().editSet(before.id, s.id, { weightKg: s.kind === 'warmup' ? 40 : 80, reps: 8, completedAt: new Date(2026, 9, 1, 18, 10).toISOString() }));
    }
    ok(state().finishSession(before.id));

    const s = ok(state().startSession({ routineId: r.id }));
    const sets = dbGetWorkoutSets(s.id);
    expect(sets.map(x => [x.exerciseId, x.position, x.setIndex, x.kind, x.weightKg, x.reps, x.completedAt])).toEqual([
      [bench, 0, 0, 'warmup', 40, 8, null],
      [bench, 0, 1, 'working', 80, 8, null],
      // The routine's own weight wins over last time's.
      [bench, 0, 2, 'working', 85, 8, null],
      [fly, 1, 0, 'working', 80, 8, null],
    ]);
    expect(sets[3].supersetKey).toBe('ss');
    expect(state().setsBySession[s.id]).toHaveLength(4);
    expect(state().lastTimeFor(bench, s.id).map(x => x.weightKg)).toEqual([40, 80, 80]);
  });

  it('finishes by dropping the sets never ticked', () => {
    const r = ok(state().addRoutine('Push A', items));
    const s = ok(state().startSession({ routineId: r.id }));
    const [, second] = state().loadSets(s.id);
    ok(state().editSet(s.id, second.id, { completedAt: new Date().toISOString() }));
    ok(state().finishSession(s.id));
    expect(dbGetWorkoutSets(s.id).map(x => [x.exerciseId, x.setIndex])).toEqual([[bench, 0]]);
    expect(state().setCounts[s.id]).toBe(1);
  });

  it('completes the task it was started from, once, and only an open one', () => {
    mockTasks = [task('t1'), task('t2', {}, { completed: true, completedAt: new Date().toISOString() })];
    const a = ok(state().startSession({ taskId: 't1' }));
    ok(state().finishSession(a.id));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1');
    const b = ok(state().startSession({ taskId: 't2' }));
    ok(state().finishSession(b.id));
    const c = ok(state().startSession({ taskId: 'gone' }));
    ok(state().finishSession(c.id));
    expect(mockCompleteTask).toHaveBeenCalledTimes(1);
  });

  it('logs one workout on a target below its count, the way its checkbox would', () => {
    mockTasks = [task('t3', { targetCount: 3, quotaPeriod: 'week', recurrenceType: 'weekly', recurrenceInterval: 1 })];
    const s = ok(state().startSession({ taskId: 't3' }));
    ok(state().finishSession(s.id));
    expect(mockLogQuotaUnit).toHaveBeenCalledWith('t3');
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('leaves the task alone when asked to, for a task that asks a question first', () => {
    mockTasks = [task('t1')];
    const s = ok(state().startSession({ taskId: 't1' }));
    ok(state().finishSession(s.id, { completeLinkedTask: false }));
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('adds an exercise mid-session laid out like last time, once', () => {
    const s = ok(state().startSession());
    const added = ok(state().addSessionExercise(s.id, 'lib:back-squat'));
    expect(added.map(x => [x.position, x.setIndex, x.kind, x.completedAt])).toEqual([[0, 0, 'working', null]]);
    expect(state().addSessionExercise(s.id, 'lib:back-squat')).toBe('taken');
    expect(state().addSessionExercise(s.id, 'nobody')).toBe('notFound');
  });

  it('lays warm-ups out ahead of an exercise\'s sets, which move down to make room', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5, completedAt: null }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5, completedAt: null }));
    ok(state().logSet(s.id, { exerciseId: 'lib:leg-press', weightKg: 150, reps: 10, completedAt: null }));
    const added = ok(state().addPlannedWarmups(s.id, 'lib:back-squat', [{ kg: 40, reps: 8 }, { kg: 60, reps: 5 }]));
    expect(added.map(x => [x.kind, x.weightKg, x.completedAt])).toEqual([['warmup', 40, null], ['warmup', 60, null]]);
    const rows = dbGetWorkoutSets(s.id);
    expect(rows.map(x => [x.exerciseId, x.position, x.setIndex, x.kind, x.weightKg])).toEqual([
      ['lib:back-squat', 0, 0, 'warmup', 40], ['lib:back-squat', 0, 1, 'warmup', 60],
      ['lib:back-squat', 0, 2, 'working', 100], ['lib:back-squat', 0, 3, 'working', 100],
      ['lib:leg-press', 1, 0, 'working', 150],
    ]);
    expect(state().setsBySession[s.id]).toHaveLength(5);
    expect(state().addPlannedWarmups(s.id, 'lib:pec-deck', [{ kg: 10, reps: 8 }])).toBe('notFound');
    expect(state().addPlannedWarmups('nope', 'lib:back-squat', [{ kg: 10, reps: 8 }])).toBe('notFound');
  });

  it('adds a set like the exercise\'s last', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', kind: 'warmup', weightKg: 60, reps: 5 }));
    const added = ok(state().addPlannedSet(s.id, 'lib:back-squat'));
    expect(added).toMatchObject({ kind: 'working', weightKg: 60, reps: 5, setIndex: 1, completedAt: null });
    expect(state().addPlannedSet(s.id, 'lib:leg-press')).toBe('notFound');
  });
});

describe('a workout logged after the fact', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).toISOString();

  it('writes a finished session with its sets in order, all done, while another is live', () => {
    ok(state().startSession());
    const { session, sets } = ok(state().addFinishedSession({
      title: '  Legs ', startedAt: at(7), endedAt: at(8), effort: 7, notes: ' Heavy ',
      sets: [
        { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 },
        { exerciseId: 'lib:leg-press', weightKg: 200, reps: 10 },
        { exerciseId: 'lib:back-squat', weightKg: 100, reps: 4 },
      ],
    }));
    expect(session).toMatchObject({ title: 'Legs', endedAt: at(8), effort: 7, notes: 'Heavy', taskId: null });
    expect(sets.map(x => [x.exerciseId, x.position, x.setIndex, x.completedAt])).toEqual([
      ['lib:back-squat', 0, 0, at(8)], ['lib:leg-press', 1, 0, at(8)], ['lib:back-squat', 0, 1, at(8)],
    ]);
    reload();
    expect(state().sessions.find(x => x.id === session.id)?.endedAt).toBe(at(8));
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('refuses one with no sets, one that ends first, and an unknown exercise', () => {
    expect(state().addFinishedSession({ startedAt: at(7), endedAt: at(8), sets: [] })).toBe('empty');
    expect(state().addFinishedSession({ startedAt: at(8), endedAt: at(7), sets: [{ exerciseId: 'lib:back-squat' }] })).toBe('order');
    expect(state().addFinishedSession({ startedAt: at(7), endedAt: at(8), sets: [{ exerciseId: 'nobody' }] })).toBe('notFound');
    expect(state().sessions).toEqual([]);
  });

  it('replaces a session\'s sets to correct it', () => {
    const { session } = ok(state().addFinishedSession({
      startedAt: at(7), endedAt: at(8), sets: [{ exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }],
    }));
    const sets = ok(state().replaceSets(session.id, [{ exerciseId: 'lib:front-squat', weightKg: 80, reps: 3 }]));
    expect(dbGetWorkoutSets(session.id)).toEqual(sets);
    expect(sets[0]).toMatchObject({ exerciseId: 'lib:front-squat', completedAt: at(8) });
    expect(state().replaceSets('nope', [])).toBe('notFound');
  });
});

describe('importing sessions from a file', () => {
  const at = (h: number) => new Date(2026, 8, 5, h).toISOString();
  const planned = (id: string, h: number, extra: Partial<PlannedImportSession> = {}): PlannedImportSession => ({
    id, title: 'Push', startedAt: at(h), startPrecisionMs: 1000, endedAt: at(h + 1), notes: ' felt good ',
    sets: [
      { exerciseRef: 'lib:back-squat', kind: 'working', weightKg: 100, reps: 5, durationSeconds: null, distanceM: null, rpe: null, note: null, supersetKey: null },
      { exerciseRef: 'new:sled drag', kind: 'working', weightKg: 40, reps: 10, durationSeconds: null, distanceM: null, rpe: null, note: null, supersetKey: null },
      { exerciseRef: 'new:sled drag', kind: 'drop', weightKg: 30, reps: 10, durationSeconds: null, distanceM: null, rpe: null, note: null, supersetKey: null },
    ],
    ...extra,
  });
  const creates = { 'sled drag': { name: 'Sled drag', kind: 'weight_reps' as const, equipment: 'other' as const, primaryMuscles: [] } };

  it('writes the sessions, their sets and the custom exercise together, and reads back after a reload', () => {
    const result = state().importSessions([planned('imp-a', 7), planned('imp-b', 9)], creates);
    expect(result).toEqual({ sessions: 2, sets: 6, created: 1, duplicates: 0 });
    const sled = state().exercises.find(e => e.name === 'Sled drag')!;
    expect(sled.isCustom).toBe(true);
    reload();
    expect(state().sessions.map(x => x.id)).toEqual(['imp-b', 'imp-a']);
    expect(state().sessions[1]).toMatchObject({ title: 'Push', notes: 'felt good', routineId: null, taskId: null, endedAt: at(8) });
    const sets = dbGetWorkoutSets('imp-a');
    expect(sets.map(x => [x.exerciseId === sled.id ? 'sled' : x.exerciseId, x.position, x.setIndex, x.kind])).toEqual([
      ['lib:back-squat', 0, 0, 'working'], ['sled', 1, 0, 'working'], ['sled', 1, 1, 'drop'],
    ]);
    expect(sets.every(x => x.completedAt === at(8))).toBe(true);
    expect(state().setCounts['imp-a']).toBe(3);
  });

  it('adds nothing the second time', () => {
    state().importSessions([planned('imp-a', 7)], creates);
    const again = state().importSessions([planned('imp-a', 7), planned('another-id', 7)], creates);
    expect(again).toEqual({ sessions: 0, sets: 0, created: 0, duplicates: 2 });
    expect(state().sessions).toHaveLength(1);
    expect(state().exercises.filter(e => e.name === 'Sled drag')).toHaveLength(1);
  });

  it('skips a workout that started at the same time under another title', () => {
    state().importSessions([planned('imp-a', 7)], creates);
    const again = state().importSessions([planned('imp-c', 7, { title: 'Renamed since' })], creates);
    expect(again).toMatchObject({ sessions: 0, duplicates: 1 });
  });

  it('does not double the app\'s own export when it is imported back into the same log', () => {
    // A session keeps its milliseconds; the export writes whole seconds.
    const started = new Date(2026, 8, 5, 7, 15, 20, 789);
    const first = ok(state().addFinishedSession({
      title: 'Leg day', startedAt: started.toISOString(), endedAt: new Date(started.getTime() + 3_600_000).toISOString(),
      sets: [
        { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 },
        { exerciseId: 'lib:leg-press', weightKg: 180, reps: 10 },
      ],
    }));
    const second = ok(state().addFinishedSession({
      title: 'Push', startedAt: new Date(2026, 8, 7, 18, 0, 0, 5).toISOString(), endedAt: new Date(2026, 8, 7, 19, 0, 0, 5).toISOString(),
      sets: [{ exerciseId: 'lib:barbell-bench-press', weightKg: 80, reps: 8 }],
    }));
    const csv = workoutExportCsv(
      [first, second].map(({ session }) => ({ session, sets: state().loadSets(session.id) })),
      state().exercises,
      'kg',
    );
    const parsed = parseWorkoutCsv(csv);
    if (!parsed.ok) throw new Error('export did not parse');
    expect(parsed.sessions).toHaveLength(2);
    const resolutions = Object.fromEntries(
      distinctExerciseNames(parsed.sessions).map(n => [n.key, { kind: 'create' as const }]),
    );
    const plan = buildImportPlan(parsed.sessions, resolutions, state().sessions);
    expect(plan.sessions).toHaveLength(0);
    expect(plan.duplicates).toBe(2);
    // And the store's own check, for a plan made before the log had them.
    const fresh = buildImportPlan(parsed.sessions, resolutions, []);
    const creates2 = Object.fromEntries(fresh.createKeys.map(k => [k, { name: k, kind: 'weight_reps' as const, equipment: 'other' as const, primaryMuscles: [] }]));
    expect(state().importSessions(fresh.sessions, creates2)).toEqual({ sessions: 0, sets: 0, created: 0, duplicates: 2 });
    expect(state().sessions).toHaveLength(2);
  });

  it('uses the exercise already holding a name rather than making a second', () => {
    ok(state().addExercise({ name: 'sled DRAG', kind: 'weight_reps', equipment: 'other', primaryMuscles: [] }));
    const result = state().importSessions([planned('imp-a', 7)], creates);
    expect(result.created).toBe(0);
    expect(state().exercises.filter(e => e.name.toLowerCase() === 'sled drag')).toHaveLength(1);
  });

  it('drops a set whose exercise cannot be resolved, and a session left with none', () => {
    const bad = planned('imp-bad', 11, {
      sets: [{ exerciseRef: 'nobody', kind: 'working', weightKg: 1, reps: 1, durationSeconds: null, distanceM: null, rpe: null, note: null, supersetKey: null }],
    });
    const result = state().importSessions([bad, planned('imp-a', 7)], {});
    expect(result.sessions).toBe(1);
    expect(dbGetWorkoutSets('imp-a')).toHaveLength(1);
    expect(state().sessions.map(x => x.id)).toEqual(['imp-a']);
  });
});

describe('history', () => {
  it('lists sessions newest first and loads a finished one\'s sets on demand', () => {
    const older = ok(state().startSession({ title: 'Older', at: new Date(2026, 9, 1, 18) }));
    ok(state().logSet(older.id, { exerciseId: 'lib:back-squat', reps: 5, completedAt: new Date(2026, 9, 1, 18, 5).toISOString() }));
    ok(state().finishSession(older.id));
    const newer = ok(state().startSession({ title: 'Newer', at: new Date(2026, 9, 3, 18) }));
    ok(state().finishSession(newer.id));
    reload();
    expect(state().sessions.map(s => s.title)).toEqual(['Newer', 'Older']);
    expect(state().setsBySession[older.id]).toBeUndefined();
    expect(state().setCounts[older.id]).toBe(1);
    expect(state().loadSets(older.id)).toHaveLength(1);
    expect(state().exerciseHistory('lib:back-squat')).toHaveLength(1);
  });

  it('reads every done set across sessions, leaving planned ones out', () => {
    const a = ok(state().startSession({ at: new Date(2026, 9, 1, 18) }));
    ok(state().logSet(a.id, { exerciseId: 'lib:back-squat', reps: 5, completedAt: new Date(2026, 9, 1, 18, 5).toISOString() }));
    ok(state().finishSession(a.id));
    const b = ok(state().startSession({ at: new Date(2026, 9, 3, 18) }));
    ok(state().logSet(b.id, { exerciseId: 'lib:barbell-bench-press', reps: 8, completedAt: new Date(2026, 9, 3, 18, 5).toISOString() }));
    ok(state().logSet(b.id, { exerciseId: 'lib:barbell-bench-press', reps: 8, completedAt: null }));
    const all = state().allSets();
    expect(all.map(x => x.exerciseId)).toEqual(['lib:back-squat', 'lib:barbell-bench-press']);
    expect(all.every(x => x.completedAt !== null)).toBe(true);
  });

  it('deletes a finished session and its sets', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    ok(state().finishSession(s.id));
    state().deleteSession(s.id);
    reload();
    expect(state().sessions).toEqual([]);
    expect(dbGetWorkoutSets(s.id)).toEqual([]);
  });

  it('edits a session, refusing a blank title', () => {
    const s = ok(state().startSession({ title: 'Legs' }));
    expect(ok(state().updateSession(s.id, { title: 'Leg day', effort: 11 }))).toMatchObject({ title: 'Leg day', effort: null });
    expect(state().updateSession(s.id, { title: ' ' })).toBe('blank');
    expect(state().updateSession(s.id, { endedAt: new Date(2000, 0, 1).toISOString() })).toBe('order');
    expect(state().updateSession('nope', {})).toBe('notFound');
  });

  it('counts sessions, routines, programs and custom exercises as content', () => {
    ok(state().startSession());
    ok(state().addRoutine('A'));
    ok(state().addProgram({ name: 'P' }));
    ok(state().addExercise({ name: 'Landmine row', kind: 'weight_reps', equipment: 'barbell', primaryMuscles: ['upper_back'] }));
    expect(workoutContentCount(state())).toBe(4);
  });
});

/**
 * Writing a workout to Apple Health (docs/arch/health-data.md, "The fourth
 * write"): on Save, retracted on delete, rewritten when a written workout's
 * times move, and the pending pass for a workout an agent logged.
 */
describe('Apple Health', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).toISOString();
  const finishOne = () => {
    const live = ok(state().startSession({ title: 'Upper', at: new Date(2026, 9, 5, 9) }));
    ok(state().logSet(live.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    return ok(state().finishSession(live.id, { endedAt: at(10) }));
  };
  const logged = (extra: Record<string, unknown> = {}) => ok(state().addFinishedSession({
    startedAt: at(7), endedAt: at(8), sets: [{ exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }], ...extra,
  })).session;
  const stampId = (id: string, healthWorkoutId: string) => {
    dbSaveWorkoutSession({ ...dbGetWorkoutSession(id)!, healthWorkoutId });
    reload();
  };

  it('writes a workout once on Save and keeps the id Health gave it', async () => {
    mockWrite.mockResolvedValue(written('HK-1'));
    const done = finishOne();
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ id: done.id, endedAt: at(10) });
    await flush();
    expect(dbGetWorkoutSession(done.id)).toMatchObject({ healthWorkoutId: 'HK-1', healthWritePending: false });
    expect(state().sessions.find(x => x.id === done.id)?.healthWorkoutId).toBe('HK-1');
  });

  it('takes the write back out when the workout was deleted before Health answered', async () => {
    let land: (v: unknown) => void = () => {};
    mockWrite.mockReturnValue(new Promise(r => { land = r; }));
    const done = finishOne();
    state().deleteSession(done.id);
    land(written('HK-2'));
    await flush();
    expect(mockRetract).toHaveBeenCalledWith(['HK-2']);
    expect(dbGetWorkoutSession(done.id)).toBeNull();
  });

  it('writes it again when its times moved before Health answered, and drops the first', async () => {
    let land: (v: unknown) => void = () => {};
    mockWrite.mockReturnValueOnce(new Promise(r => { land = r; })).mockResolvedValueOnce(written('HK-4'));
    const done = finishOne();
    ok(state().updateSession(done.id, { endedAt: at(11) }));
    land(written('HK-3'));
    await flush();
    expect(mockRetract).toHaveBeenCalledWith(['HK-3']);
    expect(mockWrite).toHaveBeenLastCalledWith(expect.objectContaining({ endedAt: at(11) }));
    expect(dbGetWorkoutSession(done.id)?.healthWorkoutId).toBe('HK-4');
  });

  it('moves to its own id when another write of the session landed first, and retracts the older one', async () => {
    // Both carry the session's sync identifier, so this one replaced the
    // other in Health; retracting it would leave neither.
    let land: (v: unknown) => void = () => {};
    mockWrite.mockReturnValue(new Promise(r => { land = r; }));
    const done = finishOne();
    stampId(done.id, 'HK-OTHER');
    land(written('HK-13'));
    await flush();
    expect(mockRetract).toHaveBeenCalledWith(['HK-OTHER']);
    expect(mockRetract).not.toHaveBeenCalledWith(['HK-13']);
    expect(dbGetWorkoutSession(done.id)?.healthWorkoutId).toBe('HK-13');
  });

  it('keeps the id it has when the later write saved locked, with no id to move to', async () => {
    let land: (v: unknown) => void = () => {};
    mockWrite.mockReturnValue(new Promise(r => { land = r; }));
    const done = finishOne();
    stampId(done.id, 'HK-OTHER');
    land(written(null));
    await flush();
    expect(mockRetract).not.toHaveBeenCalled();
    expect(dbGetWorkoutSession(done.id)?.healthWorkoutId).toBe('HK-OTHER');
  });

  it('writes nothing for an edit that changes nothing', () => {
    const s = logged();
    const before = state().sessions;
    expect(state().updateSession(s.id, {})).toBe(state().sessions.find(x => x.id === s.id));
    expect(state().updateSession(s.id, { title: s.title, notes: s.notes, startedAt: s.startedAt, endedAt: s.endedAt })).toBe(before.find(x => x.id === s.id));
    expect(state().sessions).toBe(before);
  });

  it('says a refusal once, and again only after a write has landed', async () => {
    useSettingsStore.getState().setHealthWorkoutWriteRefusalSeen(false);
    mockWrite.mockResolvedValue({ outcome: 'refused', workoutId: null, sampleIds: [] });
    finishOne();
    await flush();
    expect(state().pendingHealthWriteRefusal).toBe(true);
    state().setPendingHealthWriteRefusal(false);
    finishOne();
    await flush();
    expect(state().pendingHealthWriteRefusal).toBe(false);
    mockWrite.mockResolvedValue(written('HK-5'));
    finishOne();
    await flush();
    expect(useSettingsStore.getState().healthWorkoutWriteRefusalSeen).toBe(false);
  });

  it('retracts a deleted workout whatever the switches say, and asks nothing of one never written', async () => {
    const plain = logged();
    state().deleteSession(plain.id);
    expect(mockRetract).not.toHaveBeenCalled();
    const inHealth = logged();
    stampId(inHealth.id, 'HK-6');
    state().deleteSession(inHealth.id);
    expect(mockRetract).toHaveBeenCalledWith(['HK-6']);
  });

  it('rewrites a written workout whose times change, while writing is on', async () => {
    mockWriteOn.mockReturnValue(true);
    mockWrite.mockResolvedValue(written('HK-8'));
    const s = logged();
    stampId(s.id, 'HK-7');
    ok(state().updateSession(s.id, { startedAt: at(6, 30) }));
    // Still in Health while the rewrite is on its way, so the page keeps
    // saying so and a second edit is checked against Health's limits.
    expect(dbGetWorkoutSession(s.id)?.healthWorkoutId).toBe('HK-7');
    await flush();
    expect(mockRetract).toHaveBeenCalledWith(['HK-7']);
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ startedAt: at(6, 30), endedAt: at(8) }));
    expect(dbGetWorkoutSession(s.id)?.healthWorkoutId).toBe('HK-8');
  });

  it('keeps pointing at the old workout when a rewrite is refused and the retract failed', async () => {
    mockWriteOn.mockReturnValue(true);
    mockRetract.mockResolvedValue(false);
    mockWrite.mockResolvedValue({ outcome: 'refused', workoutId: null, sampleIds: [] });
    const s = logged();
    stampId(s.id, 'HK-20');
    ok(state().updateSession(s.id, { endedAt: at(9) }));
    await flush();
    expect(dbGetWorkoutSession(s.id)?.healthWorkoutId).toBe('HK-20');
  });

  it('lets go of the old id when a rewrite is refused after the retract took it out', async () => {
    mockWriteOn.mockReturnValue(true);
    mockWrite.mockResolvedValue({ outcome: 'refused', workoutId: null, sampleIds: [] });
    const s = logged();
    stampId(s.id, 'HK-21');
    ok(state().updateSession(s.id, { endedAt: at(9) }));
    await flush();
    expect(mockRetract).toHaveBeenCalledWith(['HK-21']);
    expect(dbGetWorkoutSession(s.id)?.healthWorkoutId).toBeNull();
  });

  it('rewrites again for a second retime while the first is on its way, and ends on one id', async () => {
    mockWriteOn.mockReturnValue(true);
    let land: (v: unknown) => void = () => {};
    mockWrite.mockReturnValueOnce(new Promise(r => { land = r; })).mockResolvedValue(written('HK-23'));
    const s = logged();
    stampId(s.id, 'HK-22');
    ok(state().updateSession(s.id, { endedAt: at(9) }));
    await flush();
    ok(state().updateSession(s.id, { endedAt: at(9, 30) }));
    await flush();
    land(written('HK-STALE'));
    await flush();
    await flush();
    expect(mockWrite).toHaveBeenLastCalledWith(expect.objectContaining({ endedAt: at(9, 30) }));
    expect(mockRetract).toHaveBeenCalledWith(['HK-STALE']);
    expect(dbGetWorkoutSession(s.id)?.healthWorkoutId).toBe('HK-23');
  });

  it('leaves Health alone for an edit with writing off, one that keeps the times, and one never written', async () => {
    const s = logged();
    stampId(s.id, 'HK-9');
    ok(state().updateSession(s.id, { endedAt: at(9) }));
    mockWriteOn.mockReturnValue(true);
    ok(state().updateSession(s.id, { notes: 'Heavy', effort: 8 }));
    ok(state().replaceSets(s.id, [{ exerciseId: 'lib:front-squat', weightKg: 80, reps: 3 }]));
    const never = logged();
    ok(state().updateSession(never.id, { endedAt: at(9) }));
    await flush();
    expect(mockRetract).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(dbGetWorkoutSession(s.id)?.healthWorkoutId).toBe('HK-9');
  });

  it('never writes an imported workout', () => {
    state().importSessions([{
      id: 'imp-h', title: 'Push', startedAt: at(7), startPrecisionMs: 1000, endedAt: at(8), notes: '',
      sets: [{ exerciseRef: 'lib:back-squat', kind: 'working', weightKg: 100, reps: 5, durationSeconds: null, distanceM: null, rpe: null, note: null, supersetKey: null }],
    }], {});
    expect(mockWrite).not.toHaveBeenCalled();
    expect(dbGetWorkoutSession('imp-h')).toMatchObject({ healthWorkoutId: null, healthWritePending: false });
  });

  describe('a workout an agent logged', () => {
    const recent = () => {
      const end = new Date(Date.now() - 3_600_000);
      return logged({ startedAt: new Date(end.getTime() - 3_600_000).toISOString(), endedAt: end.toISOString(), healthWritePending: true });
    };

    it('is written by the pending pass, which keeps the id and clears the flag', async () => {
      const s = recent();
      expect(s.healthWritePending).toBe(true);
      mockWrite.mockResolvedValue(written('HK-10'));
      await state().writePendingHealthSessions();
      expect(dbGetWorkoutSession(s.id)).toMatchObject({ healthWorkoutId: 'HK-10', healthWritePending: false });
    });

    it('stays flagged while writing is off or refused, so a later pass can send it', async () => {
      const s = recent();
      for (const outcome of ['off', 'unavailable', 'refused']) {
        mockWrite.mockResolvedValue({ outcome, workoutId: null, sampleIds: [] });
        await state().writePendingHealthSessions();
        expect(dbGetWorkoutSession(s.id)?.healthWritePending).toBe(true);
      }
    });

    it('is dropped unwritten once it ended over a week ago', async () => {
      const old = logged({ healthWritePending: true });
      await state().writePendingHealthSessions();
      expect(mockWrite).not.toHaveBeenCalled();
      expect(dbGetWorkoutSession(old.id)?.healthWritePending).toBe(false);
    });

    it('waits, still flagged, while it has no length, and is written once one is added', async () => {
      const end = new Date(Date.now() - 3_600_000).toISOString();
      const s = logged({ startedAt: end, endedAt: end, healthWritePending: true });
      await state().writePendingHealthSessions();
      expect(mockWrite).not.toHaveBeenCalled();
      expect(dbGetWorkoutSession(s.id)?.healthWritePending).toBe(true);
      ok(state().updateSession(s.id, { endedAt: new Date(Date.now() - 600_000).toISOString() }));
      mockWrite.mockResolvedValue(written('HK-12'));
      await state().writePendingHealthSessions();
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(dbGetWorkoutSession(s.id)).toMatchObject({ healthWorkoutId: 'HK-12', healthWritePending: false });
    });

    it('keeps the flag when the writer calls the span unwritable', async () => {
      const s = recent();
      mockWrite.mockResolvedValue({ outcome: 'notWritable', workoutId: null, sampleIds: [] });
      await state().writePendingHealthSessions();
      expect(dbGetWorkoutSession(s.id)?.healthWritePending).toBe(true);
    });

    it('is written once when two passes overlap', async () => {
      recent();
      mockWrite.mockResolvedValue(written('HK-11'));
      await Promise.all([state().writePendingHealthSessions(), state().writePendingHealthSessions()]);
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });
  });
});
