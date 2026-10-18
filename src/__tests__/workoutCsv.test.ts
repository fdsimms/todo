import type { Exercise, WorkoutSession, WorkoutSet } from '../types';
import { buildCatalog } from '../utils/exerciseCatalog';
import {
  buildImportPlan,
  detectFormat,
  distinctExerciseNames,
  exportDuration,
  guessEquipment,
  importSessionId,
  importSummary,
  inferExerciseKind,
  matchExerciseName,
  nameWords,
  parseCsv,
  parseImportDate,
  parseImportDuration,
  parseWorkoutCsv,
  splitDuplicates,
  workoutExportColumns,
  workoutExportCsv,
  workoutExportFileName,
  workoutExportSummary,
  type CsvParseResult,
} from '../utils/workoutCsv';

// A Strong export: BOM, CRLF, quoted commas and doubled quotes, a rest timer
// row, warm-up / drop / failure markers, lbs in a unit column, a distance in
// meters, and a row for something nobody recorded anything on.
const STRONG = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,RPE,Distance,Distance Unit,Seconds,Notes,Workout Notes',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Bench Press (Barbell),W,45,lbs,10,,0,,0,,"Felt strong, slept well"',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Bench Press (Barbell),1,135,lbs,8,8,0,,0,"Paused ""slow"" reps",',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Bench Press (Barbell),2,135,lbs,7,9,0,,0,,',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Bench Press (Barbell),D,115,lbs,6,,0,,0,,',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Bench Press (Barbell),Rest Timer,0,lbs,0,,0,,90,,',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Pull Up,1,0,lbs,10,,0,,0,,',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Pull Up,F,0,lbs,12,,0,,0,,',
  '2024-01-09 18:30:12,"Push Day, Heavy",1h 5m,Plank,1,0,lbs,0,,0,,60,,',
  '2024-01-11 07:00:00,Run,45m,Running,1,0,lbs,0,,5000,m,2700,,',
  '2024-01-11 07:00:00,Run,45m,Mystery Machine,1,0,lbs,10,,0,,0,,',
  '2024-01-11 07:00:00,Run,45m,Cooldown,1,0,lbs,0,,0,,0,,',
].join('\r\n') + '\r\n';
const STRONG_FILE = '﻿' + STRONG;

// A Hevy export in pounds, with its day-month-year dates, a 12-hour time, sets
// out of order, a superset and a distance in miles.
const HEVY = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"',
  '"Leg Day","9 Jan 2024, 18:30","9 Jan 2024, 19:35","Quads, mostly","Squat (Barbell)","","",1,"normal",225,5,"","",8.5',
  '"Leg Day","9 Jan 2024, 18:30","9 Jan 2024, 19:35","Quads, mostly","Squat (Barbell)","","",0,"warmup",135,8,"","",',
  '"Leg Day","9 Jan 2024, 18:30","9 Jan 2024, 19:35","Quads, mostly","Squat (Barbell)","","",2,"failure",225,7,"","",',
  '"Leg Day","9 Jan 2024, 18:30","9 Jan 2024, 19:35","Quads, mostly","Leg Extension (Machine)","1","Slow",0,"normal",100,12,"","",',
  '"Leg Day","9 Jan 2024, 18:30","9 Jan 2024, 19:35","Quads, mostly","Lying Leg Curl (Machine)","1","",0,"dropset",80,10,"","",',
  '"Easy Run","12 Jan 2024, 7:05 AM","12 Jan 2024, 7:35 AM","","Running","","",0,"normal","","",3.1,1800,',
].join('\n');

const ok = (r: CsvParseResult) => {
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r;
};

const KG_PER_LB = 0.45359237;
const lb = (n: number) => Number((n * KG_PER_LB).toFixed(3));

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes, line breaks inside quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
  });

  it('handles a bare CR, no trailing newline and blank rows', () => {
    expect(parseCsv('a,b\r1,2\n\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('keeps empty cells, and reads a semicolon file', () => {
    expect(parseCsv('a,,c\n1,,3')).toEqual([['a', '', 'c'], ['1', '', '3']]);
    expect(parseCsv('a;b;c\n1;2,5;3')).toEqual([['a', 'b', 'c'], ['1', '2,5', '3']]);
  });

  it('is empty for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿\r\n')).toEqual([]);
  });
});

