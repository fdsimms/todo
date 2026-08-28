import { nextStreakRecord, bestStreakOf, isStreakAtRecord, streakHint } from '../utils/streakRecord';

const at = (streakCount: number, priorBestStreak: number) => ({ streakCount, priorBestStreak });

// ─── nextStreakRecord ─────────────────────────────────────────────────────────

describe('nextStreakRecord', () => {
  it('folds the run that just ended when the streak breaks to zero', () => {
    expect(nextStreakRecord(at(12, 5), 0)).toBe(12);
  });

  it('folds it when a gap restarts the run at one', () => {
    expect(nextStreakRecord(at(12, 5), 1)).toBe(12);
  });

  it('keeps the older record when the run that ended was shorter', () => {
    expect(nextStreakRecord(at(3, 20), 0)).toBe(20);
  });

  it('changes nothing while the run is climbing', () => {
    expect(nextStreakRecord(at(12, 5), 13)).toBe(5);
  });

  // getStreakOutcome's 'same-day' case — a second completion on one day holds
  // the count, which is the same run rather than a new one.
  it('changes nothing when the count holds', () => {
    expect(nextStreakRecord(at(12, 5), 12)).toBe(5);
  });
});

// ─── bestStreakOf ─────────────────────────────────────────────────────────────

describe('bestStreakOf', () => {
  it('is the stored record while the live run is behind it', () => {
    expect(bestStreakOf(at(4, 20))).toBe(20);
  });

  // The reason it's derived: a live run past the old record *is* the record,
  // and showing the superseded number while it climbs would be wrong.
  it('is the live run once it has passed the record', () => {
    expect(bestStreakOf(at(21, 20))).toBe(21);
  });

  it('is zero for a task that has never had a streak', () => {
    expect(bestStreakOf(at(0, 0))).toBe(0);
  });
});

// ─── isStreakAtRecord ─────────────────────────────────────────────────────────

describe('isStreakAtRecord', () => {
  it('is true once the run is past every run before it', () => {
    expect(isStreakAtRecord(at(21, 20))).toBe(true);
  });

  it('is false while matching the record, since a tie is not a win', () => {
    expect(isStreakAtRecord(at(20, 20))).toBe(false);
  });

  it('is false below the record', () => {
    expect(isStreakAtRecord(at(19, 20))).toBe(false);
  });

  // A first-ever streak has nothing to have beaten. Without this gate every
  // recurring task would light up on day one, which would make the state say
  // nothing at all on exactly the tasks with no history to compare against.
  it('is false for a first run, however long it gets', () => {
    expect(isStreakAtRecord(at(1, 0))).toBe(false);
    expect(isStreakAtRecord(at(60, 0))).toBe(false);
  });
});

// ─── the two rules together ───────────────────────────────────────────────────

// The property the whole design exists for: overtaking happens once per run,
// not on every completion after it. A running all-time maximum would be raised
// by the streak measuring against it, so day 35, 36 and 37 would each "beat"
// the record set the day before.
describe('overtaking a record', () => {
  it('lights up once and stays lit for the rest of the run', () => {
    const record = 34;
    let prior = record;
    const lit: number[] = [];
    let wasLit = false;

    for (let streak = 32; streak <= 38; streak++) {
      const task = { streakCount: streak, priorBestStreak: prior };
      const nowLit = isStreakAtRecord(task);
      if (nowLit && !wasLit) lit.push(streak);
      wasLit = nowLit;
      // A climbing run never folds, which is what holds `prior` still.
      prior = nextStreakRecord(task, streak + 1);
    }

    // Exactly one crossing, on the first day past 34.
    expect(lit).toEqual([35]);
    expect(prior).toBe(record);
  });

  it('hands the finished run to the record only when it ends', () => {
    let task = { streakCount: 38, priorBestStreak: 34 };
    task = { streakCount: 0, priorBestStreak: nextStreakRecord(task, 0) };
    expect(task.priorBestStreak).toBe(38);
    // And the next run has the higher bar to clear.
    expect(isStreakAtRecord({ streakCount: 35, priorBestStreak: task.priorBestStreak })).toBe(false);
    expect(isStreakAtRecord({ streakCount: 39, priorBestStreak: task.priorBestStreak })).toBe(true);
  });
});

// ─── streakHint ───────────────────────────────────────────────────────────────

describe('streakHint', () => {
  it('says nothing about a record a task has never set', () => {
    expect(streakHint(at(0, 0))).toBe('No streak yet');
  });

  it('names the record a broken run left behind', () => {
    expect(streakHint(at(0, 34))).toBe('No streak yet. Longest run: 34 days');
  });

  it('names the record a live run is still short of', () => {
    expect(streakHint(at(12, 34))).toBe('12 day streak. Longest run: 34 days');
  });

  it('says so once the live run is the record', () => {
    expect(streakHint(at(35, 34))).toBe('35 day streak, the longest this task has had');
  });

  // A first run has no record to report, so the row spends the line on saying
  // what tapping it does instead.
  it('keeps the affordance on a first run', () => {
    expect(streakHint(at(12, 0))).toBe('12 day streak, tap to correct');
  });

  it('resolves the plural', () => {
    // "day streak" stays singular whatever the count — it qualifies "streak",
    // it isn't a count of days. Only the record clause pluralizes.
    expect(streakHint(at(1, 0))).toBe('1 day streak, tap to correct');
    expect(streakHint(at(9, 0))).toBe('9 day streak, tap to correct');
    expect(streakHint(at(0, 1))).toBe('No streak yet. Longest run: 1 day');
  });
});
