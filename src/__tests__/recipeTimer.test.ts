import {
  isCookTimerRunning,
  cookTimerElapsed,
  isPrepTimerRunning,
  prepTimerElapsed,
  hasRunningRecipeTimer,
  recipeTimerClock,
  recipeTimerResetPrompt,
  type CookTimerState,
  type PrepTimerState,
} from '../utils/recipeTimer';

const NOW = new Date(2025, 5, 15, 12, 0, 0).getTime();

/** A recipe with nothing banked and nothing running. */
const idle = (): CookTimerState => ({
  timerElapsedSeconds: 0,
  timerStartedAt: null,
});

/** A recipe whose current cook timer run started `secondsAgo` before NOW. */
const running = (secondsAgo: number, banked = 0): CookTimerState => ({
  timerElapsedSeconds: banked,
  timerStartedAt: new Date(NOW - secondsAgo * 1000).toISOString(),
});

/** A recipe with nothing banked and nothing running on its prep timer. */
const idlePrep = (): PrepTimerState => ({
  prepTimerElapsedSeconds: 0,
  prepTimerStartedAt: null,
});

/** A recipe whose current prep timer run started `secondsAgo` before NOW. */
const runningPrep = (secondsAgo: number, banked = 0): PrepTimerState => ({
  prepTimerElapsedSeconds: banked,
  prepTimerStartedAt: new Date(NOW - secondsAgo * 1000).toISOString(),
});

// ─── isCookTimerRunning ───

describe('isCookTimerRunning', () => {
  it('tracks whether a run segment is in flight', () => {
    expect(isCookTimerRunning(idle())).toBe(false);
    expect(isCookTimerRunning(running(60))).toBe(true);
  });
});

// ─── cookTimerElapsed ───

describe('cookTimerElapsed', () => {
  it('is zero for a recipe that has never been timed', () => {
    expect(cookTimerElapsed(idle(), NOW)).toBe(0);
  });

  it('counts the live segment while running', () => {
    expect(cookTimerElapsed(running(90), NOW)).toBe(90);
  });

  it('returns only the banked time while paused', () => {
    expect(cookTimerElapsed({ ...idle(), timerElapsedSeconds: 120 }, NOW)).toBe(120);
  });

  it('adds the live segment on top of banked time', () => {
    expect(cookTimerElapsed(running(30, 120), NOW)).toBe(150);
  });

  it('ignores a clock that moved backwards rather than rewinding', () => {
    const state = running(-600, 60);
    expect(cookTimerElapsed(state, NOW)).toBe(60);
  });

});

// ─── persistence behaviour ───
//
// Elapsed time is derived, never stored, so these are the cases that would
// break if anyone reintroduced a stored counter.

describe('surviving backgrounding and restarts', () => {
  it('keeps counting real time while the app was closed', () => {
    const state = running(0);
    expect(cookTimerElapsed(state, NOW)).toBe(0);
    expect(cookTimerElapsed(state, NOW + 30 * 60 * 1000)).toBe(30 * 60);
  });

  it('does not count the paused span', () => {
    const paused: CookTimerState = { ...idle(), timerElapsedSeconds: 5 * 60 };
    expect(cookTimerElapsed(paused, NOW + 60 * 60 * 1000)).toBe(5 * 60);
  });

  it('resumes from banked time without double-counting the first segment', () => {
    // 5m run, banked, then resumed 3m ago → 8m spent.
    expect(cookTimerElapsed(running(3 * 60, 5 * 60), NOW)).toBe(8 * 60);
  });
});

// ─── the prep timer — same math as the cook timer above, its own field pair ───

describe('prep timer', () => {
  it('isPrepTimerRunning tracks whether a prep run segment is in flight', () => {
    expect(isPrepTimerRunning(idlePrep())).toBe(false);
    expect(isPrepTimerRunning(runningPrep(30))).toBe(true);
  });

  it('prepTimerElapsed adds the live segment on top of banked time', () => {
    expect(prepTimerElapsed(idlePrep(), NOW)).toBe(0);
    expect(prepTimerElapsed(runningPrep(30, 60), NOW)).toBe(90);
  });

  it('a paused prep timer does not advance', () => {
    const paused: PrepTimerState = { ...idlePrep(), prepTimerElapsedSeconds: 5 * 60 };
    expect(prepTimerElapsed(paused, NOW + 60 * 60 * 1000)).toBe(5 * 60);
  });
});

// ─── hasRunningRecipeTimer ───

describe('hasRunningRecipeTimer', () => {
  it('is false when neither the cook nor prep segment is in flight', () => {
    expect(hasRunningRecipeTimer({ ...idle(), ...idlePrep() })).toBe(false);
  });

  it('is true while the cook segment is running, regardless of prep', () => {
    expect(hasRunningRecipeTimer({ ...running(60), ...idlePrep() })).toBe(true);
  });

  it('is true while the prep segment is running, regardless of cook', () => {
    expect(hasRunningRecipeTimer({ ...idle(), ...runningPrep(30) })).toBe(true);
  });

});

// ─── recipeTimerClock ───

describe('recipeTimerClock', () => {
  const base = { running: true, paused: false, elapsedSeconds: 0 };

  it('has no clock for a timer that has not started', () => {
    expect(recipeTimerClock({ ...base, running: false })).toBeNull();
  });

  it('counts up, with the state after the number', () => {
    expect(recipeTimerClock({ ...base, elapsedSeconds: 192 }))
      .toEqual({ clock: '3:12', state: 'elapsed' });
    expect(recipeTimerClock({ ...base, running: false, paused: true, elapsedSeconds: 192 }))
      .toEqual({ clock: '3:12', state: 'paused' });
  });

  it('keeps counting past the recipe\'s estimate: there is no target to be over', () => {
    expect(recipeTimerClock({ ...base, elapsedSeconds: 3 * 3600 }))
      .toEqual({ clock: '3:00:00', state: 'elapsed' });
  });
});

// ─── recipeTimerResetPrompt ───

describe('recipeTimerResetPrompt', () => {
  it('asks before throwing away time that is still counting, naming the timer', () => {
    expect(recipeTimerResetPrompt('Cook', { running: true, elapsedSeconds: 725 })).toEqual({
      title: 'Reset the cook timer?',
      message: '12:05 timed so far, not logged yet.',
    });
  });

  it('says a paused timer is paused', () => {
    expect(recipeTimerResetPrompt('Prep', { running: false, elapsedSeconds: 90 })).toEqual({
      title: 'Reset the prep timer?',
      message: 'Paused at 1:30, not logged yet.',
    });
  });

  it('does not ask when nothing has been timed', () => {
    expect(recipeTimerResetPrompt('Cook', { running: true, elapsedSeconds: 0.4 })).toBeNull();
    expect(recipeTimerResetPrompt('Cook', { running: false, elapsedSeconds: 0 })).toBeNull();
  });
});
