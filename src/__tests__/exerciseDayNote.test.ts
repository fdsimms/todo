import type { WorkoutSet } from '../types';
import { exerciseDayNote, exerciseDayNotePatches } from '../utils/exerciseDayNote';

const set = (id: string, setIndex: number, note: string | null): WorkoutSet => ({
  id, sessionId: 's', exerciseId: 'e', position: 0, setIndex, kind: 'working', weightKg: 60, reps: 8,
  durationSeconds: null, distanceM: null, rpe: null, completedAt: null, supersetKey: null, note,
});

describe('exerciseDayNote', () => {
  it('is empty when no set carries a note', () => {
    expect(exerciseDayNote([set('a', 0, null), set('b', 1, '  ')])).toBe('');
  });

  it('joins notes in set order, so one written on a later set still shows', () => {
    expect(exerciseDayNote([set('b', 1, ' slow '), set('a', 0, 'tight shoulder')])).toBe('tight shoulder\nslow');
  });
});

describe('exerciseDayNotePatches', () => {
  it('writes the text on the first set and clears any other set that carried one', () => {
    const sets = [set('a', 0, null), set('b', 1, 'old'), set('c', 2, null)];
    expect(exerciseDayNotePatches(sets, ' new ')).toEqual([
      { setId: 'a', note: 'new' },
      { setId: 'b', note: null },
    ]);
  });

  it('changes nothing when the note already reads that way', () => {
    expect(exerciseDayNotePatches([set('a', 0, 'same'), set('b', 1, null)], 'same')).toEqual([]);
  });

  it('clears the note when the text is blank', () => {
    expect(exerciseDayNotePatches([set('a', 0, 'x')], '   ')).toEqual([{ setId: 'a', note: null }]);
  });
});
