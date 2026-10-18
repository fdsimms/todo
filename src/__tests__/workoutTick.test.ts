import type { WorkoutRoutine, WorkoutSession, WorkoutSet } from '../types';

// The three stores as fakes: what is under test is the rule (`tickOutcome`)
// and that `tickSet` writes it through the same calls workout mode used to
// make itself. The workout store's own write is tested in useWorkoutStore.test.ts.
const mockEditSet = jest.fn();
const mockLoadSets = jest.fn();
const mockStartRest = jest.fn();
const mockRemoveRestsOutside = jest.fn();
let mockSessions: WorkoutSession[] = [];
let mockRoutines: WorkoutRoutine[] = [];
let mockSetsBySession: Record<string, WorkoutSet[]> = {};
let mockDefaultRest = 90;

jest.mock('../store/useWorkoutStore', () => ({
  useWorkoutStore: {
    getState: () => ({
      sessions: mockSessions,
      routines: mockRoutines,
      exercises: [],
      setsBySession: mockSetsBySession,
      loadSets: mockLoadSets,
      editSet: mockEditSet,
    }),
  },
}));
jest.mock('../store/useStepTimerStore', () => ({
  useStepTimerStore: { getState: () => ({ startRest: mockStartRest, removeRestsOutside: mockRemoveRestsOutside }) },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ defaultRestSeconds: mockDefaultRest }) },
}));

import { restLabelFor, tickOutcome, tickSet } from '../utils/workoutTick';

const DONE = '2026-10-18T09:00:00.000Z';
const NOW = new Date('2026-10-18T09:05:00');

