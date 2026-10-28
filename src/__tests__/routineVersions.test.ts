import type {
  WorkoutProgram,
  WorkoutProgramVersion,
  WorkoutRoutine,
  WorkoutRoutineItem,
  WorkoutRoutineVersion,
  WorkoutSession,
} from '../types';
import {
  changeParts,
  currentRoutineVersion,
  diffIsEmpty,
  diffPrograms,
  diffRoutines,
  finishVersionText,
  initialRoutineVersionId,
  likelyRoutineCopies,
  programDiffIsEmpty,
  programHistory,
  programSchemeText,
  programStructureChanged,
  programVersionTrained,
  programWeeksText,
  routineContentChanged,
  routineHistory,
  routineVersionTrained,
  routineVersionsOf,
  sessionPlan,
  sessionVersionId,
  summarizeDiff,
  summarizeProgramDiff,
  versionCopyName,
  versionNumber,
  versionSpanText,
  versionStats,
  workoutCountText,
} from '../utils/routineVersions';

const SQUAT = 'lib:goblet-squat';
const BENCH = 'lib:db-bench';
const CURL = 'lib:hammer-curl';
const RAISE = 'lib:lateral-raise';
const ROW = 'lib:upright-row';
const names: Record<string, string> = {
  [SQUAT]: 'Goblet squat', [BENCH]: 'Bench press', [CURL]: 'Hammer curl', [RAISE]: 'Lateral raise', [ROW]: 'Upright row',
};
const nameOf = (id: string) => names[id] ?? id;

function item(exerciseId: string, sets = 3, extra: Partial<WorkoutRoutineItem> = {}): WorkoutRoutineItem {
  return {
    exerciseId,
    restSeconds: null,
    progression: null,
    targets: Array.from({ length: sets }, () => ({ kind: 'working' as const, repsMin: 8, repsMax: 12 })),
    ...extra,
  };
}

const at = (day: number) => new Date(2026, 8, day, 12).toISOString();

function routine(extra: Partial<WorkoutRoutine> = {}): WorkoutRoutine {
  return {
    id: 'r1', name: 'HW Day One', notes: '', programId: null, sortOrder: 0, items: [item(SQUAT), item(BENCH)],
    createdAt: at(1), groupName: null, archived: false, ...extra,
  };
}

function version(id: string, day: number, items: WorkoutRoutineItem[], extra: Partial<WorkoutRoutineVersion> = {}): WorkoutRoutineVersion {
  return { id, routineId: 'r1', createdAt: at(day), name: 'HW Day One', notes: '', items, source: 'edit', label: null, ...extra };
}

function session(id: string, day: number, extra: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id, routineId: 'r1', programId: null, taskId: null, title: 'HW', startedAt: at(day), endedAt: at(day),
    notes: '', effort: null, healthWorkoutId: null, healthWritePending: false, measuredOnWatch: false, ...extra,
  } as WorkoutSession;
}

describe('routineVersionsOf', () => {
  it('stands in one implicit first version, with an id every device derives, when none is stored', () => {
    const list = routineVersionsOf(routine(), []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: initialRoutineVersionId('r1'), source: 'initial', createdAt: at(1) });
    expect(initialRoutineVersionId('r1')).toBe(initialRoutineVersionId('r1'));
    expect(initialRoutineVersionId('r1')).not.toBe(initialRoutineVersionId('r2'));
  });

  it('keeps only its own, oldest first', () => {
    const list = routineVersionsOf(routine(), [
      version('b', 5, []), version('a', 2, []), { ...version('x', 3, []), routineId: 'other' },
    ]);
    expect(list.map(v => v.id)).toEqual(['a', 'b']);
    expect(versionNumber(list, 'b')).toBe(2);
    expect(versionNumber(list, 'nope')).toBe(0);
  });

  it('is on the version the routine names, or its newest', () => {
    const list = [version('a', 2, []), version('b', 5, [])];
    expect(currentRoutineVersion(routine({ currentVersionId: 'a' }), list).id).toBe('a');
    expect(currentRoutineVersion(routine({ currentVersionId: 'gone' }), list).id).toBe('b');
  });
});

