import type { Exercise, Gym, GymExerciseSetting, WorkoutRoutine } from '../types';
import {
  describeRoutineFit, equipmentAvailable, exerciseIdsDoneAt, gymAt, gymExerciseId, gymSettingFor, gymSwapCandidates,
  describeGymSetting, describeLastLoad, gymIncrementKg, gymsUsedBy, isEmptyGymSetting, setsAtGym, lastUsedGymId, startingGymId, routineFit, unavailableExerciseIds, withGymBar,
} from '../utils/gyms';
import { EXERCISE_LIBRARY } from '../utils/exerciseLibrary';

const gym = (over: Partial<Gym> = {}): Gym => ({
  id: 'g1', name: 'Planet', equipment: ['dumbbell', 'machine', 'cable'], placeText: '', latitude: 40, longitude: -74,
  radiusM: 150, sortOrder: 1, archived: false, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const none: Exercise[] = [];
const byEquipment = (e: string) => EXERCISE_LIBRARY.find(x => x.equipment === e)!.id;
const routine = (ids: string[]): Pick<WorkoutRoutine, 'items'> => ({
  items: ids.map(exerciseId => ({ exerciseId, restSeconds: null, progression: null, targets: [] })),
});

describe('equipmentAvailable', () => {
  it('says yes with no gym, or a gym nobody has listed equipment for', () => {
    expect(equipmentAvailable(null, 'barbell')).toBe(true);
    expect(equipmentAvailable(gym({ equipment: [] }), 'barbell')).toBe(true);
  });
  it('never blocks bodyweight or other', () => {
    expect(equipmentAvailable(gym(), 'bodyweight')).toBe(true);
    expect(equipmentAvailable(gym(), 'other')).toBe(true);
  });
  it('blocks what a listed gym lacks', () => {
    expect(equipmentAvailable(gym(), 'barbell')).toBe(false);
    expect(equipmentAvailable(gym(), 'cable')).toBe(true);
  });
});

describe('equipmentAvailable with specific machines', () => {
  it('blocks a machine the gym did not tick, and allows the one it did', () => {
    const g = gym({ equipment: ['leg_press', 'treadmill'] });
    expect(equipmentAvailable(g, 'leg_press')).toBe(true);
    expect(equipmentAvailable(g, 'leg_curl')).toBe(false);
    expect(equipmentAvailable(g, 'treadmill')).toBe(true);
    expect(equipmentAvailable(g, 'rowing_machine')).toBe(false);
    expect(equipmentAvailable(g, 'machine')).toBe(false);
  });
  it('reads a gym that ticked Machine or Cardio machine before as having every one of them', () => {
    const g = gym({ equipment: ['machine', 'cardio_machine'] });
    expect(equipmentAvailable(g, 'leg_press')).toBe(true);
    expect(equipmentAvailable(g, 'pec_deck')).toBe(true);
    expect(equipmentAvailable(g, 'treadmill')).toBe(true);
    expect(equipmentAvailable(gym({ equipment: ['machine'] }), 'treadmill')).toBe(false);
  });
  it('names the missing machine in the routine fit', () => {
    const legPress = EXERCISE_LIBRARY.find(e => e.equipment === 'leg_press')!.id;
    const g = gym({ equipment: ['dumbbell'] });
    expect(describeRoutineFit(routineFit(g, routine([legPress]), none), 'Planet')).toBe("No leg press at Planet. 1 of 1 exercise can’t be done.");
  });
});

describe('unavailableExerciseIds and routineFit', () => {
  const barbell = byEquipment('barbell');
  const cable = byEquipment('cable');
  it('lists only the exercises the gym cannot do, in order', () => {
    expect(unavailableExerciseIds(gym(), none, [cable, barbell])).toEqual([barbell]);
    expect(unavailableExerciseIds(null, none, [barbell])).toEqual([]);
  });
  it('leaves an id the catalog does not know alone', () => {
    expect(unavailableExerciseIds(gym(), none, ['missing'])).toEqual([]);
  });
  it('describes the fit in the three cases', () => {
    expect(describeRoutineFit(routineFit(gym(), routine([cable]), none), 'Planet')).toBeNull();
    expect(describeRoutineFit(routineFit(gym(), routine([cable, barbell]), none), 'Planet')).toBe("No barbell at Planet. 1 of 2 exercises can’t be done.");
    expect(describeRoutineFit(routineFit(gym(), routine([barbell]), none), 'Planet')).toBe("No barbell at Planet. 1 of 1 exercise can’t be done.");
  });
  it('lists several missing pieces of equipment with "or"', () => {
    const fit = routineFit(gym(), routine([barbell, byEquipment('dip_bars')]), none);
    expect(describeRoutineFit(fit, 'Planet')).toBe("No barbell or dip bars at Planet. 2 of 2 exercises can’t be done.");
  });
});

describe('gymSwapCandidates', () => {
  const bench = EXERCISE_LIBRARY.find(e => e.equipment === 'barbell' && e.primaryMuscles.includes('chest'))!.id;
  it('offers only equipment the gym has, sharing a primary muscle', () => {
    const ids = gymSwapCandidates(none, bench, gym());
    expect(ids.length).toBeGreaterThan(0);
    const ex = (id: string) => EXERCISE_LIBRARY.find(e => e.id === id)!;
    for (const id of ids) {
      expect(equipmentAvailable(gym(), ex(id).equipment)).toBe(true);
      expect(ex(id).primaryMuscles).toContain('chest');
    }
  });
  it('puts an exercise done at this gym ahead of one with the same muscles', () => {
    const base = gymSwapCandidates(none, bench, gym());
    const last = base[base.length - 1];
    const ranked = gymSwapCandidates(none, bench, gym(), [], new Set([last]));
    const sharedOf = (id: string) => EXERCISE_LIBRARY.find(e => e.id === id)!.primaryMuscles.filter(m => m === 'chest').length;
    expect(ranked.indexOf(last)).toBeLessThanOrEqual(base.indexOf(last));
    expect(sharedOf(ranked[0])).toBeGreaterThan(0);
  });
  it('offers a bodyweight exercise for a weighted one and the reverse, when the gym allows it', () => {
    const home = gym({ equipment: ['dumbbell'] });
    const named = (name: string) => EXERCISE_LIBRARY.find(e => e.name === name)!.id;
    const goblet = named('Goblet squat');
    const bodyweight = named('Bodyweight squat');
    expect(gymSwapCandidates(none, goblet, home)).toContain(bodyweight);
    expect(gymSwapCandidates(none, bodyweight, home)).toContain(goblet);
    expect(gymSwapCandidates(none, bodyweight, gym({ equipment: ['cable'] }))).not.toContain(goblet);
  });
  it('does not offer gear a bands-only gym was never told it has', () => {
    const bands = gym({ equipment: ['band'] });
    const named = (name: string) => EXERCISE_LIBRARY.find(e => e.name === name)!.id;
    const ids = gymSwapCandidates(none, named('Barbell bench press'), bands);
    expect(ids).not.toContain(named('Weighted dip'));
    expect(ids).not.toContain(named('Chest dip'));
    expect(gymSwapCandidates(none, named('Lat pulldown'), bands)).not.toContain(named('Medicine ball slam'));
    expect(gymSwapCandidates(none, named('Barbell row'), bands)).not.toContain(named('Pull-up'));
    const home = gym({ equipment: ['band'] });
    for (const name of ['Sled push', 'Battle ropes', 'Jump rope', 'Ab wheel rollout']) {
      expect(equipmentAvailable(home, EXERCISE_LIBRARY.find(e => e.name === name)!.equipment)).toBe(false);
    }
    // Ticking the gear brings them back, and a gym that was never asked still allows them.
    expect(gymSwapCandidates(none, named('Barbell bench press'), gym({ equipment: ['band', 'dip_bars'] }))).toContain(named('Chest dip'));
    expect(gymSwapCandidates(none, named('Barbell bench press'), gym({ equipment: [] }))).toContain(named('Chest dip'));
  });
  it('never crosses to a timed or distance exercise', () => {
    const kinds = gymSwapCandidates(none, EXERCISE_LIBRARY.find(e => e.name === 'Goblet squat')!.id, gym()).map(id => EXERCISE_LIBRARY.find(e => e.id === id)!.kind);
    expect(kinds.every(k => k === 'weight_reps' || k === 'bodyweight_reps')).toBe(true);
  });
  it('skips what the workout already has', () => {
    const base = gymSwapCandidates(none, bench, gym());
    expect(gymSwapCandidates(none, bench, gym(), [base[0]])).not.toContain(base[0]);
  });
});

describe('gymAt', () => {
  const fix = (latitude: number, longitude: number, accuracyM: number | null = 20) => ({ latitude, longitude, accuracyM });
  it('matches the gym a fix is inside', () => {
    expect(gymAt([gym()], fix(40, -74))?.id).toBe('g1');
  });
  it('picks the nearest of two', () => {
    const near = gym({ id: 'near', latitude: 40.0003 });
    expect(gymAt([gym({ latitude: 40.001 }), near], fix(40.0002, -74))?.id).toBe('near');
  });
  it('refuses a fix with no accuracy, a coarse one, or one outside the radius', () => {
    expect(gymAt([gym()], fix(40, -74, null))).toBeNull();
    expect(gymAt([gym()], fix(40, -74, 500))).toBeNull();
    expect(gymAt([gym()], fix(40.01, -74))).toBeNull();
    expect(gymAt([gym()], null)).toBeNull();
  });
  it('ignores archived gyms and gyms with no pin', () => {
    expect(gymAt([gym({ archived: true })], fix(40, -74))).toBeNull();
    expect(gymAt([gym({ latitude: null, longitude: null })], fix(40, -74))).toBeNull();
  });
});

describe('settings', () => {
  const s: GymExerciseSetting = { id: gymExerciseId('g1', 'e1'), gymId: 'g1', exerciseId: 'e1', notes: 'Seat 4', barKg: null, incrementKg: null };
  it('finds a setting by the pair and treats an all-empty one as empty', () => {
    expect(gymSettingFor([s], 'g1', 'e1')).toBe(s);
    expect(gymSettingFor([s], 'g2', 'e1')).toBeNull();
    expect(gymSettingFor([s], null, 'e1')).toBeNull();
    expect(isEmptyGymSetting({ notes: '  ', barKg: null, incrementKg: null })).toBe(true);
    expect(isEmptyGymSetting({ notes: '', barKg: 15, incrementKg: null })).toBe(false);
  });
  it('replaces a bar only where the gym names one', () => {
    expect(withGymBar({ barKg: 20 }, { barKg: 15 })).toEqual({ barKg: 15 });
    expect(withGymBar({ barKg: 20 }, { barKg: null })).toEqual({ barKg: 20 });
    expect(withGymBar({ barKg: null }, null)).toEqual({ barKg: null });
  });
  it('reads which exercises were done at a gym from finished sets only', () => {
    const sessions = [{ id: 's1', gymId: 'g1' }, { id: 's2', gymId: 'g2' }];
    const sets = [
      { sessionId: 's1', exerciseId: 'a', completedAt: 'x' },
      { sessionId: 's1', exerciseId: 'b', completedAt: null },
      { sessionId: 's2', exerciseId: 'c', completedAt: 'x' },
    ];
    expect([...exerciseIdsDoneAt('g1', sessions, sets)]).toEqual(['a']);
    expect(exerciseIdsDoneAt(null, sessions, sets).size).toBe(0);
  });
});

describe('lastUsedGymId', () => {
  const gyms = [gym({ id: 'a' }), gym({ id: 'b' }), gym({ id: 'c', archived: true })];
  it('is the gym of the newest session that had one', () => {
    expect(lastUsedGymId(gyms, [
      { gymId: 'a', startedAt: '2026-01-01' }, { gymId: 'b', startedAt: '2026-02-01' }, { gymId: null, startedAt: '2026-03-01' },
    ])).toBe('b');
  });
  it('skips an archived or deleted gym, and is null when nobody used one', () => {
    expect(lastUsedGymId(gyms, [{ gymId: 'c', startedAt: '2026-03-01' }, { gymId: 'gone', startedAt: '2026-04-01' }])).toBeNull();
    expect(lastUsedGymId(gyms, [{ startedAt: '2026-03-01' }])).toBeNull();
  });
});

describe('startingGymId', () => {
  const gyms = [gym({ id: 'a' }), gym({ id: 'b' }), gym({ id: 'c', archived: true })];
  const sessions = [{ gymId: 'a', startedAt: '2026-01-01' }];
  it('is the default gym over the one last used', () => {
    expect(startingGymId('b', gyms, sessions)).toBe('b');
  });
  it('falls back to the last used gym with no default, or one archived or deleted', () => {
    expect(startingGymId(null, gyms, sessions)).toBe('a');
    expect(startingGymId('c', gyms, sessions)).toBe('a');
    expect(startingGymId('gone', gyms, sessions)).toBe('a');
  });
});

describe('describeLastLoad', () => {
  it('reads the heaviest working set, skipping warm-ups and sets with no load', () => {
    expect(describeLastLoad([
      { kind: 'warmup', weightKg: 140, reps: 3 }, { kind: 'working', weightKg: 100, reps: 5 },
      { kind: 'working', weightKg: 90, reps: 8 }, { kind: 'working', weightKg: null, reps: 8 },
    ], 'kg')).toBe('last 100 kg × 5');
  });
  it('is null with nothing to read', () => {
    expect(describeLastLoad([], 'kg')).toBeNull();
    expect(describeLastLoad([{ kind: 'working', weightKg: null, reps: 10 }], 'kg')).toBeNull();
  });
});

describe('load step and history by gym', () => {
  it('reads a gym load step only when it names a positive one', () => {
    expect(gymIncrementKg({ incrementKg: 2 })).toBe(2);
    expect(gymIncrementKg({ incrementKg: null })).toBeNull();
    expect(gymIncrementKg(null)).toBeNull();
    expect(isEmptyGymSetting({ notes: '', barKg: null, incrementKg: 2 })).toBe(false);
  });
  const sessions = [{ id: 's1', gymId: 'a' }, { id: 's2', gymId: 'b' }, { id: 's3', gymId: null }, { id: 's4' }];
  const sets = ['s1', 's2', 's3', 's4', 's1'].map((sessionId, i) => ({ sessionId, i }));
  it('filters sets to one gym, and keeps all of them for none', () => {
    expect(setsAtGym(sets, sessions, 'a').map(s => s.i)).toEqual([0, 4]);
    expect(setsAtGym(sets, sessions, null)).toHaveLength(5);
  });
  it('lists the gyms sets were done at, in the gyms\' order', () => {
    const gyms = [gym({ id: 'b' }), gym({ id: 'a' }), gym({ id: 'c' })];
    expect(gymsUsedBy(sets, sessions, gyms).map(g => g.id)).toEqual(['b', 'a']);
  });
});

describe('describeGymSetting', () => {
  it('joins the first line of the note, the bar and the step', () => {
    expect(describeGymSetting({ notes: 'Seat 4\nsecond line', barKg: 15, incrementKg: 2 }, 'kg')).toBe('Seat 4 · bar 15 kg · step 2 kg');
    expect(describeGymSetting({ notes: '', barKg: null, incrementKg: 5 }, 'kg')).toBe('step 5 kg');
  });
  it('is null for nothing', () => {
    expect(describeGymSetting(null, 'kg')).toBeNull();
    expect(describeGymSetting({ notes: ' ', barKg: null, incrementKg: null }, 'kg')).toBeNull();
  });
});
