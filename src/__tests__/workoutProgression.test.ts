import type { WorkoutRoutineItem, WorkoutSet } from '../types';
import {
  DEFAULT_TARGET_RPE,
  LINEAR_DELOAD_AFTER,
  defaultIncrementKg,
  incrementFor,
  joinAnd,
  loadAbove,
  loadBelow,
  loadContextFor,
  proposalActionLabel,
  proposalApplied,
  proposalEdits,
  proposalHeadline,
  proposeNext,
  rampSteps,
  rampWarmupsToAdd,
  roundLoad,
  sameLoad,
  schemeFor,
  suggestedTrainingMaxKg,
  trainingMaxRaises,
  waveOffset,
  workingSetLogged,
  type LoadContext,
  type ProposalInput,
} from '../utils/workoutProgression';
import { DEFAULT_PLATE_INVENTORY, weightFromDisplay } from '../utils/workoutData';
import { unitToKg } from '../utils/weightLog';

const barbell: LoadContext = { equipment: 'barbell', barKg: null, inventory: DEFAULT_PLATE_INVENTORY, unit: 'kg', incrementKg: 2.5 };
const dumbbell: LoadContext = { ...barbell, equipment: 'dumbbell' };
const lbBarbell: LoadContext = { ...barbell, unit: 'lb', incrementKg: unitToKg(5, 'lb') };

let seq = 0;
/** A done working set in session `sessionId`. */
function done(sessionId: string, setIndex: number, weightKg: number | null, reps: number | null, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  seq += 1;
  return {
    id: `set-${seq}`, sessionId, exerciseId: 'lib:barbell-bench-press', position: 0, setIndex,
    kind: 'working', weightKg, reps, durationSeconds: null, distanceM: null, rpe: null,
    completedAt: new Date(2026, 9, 1, 18, setIndex).toISOString(), supersetKey: null, note: null, ...extra,
  };
}

/** Sessions s1, s2, … one day apart, s1 the oldest. */
const sessions = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, startedAt: new Date(2026, 9, 1 + i, 18).toISOString() }));

const item = (scheme: 'double' | 'linear' | 'percent' | 'rpe', targets: WorkoutRoutineItem['targets'], incrementKg: number | null = null) =>
  ({ progression: { scheme, incrementKg }, targets });

const range = (min: number, max: number, n = 3, extra = {}) =>
  Array.from({ length: n }, () => ({ kind: 'working' as const, repsMin: min, repsMax: max, ...extra }));

function input(over: Partial<ProposalInput>): ProposalInput {
  return {
    exerciseId: 'lib:barbell-bench-press', kind: 'weight_reps', item: item('double', range(6, 8)), scheme: 'double',
    history: [], sessions: sessions(6), exceptSessionId: null, load: barbell, ...over,
  };
}

describe('increments and schemes', () => {
  it('steps by 2.5 kg, or 5 lb, unless the item says', () => {
    expect(defaultIncrementKg('kg')).toBe(2.5);
    expect(defaultIncrementKg('lb')).toBeCloseTo(unitToKg(5, 'lb'));
    expect(incrementFor({ progression: { scheme: 'linear', incrementKg: 5 } }, 'kg')).toBe(5);
    expect(incrementFor({ progression: { scheme: 'linear', incrementKg: null } }, 'kg')).toBe(2.5);
    expect(incrementFor(null, 'kg')).toBe(2.5);
  });

  it('takes the item’s scheme, else the program’s', () => {
    expect(schemeFor({ progression: { scheme: 'rpe', incrementKg: null } }, { scheme: 'linear' })).toBe('rpe');
    expect(schemeFor({ progression: null }, { scheme: 'linear' })).toBe('linear');
    expect(schemeFor(null, null)).toBeNull();
  });

  it('builds a context from the exercise and the item', () => {
    expect(loadContextFor({ equipment: 'ez_bar', barKg: 8 }, DEFAULT_PLATE_INVENTORY, 'kg', { progression: { scheme: 'double', incrementKg: 1 } }))
      .toEqual({ equipment: 'ez_bar', barKg: 8, inventory: DEFAULT_PLATE_INVENTORY, unit: 'kg', incrementKg: 1 });
  });
});

