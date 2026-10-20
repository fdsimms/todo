import { parseSetCell } from '../utils/workoutCell';

describe('parseSetCell', () => {
  it('clears a value when the text is blank', () => {
    expect(parseSetCell('reps', '  ', 'lb')).toEqual({ reps: null });
    expect(parseSetCell('weight', '', 'kg')).toEqual({ weightKg: null });
  });

  it('stores a weight in kilograms from the unit shown, accepting a comma', () => {
    expect(parseSetCell('weight', '82,5', 'kg')).toEqual({ weightKg: 82.5 });
    expect(parseSetCell('weight', '135', 'lb')).toEqual({ weightKg: 61.235 });
  });

  it('rounds reps and clamps to the ceiling', () => {
    expect(parseSetCell('reps', '8.6', 'kg')).toEqual({ reps: 9 });
    expect(parseSetCell('reps', '5000', 'kg')).toEqual({ reps: 200 });
  });

  it('reads a duration as seconds or m:ss', () => {
    expect(parseSetCell('duration', '90', 'kg')).toEqual({ durationSeconds: 90 });
    expect(parseSetCell('duration', '1:30', 'kg')).toEqual({ durationSeconds: 90 });
  });

  it('reads a distance in meters', () => {
    expect(parseSetCell('distance', '400', 'kg')).toEqual({ distanceM: 400 });
  });

  it('refuses text that is not a number, and a negative one', () => {
    expect(parseSetCell('reps', 'abc', 'kg')).toBeUndefined();
    expect(parseSetCell('weight', '-5', 'kg')).toBeUndefined();
  });
});
