import {
  clampShortNightMinutes,
  parseShortNightMinutes,
  SHORT_NIGHT_MINUTES_DEFAULT,
  SHORT_NIGHT_MINUTES_MAX,
  SHORT_NIGHT_MINUTES_MIN,
} from '@/utils/shortNight';

describe('clampShortNightMinutes', () => {
  it('snaps to the step and clamps to the range', () => {
    expect(clampShortNightMinutes(371)).toBe(360);
    expect(clampShortNightMinutes(380)).toBe(390);
    expect(clampShortNightMinutes(10)).toBe(SHORT_NIGHT_MINUTES_MIN);
    expect(clampShortNightMinutes(9999)).toBe(SHORT_NIGHT_MINUTES_MAX);
  });

  it('falls back to the default for a non-number', () => {
    expect(clampShortNightMinutes(NaN)).toBe(SHORT_NIGHT_MINUTES_DEFAULT);
  });
});

describe('parseShortNightMinutes', () => {
  it('reads a stored value', () => {
    expect(parseShortNightMinutes('420')).toBe(420);
  });

  it('is the old fixed 6 hours when nothing usable is stored', () => {
    expect(SHORT_NIGHT_MINUTES_DEFAULT).toBe(360);
    expect(parseShortNightMinutes(null)).toBe(360);
    expect(parseShortNightMinutes('')).toBe(360);
    expect(parseShortNightMinutes('abc')).toBe(360);
    expect(parseShortNightMinutes('0')).toBe(360);
  });
});