describe('sessionVersionId', () => {
  const list = [version('a', 2, []), version('b', 10, [])];

  it('takes the version a workout recorded', () => {
    expect(sessionVersionId(session('s', 20, { routineVersionId: 'a' }), list)).toBe('a');
  });

  it('counts an older workout toward the version in effect when it started', () => {
    expect(sessionVersionId(session('s', 5), list)).toBe('a');
    expect(sessionVersionId(session('s', 12), list)).toBe('b');
    expect(sessionVersionId(session('s', 1), list)).toBe('a');
  });

  it('falls back to time for a version this device hasn\'t received', () => {
    expect(sessionVersionId(session('s', 12, { routineVersionId: 'later' }), list)).toBe('b');
  });
});

describe('routineVersionTrained', () => {
  it('asks only once a finished workout was done on the current version', () => {
    const r = routine({ currentVersionId: 'b' });
    const list = [version('a', 2, []), version('b', 10, [])];
    expect(routineVersionTrained(r, list, [session('s1', 5)])).toBe(false);
    expect(routineVersionTrained(r, list, [session('s2', 11, { endedAt: null })])).toBe(false);
    expect(routineVersionTrained(r, list, [session('s3', 11)])).toBe(true);
    expect(routineVersionTrained(r, list, [session('s4', 11, { routineId: 'other' })])).toBe(false);
  });

  it('counts workouts against a routine with no stored versions', () => {
    expect(routineVersionTrained(routine(), [], [session('s', 3)])).toBe(true);
  });
});

describe('routineContentChanged', () => {
  it('sees items and notes, never the name alone', () => {
    const r = routine();
    expect(routineContentChanged(r, { ...r })).toBe(false);
    expect(routineContentChanged(r, { ...r, notes: ' ' })).toBe(false);
    expect(routineContentChanged(r, { ...r, notes: 'Seat 4' })).toBe(true);
    expect(routineContentChanged(r, { ...r, items: [item(SQUAT)] })).toBe(true);
  });
});