describe('roundLoad', () => {
  it('rounds a bar to what the plates make', () => {
    expect(roundLoad(83, barbell)).toBe(82.5);
    expect(roundLoad(83, barbell, 'up')).toBe(85);
    expect(roundLoad(84.9, barbell, 'down')).toBe(82.5);
    expect(roundLoad(10, barbell)).toBe(20);
  });

  it('steps a dumbbell or a machine by the increment', () => {
    expect(roundLoad(23.4, dumbbell)).toBe(22.5);
    expect(roundLoad(23.4, dumbbell, 'up')).toBe(25);
    expect(roundLoad(24.9, dumbbell, 'down')).toBe(22.5);
    expect(roundLoad(0, dumbbell)).toBe(0);
  });

  it('rounds in pounds on a pound gym’s plates', () => {
    const kg = roundLoad(unitToKg(137, 'lb'), lbBarbell);
    expect(sameLoad(kg, unitToKg(135, 'lb'), 'lb')).toBe(true);
  });

  it('finds the load just above and just below', () => {
    expect(loadAbove(82.5, barbell)).toBe(85);
    expect(loadBelow(82.5, barbell)).toBe(80);
    expect(loadAbove(20, dumbbell)).toBe(22.5);
  });
});

describe('rampSteps', () => {
  it('ramps a bar to the working weight on loadable plates', () => {
    expect(rampSteps(100, barbell)).toEqual([{ kg: 40, reps: 8 }, { kg: 60, reps: 5 }, { kg: 80, reps: 3 }]);
  });

  it('ramps a dumbbell by its increment, lighter each time than the work', () => {
    expect(rampSteps(30, dumbbell)).toEqual([{ kg: 12.5, reps: 8 }, { kg: 17.5, reps: 5 }, { kg: 25, reps: 3 }]);
    expect(rampSteps(2.5, dumbbell)).toEqual([]);
  });

  it('lays out nothing with no working weight', () => {
    expect(rampSteps(null, barbell)).toEqual([]);
    expect(rampSteps(20, barbell)).toEqual([]);
  });
});

