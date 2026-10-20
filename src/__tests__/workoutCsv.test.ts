import type { Exercise, WorkoutSession, WorkoutSet } from '../types';
import { buildCatalog } from '../utils/exerciseCatalog';
import {
  buildImportPlan,
  describeSkipped,
  detectFormat,
  distinctExerciseNames,
  exportDuration,
  guessEquipment,
  importSessionId,
  importSummary,
  indexExisting,
  indexHas,
  inferExerciseKind,
  isAutoMatch,
  matchAll,
  matchExerciseName,
  nameWords,
  parseCsv,
  parseImportDate,
  parseImportDuration,
  parseWorkoutCsv,
  readCsv,
  splitDuplicates,
  workoutExportColumns,
  workoutExportCsv,
  workoutExportFileName,
  workoutExportSummary,
  type CsvParseResult,
} from '../utils/workoutCsv';

// The fixtures below are written to match the layouts the real apps produce
// (the header lines are the apps'; every row is made up for these tests).

// Strong, iOS (S1): comma-delimited, twelve columns, text cells quoted, no
// unit column anywhere, "1h 5m" and "38min" durations. Has a BOM and CRLF, a
// quoted comma, doubled quotes, a rest timer, warm-up / drop / failure
// markers, a bodyweight set, a hold, a run and a row nobody recorded.
const STRONG_S1 = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Bench Press (Barbell)","W",45,10,0,0,"","Felt strong, slept well",',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Bench Press (Barbell)","1",135,8,0,0,"Paused ""slow"" reps","",8',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Bench Press (Barbell)","2",135,7,0,0,"","",9',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Bench Press (Barbell)","D",115,6,0,0,"","",',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Bench Press (Barbell)","Rest Timer",0,0,0,90,"","",',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Pull Up","1",0,10,0,0,"","",',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Pull Up","F",0,12,0,0,"","",',
  '2024-01-09 18:30:12,"Push Day, Heavy","1h 5m","Plank","1",0,0,0,60,"","",',
  '2024-01-11 07:00:00,"Run","38min","Running","1",0,0,5,2700,"","",',
  '2024-01-11 07:00:00,"Run","38min","Mystery Machine","1",0,10,0,0,"","",',
  '2024-01-11 07:00:00,"Run","38min","Cooldown","1",0,0,0,0,"","",',
].join('\r\n') + '\r\n';
const STRONG_FILE = '﻿' + STRONG_S1;

// Strong, Android (S2): semicolon-delimited, a unit column for weight (lbs, or
// blank for kg) and one for distance (mi., km), comma decimals, and quoted text
// whose inner quotes are NOT doubled.
const STRONG_S2 = [
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration',
  '"2024-03-04 06:45:00";"Upper";"Bench "paused"";1;135;lbs;8;8;0;;0;"Tempo "slow" reps";"Light day";"58m"',
  '"2024-03-04 06:45:00";"Upper";"Bench "paused"";2;82,5;;5;;0;;0;"";"";"58m"',
  '"2024-03-04 06:45:00";"Upper";"Row (Cable)";1;60;;12;;0;;0;"";"";"58m"',
  '"2024-03-06 17:00:00";"Run";"Running";1;0;;0;;3,1;mi.;1500;"";"";"25m"',
  '"2024-03-06 17:00:00";"Run";"Cycling";1;0;;0;;12;km;2400;"";"";"25m"',
].join('\n');

// Strong (S3): semicolon-delimited, every cell quoted, units in the headers,
// a duration in seconds, a "Note" row ahead of the sets it belongs to, one for
// an exercise with no sets, and a 12-hour date with a narrow no-break space.
const STRONG_S3 = [
  '"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"',
  '"1";"2024-02-05 07:15:00";"Morning Lift";"3300";"Overhead Press (Barbell)";"Note";"0";"0";"";"0";"0";"Strict, no leg drive";""',
  '"1";"2024-02-05 07:15:00";"Morning Lift";"3300";"Overhead Press (Barbell)";"1";"42,5";"5";"7";"0";"0";"";""',
  '"1";"2024-02-05 07:15:00";"Morning Lift";"3300";"Overhead Press (Barbell)";"2";"42,5";"4";"9";"0";"0";"Grindy";""',
  '"1";"2024-02-05 07:15:00";"Morning Lift";"3300";"Face Pull";"Note";"0";"0";"";"0";"0";"Cable at eye level";""',
  '"1";"2024-02-05 07:15:00";"Morning Lift";"3300";"Farmer Walk";"1";"32";"0";"";"40";"30";"";""',
  '"2";"2025-01-30 12:34:56 pm";"Evening Pull";"1800";"Pull Up";"1";"0";"8";"";"0";"0";"";""',
].join('\n');

