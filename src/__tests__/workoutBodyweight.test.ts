import { WORKOUT_BODYWEIGHT_RANGE_KG, parseWorkoutBodyweightKg } from '../utils/workoutBodyweight';

describe('parseWorkoutBodyweightKg', () => {
  it('reads a stored kilogram figure to one decimal', () => {
    expect(parseWorkoutBodyweightKg('80')).toBe(80);
    expect(parseWorkoutBodyweightKg('70.34')).toBe(70.3);
    expect(parseWorkoutBodyweightKg(' 82.5 ')).toBe(82.5);
  });

  it('reads blank, missing and non-numeric values as none', () => {
    expect(parseWorkoutBodyweightKg('')).toBeNull();
    expect(parseWorkoutBodyweightKg('   ')).toBeNull();
    expect(parseWorkoutBodyweightKg(null)).toBeNull();
    expect(parseWorkoutBodyweightKg(undefined)).toBeNull();
    expect(parseWorkoutBodyweightKg('heavy')).toBeNull();
  });

  it('reads a figure outside the range as none rather than as a guess', () => {
    expect(parseWorkoutBodyweightKg('19.9')).toBeNull();
    expect(parseWorkoutBodyweightKg('301')).toBeNull();
    expect(parseWorkoutBodyweightKg('-80')).toBeNull();
    expect(parseWorkoutBodyweightKg(String(WORKOUT_BODYWEIGHT_RANGE_KG.min))).toBe(20);
    expect(parseWorkoutBodyweightKg(String(WORKOUT_BODYWEIGHT_RANGE_KG.max))).toBe(300);
  });
});
