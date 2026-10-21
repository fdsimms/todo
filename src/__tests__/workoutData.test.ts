import {
  DEFAULT_PLATE_INVENTORY, DEFAULT_REST_SECONDS, REST_SECONDS_MAX, REST_SECONDS_MIN, WORKOUT_NAME_MAX_LENGTH,
  clampRestSeconds, cleanWorkoutName, exerciseNameKey, freeWorkoutName, normalizePlateInventory, parsePlateInventory, parseRestSeconds,
  readEquipment, readExerciseKind, readIdList, readMuscles, readRoutineItems, readProgramScheme, readScheme, readSetKind, readTrainingMaxes,
  EQUIPMENT_LABELS, EXERCISE_EQUIPMENT, machineParent,
  WEIGHT_STEP, formatRestSeconds, formatWeightNumber, formatWeightWithUnit, weightFromDisplay, weightToDisplay,
} from '../utils/workoutData';

describe('names', () => {
  it('keys a custom exercise name so spacing and case are one name', () => {
    expect(exerciseNameKey('  Cable   Fly ')).toBe('cable fly');
    expect(exerciseNameKey('cable fly')).toBe(exerciseNameKey('Cable Fly'));
  });

  it('cleans a name for storage and caps it', () => {
    expect(cleanWorkoutName('  Push   A ')).toBe('Push A');
    expect(cleanWorkoutName('   ')).toBe('');
    expect(cleanWorkoutName('x'.repeat(200))).toHaveLength(WORKOUT_NAME_MAX_LENGTH);
  });

  it('suffixes a name another holds, on the same key the exercise names use', () => {
    expect(freeWorkoutName('Upper A', [])).toBe('Upper A');
    expect(freeWorkoutName('Upper A', ['Lower A'])).toBe('Upper A');
    expect(freeWorkoutName('Upper A', ['upper  a'])).toBe('Upper A (2)');
    expect(freeWorkoutName(' Upper  A ', ['Upper A', 'Upper A (2)'])).toBe('Upper A (3)');
    // A long name gives up characters, never the suffix.
    const long = 'x'.repeat(WORKOUT_NAME_MAX_LENGTH);
    const free = freeWorkoutName(long, [long]);
    expect(free).toHaveLength(WORKOUT_NAME_MAX_LENGTH);
    expect(free.endsWith(' (2)')).toBe(true);
  });
});

describe('machine equipment', () => {
  it('files each specific machine under the catch-all of its kind, and nothing else', () => {
    expect(machineParent('leg_press')).toBe('machine');
    expect(machineParent('treadmill')).toBe('cardio_machine');
    for (const e of ['machine', 'cardio_machine', 'cable', 'smith_machine', 'barbell', 'other'] as const) {
      expect(machineParent(e)).toBeNull();
    }
  });
  it('labels every value once and lists each once', () => {
    expect(new Set(EXERCISE_EQUIPMENT).size).toBe(EXERCISE_EQUIPMENT.length);
    expect(Object.keys(EQUIPMENT_LABELS).sort()).toEqual([...EXERCISE_EQUIPMENT].sort());
    expect(readEquipment('leg_press')).toBe('leg_press');
  });
});

describe('closed vocabularies', () => {
  it('reads an unknown value as the nearest one this build knows', () => {
    expect(readExerciseKind('weight_reps')).toBe('weight_reps');
    expect(readExerciseKind('juggling')).toBe('weight_reps');
    expect(readEquipment('kettlebell')).toBe('kettlebell');
    expect(readEquipment(7)).toBe('other');
    expect(readSetKind('drop')).toBe('drop');
    expect(readSetKind(null)).toBe('working');
    expect(readScheme('rpe')).toBe('rpe');
    expect(readScheme('magic')).toBe('double');
    expect(readProgramScheme('none')).toBeNull();
    expect(readProgramScheme('rpe')).toBe('rpe');
    expect(readProgramScheme('magic')).toBe('double');
  });

  it('keeps known muscles once each, from an array or its JSON', () => {
    expect(readMuscles(['chest', 'chest', 'wings', 'triceps'])).toEqual(['chest', 'triceps']);
    expect(readMuscles('["quads","glutes"]')).toEqual(['quads', 'glutes']);
    expect(readMuscles('{not json')).toEqual([]);
    expect(readMuscles(null)).toEqual([]);
  });
});

