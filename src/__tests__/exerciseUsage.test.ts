import type { WorkoutSet } from '../types';
import { mostUsedExerciseIds } from '../utils/exerciseUsage';

const NOW = new Date('2026-11-09T12:00:00');
const set = (sessionId: string, exerciseId: string, completedAt: string | null, kind: WorkoutSet['kind'] = 'working'): WorkoutSet => ({
  id: `${sessionId}-${exerciseId}-${completedAt}-${Math.random()}`, sessionId, exerciseId, position: 0, setIndex: 0, kind,
  weightKg: null, reps: null, durationSeconds: null, distanceM: null, rpe: null, completedAt, supersetKey: null, note: null,
});

describe('mostUsedExerciseIds', () => {
  it('ranks by workouts, not sets', () => {
    const sets = [
      // Five sets in one workout is one use.
      ...[1, 2, 3, 4, 5].map(() => set('s1', 'squat', '2026-11-01T10:00:00')),
      set('s1', 'curl', '2026-11-01T10:30:00'), set('s2', 'curl', '2026-11-03T10:30:00'), set('s3', 'curl', '2026-11-05T10:30:00'),
      set('s2', 'squat', '2026-11-03T10:00:00'),
    ];
    expect(mostUsedExerciseIds(sets, NOW)).toEqual(['curl', 'squat']);
  });

  it('breaks a tie by the one done most recently', () => {
    const sets = [
      set('s1', 'a', '2026-11-01T10:00:00'), set('s2', 'a', '2026-11-02T10:00:00'),
      set('s1', 'b', '2026-11-01T10:00:00'), set('s2', 'b', '2026-11-04T10:00:00'),
    ];
    expect(mostUsedExerciseIds(sets, NOW)).toEqual(['b', 'a']);
  });

  it('leaves out warm-ups, undone sets and sets older than 90 days', () => {
    const sets = [
      set('s1', 'w', '2026-11-01T10:00:00', 'warmup'), set('s2', 'w', '2026-11-02T10:00:00', 'warmup'),
      set('s1', 'u', null), set('s2', 'u', null),
      set('s1', 'old', '2026-05-01T10:00:00'), set('s2', 'old', '2026-05-02T10:00:00'),
    ];
    expect(mostUsedExerciseIds(sets, NOW)).toEqual([]);
  });

  it('needs two workouts, so one workout makes nothing most used', () => {
    expect(mostUsedExerciseIds([set('s1', 'a', '2026-11-01T10:00:00'), set('s1', 'b', '2026-11-01T10:00:00')], NOW)).toEqual([]);
  });

  it('stops at the limit', () => {
    const sets = ['a', 'b', 'c'].flatMap(id => [set('s1', id, '2026-11-01T10:00:00'), set('s2', id, '2026-11-02T10:00:00')]);
    expect(mostUsedExerciseIds(sets, NOW, 2)).toHaveLength(2);
  });
});