describe('proposeNext, rep range (double)', () => {
  it('adds the increment once every set reached the top of the range', () => {
    const history = [done('s5', 0, 80, 8), done('s5', 1, 80, 8), done('s5', 2, 80, 8)];
    const p = proposeNext(input({ history }))!;
    expect(p).toMatchObject({ move: 'up', repsMin: 6, repsMax: 8, lastKg: 80 });
    expect(p.sets).toEqual([0, 1, 2].map(() => ({ kind: 'working', weightKg: 82.5, reps: 6 })));
    expect(p.reason).toBe('Up 2.5 kg because every set last time reached 8.');
    expect(proposalHeadline(p, 'kg')).toBe('Today 3 × 6–8 at 82.5 kg.');
    expect(proposalActionLabel(p, 'kg')).toBe('Use 82.5 kg');
  });

  it('keeps the weight and aims for more reps until then', () => {
    const history = [done('s5', 0, 80, 8), done('s5', 1, 80, 7), done('s5', 2, 80, 6)];
    const p = proposeNext(input({ history }))!;
    expect(p.move).toBe('same');
    expect(p.sets.every(s => s.weightKg === 80 && s.reps === 8)).toBe(true);
    expect(p.reason).toBe('Same weight. Last time reached 8, 7 and 6, so aim for 8 on every set before adding weight.');
  });

  it('counts a set skipped last time as short of the top', () => {
    const history = [done('s5', 0, 80, 8), done('s5', 1, 80, 8)];
    expect(proposeNext(input({ history }))!.move).toBe('same');
  });

  it('reads only the newest earlier session, and never the live one', () => {
    const history = [
      done('s4', 0, 75, 8), done('s4', 1, 75, 8), done('s4', 2, 75, 8),
      done('s5', 0, 77.5, 6), done('s5', 1, 77.5, 6), done('s5', 2, 77.5, 6),
      done('s6', 0, 80, 8), done('s6', 1, 80, 8), done('s6', 2, 80, 8),
    ];
    expect(proposeNext(input({ history, exceptSessionId: 's6' }))!).toMatchObject({ move: 'same', lastKg: 77.5 });
  });

  it('ignores warm-ups, drop sets and planned sets', () => {
    const history = [
      done('s5', 0, 40, 10, { kind: 'warmup' }),
      done('s5', 1, 80, 8), done('s5', 2, 80, 8), done('s5', 3, 80, 8),
      done('s5', 4, 60, 3, { kind: 'drop' }),
      done('s5', 5, 80, 2, { completedAt: null }),
    ];
    expect(proposeNext(input({ history }))!.move).toBe('up');
  });

  it('steps a dumbbell by the increment from wherever it was', () => {
    const history = [done('s5', 0, 22, 12), done('s5', 1, 22, 12)];
    const p = proposeNext(input({ history, item: item('double', range(10, 12, 2)), load: dumbbell }))!;
    expect(p.sets[0].weightKg).toBe(24.5);
  });

  it('never proposes the same load as an increase when the plates can’t make the step', () => {
    const history = [done('s5', 0, 80, 8), done('s5', 1, 80, 8), done('s5', 2, 80, 8)];
    const p = proposeNext(input({ history, item: item('double', range(6, 8), 1) }))!;
    expect(p.sets[0].weightKg).toBe(82.5);
    expect(p.reason).toBe('Up 2.5 kg because every set last time reached 8.');
  });

  it('proposes in pounds for a pound lifter', () => {
    const w = unitToKg(135, 'lb');
    const history = [done('s5', 0, w, 8), done('s5', 1, w, 8), done('s5', 2, w, 8)];
    const p = proposeNext(input({ history, load: lbBarbell }))!;
    expect(sameLoad(p.sets[0].weightKg, unitToKg(140, 'lb'), 'lb')).toBe(true);
    expect(p.reason).toBe('Up 5 lb because every set last time reached 8.');
    expect(proposalActionLabel(p, 'lb')).toBe('Use 140 lb');
  });

  it('has nothing to say without history, a scheme, a range or a load', () => {
    expect(proposeNext(input({ history: [] }))).toBeNull();
    expect(proposeNext(input({ history: [done('s5', 0, 80, 8)], scheme: null }))).toBeNull();
    expect(proposeNext(input({ history: [done('s5', 0, null, 8)] }))).toBeNull();
    expect(proposeNext(input({ history: [done('s5', 0, 80, 8)], kind: 'bodyweight_reps' }))).toBeNull();
    expect(proposeNext(input({ history: [done('s5', 0, 80, 8)], item: item('double', [{ kind: 'working', repsMin: null, repsMax: null }]) }))).toBeNull();
  });

  it('needs the routine’s rep range for a rep range scheme', () => {
    const history = [done('s5', 0, 80, 8), done('s5', 1, 80, 8)];
    expect(proposeNext(input({ history, item: null }))).toBeNull();
  });
});

