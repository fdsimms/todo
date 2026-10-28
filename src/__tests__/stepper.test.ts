import { canStep, clampCount, holdRepeatDelay, parseStepperInput, stepCount, typedStepperValue } from '../utils/stepper';
import { COUNTDOWN_LADDER } from '../utils/taskKinds';

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

describe('a weight stepper, in 2.5 kg steps', () => {
  const kg = { min: 0, max: 500, step: 2.5, places: 2 };

  it('steps by the plate pair, landing on the half kilogram', () => {
    expect(stepCount(80, 2.5, kg)).toBe(82.5);
    expect(stepCount(82.5, 2.5, kg)).toBe(85);
    expect(stepCount(2.5, -2.5, kg)).toBe(0);
    expect(stepCount(0, -2.5, kg)).toBe(0);
  });

  it('keeps a value typed finer than the step, to the places the range names', () => {
    // 85.25, not 85.3: the step's one place must not round away the quarter.
    expect(stepCount(82.75, 2.5, kg)).toBe(85.25);
    expect(clampCount(82.75, kg)).toBe(82.75);
    expect(clampCount(82.756, kg)).toBe(82.76);
    // Without `places`, the step's own precision, as every other stepper has.
    expect(stepCount(82.75, 2.5, { min: 0, max: 500, step: 2.5 })).toBe(85.3);
  });

  it('still rounds away the dust a run of fractional adds leaves', () => {
    let v: number | null = 0;
    for (let i = 0; i < 7; i++) v = stepCount(v, 2.5, kg);
    expect(v).toBe(17.5);
    expect(clampCount(0.30000000000000004, kg)).toBe(0.3);
  });
});

describe('parseStepperInput', () => {
  it('reads a decimal point or a decimal comma', () => {
    expect(parseStepperInput('82.5')).toBe(82.5);
    expect(parseStepperInput(' 82,5 ')).toBe(82.5);
    expect(parseStepperInput('8')).toBe(8);
    expect(parseStepperInput('.5')).toBe(0.5);
  });

  it('refuses a thousands separator on an integer stepper, and keeps a decimal comma on a decimal one', () => {
    const steps = { min: 0, max: 100000, step: 500 };
    expect(parseStepperInput('10,000', steps)).toBeNull();
    expect(parseStepperInput('1,000', steps)).toBeNull();
    expect(parseStepperInput('10000', steps)).toBe(10000);
    expect(parseStepperInput('8.5', steps)).toBeNull();
    const weight = { min: 0, max: 500, step: 2.5, places: 2 };
    expect(parseStepperInput('82,5', weight)).toBe(82.5);
  });

  it('refuses anything that is not one number', () => {
    expect(parseStepperInput('')).toBeNull();
    expect(parseStepperInput('.')).toBeNull();
    expect(parseStepperInput('1,000.5')).toBeNull();
    expect(parseStepperInput('82 kg')).toBeNull();
    expect(parseStepperInput('8-10')).toBeNull();
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

describe('stepCount with a ladder', () => {
  const ladder = { min: 0.25, max: 180, allowNull: true, ladder: COUNTDOWN_LADDER };

  it('steps 15 seconds under a minute, then whole minutes', () => {
    expect(stepCount(0.5, 1, ladder)).toBe(0.75);
    expect(stepCount(0.75, 1, ladder)).toBe(1);
    expect(stepCount(1, 1, ladder)).toBe(2);
    expect(stepCount(2, -1, ladder)).toBe(1);
    expect(stepCount(1, -1, ladder)).toBe(0.75);
  });

  it('lands on the next rung from a value between them', () => {
    expect(stepCount(1.5, 1, ladder)).toBe(2);
    expect(stepCount(1.5, -1, ladder)).toBe(1);
  });

  it('clears below the floor and sticks at the ceiling', () => {
    expect(stepCount(0.25, -1, ladder)).toBeNull();
    expect(stepCount(180, 1, ladder)).toBe(180);
    expect(stepCount(null, 1, ladder)).toBe(0.25);
  });
});

describe('typedStepperValue', () => {
  const range = { min: 5, max: 100 };

  it('writes a number the stepper keeps as typed', () => {
    expect(typedStepperValue('12', range)).toBe(12);
    expect(typedStepperValue('100', range)).toBe(100);
  });

  it('waits on one it would clamp, on an empty field and on text that is not a number', () => {
    // "1" on the way to "12": writing it would clamp to 5 under the finger.
    expect(typedStepperValue('1', range)).toBeNull();
    expect(typedStepperValue('150', range)).toBeNull();
    expect(typedStepperValue('', { ...range, allowNull: true })).toBeNull();
    expect(typedStepperValue('1x', range)).toBeNull();
  });

  it('keeps a decimal stepper to its own places', () => {
    const kg = { min: 0, max: 500, step: 2.5, places: 2 };
    expect(typedStepperValue('82.5', kg)).toBe(82.5);
    expect(typedStepperValue('82.', kg)).toBe(82);
    expect(typedStepperValue('82.125', kg)).toBeNull();
  });
});
