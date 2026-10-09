import {
  STEP_GOAL_DEFAULT, STEP_GOAL_MAX, STEP_GOAL_MIN, clampStepGoal, parseStepGoal,
} from '../utils/stepGoal';

describe('clampStepGoal', () => {
  it('snaps to the step and clamps to the range', () => {
    expect(clampStepGoal(8240)).toBe(8000);
    expect(clampStepGoal(8260)).toBe(8500);
    expect(clampStepGoal(10)).toBe(STEP_GOAL_MIN);
    expect(clampStepGoal(900000)).toBe(STEP_GOAL_MAX);
  });
  it('falls back to the default for a non-number', () => {
    expect(clampStepGoal(NaN)).toBe(STEP_GOAL_DEFAULT);
  });
});

describe('parseStepGoal', () => {
  it('reads a stored goal', () => {
    expect(parseStepGoal('12000')).toBe(12000);
  });
  it('is no goal, rather than the default, for empty or unreadable values', () => {
    expect(parseStepGoal(null)).toBeNull();
    expect(parseStepGoal('')).toBeNull();
    expect(parseStepGoal('abc')).toBeNull();
    expect(parseStepGoal('0')).toBeNull();
    expect(parseStepGoal('-5')).toBeNull();
  });
});