describe('proposeNext, linear', () => {
  const lin = item('linear', range(5, 5, 3));
  const day = (id: string, kg: number, reps: [number, number, number]) => reps.map((r, i) => done(id, i, kg, r));

  it('adds the increment after every set hit its reps', () => {
    const p = proposeNext(input({ scheme: 'linear', item: lin, history: day('s5', 100, [5, 5, 5]) }))!;
    expect(p).toMatchObject({ move: 'up', repsMin: 5, repsMax: 5 });
    expect(p.sets[0]).toEqual({ kind: 'working', weightKg: 102.5, reps: 5 });
    expect(proposalHeadline(p, 'kg')).toBe('Today 3 × 5 at 102.5 kg.');
  });

  it('keeps the weight after a short workout', () => {
    const p = proposeNext(input({ scheme: 'linear', item: lin, history: day('s5', 100, [5, 5, 4]) }))!;
    expect(p.move).toBe('same');
    expect(p.sets[0].weightKg).toBe(100);
    expect(p.reason).toBe(`Same weight, because a set last time fell short of 5. After ${LINEAR_DELOAD_AFTER} short workouts in a row, the suggestion goes down to the closest load at or under 90% of this weight.`);
  });

  it('proposes about 10% less after three short workouts in a row at one weight', () => {
    const history = [...day('s3', 100, [5, 5, 4]), ...day('s4', 100, [5, 4, 4]), ...day('s5', 100, [4, 4, 3])];
    const p = proposeNext(input({ scheme: 'linear', item: lin, history }))!;
    expect(p.move).toBe('deload');
    expect(p.sets[0].weightKg).toBe(90);
    expect(p.reason).toBe('Down 10 kg after 3 workouts in a row short of 5 reps at 100 kg.');
  });

  it('counts only the misses at the same weight', () => {
    const history = [...day('s3', 97.5, [5, 5, 4]), ...day('s4', 100, [5, 4, 4]), ...day('s5', 100, [4, 4, 3])];
    expect(proposeNext(input({ scheme: 'linear', item: lin, history }))!.move).toBe('same');
  });

  it('starts the count again after a success', () => {
    const history = [...day('s2', 100, [4, 4, 4]), ...day('s3', 100, [5, 5, 5]), ...day('s4', 100, [5, 4, 4]), ...day('s5', 100, [4, 4, 3])];
    expect(proposeNext(input({ scheme: 'linear', item: lin, history }))!.move).toBe('same');
  });

  it('deloads a dumbbell to a step of its increment', () => {
    const history = [...day('s3', 30, [5, 5, 4]), ...day('s4', 30, [5, 4, 4]), ...day('s5', 30, [4, 4, 3])];
    const p = proposeNext(input({ scheme: 'linear', item: lin, history, load: dumbbell }))!;
    expect(p.sets[0].weightKg).toBe(25);
    // The reason states the change that was made, not "about 10%" of it.
    expect(p.reason).toBe('Down 5 kg after 3 workouts in a row short of 5 reps at 30 kg.');
  });

  it('rounds a light dumbbell down to the nearest load at or under 90%, not a whole step', () => {
    const history = [...day('s3', 10, [5, 5, 4]), ...day('s4', 10, [5, 4, 4]), ...day('s5', 10, [4, 4, 3])];
    const p = proposeNext(input({ scheme: 'linear', item: lin, history, load: dumbbell }))!;
    expect(p).toMatchObject({ move: 'deload' });
    expect(p.sets[0].weightKg).toBe(7.5);
    expect(p.reason).toBe('Down 2.5 kg after 3 workouts in a row short of 5 reps at 10 kg.');
  });

  it('stays put at the bare bar, where nothing lighter can be loaded, and says so', () => {
    const history = [...day('s3', 20, [5, 5, 4]), ...day('s4', 20, [5, 4, 4]), ...day('s5', 20, [4, 4, 3])];
    const p = proposeNext(input({ scheme: 'linear', item: lin, history }))!;
    expect(p.move).toBe('same');
    expect(p.sets[0].weightKg).toBe(20);
    expect(p.reason).toBe('Same weight. 20 kg is already the lightest load, so there is nothing lighter to go down to after 3 workouts short of 5 reps.');
    expect(p.reason).not.toMatch(/Down 0/);
  });

  it('never deloads a dumbbell to nothing', () => {
    const history = [...day('s3', 2.5, [5, 5, 4]), ...day('s4', 2.5, [5, 4, 4]), ...day('s5', 2.5, [4, 4, 3])];
    const p = proposeNext(input({ scheme: 'linear', item: lin, history, load: dumbbell }))!;
    expect(p.move).toBe('same');
    expect(p.sets[0].weightKg).toBe(2.5);
  });
});