// Strong, older (S4): S2 without RPE or a workout duration.
const STRONG_S4 = [
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Distance;Distance Unit;Seconds;Notes;Workout Notes',
  '"2023-11-20 19:00:00";"Legs";"Squat (Barbell)";1;100;;5;0;;0;"";""',
  '"2023-11-20 19:00:00";"Legs";"Squat (Barbell)";2;100;;5;0;;0;"";""',
].join('\n');

const HEVY_HEADER_KG = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';
const HEVY_HEADER_LB = HEVY_HEADER_KG.replace('weight_kg', 'weight_lbs').replace('distance_km', 'distance_miles');

// Hevy, metric, day-first dates (zero-padded and not), sets out of order, a
// superset and a distance in kilometers.
const HEVY_KG = [
  HEVY_HEADER_KG,
  '"Leg Day","26 Feb 2024, 08:00","26 Feb 2024, 09:05","Quads, mostly","Squat (Barbell)","","",1,"normal",100,5,"","",8.5',
  '"Leg Day","26 Feb 2024, 08:00","26 Feb 2024, 09:05","Quads, mostly","Squat (Barbell)","","",0,"warmup",60,8,"","",',
  '"Leg Day","26 Feb 2024, 08:00","26 Feb 2024, 09:05","Quads, mostly","Squat (Barbell)","","",2,"failure",100,7,"","",',
  '"Leg Day","26 Feb 2024, 08:00","26 Feb 2024, 09:05","Quads, mostly","Leg Extension (Machine)","0","Slow",0,"normal",45,12,"","",',
  '"Leg Day","26 Feb 2024, 08:00","26 Feb 2024, 09:05","Quads, mostly","Lying Leg Curl (Machine)","0","",0,"dropset",35,10,"","",',
  '"Easy Run","3 Mar 2024, 7:05","3 Mar 2024, 7:35","","Running","","",0,"normal","","",5,1800,',
].join('\n');

// Hevy, imperial, month-first 12-hour dates.
const HEVY_LB = [
  HEVY_HEADER_LB,
  '"Push","Oct 1, 2026, 8:28 PM","Oct 1, 2026, 9:20 PM","","Bench Press (Dumbbell)","","",0,"normal",60,10,"","",',
  '"Push","Oct 1, 2026, 8:28 PM","Oct 1, 2026, 9:20 PM","","Bench Press (Dumbbell)","","",1,"normal",60,9,"","",9',
  '"Easy Run","Oct 3, 2026, 7:05 AM","Oct 3, 2026, 7:35 AM","","Running","","",0,"normal","","",3.1,1800,',
].join('\n');

const ok = (r: CsvParseResult) => {
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r;
};

const KG_PER_LB = 0.45359237;
const lb = (n: number) => Number((n * KG_PER_LB).toFixed(3));
const parts = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];

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
    expect(readCsv('a;b\n1;2').delimiter).toBe(';');
    expect(readCsv('a,b\n1,2').delimiter).toBe(',');
  });

  it('is empty for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿\r\n')).toEqual([]);
  });

  it('keeps an unescaped quote inside a quoted field (Strong on Android)', () => {
    const rows = parseCsv('a;b;c\n"Bench "paused"";"x";3\n"say "hi" there";"y";4\n');
    expect(rows[1]).toEqual(['Bench "paused"', 'x', '3']);
    expect(rows[2]).toEqual(['say "hi" there', 'y', '4']);
  });

  it('still reads a properly doubled quote at the end of a field', () => {
    expect(parseCsv('a,b\n"ends with ""","next"\n')[1]).toEqual(['ends with "', 'next']);
    expect(parseCsv('a,b\n"""",x\n')[1]).toEqual(['"', 'x']);
  });
});

