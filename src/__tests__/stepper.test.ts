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

  it('walks an out-of-range value back in by one press', () => {
    expect(stepCount(500, -1, range)).toBe(99);
    expect(stepCount(1, 1, range)).toBe(2);
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