describe('proposeNext, RPE', () => {
  const rpeItem = (rpe?: number) => item('rpe', range(5, 5, 3, rpe ? { rpe } : {}));
  const day = (rpes: (number | null)[], kg = 100) => rpes.map((r, i) => done('s5', i, kg, 5, { rpe: r }));

  it('adds load for a top set that felt easier than planned', () => {
    const p = proposeNext(input({ scheme: 'rpe', item: rpeItem(8), history: day([6, 6, 6]) }))!;
    expect(p.move).toBe('up');
    expect(p.sets[0].weightKg).toBe(105);
    expect(p.reason).toBe('Up 5 kg because the top set last time was RPE 6, under the 8 planned.');
  });

  it('takes load off for one that felt harder', () => {
    const p = proposeNext(input({ scheme: 'rpe', item: rpeItem(7), history: day([8, 8.5, 9]) }))!;
    expect(p.move).toBe('down');
    expect(p.sets[0].weightKg).toBe(95);
    expect(p.reason).toBe('Down 5 kg because the top set last time was RPE 9, over the 7 planned.');
  });

  it('keeps it within a point of the plan, and moves at least one step outside it', () => {
    expect(proposeNext(input({ scheme: 'rpe', item: rpeItem(8), history: day([8, 8, 8.5]) }))!.move).toBe('same');
    const p = proposeNext(input({ scheme: 'rpe', item: rpeItem(8), history: day([7, 7, 7], 40) }))!;
    expect(p.sets[0].weightKg).toBe(42.5);
  });

  it('never proposes nothing for a light dumbbell that felt too hard', () => {
    const p = proposeNext(input({ scheme: 'rpe', item: rpeItem(7), history: day([10, 10, 10], 2.5), load: dumbbell }))!;
    expect(p.sets[0].weightKg).toBeGreaterThan(0);
    expect(p.move).toBe('same');
    expect(p.sets[0].weightKg).toBe(2.5);
    const heavier = proposeNext(input({ scheme: 'rpe', item: rpeItem(7), history: day([10, 10, 10], 5), load: dumbbell }))!;
    expect(heavier.move).toBe('down');
    expect(heavier.sets[0].weightKg).toBe(2.5);
  });

  it('aims for RPE 8 when the targets don’t say, and asks for a rating when there is none', () => {
    expect(proposeNext(input({ scheme: 'rpe', item: rpeItem(), history: day([8, 8, 8]) }))!.move).toBe('same');
    expect(DEFAULT_TARGET_RPE).toBe(8);
    const p = proposeNext(input({ scheme: 'rpe', item: rpeItem(), history: day([null, null, null]) }))!;
    expect(p.move).toBe('same');
    expect(p.reason).toContain('Rate how hard the top set felt');
  });
});