describe('parseImportDate', () => {
  it('reads Strong and Hevy dates as local wall-clock times', () => {
    const a = parseImportDate('2024-01-09 18:30:12')!;
    expect([a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes(), a.getSeconds()])
      .toEqual([2024, 0, 9, 18, 30, 12]);
    const b = parseImportDate('9 Jan 2024, 18:30')!;
    expect([b.getFullYear(), b.getMonth(), b.getDate(), b.getHours(), b.getMinutes()]).toEqual([2024, 0, 9, 18, 30]);
    const c = parseImportDate('12 January 2024, 7:05 AM')!;
    expect([c.getDate(), c.getHours(), c.getMinutes()]).toEqual([12, 7, 5]);
    const d = parseImportDate('12 Jan 2024, 12:05 AM')!;
    expect(d.getHours()).toBe(0);
    expect(parseImportDate('12 Jan 2024, 12:05 PM')!.getHours()).toBe(12);
    expect(parseImportDate('2024-01-09T18:30')!.getHours()).toBe(18);
  });

  it('reads a value that names its zone as that instant', () => {
    expect(parseImportDate('2024-01-09T18:30:00Z')!.toISOString()).toBe('2024-01-09T18:30:00.000Z');
    expect(parseImportDate('2024-01-09T18:30:00+0100')!.toISOString()).toBe('2024-01-09T17:30:00.000Z');
  });

  it('refuses a day that does not exist and a format it does not know', () => {
    expect(parseImportDate('2024-02-31 10:00:00')).toBeNull();
    expect(parseImportDate('31 Feb 2024, 10:00')).toBeNull();
    expect(parseImportDate('3/4/2024 10:00')).toBeNull();
    expect(parseImportDate('')).toBeNull();
  });

  it('keeps a late-evening time on its own calendar day in the local zone', () => {
    // Built from parts, so it is the same wall-clock time in every zone the suite runs in.
    const d = parseImportDate('2024-03-30 23:59:00')!;
    expect([d.getDate(), d.getHours()]).toEqual([30, 23]);
  });
});

describe('parseImportDuration', () => {
  it('reads hours, minutes and seconds in Strong\'s spelling', () => {
    expect(parseImportDuration('1h 5m')).toBe(3900);
    expect(parseImportDuration('45m')).toBe(2700);
    expect(parseImportDuration('1h')).toBe(3600);
    expect(parseImportDuration('50m 30s')).toBe(3030);
    expect(parseImportDuration('90')).toBe(90);
    expect(parseImportDuration('')).toBeNull();
    expect(parseImportDuration('soon')).toBeNull();
  });
});

describe('detectFormat', () => {
  it('tells the two apart by header, ignoring case and punctuation', () => {
    expect(detectFormat(['date', 'WORKOUT NAME', 'exercise_name'])).toBe('strong');
    expect(detectFormat(['Title', 'Start Time', 'Exercise Title'])).toBe('hevy');
    expect(detectFormat(['a', 'b'])).toBeNull();
  });
});

