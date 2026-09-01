import {
  isNegativeTask,
  slipsToday,
  isCleanToday,
  slipPatch,
  undoSlipPatch,
  cleanDayPatch,
  type NegativeHabitFields,
} from '../utils/negativeHabits';

// A logical day start, the shape every function here takes. 02:00 rather than
// midnight throughout, so a test that quietly reasons in calendar days instead
// of logical ones has somewhere to go wrong.
const day = (d: number) => new Date(2026, 0, d, 2, 0, 0, 0);
const iso = (d: number) => day(d).toISOString();

function habit(over: Partial<NegativeHabitFields> = {}): NegativeHabitFields {
  return {
    polarity: 'negative',
    slipCount: 0,
    slipDate: null,
    streakCount: 0,
    streakDate: null,
    previousStreakCount: 0,
    previousStreakDate: null,
    priorBestStreak: 0,
    ...over,
  };
}

describe('isNegativeTask', () => {
  it('reads the flag', () => {
    expect(isNegativeTask({ polarity: 'negative' })).toBe(true);
    expect(isNegativeTask({ polarity: 'positive' })).toBe(false);
  });
});

describe('slipsToday', () => {
  it('is 0 for a task that has never slipped', () => {
    expect(slipsToday(habit(), day(10))).toBe(0);
  });

  it('reports today’s count', () => {
    expect(slipsToday(habit({ slipCount: 3, slipDate: iso(10) }), day(10))).toBe(3);
  });

  // The reason the count and its day travel together: a launch after midnight
  // must read clean without waiting for the rollover pass to reset anything.
  it('ignores a count belonging to an earlier day', () => {
    expect(slipsToday(habit({ slipCount: 3, slipDate: iso(9) }), day(10))).toBe(0);
    expect(isCleanToday(habit({ slipCount: 3, slipDate: iso(9) }), day(10))).toBe(true);
  });
});

describe('slipPatch', () => {
  it('breaks the run on the first slip of the day and snapshots it for undo', () => {
    const patch = slipPatch(habit({ streakCount: 12, streakDate: iso(9) }), day(10));
    expect(patch).toMatchObject({
      slipCount: 1,
      slipDate: iso(10),
      streakCount: 0,
      streakDate: iso(10),
      previousStreakCount: 12,
      previousStreakDate: iso(9),
    });
  });

  it('folds the broken run into the record', () => {
    const patch = slipPatch(habit({ streakCount: 12, streakDate: iso(9), priorBestStreak: 5 }), day(10));
    expect(patch.priorBestStreak).toBe(12);
  });

  it('keeps an existing record that the broken run did not beat', () => {
    const patch = slipPatch(habit({ streakCount: 3, streakDate: iso(9), priorBestStreak: 40 }), day(10));
    expect(patch.priorBestStreak).toBe(40);
  });

  // Frequency logging: the second cigarette is worth recording even though the
  // day is already lost.
  it('keeps counting on later slips the same day', () => {
    const patch = slipPatch(habit({ slipCount: 1, slipDate: iso(10), streakCount: 0 }), day(10));
    expect(patch).toEqual({ slipCount: 2, slipDate: iso(10) });
  });

  // The bug this guards: re-snapshotting on the second tap would overwrite the
  // 12-day run undo has to give back with the 0 the first tap left behind.
  it('does not overwrite the undo snapshot on a later slip', () => {
    const after = habit({
      slipCount: 1, slipDate: iso(10), streakCount: 0, streakDate: iso(10),
      previousStreakCount: 12, previousStreakDate: iso(9),
    });
    expect(slipPatch(after, day(10))).not.toHaveProperty('previousStreakCount');
  });

  it('restarts the count when the last slip was on an earlier day', () => {
    const patch = slipPatch(habit({ slipCount: 4, slipDate: iso(8), streakCount: 1 }), day(10));
    expect(patch.slipCount).toBe(1);
  });
});