describe('proposeNext, percent of a training max', () => {
  const wave: WorkoutRoutineItem['targets'] = [
    { kind: 'working', repsMin: 5, repsMax: 5, pctOfTm: 65 },
    { kind: 'working', repsMin: 5, repsMax: 5, pctOfTm: 75 },
    { kind: 'amrap', repsMin: 5, repsMax: 5, pctOfTm: 85 },
  ];

  it('reads each set off the training max, without needing history', () => {
    const p = proposeNext(input({ scheme: 'percent', item: item('percent', wave), trainingMaxKg: 100, week: { week: 1, weeks: 4 } }))!;
    expect(p.move).toBe('percent');
    expect(p.sets).toEqual([
      { kind: 'working', weightKg: 65, reps: 5 }, { kind: 'working', weightKg: 75, reps: 5 }, { kind: 'amrap', weightKg: 85, reps: 5 },
    ]);
    expect(p.reason).toBe('Week 1 of 4: 65%, 75% and 85% of a 100 kg training max.');
    expect(proposalHeadline(p, 'kg')).toBe('Today 3 × 5 at 65, 75 and 85 kg.');
    expect(proposalActionLabel(p, 'kg')).toBe('Use these weights');
  });

  it('climbs through the weeks and eases off in the last of four, on loadable weights', () => {
    const week = (w: number) => proposeNext(input({ scheme: 'percent', item: item('percent', wave), trainingMaxKg: 102.5, week: { week: w, weeks: 4 } }))!;
    expect(week(2).sets.map(s => s.weightKg)).toEqual([72.5, 82.5, 92.5]);
    expect(week(4).sets.map(s => s.weightKg)).toEqual([57.5, 67.5, 77.5]);
    expect(week(4).reason).toBe('Week 4 of 4: 55%, 65% and 75% of a 102.5 kg training max.');
  });

  it('says what is missing without a training max', () => {
    const p = proposeNext(input({ scheme: 'percent', item: item('percent', wave), trainingMaxKg: null }))!;
    expect(p).toMatchObject({ move: 'none', sets: [] });
    expect(p.reason).toBe('No training max for this exercise yet. Set one in the program to see the weights.');
    expect(proposalHeadline(p, 'kg')).toBeNull();
  });

  it('fills in a wave for targets that name no percentage', () => {
    const p = proposeNext(input({ scheme: 'percent', item: item('percent', range(5, 5, 3)), trainingMaxKg: 100 }))!;
    expect(p.sets.map(s => s.weightKg)).toEqual([65, 75, 85]);
    expect(p.reason).toBe('65%, 75% and 85% of a 100 kg training max.');
  });
});

describe('waveOffset', () => {
  it('climbs 5 points a week, eases off in the last of four, and has no wave without a length', () => {
    expect([1, 2, 3, 4].map(w => waveOffset(w, 4))).toEqual([0, 5, 10, -10]);
    expect([1, 2, 3].map(w => waveOffset(w, 3))).toEqual([0, 5, 10]);
    expect([4, 5, 6].map(w => waveOffset(w, 6))).toEqual([0, 5, -10]);
    expect(waveOffset(3, null)).toBe(0);
  });
});