describe('parseWorkoutCsv: Strong', () => {
  const result = ok(parseWorkoutCsv(STRONG_FILE));

  it('groups rows into workouts and reads the title, notes and duration', () => {
    expect(result.source).toBe('strong');
    expect(result.sessions).toHaveLength(2);
    const [push, run] = result.sessions;
    expect(push.title).toBe('Push Day, Heavy');
    expect(push.notes).toBe('Felt strong, slept well');
    const start = new Date(push.startedAt);
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([9, 18, 30]);
    expect(new Date(push.endedAt).getTime() - start.getTime()).toBe((65 * 60 + 0) * 1000);
    expect(run.title).toBe('Run');
  });

  it('maps set markers, drops rest timers and converts pounds to kilograms at the edge', () => {
    const push = result.sessions[0];
    const bench = push.sets.filter(s => s.exerciseName === 'Bench Press (Barbell)');
    expect(bench.map(s => s.kind)).toEqual(['warmup', 'working', 'working', 'drop']);
    expect(bench[1].weightKg).toBe(lb(135));
    expect(bench[1].reps).toBe(8);
    expect(bench[1].rpe).toBe(8);
    expect(bench[1].note).toBe('Paused "slow" reps');
    expect(result.skippedRows).toBe(2); // the rest timer and the cooldown row with nothing recorded
    expect(push.sets.map(s => s.kind)).toEqual(['warmup', 'working', 'working', 'drop', 'working', 'amrap', 'working']);
  });

  it('reads a zero weight as no load, a hold as seconds and a run as meters', () => {
    const [push, run] = result.sessions;
    const pullUp = push.sets.find(s => s.exerciseName === 'Pull Up')!;
    expect(pullUp.weightKg).toBeNull();
    expect(pullUp.reps).toBe(10);
    const plank = push.sets.find(s => s.exerciseName === 'Plank')!;
    expect(plank.durationSeconds).toBe(60);
    expect(plank.reps).toBeNull();
    expect(run.sets).toHaveLength(2);
    expect(run.sets[0].distanceM).toBe(5000);
    expect(run.sets[0].durationSeconds).toBe(2700);
  });

  it('says nothing was assumed when the file names its unit', () => {
    expect(result.unitAssumed).toBe(false);
  });

  it('gives each workout a deterministic id, the same on a second read', () => {
    const again = ok(parseWorkoutCsv(STRONG_FILE));
    expect(again.sessions.map(s => s.id)).toEqual(result.sessions.map(s => s.id));
    expect(new Set(result.sessions.map(s => s.id)).size).toBe(2);
    expect(result.sessions[0].id).toBe(importSessionId('strong', result.sessions[0].startedAt, 'push day, heavy'));
  });
});

describe('parseWorkoutCsv: Strong without a unit column', () => {
  const NO_UNIT = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n'
    + '2023-05-01 09:00:00,Legs,50m,Squat (Barbell),1,100,5,0,0,,,\n';

  it('reads in the fallback unit and says it assumed one', () => {
    const kg = ok(parseWorkoutCsv(NO_UNIT));
    expect(kg.unitAssumed).toBe(true);
    expect(kg.sessions[0].sets[0].weightKg).toBe(100);
    const pounds = ok(parseWorkoutCsv(NO_UNIT, { fallbackUnit: 'lb' }));
    expect(pounds.sessions[0].sets[0].weightKg).toBe(lb(100));
  });

  it('takes the unit from a header that names it', () => {
    const csv = NO_UNIT.replace('Weight,Reps', 'Weight (lb),Reps');
    const r = ok(parseWorkoutCsv(csv));
    expect(r.unitAssumed).toBe(false);
    expect(r.sessions[0].sets[0].weightKg).toBe(lb(100));
  });

  it('is not unit-assuming when no set has a weight', () => {
    const csv = NO_UNIT.replace(',100,5,', ',0,5,');
    expect(ok(parseWorkoutCsv(csv)).unitAssumed).toBe(false);
  });

  it('tolerates a missing optional column and an extra one', () => {
    const csv = 'Date,Workout Name,Exercise Name,Weight (kg),Reps,Favorite Color\n'
      + '2023-05-01 09:00:00,Legs,Squat,82.5,5,blue\n';
    const r = ok(parseWorkoutCsv(csv));
    expect(r.sessions[0].sets[0].weightKg).toBe(82.5);
    expect(r.sessions[0].endedAt).toBe(r.sessions[0].startedAt);
  });
});

