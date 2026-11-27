import {
  LOOK_AWAY_DEFAULT_SECONDS, LOOK_AWAY_MAX_SECONDS, LOOK_AWAY_MIN_SECONDS,
  clampLookAwaySeconds, lookAwayProgress, lookAwaySecondsLeft,
} from '../utils/lookAway';

describe('lookAwaySecondsLeft', () => {
  it('shows the full length first and 1 last, rounding up', () => {
    const endsAt = 20_000;
    expect(lookAwaySecondsLeft(endsAt, 0)).toBe(20);
    expect(lookAwaySecondsLeft(endsAt, 100)).toBe(20);
    expect(lookAwaySecondsLeft(endsAt, 19_001)).toBe(1);
  });

  it('is 0 at the end and never negative after it', () => {
    expect(lookAwaySecondsLeft(20_000, 20_000)).toBe(0);
    expect(lookAwaySecondsLeft(20_000, 90_000)).toBe(0);
  });
});

describe('lookAwayProgress', () => {
  it('runs from 0 to 1 across the countdown', () => {
    expect(lookAwayProgress(20_000, 0, 20)).toBe(0);
    expect(lookAwayProgress(20_000, 10_000, 20)).toBe(0.5);
    expect(lookAwayProgress(20_000, 20_000, 20)).toBe(1);
  });

  it('stays within 0 and 1 outside the countdown', () => {
    expect(lookAwayProgress(20_000, -5_000, 20)).toBe(0);
    expect(lookAwayProgress(20_000, 99_000, 20)).toBe(1);
    expect(lookAwayProgress(20_000, 0, 0)).toBe(1);
  });
});

describe('clampLookAwaySeconds', () => {
  it('keeps a length the stepper allows', () => {
    expect(clampLookAwaySeconds(20)).toBe(20);
    expect(clampLookAwaySeconds(19.6)).toBe(20);
  });

  it('pulls a length outside the range back to it', () => {
    expect(clampLookAwaySeconds(1)).toBe(LOOK_AWAY_MIN_SECONDS);
    expect(clampLookAwaySeconds(5000)).toBe(LOOK_AWAY_MAX_SECONDS);
  });

  it('falls back to the default for a value that is not a number', () => {
    expect(clampLookAwaySeconds(NaN)).toBe(LOOK_AWAY_DEFAULT_SECONDS);
  });
});
