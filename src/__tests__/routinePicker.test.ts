import { filterRoutines, resolveRoutineSubmit } from '../utils/routinePicker';

const routines = [
  { id: 'a', name: 'Pushups' },
  { id: 'b', name: 'HW Day One v2' },
  { id: 'c', name: 'Pull / Push / Legs (Bodyweight + Dumbbell)' },
  { id: 'd', name: 'Pull Day' },
];

describe('filterRoutines', () => {
  it('lists everything in the given order for an empty query', () => {
    expect(filterRoutines(routines, '  ').matches.map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('matches anywhere in the name, ignoring case, without re-ranking', () => {
    const result = filterRoutines(routines, 'PULL');
    expect(result.matches.map(r => r.id)).toEqual(['c', 'd']);
    expect(result.noMatches).toBe(false);
  });

  it('reports a query that names nothing', () => {
    expect(filterRoutines(routines, 'squat')).toEqual({ matches: [], noMatches: true });
  });
});

describe('resolveRoutineSubmit', () => {
  it('does nothing for an empty query', () => {
    expect(resolveRoutineSubmit(filterRoutines(routines, ''), '')).toBeNull();
  });

  it('picks the only routine left', () => {
    expect(resolveRoutineSubmit(filterRoutines(routines, 'hw'), 'hw')?.id).toBe('b');
  });

  it('picks an exact name even when others also match', () => {
    expect(resolveRoutineSubmit(filterRoutines(routines, 'pull day'), 'pull day')?.id).toBe('d');
    expect(resolveRoutineSubmit(filterRoutines(routines, 'Pushups'), 'Pushups')?.id).toBe('a');
  });

  it('does nothing while several routines still match', () => {
    expect(resolveRoutineSubmit(filterRoutines(routines, 'pull'), 'pull')).toBeNull();
  });
});
