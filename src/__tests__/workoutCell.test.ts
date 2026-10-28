import { parseRepsTarget, parseSetCell, typedTickValues } from '../utils/workoutCell';

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

describe('parseRepsTarget', () => {
  it('reads a count, a range, a floor and blank', () => {
    expect(parseRepsTarget('8')).toEqual({ min: 8, max: 8 });
    expect(parseRepsTarget('8-12')).toEqual({ min: 8, max: 12 });
    expect(parseRepsTarget('8–12')).toEqual({ min: 8, max: 12 });
    expect(parseRepsTarget('5+')).toEqual({ min: 5, max: 5 });
    expect(parseRepsTarget('  ')).toEqual({ min: null, max: null });
  });

  it('clamps to the reps ceiling and floor of one', () => {
    expect(parseRepsTarget('0')).toEqual({ min: 1, max: 1 });
    expect(parseRepsTarget('5000')).toEqual({ min: 200, max: 200 });
  });

  it('refuses text that is not reps', () => {
    expect(parseRepsTarget('abc')).toBeUndefined();
    expect(parseRepsTarget('8-')).toBeUndefined();
    expect(parseRepsTarget('-5')).toBeUndefined();
  });
});

describe('typedTickValues', () => {
  it('lets a number still being typed win over the ghost and the plan', () => {
    expect(typedTickValues({ reps: 8 }, { reps: '10' }, 'kg')).toEqual({ reps: 10 });
    expect(typedTickValues({}, { weight: '82.5' }, 'kg')).toEqual({ weightKg: 82.5 });
  });

  it('keeps the ghost for a cell typed empty or with text that is not a number', () => {
    expect(typedTickValues({ reps: 8 }, { reps: '' }, 'kg')).toEqual({ reps: 8 });
    expect(typedTickValues({ reps: 8 }, { reps: 'x' }, 'kg')).toEqual({ reps: 8 });
  });

  it('halves a typed pair total like the cell does', () => {
    expect(typedTickValues({}, { weight: '40' }, 'kg', 2)).toEqual(parseSetCell('weight', '40', 'kg', 2));
  });
});
