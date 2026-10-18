import type { WorkoutRoutine, WorkoutSession, WorkoutSet } from '../types';
import { DEFAULT_PLATE_INVENTORY } from '../utils/workoutData';

// The stores as fakes: what is under test is that "Use" writes the proposal
// through the store's own edits, the same calls workout mode's card made.
const mockEditSet = jest.fn();
const mockAddPlannedWarmups = jest.fn();
let mockState: Record<string, unknown> = {};
const mockPlates = DEFAULT_PLATE_INVENTORY;
jest.mock('../store/useWorkoutStore', () => ({ useWorkoutStore: { getState: () => mockState } }));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ plateInventory: mockPlates, workoutUnit: 'kg' }) },
}));

import { applyProposal, liveProposal } from '../utils/workoutProposalApply';

const BENCH = 'lib:barbell-bench-press';
let seq = 0;
function set(sessionId: string, setIndex: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  seq += 1;
  return {
    id: `set-${seq}`, sessionId, exerciseId: BENCH, position: 0, setIndex, kind: 'working', weightKg: 80, reps: 8,
    durationSeconds: null, distanceM: null, rpe: null, completedAt: null, supersetKey: null, note: null, ...extra,
  };
}
const session = (id: string, day: number, extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, routineId: 'r1', programId: null, taskId: null, title: 'Push A', startedAt: new Date(2026, 9, day, 18).toISOString(),
  endedAt: new Date(2026, 9, day, 19).toISOString(), notes: '', effort: null, healthWorkoutId: null, healthWritePending: false, ...extra,
});
const routine = (warmupRamp: boolean): WorkoutRoutine => ({
  id: 'r1', name: 'Push A', notes: '', programId: null, sortOrder: 0, createdAt: '2026-10-01T00:00:00.000Z',
  items: [{
    exerciseId: BENCH, supersetKey: null, restSeconds: 150, progression: { scheme: 'double', incrementKg: null }, warmupRamp,
    targets: [0, 1, 2].map(() => ({ kind: 'working' as const, repsMin: 6, repsMax: 8 })),
  }],
} as WorkoutRoutine);

// Last time, every set reached the top of 6 to 8 at 80 kg: up to 82.5 for 6.
const lastTime = [0, 1, 2].map(i => set('old', i, { completedAt: new Date(2026, 9, 10, 18, i).toISOString() }));

describe('applyProposal', () => {
  const liveSets = [set('live', 0), set('live', 1)];
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddPlannedWarmups.mockReturnValue([]);
    mockState = {
      sessions: [session('old', 10), session('live', 12, { endedAt: null })],
      routines: [routine(true)],
      programs: [],
      exercises: [],
      setsBySession: { live: liveSets },
      exerciseHistory: () => lastTime,
      loadSets: () => liveSets,
      editSet: mockEditSet,
      addPlannedWarmups: mockAddPlannedWarmups,
    };
  });

  it('writes Use through the store’s own edits, and adds the ramp’s warm-ups', () => {
    expect(liveProposal('live', BENCH)?.proposal.move).toBe('up');
    expect(applyProposal('live', BENCH)).toBe(true);
    expect(mockEditSet).toHaveBeenCalledWith('live', liveSets[0].id, { weightKg: 82.5, reps: 6 });
    expect(mockEditSet).toHaveBeenCalledWith('live', liveSets[1].id, { weightKg: 82.5, reps: 6 });
    expect(mockAddPlannedWarmups).toHaveBeenCalledWith('live', BENCH, expect.any(Array), { ids: undefined });
  });

  it('gives the warm-ups the ids the watch drew, or ids of their own when those are taken', () => {
    applyProposal('live', BENCH, { warmupIds: ['tap-1-w0', 'tap-1-w1', 'tap-1-w2'] });
    expect(mockAddPlannedWarmups).toHaveBeenCalledTimes(1);
    expect(mockAddPlannedWarmups).toHaveBeenLastCalledWith('live', BENCH, expect.any(Array), { ids: ['tap-1-w0', 'tap-1-w1', 'tap-1-w2'] });
    jest.clearAllMocks();
    mockAddPlannedWarmups.mockReturnValueOnce('taken').mockReturnValueOnce([]);
    applyProposal('live', BENCH, { warmupIds: ['taken-id'] });
    expect(mockAddPlannedWarmups).toHaveBeenCalledTimes(2);
    expect(mockAddPlannedWarmups).toHaveBeenLastCalledWith('live', BENCH, expect.any(Array));
  });

  it('writes the proposal it is handed rather than reading one', () => {
    expect(applyProposal('live', BENCH, { proposal: null })).toBe(false);
    expect(mockEditSet).not.toHaveBeenCalled();
  });

  it('writes nothing for a session or exercise with nothing to propose', () => {
    expect(applyProposal('nobody', BENCH)).toBe(false);
    expect(applyProposal('live', 'lib:plank')).toBe(false);
    expect(mockEditSet).not.toHaveBeenCalled();
  });
});