describe('applying a proposal', () => {
  const planned = (id: string, kind: WorkoutSet['kind'], weightKg: number | null, reps: number | null, isDone = false) =>
    ({ ...done('live', 0, weightKg, reps, { kind, completedAt: isDone ? new Date(2026, 9, 9, 18).toISOString() : null }), id, sessionId: 'live' });
  const history = [done('s5', 0, 80, 8), done('s5', 1, 80, 8), done('s5', 2, 80, 8)];
  const p = proposeNext(input({ history }))!;

  it('writes the proposal onto the planned working sets, and the ramp onto the planned warm-ups', () => {
    const sets = [planned('w1', 'warmup', 40, 8), planned('a', 'working', 80, 8), planned('b', 'working', 80, 8), planned('c', 'working', 80, 8)];
    const ramp = rampSteps(82.5, barbell);
    expect(proposalEdits(sets, p, ramp)).toEqual([
      { setId: 'a', weightKg: 82.5, reps: 6 }, { setId: 'b', weightKg: 82.5, reps: 6 }, { setId: 'c', weightKg: 82.5, reps: 6 },
      { setId: 'w1', weightKg: 32.5, reps: 8 },
    ]);
    expect(proposalEdits(sets, p)).toHaveLength(3);
  });

  it('gives each planned warm-up the ramp step at its place among all the warm-ups, done ones included', () => {
    // Laid out for 100 kg (40, 60, 80), the 40 done, then "Use 105 kg".
    const sets = [
      planned('w1', 'warmup', 40, 8, true), planned('w2', 'warmup', 60, 5), planned('w3', 'warmup', 80, 3),
      planned('a', 'working', 100, 5),
    ];
    const ramp = rampSteps(105, barbell);
    expect(ramp.map(r => r.kg)).toEqual([42.5, 62.5, 85]);
    const edits = proposalEdits(sets, p, ramp);
    expect(edits.filter(e => e.setId.startsWith('w'))).toEqual([
      { setId: 'w2', weightKg: 62.5, reps: 5 }, { setId: 'w3', weightKg: 85, reps: 3 },
    ]);
  });

  it('adds the ramp when an exercise that ramps has no warm-up row at all', () => {
    const ramp = rampSteps(100, barbell);
    expect(rampWarmupsToAdd([planned('a', 'working', null, 5)], ramp)).toEqual(ramp);
    expect(rampWarmupsToAdd([planned('w1', 'warmup', 40, 8), planned('a', 'working', 100, 5)], ramp)).toEqual([]);
    expect(rampWarmupsToAdd([planned('w1', 'warmup', 40, 8, true), planned('a', 'working', 100, 5)], ramp)).toEqual([]);
    expect(rampWarmupsToAdd([planned('a', 'working', null, 5)], null)).toEqual([]);
    expect(rampWarmupsToAdd([planned('a', 'working', null, 5)], [])).toEqual([]);
  });

  it('never touches a done set', () => {
    const sets = [planned('a', 'working', 80, 8, true), planned('b', 'working', 80, 8)];
    expect(proposalEdits(sets, p)).toEqual([{ setId: 'b', weightKg: 82.5, reps: 6 }]);
  });

  it('knows when it is already in the plan, and when a working set is logged', () => {
    const before = [planned('a', 'working', 80, 8), planned('b', 'working', 80, 8)];
    const after = [planned('a', 'working', 82.5, 6), planned('b', 'working', 82.5, 6)];
    expect(proposalApplied(before, p, 'kg')).toBe(false);
    expect(proposalApplied(after, p, 'kg')).toBe(true);
    expect(workingSetLogged(before)).toBe(false);
    expect(workingSetLogged([planned('w', 'warmup', 40, 8, true), ...before])).toBe(false);
    expect(workingSetLogged([planned('a', 'working', 80, 8, true)])).toBe(true);
  });
});

describe('training maxes', () => {
  const muscles = (id: string) => (id === 'lib:back-squat' ? ['quads' as const, 'glutes' as const] : ['chest' as const]);

  it('raises a lower-body max twice as much as an upper-body one', () => {
    const program = { trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 140 }, { exerciseId: 'lib:barbell-bench-press', kg: 100 }] };
    expect(trainingMaxRaises(program, muscles, 'kg')).toEqual([
      { exerciseId: 'lib:back-squat', fromKg: 140, toKg: 145 },
      { exerciseId: 'lib:barbell-bench-press', fromKg: 100, toKg: 102.5 },
    ]);
    const lb = trainingMaxRaises(program, muscles, 'lb');
    expect(sameLoad(lb[0].toKg - lb[0].fromKg, unitToKg(10, 'lb'), 'lb')).toBe(true);
  });

  it('proposes a starting max of 90% of the best estimated 1RM, rounded down', () => {
    expect(suggestedTrainingMaxKg(118, 'kg')).toBe(105);
    expect(suggestedTrainingMaxKg(weightFromDisplay(300, 'lb'), 'lb')).toBe(weightFromDisplay(270, 'lb'));
    expect(suggestedTrainingMaxKg(null, 'kg')).toBeNull();
  });
});

describe('joinAnd', () => {
  it('lists with commas and a final and', () => {
    expect(joinAnd([])).toBe('');
    expect(joinAnd(['8'])).toBe('8');
    expect(joinAnd(['8', '7'])).toBe('8 and 7');
    expect(joinAnd(['8', '7', '6'])).toBe('8, 7 and 6');
  });
});