describe('parseImportDate', () => {
  it('reads Strong and Hevy dates as local wall-clock times', () => {
    expect(parts(parseImportDate('2024-01-09 18:30:12')!)).toEqual([2024, 0, 9, 18, 30, 12]);
    expect(parts(parseImportDate('9 Jan 2024, 18:30')!)).toEqual([2024, 0, 9, 18, 30, 0]);
    expect(parts(parseImportDate('26 Feb 2024, 08:00')!)).toEqual([2024, 1, 26, 8, 0, 0]);
    expect(parts(parseImportDate('3 Mar 2024, 7:05')!)).toEqual([2024, 2, 3, 7, 5, 0]);
    expect(parts(parseImportDate('12 January 2024, 7:05 AM')!)).toEqual([2024, 0, 12, 7, 5, 0]);
    expect(parseImportDate('12 Jan 2024, 12:05 AM')!.getHours()).toBe(0);
    expect(parseImportDate('12 Jan 2024, 12:05 PM')!.getHours()).toBe(12);
    expect(parseImportDate('2024-01-09T18:30')!.getHours()).toBe(18);
  });

  it('reads Hevy\'s month-first 12-hour dates', () => {
    expect(parts(parseImportDate('Oct 1, 2026, 8:28 PM')!)).toEqual([2026, 9, 1, 20, 28, 0]);
    expect(parts(parseImportDate('Oct 12, 2026, 12:05 AM')!)).toEqual([2026, 9, 12, 0, 5, 0]);
    expect(parts(parseImportDate('October 3, 2026, 7:05 am')!)).toEqual([2026, 9, 3, 7, 5, 0]);
    expect(parts(parseImportDate('Dec 31, 2025, 11:59 PM')!)).toEqual([2025, 11, 31, 23, 59, 0]);
  });

  it('reads Strong\'s 12-hour form with any kind of space and any case before am/pm', () => {
    for (const gap of [' ', ' ', ' ', '']) {
      expect(parts(parseImportDate(`2025-01-30 12:34:56${gap}pm`)!)).toEqual([2025, 0, 30, 12, 34, 56]);
      expect(parts(parseImportDate(`2025-01-30 12:34:56${gap}AM`)!)).toEqual([2025, 0, 30, 0, 34, 56]);
      expect(parts(parseImportDate(`2025-01-30 7:05:00${gap}Pm`)!)).toEqual([2025, 0, 30, 19, 5, 0]);
    }
  });

  it('reads a value that names its zone as that instant', () => {
    expect(parseImportDate('2024-01-09T18:30:00Z')!.toISOString()).toBe('2024-01-09T18:30:00.000Z');
    expect(parseImportDate('2024-01-09T18:30:00+0100')!.toISOString()).toBe('2024-01-09T17:30:00.000Z');
  });

  it('refuses a day or time that does not exist and a format it does not know', () => {
    expect(parseImportDate('2024-02-31 10:00:00')).toBeNull();
    expect(parseImportDate('31 Feb 2024, 10:00')).toBeNull();
    expect(parseImportDate('Feb 31, 2024, 10:00 AM')).toBeNull();
    expect(parseImportDate('2024-01-09 25:00:00')).toBeNull();
    expect(parseImportDate('2024-01-09 13:00:00 pm')).toBeNull();
    expect(parseImportDate('2024-01-09 00:30:00 am')).toBeNull();
    expect(parseImportDate('3/4/2024 10:00')).toBeNull();
    expect(parseImportDate('')).toBeNull();
  });

  it('keeps a late-evening time on its own calendar day in the local zone', () => {
    // Built from parts, so it is the same wall-clock time in every zone the suite runs in.
    const d = parseImportDate('2024-03-30 23:59:00')!;
    expect([d.getDate(), d.getHours()]).toEqual([30, 23]);
  });

  it('accepts a time inside a DST gap rather than losing the workout', () => {
    // 02:30 on 10 March 2024 does not exist in New York (clocks jump 02:00 to 03:00),
    // and is an ordinary time in London. The day survives in every zone.
    const d = parseImportDate('2024-03-10 02:30:00');
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(10);
    expect(parseImportDate('Mar 10, 2024, 2:30 AM')).not.toBeNull();
    expect(parseImportDate('10 Mar 2024, 02:30')).not.toBeNull();
  });
});

