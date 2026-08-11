import {
  hasCookTimer,
  isCookTimerRunning,
  cookTimerElapsed,
  cookTimerRemaining,
  cookTimerProgress,
  isCookTimerReady,
  type CookTimerState,
} from '../utils/recipeTimer';

const NOW = new Date(2025, 5, 15, 12, 0, 0).getTime();

/** A recipe with nothing banked and nothing running. */
const idle = (estimatedMinutes: number | null = 25): CookTimerState => ({
  estimatedMinutes,
  timerElapsedSeconds: 0,
  timerStartedAt: null,
});

/** A recipe whose current cook timer run started `secondsAgo` before NOW. */
const running = (estimatedMinutes: number | null, secondsAgo: number, banked = 0): CookTimerState => ({
  estimatedMinutes,
  timerElapsedSeconds: banked,
  timerStartedAt: new Date(NOW - secondsAgo * 1000).toISOString(),
});

// ─── hasCookTimer ───

describe('hasCookTimer', () => {
  it('is true when a positive duration is set', () => {
    expect(hasCookTimer(idle(25))).toBe(true);
  });

  it('is false with no duration', () => {
    expect(hasCookTimer(idle(null))).toBe(false);
  });

  it('treats a zero or negative duration as none', () => {
    expect(hasCookTimer(idle(0))).toBe(false);
    expect(hasCookTimer(idle(-5))).toBe(false);
  });
});

// ─── isCookTimerRunning ───

describe('isCookTimerRunning', () => {
  it('tracks whether a run segment is in flight', () => {
    expect(isCookTimerRunning(idle())).toBe(false);
    expect(isCookTimerRunning(running(25, 60))).toBe(true);
  });
});

// ─── cookTimerElapsed ───

describe('cookTimerElapsed', () => {
  it('is zero for a recipe that has never been timed', () => {
    expect(cookTimerElapsed(idle(), NOW)).toBe(0);
  });

  it('counts the live segment while running', () => {
    expect(cookTimerElapsed(running(25, 90), NOW)).toBe(90);
  });

  it('returns only the banked time while paused', () => {
    expect(cookTimerElapsed({ ...idle(), timerElapsedSeconds: 120 }, NOW)).toBe(120);
  });

  it('adds the live segment on top of banked time', () => {
    expect(cookTimerElapsed(running(25, 30, 120), NOW)).toBe(150);
  });

  it('ignores a clock that moved backwards rather than rewinding', () => {
    const state = running(25, -600, 60);
    expect(cookTimerElapsed(state, NOW)).toBe(60);
  });

  it('works with no duration set at all — a plain stopwatch', () => {
    expect(cookTimerElapsed(running(null, 45), NOW)).toBe(45);
  });
});

// ─── cookTimerRemaining ───

describe('cookTimerRemaining', () => {
  it('counts down from the full duration', () => {
    expect(cookTimerRemaining(idle(25), NOW)).toBe(25 * 60);
    expect(cookTimerRemaining(running(25, 60), NOW)).toBe(24 * 60);
  });

  it('goes negative once the duration is passed', () => {
    expect(cookTimerRemaining(running(1, 90), NOW)).toBe(-30);
  });

  it('is zero for a recipe with no duration', () => {
    expect(cookTimerRemaining(idle(null), NOW)).toBe(0);
  });
});

// ─── cookTimerProgress ───

describe('cookTimerProgress', () => {
  it('reports the fraction of the duration consumed', () => {
    expect(cookTimerProgress(running(10, 300), NOW)).toBe(0.5);
  });

  it('clamps to 1 once the timer overruns', () => {
    expect(cookTimerProgress(running(1, 600), NOW)).toBe(1);
  });

  it('is 0 for a recipe with no duration', () => {
    expect(cookTimerProgress(idle(null), NOW)).toBe(0);
  });
});

// ─── isCookTimerReady ───

describe('isCookTimerReady', () => {
  it('is false with time still on the clock', () => {
    expect(isCookTimerReady(running(25, 25 * 60 - 1), NOW)).toBe(false);
  });

  it('is true exactly at zero and stays true afterwards', () => {
    expect(isCookTimerReady(running(25, 25 * 60), NOW)).toBe(true);
    expect(isCookTimerReady(running(25, 25 * 60 + 60), NOW)).toBe(true);
  });

  it('is false for a recipe with no duration, however long it has run', () => {
    expect(isCookTimerReady({ ...running(1, 9999), estimatedMinutes: null }, NOW)).toBe(false);
  });

  it('is false while paused short of the duration', () => {
    expect(isCookTimerReady({ ...idle(25), timerElapsedSeconds: 24 * 60 }, NOW)).toBe(false);
  });

  it('is true when the banked time alone covers the duration', () => {
    expect(isCookTimerReady({ ...idle(25), timerElapsedSeconds: 25 * 60 }, NOW)).toBe(true);
  });
});

// ─── persistence behaviour ───
//
// Readiness is derived, never stored, so these are the cases that would break
// if anyone reintroduced a stored "ready" flag.

describe('surviving backgrounding and restarts', () => {
  it('keeps counting real time while the app was closed', () => {
    const state = running(25, 0);
    expect(isCookTimerReady(state, NOW)).toBe(false);
    expect(isCookTimerReady(state, NOW + 30 * 60 * 1000)).toBe(true);
  });

  it('does not count the paused span against the timer', () => {
    const paused: CookTimerState = { ...idle(25), timerElapsedSeconds: 5 * 60 };
    expect(cookTimerRemaining(paused, NOW + 60 * 60 * 1000)).toBe(20 * 60);
    expect(isCookTimerReady(paused, NOW + 60 * 60 * 1000)).toBe(false);
  });

  it('resumes from banked time without double-counting the first segment', () => {
    // 5m run, banked, then resumed 3m ago → 8m spent, 17m left of a 25m target.
    const resumed = running(25, 3 * 60, 5 * 60);
    expect(cookTimerElapsed(resumed, NOW)).toBe(8 * 60);
    expect(cookTimerRemaining(resumed, NOW)).toBe(17 * 60);
  });
});