describe('readRoutineItems', () => {
  it('round-trips a routine item', () => {
    const items = [{
      exerciseId: 'lib:back-squat', supersetKey: null, restSeconds: 180,
      progression: { scheme: 'linear' as const, incrementKg: 2.5 },
      targets: [{ kind: 'working' as const, repsMin: 5, repsMax: 5, weightKg: 100, rpe: 8 }],
    }];
    expect(readRoutineItems(JSON.stringify(items))).toEqual(items);
  });

  it('drops an item with no exercise, and a target that is not one, keeping the rest', () => {
    const read = readRoutineItems([
      { targets: [] },
      { exerciseId: 'lib:plank', targets: ['nope', { kind: 'working', repsMin: null, repsMax: null, durationSeconds: 60.4 }] },
    ]);
    expect(read).toEqual([{
      exerciseId: 'lib:plank', supersetKey: null, restSeconds: null, progression: null,
      targets: [{ kind: 'working', repsMin: null, repsMax: null, durationSeconds: 60 }],
    }]);
  });

  it('reads a rep range written backwards as the same range, and refuses negative figures', () => {
    const [item] = readRoutineItems([{ exerciseId: 'x', targets: [{ kind: 'working', repsMin: 12, repsMax: 8, weightKg: -5 }] }]);
    expect(item.targets[0]).toEqual({ kind: 'working', repsMin: 8, repsMax: 12 });
  });

  it('reads a ramp, which replaces any warm-ups of the item’s own, and writes nothing for none', () => {
    const [ramp, plain] = readRoutineItems([
      { exerciseId: 'x', warmupRamp: true, targets: [{ kind: 'warmup', repsMin: 5, repsMax: 5 }, { kind: 'working', repsMin: 5, repsMax: 5 }] },
      { exerciseId: 'y', warmupRamp: 'yes', targets: [] },
    ]);
    expect(ramp.warmupRamp).toBe(true);
    expect(ramp.targets.map(t => t.kind)).toEqual(['working']);
    expect('warmupRamp' in plain).toBe(false);
  });

  it('drops a progression with no scheme it knows', () => {
    const [item] = readRoutineItems([{ exerciseId: 'x', targets: [], progression: { scheme: 'vibes' } }]);
    expect(item.progression).toBeNull();
  });

  it('reads anything that is not a list as no items', () => {
    expect(readRoutineItems('{oops')).toEqual([]);
    expect(readRoutineItems({})).toEqual([]);
  });
});

describe('ids and training maxes', () => {
  it('keeps a rotation in order, repeats and all', () => {
    expect(readIdList('["a","b","a",3,""]')).toEqual(['a', 'b', 'a']);
  });

  it('keeps one training max per exercise, the last given, positive only', () => {
    expect(readTrainingMaxes([
      { exerciseId: 'lib:back-squat', kg: 120 },
      { exerciseId: 'lib:back-squat', kg: 125 },
      { exerciseId: 'lib:deadlift', kg: 0 },
      { kg: 50 },
    ])).toEqual([{ exerciseId: 'lib:back-squat', kg: 125 }]);
  });
});

describe('rest seconds', () => {
  it('reads the stored setting, defaulting anything unreadable', () => {
    expect(parseRestSeconds(null)).toBe(DEFAULT_REST_SECONDS);
    expect(parseRestSeconds('')).toBe(DEFAULT_REST_SECONDS);
    expect(parseRestSeconds('abc')).toBe(DEFAULT_REST_SECONDS);
    expect(parseRestSeconds('120')).toBe(120);
  });

  it('holds the value in range, in whole seconds', () => {
    expect(clampRestSeconds(1)).toBe(REST_SECONDS_MIN);
    expect(clampRestSeconds(10_000)).toBe(REST_SECONDS_MAX);
    expect(clampRestSeconds(75.6)).toBe(76);
  });
});

describe('plate inventory', () => {
  it('starts from a metric gym on a fresh install, and from a damaged value', () => {
    expect(parsePlateInventory(null)).toEqual(DEFAULT_PLATE_INVENTORY);
    expect(parsePlateInventory('[1,2]')).toEqual(DEFAULT_PLATE_INVENTORY);
    expect(parsePlateInventory('{oops')).toEqual(DEFAULT_PLATE_INVENTORY);
  });

  it('hands back a copy, so an edit to it cannot change the default', () => {
    const inv = parsePlateInventory(null);
    inv.barsKg.push(7);
    expect(DEFAULT_PLATE_INVENTORY.barsKg).not.toContain(7);
  });

  it('keeps real bars and plates, heaviest first, adding up a repeated plate', () => {
    expect(normalizePlateInventory({
      barsKg: [15, 20, 20, -1],
      plates: [{ kg: 5, count: 2 }, { kg: 20, count: 2 }, { kg: 5, count: 2 }, { kg: 0, count: 4 }, { kg: 10, count: 0 }],
    })).toEqual({ barsKg: [20, 15], plates: [{ kg: 20, count: 2 }, { kg: 5, count: 4 }] });
  });

  it('reads a stored inventory back as it was saved', () => {
    const inv = { barsKg: [20.41], plates: [{ kg: 20.41, count: 4 }, { kg: 1.13, count: 2 }] };
    expect(parsePlateInventory(JSON.stringify(inv))).toEqual(inv);
  });
});

describe('weights on screen', () => {
  it('shows kilograms to the quarter and pounds to the tenth', () => {
    expect(weightToDisplay(82.5, 'kg')).toBe(82.5);
    expect(weightToDisplay(1.25, 'kg')).toBe(1.25);
    expect(weightToDisplay(20, 'lb')).toBe(44.1);
    expect(formatWeightNumber(80, 'kg')).toBe('80');
    expect(formatWeightWithUnit(82.5, 'kg')).toBe('82.5 kg');
  });

  it('stores a weight typed in pounds so it reads back as typed', () => {
    const kg = weightFromDisplay(135, 'lb');
    expect(kg).toBe(61.235);
    expect(weightToDisplay(kg, 'lb')).toBe(135);
    expect(formatWeightWithUnit(weightFromDisplay(225, 'lb'), 'lb')).toBe('225 lb');
    expect(weightFromDisplay(82.5, 'kg')).toBe(82.5);
  });

  it('steps by a pair of the smallest common plates in each unit', () => {
    expect(WEIGHT_STEP).toEqual({ kg: 2.5, lb: 5 });
  });

  it('writes a rest in minutes and seconds', () => {
    expect(formatRestSeconds(150)).toBe('2:30');
    expect(formatRestSeconds(45)).toBe('0:45');
    expect(formatRestSeconds(-3)).toBe('0:00');
  });
});
