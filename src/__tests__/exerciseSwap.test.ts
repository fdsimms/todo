import type { Exercise, WorkoutSet } from '../types';
import { swapCandidates, swappableSets } from '../utils/exerciseSwap';

const set = (id: string, exerciseId: string, completedAt: string | null): WorkoutSet => ({
  id, sessionId: 's', exerciseId, position: 0, setIndex: 0, kind: 'working', weightKg: null, reps: null,
  durationSeconds: null, distanceM: null, rpe: null, completedAt, supersetKey: null, note: null,
});

describe('swappableSets', () => {
  it('is the exercise\'s unticked sets only', () => {
    const sets = [set('a', 'x', '2026-10-01T10:00:00.000Z'), set('b', 'x', null), set('c', 'y', null)];
    expect(swappableSets(sets, 'x').map(s => s.id)).toEqual(['b']);
    expect(swappableSets(sets, 'z')).toEqual([]);
  });
});

describe('swapCandidates', () => {
  const none: Exercise[] = [];
  it('offers the same kind of movement on other equipment that works the same muscle, best match first', () => {
    const got = swapCandidates(none, 'lib:barbell-bench-press');
    expect(got.length).toBeGreaterThan(0);
    expect(got).toContain('lib:dumbbell-bench-press');
    expect(got).not.toContain('lib:barbell-bench-press');
    // Different equipment only: another barbell chest press is not a way around a taken bench.
    expect(got).not.toContain('lib:barbell-incline-bench-press');
    expect(got).not.toContain('lib:back-squat');
  });

  it('leaves out what the workout already has, and an unknown exercise offers nothing', () => {
    expect(swapCandidates(none, 'lib:barbell-bench-press', ['lib:dumbbell-bench-press'])).not.toContain('lib:dumbbell-bench-press');
    expect(swapCandidates(none, 'nobody')).toEqual([]);
  });
});