let seq = 0;
function set(exerciseId: string, position: number, setIndex: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  seq += 1;
  return {
    id: `${exerciseId}-${setIndex}-${seq}`,
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

const routine = (items: { exerciseId: string; restSeconds: number }[]): WorkoutRoutine => ({
  id: 'rt',
  name: 'Push A',
  notes: '',
  programId: null,
  sortOrder: 0,
  createdAt: DONE,
  items: items.map(i => ({ exerciseId: i.exerciseId, restSeconds: i.restSeconds, progression: 'none', targets: [] })) as unknown as WorkoutRoutine['items'],
});

const liveSession = (extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'w1',
  routineId: null,
  programId: null,
  taskId: null,
  title: 'Push A',
  startedAt: DONE,
  endedAt: null,
  notes: '',
  effort: null,
  healthWorkoutId: null,
  healthWritePending: false,
  ...extra,
});

describe('restLabelFor', () => {
  it('names the set the rest comes after', () => {
    expect(restLabelFor({ kind: 'working' }, '2', 'Barbell bench press')).toBe('After set 2 of Barbell bench press');
    expect(restLabelFor({ kind: 'warmup' }, 'W', 'Barbell bench press')).toBe('After a warm-up set of Barbell bench press');
    expect(restLabelFor({ kind: 'drop' }, 'D', 'Barbell bench press')).toBe('After a drop set of Barbell bench press');
  });
});

describe('tickOutcome', () => {
  const ctx = { routine: null, defaultRestSeconds: 90, exerciseName: 'Barbell bench press' };

  it('keeps the card on an exercise done alone and starts the default rest, numbered past the warm-up', () => {
    const sets = [
      set('bench', 0, 0, { kind: 'warmup', completedAt: DONE }),
      set('bench', 0, 1, { completedAt: DONE }),
      set('bench', 0, 2),
    ];
    expect(tickOutcome(sets, sets[1].id, ctx)).toEqual({
      showExerciseId: 'bench',
      rest: true,
      restPlan: { kind: 'start', seconds: 90, label: 'After set 1 of Barbell bench press' },
    });
  });

  it('takes the routine item’s own rest over the default', () => {
    const sets = [set('bench', 0, 0, { completedAt: DONE }), set('bench', 0, 1)];
    const outcome = tickOutcome(sets, sets[0].id, { ...ctx, routine: routine([{ exerciseId: 'bench', restSeconds: 150 }]) });
    expect(outcome?.restPlan).toEqual({ kind: 'start', seconds: 150, label: 'After set 1 of Barbell bench press' });
  });

  it('drops the last rest when the exercise asks for none', () => {
    const sets = [set('bench', 0, 0, { completedAt: DONE }), set('bench', 0, 1)];
    const outcome = tickOutcome(sets, sets[0].id, { ...ctx, routine: routine([{ exerciseId: 'bench', restSeconds: 0 }]) });
    expect(outcome?.restPlan).toEqual({ kind: 'clear' });
  });

  it('turns to the superset partner mid-round with no rest, and rests after the round', () => {
    const sets = [
      set('incline', 0, 0, { supersetKey: 'ss', completedAt: DONE }),
      set('incline', 0, 1, { supersetKey: 'ss' }),
      set('fly', 1, 0, { supersetKey: 'ss' }),
      set('fly', 1, 1, { supersetKey: 'ss' }),
    ];
    expect(tickOutcome(sets, sets[0].id, ctx)).toEqual({ showExerciseId: 'fly', rest: false, restPlan: { kind: 'keep' } });
    const roundDone = sets.map((s, i) => (i === 2 ? { ...s, completedAt: DONE } : s));
    const closing = tickOutcome(roundDone, sets[2].id, ctx);
    expect(closing?.showExerciseId).toBe('incline');
    expect(closing?.restPlan.kind).toBe('start');
  });

  it('is null for a set the session doesn’t hold', () => {
    expect(tickOutcome([set('bench', 0, 0)], 'nope', ctx)).toBeNull();
  });
});

describe('tickSet', () => {
  let sets: WorkoutSet[];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // The clock the "is the rest already over" check reads.
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    sets = [set('bench', 0, 0), set('bench', 0, 1)];
    mockSessions = [liveSession()];
    mockRoutines = [];
    mockDefaultRest = 90;
    mockSetsBySession = { w1: sets };
    // The store's write, as the store does it: the set comes back done.
    mockEditSet.mockImplementation((sessionId: string, setId: string, patch: Partial<WorkoutSet>) => {
      mockSetsBySession = { ...mockSetsBySession, [sessionId]: mockSetsBySession[sessionId].map(s => (s.id === setId ? { ...s, ...patch } : s)) };
      return mockSetsBySession[sessionId].find(s => s.id === setId);
    });
  });

  it('writes the tick now and starts the rest it leads to', () => {
    expect(tickSet('w1', sets[0].id, NOW)).toEqual({ showExerciseId: 'bench', rest: true });
    expect(mockEditSet).toHaveBeenCalledWith('w1', sets[0].id, { completedAt: NOW.toISOString() });
    expect(mockStartRest).toHaveBeenCalledWith({
      sessionId: 'w1',
      exerciseId: 'bench',
      sessionTitle: 'Push A',
      label: 'After set 1 of this exercise',
      durationSeconds: 90,
      startedAt: NOW.toISOString(),
    });
  });

  // The Apple Watch's tick: done a moment ago, with the numbers it was done at.
  it('writes the watch’s numbers in the same write as the tick, and rests from when it was done', () => {
    const doneAt = new Date(NOW.getTime() - 20_000);
    tickSet('w1', sets[0].id, doneAt, { weightKg: 82.5, reps: 6 });
    expect(mockEditSet).toHaveBeenCalledTimes(1);
    expect(mockEditSet).toHaveBeenCalledWith('w1', sets[0].id, { weightKg: 82.5, reps: 6, completedAt: doneAt.toISOString() });
    expect(mockStartRest).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 90, startedAt: doneAt.toISOString() }));
  });

  it('starts no rest that would already be over, and drops the older one', () => {
    const longAgo = new Date(NOW.getTime() - 5 * 60_000);
    expect(tickSet('w1', sets[0].id, longAgo)).toEqual({ showExerciseId: 'bench', rest: true });
    expect(mockStartRest).not.toHaveBeenCalled();
    expect(mockRemoveRestsOutside).toHaveBeenCalledWith(null);
    expect(mockEditSet).toHaveBeenCalledWith('w1', sets[0].id, { completedAt: longAgo.toISOString() });
  });

  it('reads the rest from the session’s routine', () => {
    mockSessions = [liveSession({ routineId: 'rt' })];
    mockRoutines = [routine([{ exerciseId: 'bench', restSeconds: 0 }])];
    tickSet('w1', sets[0].id, NOW);
    expect(mockStartRest).not.toHaveBeenCalled();
    expect(mockRemoveRestsOutside).toHaveBeenCalledWith(null);
  });

  it('ticks nothing for a set already done, a set it doesn’t hold, or a finished session', () => {
    mockSetsBySession = { w1: [{ ...sets[0], completedAt: DONE }, sets[1]] };
    expect(tickSet('w1', sets[0].id, NOW)).toBeNull();
    expect(tickSet('w1', 'nope', NOW)).toBeNull();
    mockSessions = [liveSession({ endedAt: DONE })];
    expect(tickSet('w1', sets[1].id, NOW)).toBeNull();
    expect(tickSet('w0', sets[1].id, NOW)).toBeNull();
    expect(mockEditSet).not.toHaveBeenCalled();
    expect(mockStartRest).not.toHaveBeenCalled();
  });

  it('starts nothing when the store refuses the write', () => {
    mockEditSet.mockReturnValue('notFound');
    expect(tickSet('w1', sets[0].id, NOW)).toBeNull();
    expect(mockStartRest).not.toHaveBeenCalled();
  });

  it('loads the sets when they aren’t cached', () => {
    mockSetsBySession = {};
    mockLoadSets.mockImplementation(() => {
      mockSetsBySession = { w1: sets };
      return sets;
    });
    expect(tickSet('w1', sets[0].id, NOW)).not.toBeNull();
    expect(mockLoadSets).toHaveBeenCalledWith('w1');
  });
});