describe('parseImportDuration', () => {
  it('reads hours, minutes and seconds in Strong\'s spelling', () => {
    expect(parseImportDuration('1h 5m')).toBe(3900);
    expect(parseImportDuration('1h 43m')).toBe(6180);
    expect(parseImportDuration('38min')).toBe(2280);
    expect(parseImportDuration('45m')).toBe(2700);
    expect(parseImportDuration('1h')).toBe(3600);
    expect(parseImportDuration('50m 30s')).toBe(3030);
    expect(parseImportDuration('90')).toBe(90);
    expect(parseImportDuration('3300')).toBe(3300);
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

  it('recognises all four Strong layouts and both Hevy ones', () => {
    for (const file of [STRONG_S1, STRONG_S2, STRONG_S3, STRONG_S4]) expect(ok(parseWorkoutCsv(file)).source).toBe('strong');
    for (const file of [HEVY_KG, HEVY_LB]) expect(ok(parseWorkoutCsv(file)).source).toBe('hevy');
  });
});

describe('parseWorkoutCsv: Strong S1 (iOS)', () => {
  const result = ok(parseWorkoutCsv(STRONG_FILE, { fallbackUnit: 'lb' }));

  it('groups rows into workouts and reads the title, notes and duration', () => {
    expect(result.source).toBe('strong');
    expect(result.sessions).toHaveLength(2);
    const [push, run] = result.sessions;
    expect(push.title).toBe('Push Day, Heavy');
    expect(push.notes).toBe('Felt strong, slept well');
    expect(parts(new Date(push.startedAt))).toEqual([2024, 0, 9, 18, 30, 12]);
    expect(new Date(push.endedAt).getTime() - new Date(push.startedAt).getTime()).toBe(65 * 60 * 1000);
    expect(run.title).toBe('Run');
    expect(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()).toBe(38 * 60 * 1000);
  });

  it('maps set markers, drops rest timers and converts the person\'s unit to kilograms at the edge', () => {
    const push = result.sessions[0];
    const bench = push.sets.filter(s => s.exerciseName === 'Bench Press (Barbell)');
    expect(bench.map(s => s.kind)).toEqual(['warmup', 'working', 'working', 'drop']);
    expect(bench[1].weightKg).toBe(lb(135));
    expect(bench[1].reps).toBe(8);
    expect(bench[1].rpe).toBe(8);
    expect(bench[1].note).toBe('Paused "slow" reps');
    expect(result.skipped).toEqual({ restTimers: 1, emptySets: 1, badDates: 0, noExercise: 0, looseNotes: 0 });
    expect(result.skippedRows).toBe(2);
    expect(push.sets.map(s => s.kind)).toEqual(['warmup', 'working', 'working', 'drop', 'working', 'amrap', 'working']);
  });

  it('reads a zero weight as no load, a hold as seconds and a run as meters in the person\'s distance unit', () => {
    const [push, run] = result.sessions;
    const pullUp = push.sets.find(s => s.exerciseName === 'Pull Up')!;
    expect(pullUp.weightKg).toBeNull();
    expect(pullUp.reps).toBe(10);
    const plank = push.sets.find(s => s.exerciseName === 'Plank')!;
    expect(plank.durationSeconds).toBe(60);
    expect(plank.reps).toBeNull();
    expect(run.sets).toHaveLength(2);
    expect(run.sets[0].distanceM).toBe(8046.7); // 5 miles, because the person said pounds
    expect(run.sets[0].durationSeconds).toBe(2700);
  });

  it('has no unit anywhere, so it asks, and reads kilograms and kilometers on a kg answer', () => {
    expect(result.unitAssumed).toBe(true);
    const metric = ok(parseWorkoutCsv(STRONG_FILE, { fallbackUnit: 'kg' }));
    expect(metric.unitAssumed).toBe(true);
    expect(metric.sessions[0].sets[1].weightKg).toBe(135);
    expect(metric.sessions[1].sets[0].distanceM).toBe(5000);
  });

  it('gives each workout a deterministic id, the same on a second read', () => {
    const again = ok(parseWorkoutCsv(STRONG_FILE));
    expect(again.sessions.map(s => s.id)).toEqual(result.sessions.map(s => s.id));
    expect(new Set(result.sessions.map(s => s.id)).size).toBe(2);
    expect(result.sessions[0].id).toBe(importSessionId('strong', '2024-01-09 18:30:12'));
  });
});

describe('parseWorkoutCsv: Strong S2 (Android)', () => {
  const result = ok(parseWorkoutCsv(STRONG_S2));
  const [upper, run] = result.sessions;

  it('reads a semicolon file with a quote inside a quoted field', () => {
    expect(result.sessions).toHaveLength(2);
    expect(upper.title).toBe('Upper');
    expect(upper.notes).toBe('Light day');
    expect(upper.sets[0].exerciseName).toBe('Bench "paused"');
    expect(upper.sets[0].note).toBe('Tempo "slow" reps');
    expect(new Date(upper.endedAt).getTime() - new Date(upper.startedAt).getTime()).toBe(58 * 60 * 1000);
  });

  it('reads lbs, a blank unit as kilograms and a comma decimal', () => {
    expect(upper.sets[0].weightKg).toBe(lb(135));
    expect(upper.sets[1].weightKg).toBe(82.5);
    expect(upper.sets[2].weightKg).toBe(60);
    expect(result.unitAssumed).toBe(false);
  });

  it('reads the distance unit with its trailing period', () => {
    expect(run.sets[0].distanceM).toBe(4989); // 3,1 mi.
    expect(run.sets[1].distanceM).toBe(12000); // 12 km
    expect(run.sets[0].durationSeconds).toBe(1500);
  });

  it('reads a comma decimal only when the file is semicolon-delimited', () => {
    const commaFile = 'Date,Workout Name,Exercise Name,Weight (kg),Reps\n2023-05-01 09:00:00,Legs,Squat,"82,5",5\n';
    // In a comma file "82,5" is a thousands-style 825, never 82.5.
    expect(ok(parseWorkoutCsv(commaFile)).sessions[0].sets[0].weightKg).toBe(825);
  });
});

describe('parseWorkoutCsv: Strong S3 (every cell quoted, units in headers)', () => {
  const result = ok(parseWorkoutCsv(STRONG_S3));
  const [morning, evening] = result.sessions;

  it('reads Duration (sec) so the workout has a length', () => {
    expect(new Date(morning.endedAt).getTime() - new Date(morning.startedAt).getTime()).toBe(3300 * 1000);
    expect(new Date(evening.endedAt).getTime() - new Date(evening.startedAt).getTime()).toBe(1800 * 1000);
  });

  it('takes weight and distance from the headers, with comma decimals', () => {
    const press = morning.sets.filter(s => s.exerciseName === 'Overhead Press (Barbell)');
    expect(press.map(s => s.weightKg)).toEqual([42.5, 42.5]);
    expect(press.map(s => s.rpe)).toEqual([7, 9]);
    const walk = morning.sets.find(s => s.exerciseName === 'Farmer Walk')!;
    expect(walk.distanceM).toBe(40);
    expect(walk.durationSeconds).toBe(30);
    expect(result.unitAssumed).toBe(false);
  });

  it('attaches a Note row to the exercise\'s first set, ahead of the set\'s own note, and does not count it as a set', () => {
    const press = morning.sets.filter(s => s.exerciseName === 'Overhead Press (Barbell)');
    expect(press).toHaveLength(2);
    expect(press[0].note).toBe('Strict, no leg drive');
    expect(press[1].note).toBe('Grindy');
    expect(morning.sets).toHaveLength(3);
  });

  it('counts a note for an exercise with no sets as left out, with the reason', () => {
    expect(result.skipped).toEqual({ restTimers: 0, emptySets: 0, badDates: 0, noExercise: 0, looseNotes: 1 });
  });

  it('reads the 12-hour date with a narrow no-break space', () => {
    expect(parts(new Date(evening.startedAt))).toEqual([2025, 0, 30, 12, 34, 56]);
  });

  it('puts a note ahead of a set\'s own note', () => {
    const csv = 'Date,Workout Name,Exercise Name,Set Order,Reps,Notes\n'
      + '2024-01-01 10:00:00,A,Squat,1,5,own\n'
      + '2024-01-01 10:00:00,A,Squat,Note,0,about squats\n';
    expect(ok(parseWorkoutCsv(csv)).sessions[0].sets[0].note).toBe('about squats\nown');
  });
});

describe('parseWorkoutCsv: Strong S4 (older semicolon)', () => {
  const result = ok(parseWorkoutCsv(STRONG_S4));

  it('reads a file with no RPE and no workout duration', () => {
    expect(result.sessions).toHaveLength(1);
    const s = result.sessions[0];
    expect(s.sets.map(x => [x.weightKg, x.reps, x.rpe])).toEqual([[100, 5, null], [100, 5, null]]);
    expect(s.endedAt).toBe(s.startedAt);
    expect(result.unitAssumed).toBe(false);
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

  it('is not unit-assuming when no set has a weight or a distance', () => {
    const csv = NO_UNIT.replace(',100,5,', ',0,5,');
    expect(ok(parseWorkoutCsv(csv)).unitAssumed).toBe(false);
  });

  it('asks about a distance even when no set has a weight', () => {
    const csv = NO_UNIT.replace(',100,5,0,', ',0,0,3,');
    expect(ok(parseWorkoutCsv(csv)).unitAssumed).toBe(true);
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
  const result = ok(parseWorkoutCsv(HEVY_KG));

  it('reads title, description and the end time of a day-first, metric export', () => {
    expect(result.source).toBe('hevy');
    expect(result.sessions).toHaveLength(2);
    const [leg, run] = result.sessions;
    expect(leg.title).toBe('Leg Day');
    expect(leg.notes).toBe('Quads, mostly');
    expect(parts(new Date(leg.startedAt))).toEqual([2024, 1, 26, 8, 0, 0]);
    expect(new Date(leg.endedAt).getTime() - new Date(leg.startedAt).getTime()).toBe(65 * 60 * 1000);
    expect(parts(new Date(run.startedAt))).toEqual([2024, 2, 3, 7, 5, 0]);
    expect(result.unitAssumed).toBe(false);
  });

  it('orders exercises by first appearance and sets by their index', () => {
    const leg = result.sessions[0];
    expect(leg.sets.map(s => s.exerciseName)).toEqual([
      'Squat (Barbell)', 'Squat (Barbell)', 'Squat (Barbell)', 'Leg Extension (Machine)', 'Lying Leg Curl (Machine)',
    ]);
    const squat = leg.sets.slice(0, 3);
    expect(squat.map(s => s.kind)).toEqual(['warmup', 'working', 'amrap']);
    expect(squat.map(s => s.reps)).toEqual([8, 5, 7]);
    expect(squat[1].weightKg).toBe(100);
    expect(squat[1].rpe).toBe(8.5);
  });

  it('keys a superset counted from zero and maps drop sets', () => {
    const [, ext, curl] = result.sessions[0].sets.slice(2);
    expect(ext.supersetKey).toBe('ss-0');
    expect(curl.supersetKey).toBe('ss-0');
    expect(curl.kind).toBe('drop');
    expect(ext.note).toBe('Slow');
  });

  it('reads kilometers and the duration', () => {
    const run = result.sessions[1].sets[0];
    expect(run.distanceM).toBe(5000);
    expect(run.durationSeconds).toBe(1800);
  });

  it('is minute-precise, since Hevy writes no seconds', () => {
    expect(result.sessions[0].startPrecisionMs).toBe(60_000);
    expect(ok(parseWorkoutCsv(STRONG_S2)).sessions[0].startPrecisionMs).toBe(1000);
  });
});

describe('parseWorkoutCsv: Hevy, imperial and month-first', () => {
  const result = ok(parseWorkoutCsv(HEVY_LB));

  it('reads 12-hour month-first dates as local wall-clock times', () => {
    const [push, run] = result.sessions;
    expect(parts(new Date(push.startedAt))).toEqual([2026, 9, 1, 20, 28, 0]);
    expect(new Date(push.endedAt).getTime() - new Date(push.startedAt).getTime()).toBe(52 * 60 * 1000);
    expect(parts(new Date(run.startedAt))).toEqual([2026, 9, 3, 7, 5, 0]);
  });

  it('converts pounds and miles', () => {
    const [push, run] = result.sessions;
    expect(push.sets.map(s => s.weightKg)).toEqual([lb(60), lb(60)]);
    expect(push.sets[1].rpe).toBe(9);
    expect(run.sets[0].distanceM).toBe(4989);
    expect(result.unitAssumed).toBe(false);
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

  it('counts each reason a row is left out and names it', () => {
    const csv = 'Date,Workout Name,Exercise Name,Set Order,Reps,Notes\n'
      + '2024-01-01 10:00:00,A,Squat,1,5,\n'
      + '2024-01-01 10:00:00,A,Squat,Rest Timer,0,\n'
      + '2024-01-01 10:00:00,A,Squat,2,0,\n'
      + '2024-01-01 10:00:00,A,,1,5,\n'
      + 'nope,A,Squat,1,5,\n'
      + '2024-01-01 10:00:00,A,Squat,Note,0,\n';
    const r = ok(parseWorkoutCsv(csv));
    expect(r.skipped).toEqual({ restTimers: 1, emptySets: 1, badDates: 1, noExercise: 1, looseNotes: 1 });
    expect(r.skippedRows).toBe(5);
    expect(describeSkipped(r.skipped)).toBe(
      '1 rest timer, 1 set with nothing recorded, 1 row with a date that couldn’t be read, '
      + '1 row with no exercise name and 1 note with no set to attach to',
    );
  });

  it('names only the reasons that occurred', () => {
    const none = { restTimers: 0, emptySets: 0, badDates: 0, noExercise: 0, looseNotes: 0 };
    expect(describeSkipped(none)).toBe('');
    expect(describeSkipped({ ...none, restTimers: 3 })).toBe('3 rest timers');
    expect(describeSkipped({ ...none, restTimers: 3, badDates: 2 })).toBe('3 rest timers and 2 rows with a date that couldn’t be read');
  });
});

describe('import identity', () => {
  // The id is hashed from the source and the file's own date text, so it is a
  // plain constant in every zone the suite runs under.
  const PINNED_ID = 'imp-strong-1146a2l61u';

  it('is the same wherever the file is read, because it comes from the date text', () => {
    expect(importSessionId('strong', '2024-01-09 18:30:12')).toBe(PINNED_ID);
    const r = ok(parseWorkoutCsv(STRONG_S1));
    expect(r.sessions[0].id).toBe(PINNED_ID);
    // Spacing and case in the text do not matter, the digits do.
    expect(importSessionId('strong', ' 2024-01-09  18:30:12 ')).toBe(PINNED_ID);
    expect(importSessionId('strong', '2024-01-09 18:30:13')).not.toBe(PINNED_ID);
    expect(importSessionId('hevy', '2024-01-09 18:30:12')).not.toBe(PINNED_ID);
  });

  it('does not change when a workout is renamed', () => {
    const renamed = STRONG_S1.replace(/Push Day, Heavy/g, 'Chest and Triceps');
    const before = ok(parseWorkoutCsv(STRONG_S1)).sessions.map(s => s.id);
    const after = ok(parseWorkoutCsv(renamed)).sessions;
    expect(after[0].title).toBe('Chest and Triceps');
    expect(after.map(s => s.id)).toEqual(before);
  });

  it('is told apart by date text, not by title', () => {
    const r = ok(parseWorkoutCsv(HEVY_KG));
    expect(r.sessions[0].id).toBe(importSessionId('hevy', '26 Feb 2024, 08:00'));
    expect(r.sessions[0].id).not.toBe(r.sessions[1].id);
  });
});

describe('names', () => {
  it('compares names as sets of words', () => {
    expect(nameWords('Bench Press (Barbell)')).toEqual(['bench', 'press', 'barbell']);
    expect(nameWords('Pull-up')).toEqual(['pull', 'up']);
    expect(nameWords('Dumbbell Curls')).toEqual(['dumbbell', 'curl']);
  });

  it('lists each distinct name once, most used first, with its counts', () => {
    const r = ok(parseWorkoutCsv(STRONG_S1));
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

  it('only suggests a one-letter typo, never decides it', () => {
    const m = matchExerciseName('Barbell bnch press', catalog);
    expect(m).toMatchObject({ kind: 'suggest', exerciseId: 'lib:barbell-bench-press' });
    expect(isAutoMatch(m)).toBe(false);
  });

  it('sends "Back Squat" to a choice, offering the back squat rather than "Hack squat"', () => {
    // One letter apart from "Hack squat" once the words are joined, which used to
    // be accepted without asking; the name holding both of its words is offered first.
    const m = matchExerciseName('Back Squat', catalog);
    expect(isAutoMatch(m)).toBe(false);
    expect(m).toMatchObject({ kind: 'suggest', exerciseId: 'lib:back-squat' });
    // The full name is the library's own.
    expect(matchExerciseName('Barbell Back Squat', catalog)).toMatchObject({ kind: 'exact', exerciseId: 'lib:back-squat' });
  });

  it('sends other variants of "Smith machine bench press" to a choice, with it preselected', () => {
    for (const name of ['Decline Bench Press (Smith Machine)', 'Pause Bench Press (Smith Machine)']) {
      const m = matchExerciseName(name, catalog);
      expect(isAutoMatch(m)).toBe(false);
      expect(m).toMatchObject({ kind: 'suggest', exerciseId: 'lib:smith-machine-bench-press' });
    }
    // The same words in another order are the same exercise.
    expect(matchExerciseName('Bench Press (Smith Machine)', catalog)).toMatchObject({ kind: 'words', exerciseId: 'lib:smith-machine-bench-press' });
  });

  it('offers a library name holding every word of a two-word name, but never decides it', () => {
    // Strong's own name for the back squat.
    const m = matchExerciseName('Squat (Barbell)', catalog);
    expect(m).toMatchObject({ kind: 'suggest', exerciseId: 'lib:back-squat' });
    expect(isAutoMatch(m)).toBe(false);
  });

  it('matches a bracketed equipment to a library name that leaves the usual equipment out', () => {
    for (const [name, id] of [
      ['Hammer Curl (Dumbbell)', 'lib:hammer-curl'],
      ['Lat Pulldown (Cable)', 'lib:lat-pulldown'],
      ['Leg Extension (Machine)', 'lib:leg-extension'],
      ['Arnold Press (Dumbbell)', 'lib:arnold-press'],
      ['Bulgarian Split Squat (Dumbbell)', 'lib:bulgarian-split-squat'],
      ['Bicep Curl (Dumbbell)', 'lib:dumbbell-curl'],
      ['Overhead Press (Dumbbell)', 'lib:dumbbell-shoulder-press'],
      ['Skullcrusher (Dumbbell)', 'lib:dumbbell-skull-crusher'],
      ['Incline Chest Fly (Dumbbell)', 'lib:incline-dumbbell-fly'],
      ['Lat Pulldown - Close Grip (Cable)', 'lib:close-grip-lat-pulldown'],
    ]) {
      const m = matchExerciseName(name, catalog);
      expect(m).toMatchObject({ kind: 'words', exerciseId: id });
    }
  });

  it('only offers the same movement on other equipment', () => {
    // "Lat pulldown" is the library's cable lift; a machine one is a choice.
    const m = matchExerciseName('Lat Pulldown (Machine)', catalog);
    expect(m).toMatchObject({ kind: 'suggest', exerciseId: 'lib:lat-pulldown' });
    expect(isAutoMatch(m)).toBe(false);
  });

  it('offers nothing for a name that is only vaguely like something', () => {
    expect(idOf('Mystery Machine')).toBeNull();
    expect(idOf('Press')).toBeNull();
    // One extra word on a three-word name is not close enough to suggest.
    expect(idOf('Barbell bench press wide')).toBeNull();
    expect(idOf('')).toBeNull();
  });

  it('matches an archived exercise only by its exact name', () => {
    expect(matchExerciseName('Zottman curl', catalog)).toMatchObject({ kind: 'exact', exerciseId: 'c2' });
    expect(idOf('Curl Zottman Extra')).toBeNull();
    expect(idOf('curl zottman')).toBeNull();
  });

  it('puts only decided matches in the auto set when matching a whole file', () => {
    const names = [
      { name: 'Pull Up', key: 'pull up', sets: 1, sessions: 1 },
      { name: 'Decline Bench Press (Smith Machine)', key: 'decline bench press (smith machine)', sets: 1, sessions: 1 },
      { name: 'Mystery Machine', key: 'mystery machine', sets: 1, sessions: 1 },
    ];
    const out = matchAll(names, [custom]);
    expect(Object.values(out).map(m => m.kind)).toEqual(['words', 'suggest', 'none']);
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
  const sessions = ok(parseWorkoutCsv(STRONG_S1)).sessions;

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
    expect(plan.sessions[0].startPrecisionMs).toBe(1000);
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

  it('adds nothing the second time: by id, and by start time under another id and title', () => {
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

    const otherIdAndTitle = existing.map(e => ({ ...e, id: 'something-else', title: 'Renamed since' }));
    expect(buildImportPlan(sessions, resolutions, otherIdAndTitle).duplicates).toBe(2);
    expect(splitDuplicates(sessions, [existing[0]])).toMatchObject({ duplicates: 1 });
  });

  it('treats a name with no decision as skipped', () => {
    expect(buildImportPlan(sessions, {}, []).sessions).toHaveLength(0);
  });
});

describe('matching a start against the log', () => {
  const at = (h: number, mi: number, s: number, ms = 0) => new Date(2026, 9, 5, h, mi, s, ms).toISOString();
  const existing = indexExisting([{ id: 'x', startedAt: at(8, 0, 30, 456) }]);

  it('compares to the second for a source that writes seconds', () => {
    expect(indexHas(existing, { id: 'new', startedAt: at(8, 0, 30), startPrecisionMs: 1000 })).toBe(true);
    expect(indexHas(existing, { id: 'new', startedAt: at(8, 0, 31), startPrecisionMs: 1000 })).toBe(false);
  });

  it('compares to the minute for a source that only writes minutes', () => {
    expect(indexHas(existing, { id: 'new', startedAt: at(8, 0, 0), startPrecisionMs: 60_000 })).toBe(true);
    expect(indexHas(existing, { id: 'new', startedAt: at(8, 1, 0), startPrecisionMs: 60_000 })).toBe(false);
  });

  it('matches an id on its own', () => {
    expect(indexHas(existing, { id: 'x', startedAt: at(12, 0, 0), startPrecisionMs: 1000 })).toBe(true);
  });
});

describe('importSummary', () => {
  it('counts workouts and sets and finds the date range', () => {
    const s = importSummary(ok(parseWorkoutCsv(STRONG_S1)).sessions);
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
    notes: 'Felt "good", slept well', effort: null, healthWorkoutId: null, healthWritePending: false, measuredOnWatch: false, timesEdited: false, ...over,
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

  it('does not double the app\'s own export: a start with milliseconds is the same workout to the second', () => {
    const started = new Date(2024, 0, 9, 18, 30, 0, 456);
    const own = session({
      id: 'mine', title: 'Push, heavy',
      startedAt: started.toISOString(), endedAt: new Date(2024, 0, 9, 19, 35, 0, 456).toISOString(),
    });
    const parsed = ok(parseWorkoutCsv(workoutExportCsv([{ session: own, sets }], exercises, 'kg')));
    const resolutions = Object.fromEntries(
      distinctExerciseNames(parsed.sessions).map(n => [n.key, { kind: 'create' as const }]),
    );
    const plan = buildImportPlan(parsed.sessions, resolutions, [own]);
    expect(plan.duplicates).toBe(1);
    expect(plan.sessions).toHaveLength(0);
    // Renamed since the export, the start still says it is the same workout.
    const renamed: WorkoutSession = { ...own, title: 'Renamed' };
    expect(buildImportPlan(parsed.sessions, resolutions, [renamed]).duplicates).toBe(1);
    // A different second is a different workout.
    const other = { ...own, startedAt: new Date(2024, 0, 9, 18, 30, 1).toISOString() };
    expect(buildImportPlan(parsed.sessions, resolutions, [other]).duplicates).toBe(0);
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