describe('parseWorkoutCsv: Hevy', () => {
  const result = ok(parseWorkoutCsv(HEVY));

  it('reads title, description and the end time', () => {
    expect(result.source).toBe('hevy');
    expect(result.sessions).toHaveLength(2);
    const leg = result.sessions[0];
    expect(leg.title).toBe('Leg Day');
    expect(leg.notes).toBe('Quads, mostly');
    expect(new Date(leg.endedAt).getTime() - new Date(leg.startedAt).getTime()).toBe(65 * 60 * 1000);
    const run = result.sessions[1];
    const start = new Date(run.startedAt);
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([12, 7, 5]);
  });

  it('orders exercises by first appearance and sets by their index', () => {
    const leg = result.sessions[0];
    expect(leg.sets.map(s => s.exerciseName)).toEqual([
      'Squat (Barbell)', 'Squat (Barbell)', 'Squat (Barbell)', 'Leg Extension (Machine)', 'Lying Leg Curl (Machine)',
    ]);
    const squat = leg.sets.slice(0, 3);
    expect(squat.map(s => s.kind)).toEqual(['warmup', 'working', 'amrap']);
    expect(squat.map(s => s.reps)).toEqual([8, 5, 7]);
    expect(squat[1].weightKg).toBe(lb(225));
    expect(squat[1].rpe).toBe(8.5);
  });

  it('keys a superset and maps drop sets', () => {
    const [, ext, curl] = result.sessions[0].sets.slice(2);
    expect(ext.supersetKey).toBe('ss-1');
    expect(curl.supersetKey).toBe('ss-1');
    expect(curl.kind).toBe('drop');
    expect(ext.note).toBe('Slow');
  });

  it('converts miles to meters and reads the duration', () => {
    const run = result.sessions[1].sets[0];
    expect(run.distanceM).toBe(4989);
    expect(run.durationSeconds).toBe(1800);
  });

  it('prefers a kilogram column and reads a kg export directly', () => {
    const kg = HEVY.replace('weight_lbs', 'weight_kg').replace('distance_miles', 'distance_km');
    const r = ok(parseWorkoutCsv(kg));
    expect(r.sessions[0].sets.find(s => s.kind === 'working')!.weightKg).toBe(225);
    expect(r.sessions[1].sets[0].distanceM).toBe(3100);
    expect(r.unitAssumed).toBe(false);
  });
});

