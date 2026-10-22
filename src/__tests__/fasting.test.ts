import type { Fast } from '../types';
import {
  pastFasts,
  formatFastLengthShort,
  activeFast,
  clampFastGoalHours,
  describeFastLength,
  describeFastMoment,
  fastElapsedMs,
  fastGoalAt,
  fastProgress,
  fastStartProblem,
  formatFastElapsed,
  lastEndedFast,
  lastMealLoggedAt,
  showsFastingCard,
} from '../utils/fasting';

const now = new Date(2026, 9, 22, 12, 0);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

const fast = (overrides: Partial<Fast> = {}): Fast => ({
  id: 'f1', startedAt: hoursAgo(13.7), endedAt: null, goalHours: 16, createdAt: hoursAgo(13.7),
  ...overrides,
});

describe('the running fast', () => {
  it('is the one with no end', () => {
    expect(activeFast([fast({ id: 'a', endedAt: hoursAgo(30) }), fast({ id: 'b' })])!.id).toBe('b');
    expect(activeFast([fast({ endedAt: hoursAgo(1) })])).toBeNull();
  });

  it('runs to now while open, and to its end once ended', () => {
    expect(fastElapsedMs(fast({ startedAt: hoursAgo(2) }), now)).toBe(2 * 3_600_000);
    expect(fastElapsedMs(fast({ startedAt: hoursAgo(5), endedAt: hoursAgo(1) }), now)).toBe(4 * 3_600_000);
  });

  it('never runs negative for a start a moment in the future', () => {
    expect(fastElapsedMs(fast({ startedAt: hoursAgo(-0.01) }), now)).toBe(0);
  });

  it('reaches its goal goalHours after the start', () => {
    expect(fastGoalAt(fast({ startedAt: hoursAgo(10), goalHours: 16 }))).toEqual(new Date(now.getTime() + 6 * 3_600_000));
  });

  it('fills the bar to the goal and holds there past it', () => {
    expect(fastProgress(fast({ startedAt: hoursAgo(8), goalHours: 16 }), now)).toBeCloseTo(0.5);
    expect(fastProgress(fast({ startedAt: hoursAgo(20), goalHours: 16 }), now)).toBe(1);
  });
});

describe('lastEndedFast', () => {
  it('picks the latest end, ignoring the open one', () => {
    const list = [fast({ id: 'a', endedAt: hoursAgo(30) }), fast({ id: 'b', endedAt: hoursAgo(5) }), fast({ id: 'c' })];
    expect(lastEndedFast(list)!.id).toBe('b');
    expect(lastEndedFast([fast()])).toBeNull();
  });
});

describe('formatting', () => {
  it('reads hours and minutes, past 24 hours too', () => {
    expect(formatFastElapsed(13 * 3_600_000 + 42 * 60_000)).toBe('13:42');
    expect(formatFastElapsed(30 * 3_600_000 + 5 * 60_000)).toBe('30:05');
    expect(formatFastElapsed(-5)).toBe('0:00');
  });

  it('spells a length out', () => {
    expect(describeFastLength(15 * 3_600_000 + 40 * 60_000)).toBe('15 hours 40 minutes');
    expect(describeFastLength(3_600_000)).toBe('1 hour');
    expect(describeFastLength(60_000)).toBe('1 minute');
  });

  it('names the day of a moment when it is not today', () => {
    const time = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(describeFastMoment(new Date(2026, 9, 22, 8, 10), now, time)).toBe('8:10');
    expect(describeFastMoment(new Date(2026, 9, 21, 20, 10), now, time)).toBe('20:10 yesterday');
    expect(describeFastMoment(new Date(2026, 9, 23, 4, 10), now, time)).toBe('4:10 tomorrow');
    expect(describeFastMoment(new Date(2026, 9, 19, 20, 10), now, time)).toBe('20:10 Mon');
  });
});

describe('fastStartProblem', () => {
  it('accepts now and the recent past', () => {
    expect(fastStartProblem(now, now)).toBeNull();
    expect(fastStartProblem(new Date(hoursAgo(20)), now)).toBeNull();
  });

  it('refuses the future, a start too long ago, and a start after the end', () => {
    expect(fastStartProblem(new Date(hoursAgo(-1)), now)).toMatch(/future/);
    expect(fastStartProblem(new Date(hoursAgo(80)), now)).toMatch(/72 hours/);
    expect(fastStartProblem(new Date(hoursAgo(2)), now, new Date(hoursAgo(3)))).toMatch(/before the end/);
  });
});

describe('lastMealLoggedAt', () => {
  it('takes the latest entry that is not water and not later than now', () => {
    const water = { atISO: hoursAgo(12) };
    const entries = [{ atISO: hoursAgo(16) }, { atISO: hoursAgo(14) }, water, { atISO: hoursAgo(-2) }];
    expect(lastMealLoggedAt(entries, now, e => e === water)).toEqual(new Date(hoursAgo(14)));
    // Without the water rule, the glass after dinner would be the answer.
    expect(lastMealLoggedAt(entries, now, () => false)).toEqual(new Date(hoursAgo(12)));
  });

  it('gives nothing when every entry is too old', () => {
    expect(lastMealLoggedAt([{ atISO: hoursAgo(100) }], now, () => false)).toBeNull();
  });
});

describe('showsFastingCard', () => {
  const dayStart = new Date(2026, 9, 22, 0, 0);

  it('shows while a fast runs and through the day one ended on', () => {
    expect(showsFastingCard([fast()], dayStart)).toBe(true);
    expect(showsFastingCard([fast({ endedAt: hoursAgo(1) })], dayStart)).toBe(true);
  });

  it('shows nothing for somebody who never fasts, or whose last fast ended before today', () => {
    expect(showsFastingCard([], dayStart)).toBe(false);
    expect(showsFastingCard([fast({ endedAt: hoursAgo(14) })], dayStart)).toBe(false);
  });
});

describe('clampFastGoalHours', () => {
  it('keeps a goal in range and whole', () => {
    expect(clampFastGoalHours(16.4)).toBe(16);
    expect(clampFastGoalHours(0)).toBe(1);
    expect(clampFastGoalHours(500)).toBe(72);
    expect(clampFastGoalHours(NaN)).toBe(16);
  });
});

describe('past fasts', () => {
  const f = (id: string, startedAt: string, endedAt: string | null): Fast =>
    ({ id, startedAt, endedAt, goalHours: 16, createdAt: startedAt });

  it('lists the ended ones, newest first, leaving out the one running', () => {
    const fasts = [
      f('a', '2026-10-15T20:00:00', '2026-10-16T12:00:00'),
      f('b', '2026-10-19T20:00:00', '2026-10-20T10:00:00'),
      f('c', '2026-10-21T20:00:00', null),
    ];
    expect(pastFasts(fasts).map(x => x.id)).toEqual(['b', 'a']);
  });

  it('says a length the short way a row has room for', () => {
    expect(formatFastLengthShort((16 * 60 + 12) * 60_000)).toBe('16 h 12 min');
    expect(formatFastLengthShort(16 * 3_600_000)).toBe('16 h');
    expect(formatFastLengthShort(42 * 60_000)).toBe('42 min');
    expect(formatFastLengthShort(-5)).toBe('0 min');
  });
});
