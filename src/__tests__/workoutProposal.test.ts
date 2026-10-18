import type { WorkoutProgram, WorkoutRoutine, WorkoutSession, WorkoutSet } from '../types';
import { DEFAULT_PLATE_INVENTORY } from '../utils/workoutData';

import { exerciseProposal, proposalRamp, proposalWrites } from '../utils/workoutProposal';

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
  endedAt: new Date(2026, 9, day, 19).toISOString(), notes: '', effort: null, healthWorkoutId: null, healthWritePending: false, measuredOnWatch: false, ...extra,
});
const routine = (warmupRamp = false): WorkoutRoutine => ({
  id: 'r1', name: 'Push A', notes: '', programId: null, sortOrder: 0, createdAt: '2026-10-01T00:00:00.000Z',
  items: [{
    exerciseId: BENCH, supersetKey: null, restSeconds: 150, progression: { scheme: 'double', incrementKg: null }, warmupRamp,
    targets: [0, 1, 2].map(() => ({ kind: 'working' as const, repsMin: 6, repsMax: 8 })),
  }],
} as WorkoutRoutine);

// Last time, every set reached the top of 6 to 8 at 80 kg.
const lastTime = [0, 1, 2].map(i => set('old', i, { completedAt: new Date(2026, 9, 10, 18, i).toISOString() }));
const base = {
  exerciseId: BENCH,
  exercises: [],
  program: null as WorkoutProgram | null,
  sessions: [session('old', 10), session('live', 12, { endedAt: null })],
  routines: [] as WorkoutRoutine[],
  history: lastTime,
  exceptSessionId: 'live',
  plateInventory: DEFAULT_PLATE_INVENTORY,
  unit: 'kg' as const,
};

describe('exerciseProposal', () => {
  it('is what workout mode’s card proposes, with what it was worked out against', () => {
    const p = exerciseProposal({ ...base, routine: routine() })!;
    expect(p.proposal).toMatchObject({ move: 'up', brief: 'All sets hit 8 last time' });
    expect(p.proposal.sets.map(s => s.weightKg)).toEqual([82.5, 82.5, 82.5]);
    expect(p.kind).toBe('weight_reps');
    expect(p.item?.exerciseId).toBe(BENCH);
  });

  it('is null with no scheme or no exercise to read', () => {
    expect(exerciseProposal({ ...base, routine: null })).toBeNull();
    expect(exerciseProposal({ ...base, exerciseId: 'nobody', routine: routine() })).toBeNull();
  });
});

describe('proposalWrites', () => {
  it('writes the proposal onto the planned working sets and leaves done ones', () => {
    const p = exerciseProposal({ ...base, routine: routine() })!;
    const sets = [set('live', 0, { completedAt: '2026-10-12T18:05:00.000Z' }), set('live', 1), set('live', 2)];
    const { edits, warmupsToAdd } = proposalWrites(sets, p);
    expect(edits).toEqual([
      { setId: sets[1].id, weightKg: 82.5, reps: 6 },
      { setId: sets[2].id, weightKg: 82.5, reps: 6 },
    ]);
    expect(warmupsToAdd).toEqual([]);
    expect(proposalRamp(p)).toBeNull();
  });

  it('works a ramp’s warm-ups out again from the new weight, or adds them when none were laid out', () => {
    const p = exerciseProposal({ ...base, routine: routine(true) })!;
    const ramp = proposalRamp(p)!;
    expect(ramp.length).toBeGreaterThan(0);
    const withWarmup = [set('live', 0, { kind: 'warmup', weightKg: 30, reps: 10 }), set('live', 1)];
    expect(proposalWrites(withWarmup, p).edits[1]).toEqual({ setId: withWarmup[0].id, weightKg: ramp[0].kg, reps: ramp[0].reps });
    expect(proposalWrites([set('live', 0)], p).warmupsToAdd).toEqual(ramp);
  });
});