describe('parseWorkoutCsv: refusals', () => {
  it('says why a file is not usable', () => {
    expect(parseWorkoutCsv('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseWorkoutCsv('a,b\n1,2')).toEqual({ ok: false, reason: 'unknown' });
    expect(parseWorkoutCsv('Date,Workout Name,Exercise Name,Reps\n')).toEqual({ ok: false, reason: 'noRows' });
    expect(parseWorkoutCsv('Date,Workout Name,Exercise Name,Reps\nnot a date,Legs,Squat,5\n'))
      .toEqual({ ok: false, reason: 'noRows' });
  });
});

describe('names', () => {
  it('compares names as sets of words', () => {
    expect(nameWords('Bench Press (Barbell)')).toEqual(['bench', 'press', 'barbell']);
    expect(nameWords('Pull-up')).toEqual(['pull', 'up']);
    expect(nameWords('Dumbbell Curls')).toEqual(['dumbbell', 'curl']);
  });

  it('lists each distinct name once, most used first, with its counts', () => {
    const r = ok(parseWorkoutCsv(STRONG));
    const names = distinctExerciseNames(r.sessions);
    expect(names[0]).toMatchObject({ name: 'Bench Press (Barbell)', sets: 4, sessions: 1 });
    expect(names.map(n => n.name)).toContain('Mystery Machine');
  });

  it('counts different spacing and case as one name', () => {
    const csv = 'Date,Workout Name,Exercise Name,Reps\n2024-01-01 10:00:00,A,Pull  Up,5\n2024-01-01 10:00:00,A,pull up,6\n';
    expect(distinctExerciseNames(ok(parseWorkoutCsv(csv)).sessions)).toHaveLength(1);
  });
});

describe('matchExerciseName', () => {
  const custom: Exercise = {
    id: 'c1', name: 'Sled drag', kind: 'weight_reps', primaryMuscles: [], secondaryMuscles: [], equipment: 'other',
    barKg: null, notes: '', archived: false, isCustom: true, createdAt: '2026-01-01T00:00:00.000Z',
  };
  const archived: Exercise = { ...custom, id: 'c2', name: 'Zottman curl', archived: true };
  const catalog = buildCatalog([custom, archived]);
  const idOf = (name: string) => {
    const m = matchExerciseName(name, catalog);
    return m.kind === 'none' ? null : m.exerciseId;
  };

  it('matches the exact name key first, in any case and spacing', () => {
    expect(matchExerciseName('barbell  BENCH press', catalog)).toMatchObject({ kind: 'exact', exerciseId: 'lib:barbell-bench-press' });
    expect(matchExerciseName('Sled Drag', catalog)).toMatchObject({ kind: 'exact', exerciseId: 'c1' });
  });

  it('matches the same words in another order, with the equipment in brackets', () => {
    expect(matchExerciseName('Bench Press (Barbell)', catalog)).toMatchObject({ kind: 'words' });
    expect(matchExerciseName('Pull Up', catalog)).toMatchObject({ kind: 'words' });
    expect(matchExerciseName('Overhead Press (Barbell)', catalog)).toMatchObject({ kind: 'words' });
  });

  it('matches a one-letter typo', () => {
    expect(matchExerciseName('Barbell bnch press', catalog)).toMatchObject({ kind: 'close', exerciseId: 'lib:barbell-bench-press' });
  });

  it('declines a name that is only vaguely like something', () => {
    expect(idOf('Squat (Barbell)')).toBeNull();
    expect(idOf('Mystery Machine')).toBeNull();
    expect(idOf('Press')).toBeNull();
    // One extra word on a three-word name is not close enough to decide for the person.
    expect(idOf('Barbell bench press wide')).toBeNull();
    expect(idOf('')).toBeNull();
  });

  it('declines two equally plausible candidates', () => {
    // "Incline Bench Press" is one word off both the barbell and the dumbbell versions.
    expect(idOf('Incline Bench Press')).toBeNull();
  });

  it('matches an archived exercise only by its exact name', () => {
    expect(matchExerciseName('Zottman curl', catalog)).toMatchObject({ kind: 'exact', exerciseId: 'c2' });
    expect(idOf('Curl Zottman Extra')).toBeNull();
    expect(idOf('curl zottman')).toBeNull();
  });
});

describe('kind and equipment of a created exercise', () => {
  it('reads the kind off the sets that used it', () => {
    const none = { weightKg: null, reps: null, durationSeconds: null, distanceM: null };
    expect(inferExerciseKind([{ ...none, weightKg: 50, reps: 5 }])).toBe('weight_reps');
    expect(inferExerciseKind([{ ...none, reps: 5 }])).toBe('bodyweight_reps');
    expect(inferExerciseKind([{ ...none, durationSeconds: 60 }])).toBe('duration');
    expect(inferExerciseKind([{ ...none, distanceM: 400, durationSeconds: 90 }])).toBe('distance');
    expect(inferExerciseKind([{ ...none, weightKg: 40, distanceM: 20 }])).toBe('weight_distance');
  });

  it('reads the equipment off the name', () => {
    expect(guessEquipment('Row (Barbell)')).toBe('barbell');
    expect(guessEquipment('Curl (Dumbbell)')).toBe('dumbbell');
    expect(guessEquipment('Smith Machine Squat')).toBe('smith_machine');
    expect(guessEquipment('Sled Drag')).toBe('other');
  });
});

describe('buildImportPlan', () => {
  const sessions = ok(parseWorkoutCsv(STRONG)).sessions;

  it('writes the sessions with the exercises the person chose', () => {
    const plan = buildImportPlan(sessions, {
      'bench press (barbell)': { kind: 'exercise', exerciseId: 'lib:barbell-bench-press' },
      'pull up': { kind: 'exercise', exerciseId: 'lib:pull-up' },
      plank: { kind: 'create' },
      running: { kind: 'exercise', exerciseId: 'lib:running' },
      'mystery machine': { kind: 'skip' },
    }, []);
    expect(plan.sessions).toHaveLength(2);
    expect(plan.createKeys).toEqual(['plank']);
    expect(plan.sessions[0].sets[0]).toMatchObject({ exerciseRef: 'lib:barbell-bench-press', kind: 'warmup' });
    expect(plan.sessions[0].sets.find(s => s.exerciseRef === 'new:plank')).toBeTruthy();
    expect(plan.skippedSets).toBe(1);
    expect(plan.duplicates).toBe(0);
  });

  it('leaves out the sets of a skipped name, and a workout with none left', () => {
    const plan = buildImportPlan(sessions, {
      'bench press (barbell)': { kind: 'skip' },
      'pull up': { kind: 'skip' },
      plank: { kind: 'skip' },
      running: { kind: 'skip' },
      'mystery machine': { kind: 'skip' },
    }, []);
    expect(plan.sessions).toHaveLength(0);
    expect(plan.emptied).toBe(2);
    expect(plan.skippedSets).toBe(9);
  });

  it('adds nothing the second time: by id, and by start and title under another id', () => {
    const resolutions = Object.fromEntries(
      distinctExerciseNames(sessions).map(n => [n.key, { kind: 'create' as const }]),
    );
    const first = buildImportPlan(sessions, resolutions, []);
    expect(first.sessions).toHaveLength(2);
    const existing: Pick<WorkoutSession, 'id' | 'startedAt' | 'title'>[] = first.sessions.map(s => ({
      id: s.id, startedAt: s.startedAt, title: s.title,
    }));
    const again = buildImportPlan(sessions, resolutions, existing);
    expect(again.sessions).toHaveLength(0);
    expect(again.duplicates).toBe(2);

    const renamedId = existing.map(e => ({ ...e, id: 'something-else', title: e.title.toUpperCase() }));
    expect(buildImportPlan(sessions, resolutions, renamedId).duplicates).toBe(2);
    expect(splitDuplicates(sessions, [existing[0]])).toMatchObject({ duplicates: 1 });
  });

  it('treats a name with no decision as skipped', () => {
    expect(buildImportPlan(sessions, {}, []).sessions).toHaveLength(0);
  });
});

describe('importSummary', () => {
  it('counts workouts and sets and finds the date range', () => {
    const s = importSummary(ok(parseWorkoutCsv(STRONG)).sessions);
    expect(s.sessions).toBe(2);
    expect(s.sets).toBe(9);
    expect(new Date(s.from!).getDate()).toBe(9);
    expect(new Date(s.to!).getDate()).toBe(11);
    expect(importSummary([])).toEqual({ sessions: 0, sets: 0, from: null, to: null });
  });
});

describe('export', () => {
  const exercises: Exercise[] = [{
    id: 'c1', name: 'Cable "fly", low', kind: 'weight_reps', primaryMuscles: [], secondaryMuscles: [], equipment: 'cable',
    barKg: null, notes: '', archived: false, isCustom: true, createdAt: '2026-01-01T00:00:00.000Z',
  }];
  const session = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
    id: 's1', routineId: null, programId: null, taskId: null, title: 'Push, heavy',
    startedAt: new Date(2024, 0, 9, 18, 30, 0).toISOString(),
    endedAt: new Date(2024, 0, 9, 19, 35, 0).toISOString(),
    notes: 'Felt "good", slept well', effort: null, healthWorkoutId: null, healthWritePending: false, ...over,
  });
  const set = (over: Partial<WorkoutSet>): WorkoutSet => ({
    id: 'x', sessionId: 's1', exerciseId: 'lib:barbell-bench-press', position: 0, setIndex: 0, kind: 'working',
    weightKg: null, reps: null, durationSeconds: null, distanceM: null, rpe: null,
    completedAt: '2024-01-09T19:00:00.000Z', supersetKey: null, note: null, ...over,
  });
  const sets = [
    set({ id: 'a', kind: 'warmup', weightKg: 40, reps: 10 }),
    set({ id: 'b', setIndex: 1, weightKg: 82.5, reps: 8, rpe: 8, note: 'slow, paused' }),
    set({ id: 'c', setIndex: 2, kind: 'drop', weightKg: 60, reps: 10 }),
    set({ id: 'd', setIndex: 3, weightKg: 82.5, reps: 5, completedAt: null }),
    set({ id: 'e', position: 1, exerciseId: 'c1', weightKg: 20, reps: 12 }),
  ];

  it('names the unit in the header', () => {
    expect(workoutExportColumns('kg')[5]).toBe('Weight (kg)');
    expect(workoutExportColumns('lb')[5]).toBe('Weight (lb)');
  });

  it('writes a row per set done, with Strong\'s markers, quoted where it has to be', () => {
    const csv = workoutExportCsv([{ session: session(), sets }], exercises, 'kg');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Distance (m),Seconds,Notes,Workout Notes,RPE');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('2024-01-09 18:30:00,"Push, heavy",1h 5m,Barbell bench press,W,40,10,,,,"Felt ""good"", slept well",');
    expect(lines[2]).toBe('2024-01-09 18:30:00,"Push, heavy",1h 5m,Barbell bench press,1,82.5,8,,,"slow, paused",,8');
    expect(lines[3]).toContain('Barbell bench press,D,60,10,');
    expect(lines[4]).toBe('2024-01-09 18:30:00,"Push, heavy",1h 5m,"Cable ""fly"", low",1,20,12,,,,,');
  });

  it('writes weights in the unit shown', () => {
    const csv = workoutExportCsv([{ session: session({ title: 'Push' }), sets: [set({ weightKg: 61.235, reps: 5 })] }], exercises, 'lb');
    expect(csv).toContain('Weight (lb)');
    expect(csv.split('\r\n')[1].split(',')[5]).toBe('135');
  });

  it('leaves out a workout still in progress, and goes oldest first', () => {
    const live = { session: session({ id: 'live', endedAt: null }), sets };
    const later = { session: session({ id: 'later', title: 'Later', startedAt: new Date(2024, 0, 12, 9, 0, 0).toISOString(), endedAt: new Date(2024, 0, 12, 10, 0, 0).toISOString() }), sets: [set({ weightKg: 50, reps: 5 })] };
    const earlier = { session: session({ title: 'Earlier' }), sets: [set({ weightKg: 50, reps: 5 })] };
    const lines = workoutExportCsv([later, live, earlier], exercises, 'kg').trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Earlier');
    expect(lines[2]).toContain('Later');
  });

  it('reads back through the importer, in kilograms and in pounds', () => {
    const exported = [{ session: session({ title: 'Round trip' }), sets: sets.slice(0, 3) }];
    for (const unit of ['kg', 'lb'] as const) {
      const r = ok(parseWorkoutCsv(workoutExportCsv(exported, exercises, unit)));
      expect(r.unitAssumed).toBe(false);
      expect(r.sessions).toHaveLength(1);
      const s = r.sessions[0];
      expect(s.title).toBe('Round trip');
      expect(s.sets.map(x => x.kind)).toEqual(['warmup', 'working', 'drop']);
      expect(s.sets[1].weightKg).toBeCloseTo(82.5, unit === 'kg' ? 3 : 0);
      expect(s.sets[1].reps).toBe(8);
      expect(s.sets[1].note).toBe('slow, paused');
      expect(s.sets[1].rpe).toBe(8);
      expect(new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()).toBe(65 * 60 * 1000);
    }
  });

  it('formats a duration, a file name and a summary', () => {
    expect(exportDuration(3900)).toBe('1h 5m');
    expect(exportDuration(3600)).toBe('1h');
    expect(exportDuration(2700)).toBe('45m');
    expect(exportDuration(30)).toBe('30s');
    expect(exportDuration(0)).toBe('');
    expect(workoutExportFileName(new Date(2024, 0, 9, 23, 59))).toBe('workouts-2024-01-09.csv');
    expect(workoutExportSummary([{ session: session(), sets }])).toBe('1 workout, 4 sets');
    expect(workoutExportSummary([])).toBe('No finished workouts in this range.');
  });
});
