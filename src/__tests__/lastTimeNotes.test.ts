import type { WorkoutSet } from '../types';
import { lastTimeNotes } from '../utils/lastTimeNotes';

const set = (id: string, setIndex: number, kind: WorkoutSet['kind'], note: string | null, completedAt = '2026-10-12T18:00:00.000Z'): WorkoutSet => ({
  id, sessionId: 's', exerciseId: 'e', position: 0, setIndex, kind, weightKg: 60, reps: 8,
  durationSeconds: null, distanceM: null, rpe: null, completedAt, supersetKey: null, note,
});

describe('lastTimeNotes', () => {
  it('says nothing when no set carried a note', () => {
    expect(lastTimeNotes([set('a', 0, 'working', null), set('b', 1, 'working', '   ')])).toBeNull();
    expect(lastTimeNotes([])).toBeNull();
  });

  it('files each note under the set it was written on, numbering working sets past a warm-up', () => {
    const got = lastTimeNotes([
      set('w', 0, 'warmup', 'Bar felt heavy', '2026-10-12T17:50:00.000Z'),
      set('a', 1, 'working', null),
      set('b', 2, 'working', ' Left shoulder hurt ', '2026-10-12T18:10:00.000Z'),
    ]);
    expect(got?.notes).toEqual([
      { where: 'Warm-up', text: 'Bar felt heavy' },
      { where: 'Set 2', text: 'Left shoulder hurt' },
    ]);
    // The newest set with a note dates it.
    expect(got?.at).toBe('2026-10-12T18:10:00.000Z');
  });
});