describe('undoSlipPatch', () => {
  it('gives back the run the slip ended', () => {
    const slipped = habit({
      slipCount: 1, slipDate: iso(10), streakCount: 0, streakDate: iso(10),
      previousStreakCount: 12, previousStreakDate: iso(9),
    });
    expect(undoSlipPatch(slipped, day(10))).toEqual({
      slipCount: 0,
      slipDate: iso(10),
      streakCount: 12,
      streakDate: iso(9),
    });
  });

  it('takes back only the count while earlier slips today remain', () => {
    const slipped = habit({
      slipCount: 3, slipDate: iso(10), streakCount: 0, streakDate: iso(10),
      previousStreakCount: 12, previousStreakDate: iso(9),
    });
    expect(undoSlipPatch(slipped, day(10))).toEqual({ slipCount: 2, slipDate: iso(10) });
  });

  it('refuses when there is nothing logged today', () => {
    expect(undoSlipPatch(habit(), day(10))).toBeNull();
    expect(undoSlipPatch(habit({ slipCount: 2, slipDate: iso(9) }), day(10))).toBeNull();
  });
});

describe('cleanDayPatch', () => {
  it('ignores a positive task', () => {
    expect(cleanDayPatch(habit({ polarity: 'positive', streakDate: iso(1) }), day(10))).toBeNull();
  });

  it('anchors a task that has never been accounted for', () => {
    expect(cleanDayPatch(habit(), day(10))).toEqual({ streakDate: iso(10) });
  });

  // The off-by-one, stated from both ends. The anchor day is spent — the day
  // you slipped, or the partial day you created the habit on — so the first
  // day it can credit is the one after it, and only once that day is over.
  it('credits nothing on the day after the anchor', () => {
    expect(cleanDayPatch(habit({ streakDate: iso(9) }), day(10))).toBeNull();
  });

  it('credits the day in between, two days on', () => {
    expect(cleanDayPatch(habit({ streakCount: 0, streakDate: iso(9) }), day(11))).toEqual({
      streakCount: 1,
      streakDate: iso(10),
      priorBestStreak: 0,
    });
  });

  it('credits a whole gap at once', () => {
    expect(cleanDayPatch(habit({ streakCount: 2, streakDate: iso(3) }), day(10))).toMatchObject({
      streakCount: 8, // days 4..9 are six clean days, on top of the two already banked
      streakDate: iso(9),
    });
  });

  it('is idempotent within a day', () => {
    const first = cleanDayPatch(habit({ streakCount: 0, streakDate: iso(8) }), day(10));
    expect(first).toMatchObject({ streakCount: 1, streakDate: iso(9) });
    expect(cleanDayPatch(habit({ ...first } as NegativeHabitFields), day(10))).toBeNull();
  });

  it('never credits a clock that went backwards', () => {
    expect(cleanDayPatch(habit({ streakCount: 5, streakDate: iso(12) }), day(10))).toBeNull();
  });

  // Vacation protects a run rather than growing it, and consuming the days
  // away is what stops them landing in one lump the day vacation ends.
  it('moves the anchor without crediting while paused', () => {
    expect(cleanDayPatch(habit({ streakCount: 5, streakDate: iso(3) }), day(10), { paused: true })).toEqual({
      streakDate: iso(9),
    });
  });

  // A slip and the pass have to compose: the run restarts from the slip day,
  // not from wherever the streak was anchored before it.
  it('picks the run back up after a slip', () => {
    const slipped = { ...habit({ streakCount: 12, streakDate: iso(1) }), ...slipPatch(habit({ streakCount: 12, streakDate: iso(1) }), day(10)) } as NegativeHabitFields;
    expect(cleanDayPatch(slipped, day(11))).toBeNull();
    expect(cleanDayPatch(slipped, day(13))).toMatchObject({ streakCount: 2, streakDate: iso(12) });
  });
});
