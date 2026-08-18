import {
  daysUntilDay,
  describeUseBy,
  FRESHNESS_ORDER,
  freshnessFor,
  freshnessRank,
  isUseUpSoon,
} from '../utils/freshness';

// freshness reaches dateUtils for dayKeyToDate, which reaches the settings
// store for dayResetTime — which nothing here needs, since a day key is a
// calendar day and carries no time at all. Same stub leftovers.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// A Thursday, mid-afternoon. Every case places its day relative to this rather
// than to the real clock — the whole module is calendar-day arithmetic, so a
// test that ran at 23:59 would otherwise be a different test.
const NOW = new Date(2026, 7, 13, 15, 0, 0);

describe('daysUntilDay', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // 9 hours away, but it's tomorrow to anyone opening the fridge.
    expect(daysUntilDay('2026-08-14', NOW)).toBe(1);
    expect(daysUntilDay('2026-08-13', NOW)).toBe(0);
    expect(daysUntilDay('2026-08-11', NOW)).toBe(-2);
  });
});

describe('freshnessFor', () => {
  it('reads a day through the four states', () => {
    expect(freshnessFor('2026-08-16', NOW)).toBe('fresh');
    expect(freshnessFor('2026-08-14', NOW)).toBe('soon');
    expect(freshnessFor('2026-08-13', NOW)).toBe('due');
    expect(freshnessFor('2026-08-12', NOW)).toBe('over');
  });
});

describe('freshnessRank', () => {
  it('ranks most urgent first', () => {
    const shuffled = ['fresh', 'over', 'soon', 'due'] as const;
    expect([...shuffled].sort((a, b) => freshnessRank(a) - freshnessRank(b))).toEqual([
      ...FRESHNESS_ORDER,
    ]);
  });

  it('puts "nothing counting down" last — an undated thing is not the freshest thing', () => {
    expect(freshnessRank(null)).toBeGreaterThan(freshnessRank('fresh'));
  });
});

describe('isUseUpSoon', () => {
  it('includes soon, so the nudge lands before the waste rather than on the day', () => {
    expect(isUseUpSoon('soon')).toBe(true);
    expect(isUseUpSoon('due')).toBe(true);
    expect(isUseUpSoon('over')).toBe(true);
  });

  it('is false for fresh, and for nothing counting down at all', () => {
    expect(isUseUpSoon('fresh')).toBe(false);
    expect(isUseUpSoon(null)).toBe(false);
  });
});

describe('describeUseBy', () => {
  it('phrases a day the way a cook reads it', () => {
    expect(describeUseBy('2026-08-13', NOW)).toBe('Use by today');
    expect(describeUseBy('2026-08-14', NOW)).toBe('Use by tomorrow');
    expect(describeUseBy('2026-08-16', NOW)).toBe('3 days left');
  });

  it('says a past day is past rather than overdue — food isn\'t late, it\'s questionable', () => {
    expect(describeUseBy('2026-08-12', NOW)).toBe('1 day past');
    expect(describeUseBy('2026-08-10', NOW)).toBe('3 days past');
  });
});
