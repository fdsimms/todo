import { canStep, clampCount, holdRepeatDelay, stepCount } from '../utils/stepper';

const range = { min: 2, max: 99 };
const clearable = { min: 2, max: 99, allowNull: true };

describe('clampCount', () => {
  it('pulls a value into range', () => {
    expect(clampCount(1, range)).toBe(2);
    expect(clampCount(500, range)).toBe(99);
    expect(clampCount(7, range)).toBe(7);
  });

  it('rounds', () => {
    expect(clampCount(7.4, range)).toBe(7);
  });

  it('rounds to the range\'s own step precision instead of always to a whole number', () => {
    const rate = { min: 0.25, max: 2, step: 0.25 };
    expect(clampCount(0.756, rate)).toBe(0.76);
    expect(clampCount(3, rate)).toBe(2);
  });
});

describe('stepCount', () => {
  it('steps by one either way', () => {
    expect(stepCount(3, 1, range)).toBe(4);
    expect(stepCount(3, -1, range)).toBe(2);
  });

  it('sticks at the ceiling', () => {
    expect(stepCount(99, 1, range)).toBe(99);
  });

  it('sticks at the floor when the value cannot be cleared', () => {
    expect(stepCount(2, -1, range)).toBe(2);
  });

  it('clears at the floor when it can', () => {
    expect(stepCount(2, -1, clearable)).toBeNull();
  });

  it('starts at the floor from empty, and stays empty going down', () => {
    expect(stepCount(null, 1, clearable)).toBe(2);
    expect(stepCount(null, -1, clearable)).toBeNull();
  });

  it('starts at a given point from empty instead of the floor, when one is set', () => {
    const seeded = { ...clearable, start: 40 };
    expect(stepCount(null, 1, seeded)).toBe(40);
    // Going down from empty is still empty — a start point only answers "+".
    expect(stepCount(null, -1, seeded)).toBeNull();
  });

  it('walks an out-of-range value back in by one press', () => {
    expect(stepCount(500, -1, range)).toBe(99);
    expect(stepCount(1, 1, range)).toBe(2);
  });

  it('steps a fractional value by its own granularity instead of getting stuck', () => {
    // The weight goal's rate stepper: min 0.25, step 0.25. Rounding the
    // starting value to a whole number before subtracting (the old bug)
    // turned 0.75 into 1 first, so 1 - 0.25 landed back on 0.75 forever.
    const rate = { min: 0.25, max: 2, step: 0.25 };
    expect(stepCount(1, -0.25, rate)).toBe(0.75);
    expect(stepCount(0.75, -0.25, rate)).toBe(0.5);
    expect(stepCount(0.5, -0.25, rate)).toBe(0.25);
    expect(stepCount(0.25, -0.25, rate)).toBe(0.25);
    expect(stepCount(0.25, 0.25, rate)).toBe(0.5);
  });

  it('keeps an off-grid value at its own offset rather than snapping to the grid', () => {
    // Sodium: min 200, step 100. A stored 2,006 should carry the 6 forever,
    // per the doc comment, not settle onto a multiple of 100.
    const sodium = { min: 200, max: 6000, step: 100 };
    expect(stepCount(2006, 100, sodium)).toBe(2106);
    expect(stepCount(2106, 100, sodium)).toBe(2206);
  });
});

describe('canStep', () => {
  it('is false only at a bound the value cannot leave', () => {
    expect(canStep(99, 1, range)).toBe(false);
    expect(canStep(99, -1, range)).toBe(true);
    expect(canStep(2, -1, range)).toBe(false);
    expect(canStep(2, -1, clearable)).toBe(true);
    expect(canStep(null, -1, clearable)).toBe(false);
    expect(canStep(null, 1, clearable)).toBe(true);
  });
});

describe('holdRepeatDelay', () => {
  it('pauses before the first repeat so a tap is just a tap', () => {
    expect(holdRepeatDelay(0)).toBe(400);
  });

  it('never speeds back up', () => {
    const delays = [0, 1, 4, 5, 11, 12, 40].map(holdRepeatDelay);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeLessThanOrEqual(delays[i - 1]);
    }
  });
});