describe('diffRoutines', () => {
  const v = (items: WorkoutRoutineItem[], notes = '') => ({ items, notes });

  it('finds nothing between two identical plans', () => {
    const d = diffRoutines(v([item(SQUAT)]), v([item(SQUAT)]), 90);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it('marks each exercise changed, added or removed', () => {
    const d = diffRoutines(
      v([item(SQUAT, 3, { restSeconds: 120 }), item(BENCH), item(CURL)]),
      v([item(SQUAT, 4, { restSeconds: 90 }), item(BENCH)]),
      90,
    );
    expect(d.items).toEqual([
      { status: 'changed', exerciseId: SQUAT, changes: [{ field: 'sets', from: 3, to: 4 }, { field: 'rest', from: 120, to: 90 }] },
      { status: 'same', exerciseId: BENCH },
      { status: 'removed', exerciseId: CURL },
    ]);
  });

  it('reads an exercise put in the place of another as a swap, and anything else as added', () => {
    const d = diffRoutines(v([item(SQUAT), item(RAISE)]), v([item(SQUAT), item(ROW), item(CURL)]), 90);
    expect(d.items).toEqual([
      { status: 'same', exerciseId: SQUAT },
      { status: 'swapped', exerciseId: ROW, fromExerciseId: RAISE },
      { status: 'added', exerciseId: CURL, sets: 3 },
    ]);
  });

  it('resolves a default rest before comparing', () => {
    const d = diffRoutines(v([item(SQUAT, 3, { restSeconds: null })]), v([item(SQUAT, 3, { restSeconds: 90 })]), 90);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it('pairs the second of an exercise held twice with the second', () => {
    const d = diffRoutines(v([item(SQUAT), item(SQUAT, 2)]), v([item(SQUAT), item(SQUAT, 5)]), 90);
    expect(d.items[1]).toEqual({ status: 'changed', exerciseId: SQUAT, changes: [{ field: 'sets', from: 2, to: 5 }] });
  });

  it('notices the order, the notes, the reps, the weight, the warm-up and the progression', () => {
    const before = item(BENCH, 3, { warmupRamp: true });
    const after: WorkoutRoutineItem = {
      ...item(BENCH, 3),
      targets: [{ kind: 'warmup', repsMin: 10, repsMax: 10 }, ...[1, 2, 3].map(() => ({ kind: 'working' as const, repsMin: 6, repsMax: 8, weightKg: 22 }))],
      progression: { scheme: 'linear', incrementKg: null },
    };
    const d = diffRoutines(v([item(SQUAT), before], 'a'), v([after, item(SQUAT)], 'b'), 90);
    expect(d.orderChanged).toBe(true);
    expect(d.notesChanged).toBe(true);
    expect(d.items[0]).toEqual({
      status: 'changed', exerciseId: BENCH, changes: [
        { field: 'reps', from: '8-12', to: '6-8' },
        { field: 'weight', from: null, to: 22 },
        { field: 'warmup', from: 'ramp', to: 1 },
        { field: 'progression', from: null, to: 'linear' },
      ],
    });
  });
});

describe('changeParts', () => {
  it('words each change, a weight at the scale it is shown', () => {
    expect(changeParts({ field: 'rest', from: 120, to: 90 }, 'kg')).toEqual({ label: 'Rest', from: '2:00', to: '1:30' });
    expect(changeParts({ field: 'weight', from: 10, to: 11 }, 'kg', 2)).toEqual({ label: 'Weight', from: '20 kg', to: '22 kg' });
    expect(changeParts({ field: 'weight', from: null, to: 11 }, 'kg').from).toBe('As last time');
    expect(changeParts({ field: 'warmup', from: 'ramp', to: 2 }, 'kg')).toEqual({ label: 'Warm-up', from: 'Ramp', to: '2 sets' });
    expect(changeParts({ field: 'progression', from: null, to: 'double' }, 'kg').to).toBe('Rep range');
  });
});

describe('summarizeDiff', () => {
  it('names the first changes and counts the rest', () => {
    const d = diffRoutines(
      { items: [item(SQUAT, 3, { restSeconds: 120 }), item(BENCH), item(RAISE)], notes: '' },
      { items: [item(SQUAT, 4, { restSeconds: 90 }), item(BENCH), item(ROW), item(CURL)], notes: 'x' },
      90,
    );
    expect(summarizeDiff(d, nameOf, 'kg')).toBe('Goblet squat 3 → 4 sets, rest 2:00 → 1:30; Lateral raise swapped for Upright row; and 2 more');
    expect(summarizeDiff(d, nameOf, 'kg', () => 1, 10)).toMatch(/added Hammer curl; notes changed$/);
  });

  it('says nothing when nothing changed', () => {
    expect(summarizeDiff(diffRoutines({ items: [], notes: '' }, { items: [], notes: '' }, 90), nameOf, 'kg')).toBeNull();
  });
});

describe('routineHistory', () => {
  it('lists versions newest first with their spans and workouts', () => {
    const r = routine({ currentVersionId: 'b' });
    const list = [version('a', 2, [item(SQUAT)]), version('b', 10, [item(SQUAT, 4)])];
    const h = routineHistory(r, list, [session('s1', 3), session('s2', 4), session('s3', 11), session('s4', 12, { routineVersionId: 'a' })]);
    expect(h.map(e => [e.number, e.current, e.sessions.map(s => s.id)])).toEqual([
      [2, true, ['s3']],
      [1, false, ['s1', 's2', 's4']],
    ]);
    expect(h[1]).toMatchObject({ from: at(2), until: at(10), previous: null });
    expect(h[0].previous?.id).toBe('a');
  });
});

describe('versionStats', () => {
  it('averages only the workouts that lifted anything', () => {
    expect(versionStats([session('a', 1), session('b', 2), session('c', 3)], { a: 1000, b: 3000 })).toEqual({
      workouts: 3, avgVolumeKg: 2000, lastAt: at(3),
    });
    expect(versionStats([], {})).toEqual({ workouts: 0, avgVolumeKg: null, lastAt: null });
  });
});

describe('versionCopyName', () => {
  it('says which version it came from', () => {
    expect(versionCopyName('HW Day One', 2)).toBe('HW Day One (version 2)');
  });
});

describe('programs', () => {
  const program: WorkoutProgram = {
    id: 'p1', name: 'HW', weeks: 8, rotation: ['r1', 'r2'], scheme: 'double', trainingMaxes: [], startedAt: null,
    archived: false, createdAt: at(1), currentVersionId: 'pb',
  };
  const pv = (id: string, day: number, routineVersionIds: Record<string, string> = {}): WorkoutProgramVersion => ({
    id, programId: 'p1', createdAt: at(day), name: 'HW', weeks: 8, rotation: ['r1', 'r1', 'r2'], scheme: 'double',
    routineVersionIds, label: null,
  });

  it('sees rotation, length and scheme as structure, not a rename', () => {
    const s = { name: 'A', weeks: 8, rotation: ['r1'], scheme: 'double' as const };
    expect(programStructureChanged(s, { ...s, name: 'B' })).toBe(false);
    expect(programStructureChanged(s, { ...s, weeks: 6 })).toBe(true);
    expect(programStructureChanged(s, { ...s, rotation: ['r1', 'r1'] })).toBe(true);
    expect(programStructureChanged(s, { ...s, scheme: null })).toBe(true);
  });

  it('is trained once a workout in it finishes after its current version', () => {
    const list = [pv('pa', 2), pv('pb', 10)];
    expect(programVersionTrained(program, list, [session('s', 5, { programId: 'p1' })])).toBe(false);
    expect(programVersionTrained(program, list, [session('s', 11, { programId: 'p1' })])).toBe(true);
  });

  it('lists blocks with the routine versions each started and ended on', () => {
    const routines = [routine({ currentVersionId: 'c' }), routine({ id: 'r2', name: 'Day Two' })];
    const rv = [version('a', 2, []), version('b', 6, []), version('c', 14, [])];
    const h = programHistory(program, [pv('pa', 2, { r1: 'a' }), pv('pb', 10)], routines, rv, [
      session('s1', 4, { programId: 'p1' }), session('s2', 11, { programId: 'p1' }), session('s3', 12, { programId: 'p1' }),
    ]);
    expect(h.map(e => [e.number, e.current, e.workouts])).toEqual([[2, true, 2], [1, false, 1]]);
    expect(h[1].routines).toEqual([
      { routineId: 'r1', startNumber: 1, endNumber: 2 },
      { routineId: 'r2', startNumber: 1, endNumber: 1 },
    ]);
    expect(h[0].routines[0]).toEqual({ routineId: 'r1', startNumber: 2, endNumber: 3 });
  });

  it('marks a routine since deleted', () => {
    const h = programHistory(program, [pv('pb', 10)], [], [], []);
    expect(h[0].routines[0]).toEqual({ routineId: 'r1', startNumber: null, endNumber: null });
  });
});

describe('versionSpanText', () => {
  const now = new Date(2026, 9, 21);
  const d = (m: number, day: number, y = 2026) => new Date(y, m - 1, day, 9).toISOString();

  it('says since when for the newest, and up to the day before the next began otherwise', () => {
    expect(versionSpanText(d(10, 14), null, now)).toBe('Since Oct 14');
    expect(versionSpanText(d(9, 1), d(9, 22), now)).toBe('Sep 1 to Sep 21');
  });

  it('names one day for a version replaced the day it was made, and a year only when it isn\'t this one', () => {
    expect(versionSpanText(d(9, 1), new Date(2026, 8, 1, 18).toISOString(), now)).toBe('Sep 1');
    expect(versionSpanText(d(12, 30, 2025), d(1, 5), now)).toBe('Dec 30, 2025 to Jan 4');
  });
});

describe('workoutCountText', () => {
  it('counts', () => {
    expect([0, 1, 3].map(workoutCountText)).toEqual(['No workouts', '1 workout', '3 workouts']);
  });
});

describe('finishVersionText', () => {
  const base = { current: 4, old: null, restoring: false, changes: 0, inProgram: false };

  it('says what Save does to the routine\'s versions', () => {
    expect(finishVersionText(base)).toBe('With nothing selected, the routine stays on version 4. Your logged workout is kept either way.');
    expect(finishVersionText({ ...base, changes: 2 })).toBe('Saving makes these version 5. Version 4 stays in History, and this workout counts toward it.');
    expect(finishVersionText({ ...base, changes: 1, inProgram: true })).toMatch(/^Saving makes this version 5\..* The program uses the same routine\.$/);
  });

  it('on a workout from an old version, says the restore', () => {
    expect(finishVersionText({ ...base, old: 2 })).toBe('With nothing selected, the routine stays on version 4, and this workout counts toward version 2.');
    expect(finishVersionText({ ...base, old: 2, restoring: true })).toBe('Version 2 becomes version 5, the newest. Version 4 stays in History.');
    expect(finishVersionText({ ...base, old: 2, restoring: true, changes: 1 })).toMatch(/^Version 2 with this change becomes version 5/);
  });
});

describe('likelyRoutineCopies', () => {
  const r = (id: string, name: string) => ({ id, name });

  it('pairs a routine with what reads as a copy of it made by hand', () => {
    expect(likelyRoutineCopies([r('a', 'HW Day One'), r('b', 'HW Day One v2'), r('c', 'Push (2)'), r('d', 'Push')])).toEqual([
      { originalId: 'a', copyId: 'b' },
      { originalId: 'd', copyId: 'c' },
    ]);
    expect(likelyRoutineCopies([r('a', 'Legs'), r('b', 'legs - version 3'), r('c', 'Legs copy')])).toHaveLength(2);
  });

  it('leaves names that only share a start', () => {
    expect(likelyRoutineCopies([r('a', 'Push'), r('b', 'Push A'), r('c', 'Pushups'), r('d', 'Day One'), r('e', 'Day Two')])).toEqual([]);
  });
});

describe('diffPrograms', () => {
  const pv = (rotation: string[], weeks: number | null = 8, scheme: 'double' | 'linear' | null = 'double') => ({ rotation, weeks, scheme });
  const nameOf = (id: string) => ({ a: 'Day One', b: 'Day Two', c: 'Day Three' }[id] ?? id);

  it('finds routines added and removed by slot, so one done twice compares as two', () => {
    const d = diffPrograms(pv(['a', 'b']), pv(['a', 'b', 'a', 'c']));
    expect(d).toMatchObject({ added: ['a', 'c'], removed: [], orderChanged: false, weeks: null, scheme: null });
    expect(diffPrograms(pv(['a', 'b', 'c']), pv(['a'])).removed).toEqual(['b', 'c']);
  });

  it('notices a new order only when the same routines come round differently', () => {
    expect(diffPrograms(pv(['a', 'b']), pv(['b', 'a'])).orderChanged).toBe(true);
    expect(programDiffIsEmpty(diffPrograms(pv(['a', 'b']), pv(['a', 'b'])))).toBe(true);
  });

  it('words the length and the progression', () => {
    const d = diffPrograms(pv(['a']), pv(['a', 'c'], null, 'linear'));
    expect(summarizeProgramDiff(d, nameOf)).toBe('Added Day Three; 8 weeks → no end; progression Rep range → Linear');
    expect(summarizeProgramDiff(diffPrograms(pv(['a']), pv(['a'])), nameOf)).toBeNull();
    expect([programWeeksText(1), programWeeksText(null), programSchemeText(null)]).toEqual(['1 week', 'No end', 'None']);
  });
});

describe('a program workout from before its first version', () => {
  const program: WorkoutProgram = {
    id: 'p1', name: 'HW', weeks: 8, rotation: ['r1'], scheme: 'double', trainingMaxes: [], startedAt: null,
    archived: false, createdAt: at(10), currentVersionId: null,
  };

  it('counts toward the first version, as a routine\'s does', () => {
    const early = session('s', 3, { programId: 'p1' });
    expect(programVersionTrained(program, [], [early])).toBe(true);
    expect(programHistory(program, [], [], [], [early])[0].workouts).toBe(1);
  });
});

describe('sessionPlan', () => {
  const routine = { id: 'r', items: [{ exerciseId: 'a', restSeconds: 90 }] } as unknown as WorkoutRoutine;
  const v1 = { id: 'v1', routineId: 'r', createdAt: '2026-01-01T00:00:00.000Z', items: [{ exerciseId: 'a', restSeconds: 180 }] } as unknown as WorkoutRoutineVersion;
  const v2 = { id: 'v2', routineId: 'r', createdAt: '2026-02-01T00:00:00.000Z', items: [{ exerciseId: 'a', restSeconds: 90 }] } as unknown as WorkoutRoutineVersion;

  it('reads the version the workout was started on', () => {
    expect(sessionPlan({ routineId: 'r', routineVersionId: 'v1' }, [routine], [v1, v2])).toBe(v1);
  });

  it('falls back to the routine for a version this device lacks, and to nothing without a routine', () => {
    expect(sessionPlan({ routineId: 'r', routineVersionId: 'gone' }, [routine], [v1, v2])).toBe(routine);
    expect(sessionPlan({ routineId: null, routineVersionId: null }, [routine], [v1])).toBeNull();
  });
});
