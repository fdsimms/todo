import {
  isTimedTask,
  isTimerRunning,
  timerElapsed,
  timerRemaining,
  timerProgress,
  isTimerReady,
  type TimerState,
} from '../utils/timer';

const NOW = new Date(2025, 5, 15, 12, 0, 0).getTime();

/** A timed task with nothing banked and nothing running. */
const idle = (timedMinutes: number | null = 15): TimerState => ({
  timedMinutes,
  timerElapsedSeconds: 0,
  timerStartedAt: null,
});

/** A timed task whose current run started `secondsAgo` before NOW. */
const running = (timedMinutes: number, secondsAgo: number, banked = 0): TimerState => ({
  timedMinutes,
  timerElapsedSeconds: banked,
  timerStartedAt: new Date(NOW - secondsAgo * 1000).toISOString(),
});

// ─── isTimedTask ───

describe('isTimedTask', () => {
  it('is true when a positive target is set', () => {
    expect(isTimedTask(idle(15))).toBe(true);
  });

  it('is false with no target', () => {
    expect(isTimedTask(idle(null))).toBe(false);
  });

  it('treats a zero or negative target as no target', () => {
    expect(isTimedTask(idle(0))).toBe(false);
    expect(isTimedTask(idle(-5))).toBe(false);
  });
});

// ─── isTimerRunning ───

describe('isTimerRunning', () => {
  it('tracks whether a run segment is in flight', () => {
    expect(isTimerRunning(idle())).toBe(false);
    expect(isTimerRunning(running(15, 60))).toBe(true);
  });
});

// ─── timerElapsed ───

describe('timerElapsed', () => {
  it('is zero for a task that has never run', () => {
    expect(timerElapsed(idle(), NOW)).toBe(0);
  });

  it('counts the live segment while running', () => {
    expect(timerElapsed(running(15, 90), NOW)).toBe(90);
  });

  it('returns only the banked time while paused', () => {
    expect(timerElapsed({ ...idle(), timerElapsedSeconds: 120 }, NOW)).toBe(120);
  });

  it('adds the live segment on top of banked time', () => {
    expect(timerElapsed(running(15, 30, 120), NOW)).toBe(150);
  });

  it('ignores a clock that moved backwards rather than rewinding', () => {
    // Start timestamp in the future — a timezone change or manual clock set.
    const state = running(15, -600, 60);
    expect(timerElapsed(state, NOW)).toBe(60);
  });
});

// ─── timerRemaining ───

describe('timerRemaining', () => {
  it('counts down from the full target', () => {
    expect(timerRemaining(idle(15), NOW)).toBe(15 * 60);
    expect(timerRemaining(running(15, 60), NOW)).toBe(14 * 60);
  });

  it('goes negative once the target is passed', () => {
    expect(timerRemaining(running(1, 90), NOW)).toBe(-30);
  });

  it('is zero for a task with no target', () => {
    expect(timerRemaining(idle(null), NOW)).toBe(0);
  });
});

// ─── timerProgress ───

describe('timerProgress', () => {
  it('reports the fraction of the target consumed', () => {
    expect(timerProgress(running(10, 300), NOW)).toBe(0.5);
  });

  it('clamps to 1 once the timer overruns', () => {
    expect(timerProgress(running(1, 600), NOW)).toBe(1);
  });

  it('is 0 for an untimed task', () => {
    expect(timerProgress(idle(null), NOW)).toBe(0);
  });
});

// ─── isTimerReady ───

describe('isTimerReady', () => {
  it('is false with time still on the clock', () => {
    expect(isTimerReady(running(15, 15 * 60 - 1), NOW)).toBe(false);
  });

  it('is true exactly at zero and stays true afterwards', () => {
    expect(isTimerReady(running(15, 15 * 60), NOW)).toBe(true);
    expect(isTimerReady(running(15, 15 * 60 + 60), NOW)).toBe(true);
  });

  it('is false for a task with no target, however long it has run', () => {
    expect(isTimerReady({ ...running(1, 9999), timedMinutes: null }, NOW)).toBe(false);
  });

  it('is false while paused short of the target', () => {
    expect(isTimerReady({ ...idle(15), timerElapsedSeconds: 14 * 60 }, NOW)).toBe(false);
  });

  it('is true when the banked time alone covers the target', () => {
    expect(isTimerReady({ ...idle(15), timerElapsedSeconds: 15 * 60 }, NOW)).toBe(true);
  });
});

// ─── persistence behaviour ───
//
// Readiness is derived, never stored, so these are the cases that would break if
// anyone reintroduced a `readyAt` column.

describe('surviving backgrounding and restarts', () => {
  it('keeps counting real time while the app was closed', () => {
    // Started a 15m timer, app killed immediately, reopened 20 minutes later.
    const state = running(15, 0);
    expect(isTimerReady(state, NOW)).toBe(false);
    expect(isTimerReady(state, NOW + 20 * 60 * 1000)).toBe(true);
  });

  it('does not count the paused span against the timer', () => {
    // Ran 5 of 15 minutes, paused, reopened an hour later — still 10m left.
    const paused: TimerState = { ...idle(15), timerElapsedSeconds: 5 * 60 };
    expect(timerRemaining(paused, NOW + 60 * 60 * 1000)).toBe(10 * 60);
    expect(isTimerReady(paused, NOW + 60 * 60 * 1000)).toBe(false);
  });

  it('resumes from banked time without double-counting the first segment', () => {
    // 5m run, banked, then resumed 3m ago → 8m spent, 7m left.
    const resumed = running(15, 3 * 60, 5 * 60);
    expect(timerElapsed(resumed, NOW)).toBe(8 * 60);
    expect(timerRemaining(resumed, NOW)).toBe(7 * 60);
  });
});
