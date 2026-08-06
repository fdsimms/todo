import {
  getDayStart,
  formatDueDate,
  formatStartDate,
  formatGroupHeader,
  getNextDueDate,
  getStreakOutcome,
  getDeadlineCountdown,
  getDeadlineFromMonthDay,
  getLogicalToday,
  getLogicalTomorrow,
  getLogicalNow,
  isBeforeDayReset,
  getEffectiveTaskDate,
  formatTaskDate,
  seriesMonthDaysFrom,
  getNextSeriesDates,
} from '../utils/dateUtils';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
  },
}));

const baseTask: Task = {
  id: 'test-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: new Date(2025, 0, 1).toISOString(),
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  tags: [],
  sortOrder: 0,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  recurrenceFromCompletion: false,
  targetCount: null,
  progressCount: 0,
  reminderTime: null,
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  blockedById: null,
};

// June 10, 2025 10:00 AM — a Tuesday (getDay() === 2)
const NOW = new Date(2025, 5, 10, 10, 0, 0);

// ─── getDayStart ─────────────────────────────────────────────────────────────

describe('getDayStart', () => {
  it('returns the same day when at or after the reset hour', () => {
    const date = new Date(2025, 0, 15, 10, 0, 0); // 10:00 AM
    const result = getDayStart(date, '06:00');
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(6);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('returns the previous day when before the reset hour', () => {
    const date = new Date(2025, 0, 15, 1, 0, 0); // 1:00 AM — before 6:00 reset
    const result = getDayStart(date, '06:00');
    expect(result.getDate()).toBe(14);
    expect(result.getHours()).toBe(6);
  });

  it('treats exactly the reset hour as same day', () => {
    const date = new Date(2025, 0, 15, 6, 0, 0); // exactly 6:00
    const result = getDayStart(date, '06:00');
    expect(result.getDate()).toBe(15);
  });

  it('uses midnight (00:00) correctly — any time after midnight is same day', () => {
    const date = new Date(2025, 0, 15, 0, 1, 0); // 00:01
    const result = getDayStart(date, '00:00');
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(0);
  });

  it('works across a month boundary', () => {
    const date = new Date(2025, 1, 1, 1, 0, 0); // Feb 1 at 1 AM — before 2 AM reset
    const result = getDayStart(date, '02:00');
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(31);
  });
});

// ─── formatDueDate ────────────────────────────────────────────────────────────

describe('formatDueDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Today" for a date matching the current day', () => {
    expect(formatDueDate(new Date(2025, 5, 10, 9, 0, 0).toISOString())).toBe('Today');
  });

  it('returns "Tomorrow" for the next day', () => {
    expect(formatDueDate(new Date(2025, 5, 11, 9, 0, 0).toISOString())).toBe('Tomorrow');
  });

  it('returns overdue label for past dates', () => {
    expect(formatDueDate(new Date(2025, 5, 7, 9, 0, 0).toISOString())).toBe('3d overdue');
    expect(formatDueDate(new Date(2025, 5, 9, 9, 0, 0).toISOString())).toBe('1d overdue');
  });

  it('returns a day name for dates within the current week', () => {
    // June 12 (Thursday) is within the same Sun-Sat week as June 10 (Tuesday)
    const result = formatDueDate(new Date(2025, 5, 12, 9, 0, 0).toISOString());
    expect(result).toBe('Thursday');
  });

  it('returns "MMM d" for dates beyond this week', () => {
    expect(formatDueDate(new Date(2025, 6, 15, 9, 0, 0).toISOString())).toBe('Jul 15');
  });

  it('returns "MMM d, yyyy" for dates in a different year', () => {
    expect(formatDueDate(new Date(2026, 0, 1, 9, 0, 0).toISOString())).toBe('Jan 1, 2026');
    expect(formatDueDate(new Date(2029, 7, 19, 9, 0, 0).toISOString())).toBe('Aug 19, 2029');
  });

  it('is not "overdue" for a task due on the logical day, checked after midnight but before dayResetTime', () => {
    // It's 12:30 AM on June 11, but with a 4 AM reset the logical day is still June 10.
    jest.setSystemTime(new Date(2025, 5, 11, 0, 30, 0));
    const dueToday = formatDueDate(new Date(2025, 5, 10, 18, 0, 0).toISOString(), '04:00');
    expect(dueToday).toBe('Today');
  });
});

// ─── getEffectiveTaskDate / formatTaskDate ───────────────────────────────────

describe('getEffectiveTaskDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // Tue June 10, 2025
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const due = new Date(2025, 5, 10, 12, 0, 0).toISOString();   // today
  const later = new Date(2025, 5, 12, 12, 0, 0).toISOString(); // Thursday
  const earlier = new Date(2025, 5, 8, 12, 0, 0).toISOString(); // Sunday

  it('prefers a deferUntil that pushes the task past its due date', () => {
    expect(getEffectiveTaskDate({ dueDate: due, deferUntil: later })).toBe(later);
  });

  it('keeps the due date when deferUntil is earlier', () => {
    expect(getEffectiveTaskDate({ dueDate: due, deferUntil: earlier })).toBe(due);
  });

  it('keeps the due date when both fall on the same day', () => {
    const sameDayLater = new Date(2025, 5, 10, 23, 0, 0).toISOString();
    expect(getEffectiveTaskDate({ dueDate: due, deferUntil: sameDayLater })).toBe(due);
  });

  it('falls back to whichever field is set', () => {
    expect(getEffectiveTaskDate({ dueDate: due, deferUntil: null })).toBe(due);
    expect(getEffectiveTaskDate({ dueDate: null, deferUntil: later })).toBe(later);
    expect(getEffectiveTaskDate({ dueDate: null, deferUntil: null })).toBeNull();
  });
});

describe('formatTaskDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads as the deferred day rather than "overdue" for a task that was pushed back', () => {
    // Due Sunday, deliberately pushed to Thursday — it surfaces Thursday, so
    // labelling it "2d overdue" would punish a move the user chose.
    const task = {
      dueDate: new Date(2025, 5, 8, 12, 0, 0).toISOString(),
      deferUntil: new Date(2025, 5, 12, 12, 0, 0).toISOString(),
    };
    expect(formatTaskDate(task)).toBe('Thursday');
  });

  it('still reads as overdue when the task is genuinely late', () => {
    const task = { dueDate: new Date(2025, 5, 7, 12, 0, 0).toISOString(), deferUntil: null };
    expect(formatTaskDate(task)).toBe('3d overdue');
  });

  it('returns null when the task has no date at all', () => {
    expect(formatTaskDate({ dueDate: null, deferUntil: null })).toBeNull();
  });
});

describe('formatStartDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 9, 0, 0)); // Tue June 10, 2025
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Today" for a date matching the current day', () => {
    expect(formatStartDate(new Date(2025, 5, 10, 9, 0, 0).toISOString())).toBe('Today');
  });

  it('returns "Tomorrow" for the next day', () => {
    expect(formatStartDate(new Date(2025, 5, 11, 9, 0, 0).toISOString())).toBe('Tomorrow');
  });

  it('returns the plain calendar date for a past date, not an overdue label', () => {
    expect(formatStartDate(new Date(2025, 5, 7, 9, 0, 0).toISOString())).toBe('Jun 7');
    expect(formatStartDate(new Date(2025, 3, 1, 9, 0, 0).toISOString())).toBe('Apr 1');
  });

  it('returns a day name for future dates within the current week', () => {
    const result = formatStartDate(new Date(2025, 5, 12, 9, 0, 0).toISOString());
    expect(result).toBe('Thursday');
  });

  it('returns "MMM d" for dates beyond this week', () => {
    expect(formatStartDate(new Date(2025, 6, 15, 9, 0, 0).toISOString())).toBe('Jul 15');
  });

  it('returns "MMM d, yyyy" for dates in a different year', () => {
    expect(formatStartDate(new Date(2029, 7, 19, 9, 0, 0).toISOString())).toBe('Aug 19, 2029');
  });
});

// ─── formatGroupHeader ────────────────────────────────────────────────────────

describe('formatGroupHeader', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Today · MMM d" for today', () => {
    expect(formatGroupHeader(new Date(2025, 5, 10, 20, 0, 0).toISOString())).toBe('Today · Jun 10');
  });

  it('returns "Tomorrow · MMM d" for tomorrow', () => {
    expect(formatGroupHeader(new Date(2025, 5, 11, 8, 0, 0).toISOString())).toBe('Tomorrow · Jun 11');
  });

  it('returns "EEEE · MMM d" for a day within the next week', () => {
    // June 14 is Saturday, 4 days out — within the rolling next-week window
    expect(formatGroupHeader(new Date(2025, 5, 14, 8, 0, 0).toISOString())).toBe('Saturday · Jun 14');
  });

  it('still gives the 6th day out its own header', () => {
    // June 16 is Monday, 6 days out — last day of the rolling window
    expect(formatGroupHeader(new Date(2025, 5, 16, 8, 0, 0).toISOString())).toBe('Monday · Jun 16');
  });

  it('batches dates 7+ days out by month name', () => {
    // June 17 is 7 days out — first date to be batched
    expect(formatGroupHeader(new Date(2025, 5, 17, 8, 0, 0).toISOString())).toBe('June');
    expect(formatGroupHeader(new Date(2025, 6, 1, 8, 0, 0).toISOString())).toBe('July');
  });

  it('includes the year for batched dates in a different year', () => {
    expect(formatGroupHeader(new Date(2026, 0, 1, 8, 0, 0).toISOString())).toBe('January 2026');
  });
});

// ─── getLogicalToday / getLogicalTomorrow / isBeforeDayReset ─────────────────

describe('getLogicalToday / getLogicalTomorrow / isBeforeDayReset', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('matches the calendar date when well after the reset hour', () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // June 10, 2025, 10:00 AM

    const today = getLogicalToday('02:00');
    expect(today.getFullYear()).toBe(2025);
    expect(today.getMonth()).toBe(5);
    expect(today.getDate()).toBe(10);

    const tomorrow = getLogicalTomorrow('02:00');
    expect(tomorrow.getDate()).toBe(11);

    expect(isBeforeDayReset('02:00')).toBe(false);
  });

  it('stays on the previous calendar day during the early-morning grace window', () => {
    // 1:30 AM on June 11 — before the 2:00 AM reset, so still "June 10" logically
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 11, 1, 30, 0));

    const today = getLogicalToday('02:00');
    expect(today.getDate()).toBe(10);

    const tomorrow = getLogicalTomorrow('02:00');
    expect(tomorrow.getDate()).toBe(11);

    expect(isBeforeDayReset('02:00')).toBe(true);
  });

  it('is never "before reset" when dayResetTime is midnight', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 11, 0, 30, 0)); // 12:30 AM

    expect(isBeforeDayReset('00:00')).toBe(false);
  });
});

// ─── getLogicalNow ─────────────────────────────────────────────────────────

describe('getLogicalNow', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('matches the wall clock when well after the reset hour', () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // June 10, 2025, 10:00 AM

    expect(getLogicalNow('02:00').getTime()).toBe(NOW.getTime());
  });

  it('rolls back to the previous calendar day, preserving the clock time, during the early-morning grace window', () => {
    // 1:30 AM on June 11 — before the 2:00 AM reset, so "tomorrow" typed here
    // should resolve relative to June 10 (the logical day), not June 11.
    jest.useFakeTimers();
    const wallClock = new Date(2025, 5, 11, 1, 30, 0);
    jest.setSystemTime(wallClock);

    const logicalNow = getLogicalNow('02:00');
    expect(logicalNow.getDate()).toBe(10);
    expect(logicalNow.getHours()).toBe(1);
    expect(logicalNow.getMinutes()).toBe(30);
  });
});

// ─── getNextDueDate ───────────────────────────────────────────────────────────

describe('getNextDueDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // June 10 2025, Tuesday
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('daily interval=1 adds 1 day from today\'s logical start', () => {
    const task: Task = { ...baseTask, recurrenceType: 'daily', recurrenceInterval: 1 };
    const result = getNextDueDate(task, '00:00')!;
    const expected = new Date(2025, 5, 11, 0, 0, 0);
    expect(result.getFullYear()).toBe(expected.getFullYear());
    expect(result.getMonth()).toBe(expected.getMonth());
    expect(result.getDate()).toBe(expected.getDate());
  });

  it('daily interval=3 adds 3 days', () => {
    const task: Task = { ...baseTask, recurrenceType: 'daily', recurrenceInterval: 3 };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getDate()).toBe(13);
  });

  it('weekly without specific days adds N weeks', () => {
    const task: Task = { ...baseTask, recurrenceType: 'weekly', recurrenceInterval: 2 };
    const result = getNextDueDate(task, '00:00')!;
    const expected = new Date(2025, 5, 24, 0, 0, 0); // June 10 + 14 days
    expect(result.getDate()).toBe(expected.getDate());
    expect(result.getMonth()).toBe(expected.getMonth());
  });

  it('monthly interval=1 adds 1 month', () => {
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceInterval: 1 };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(10);
  });

  it('monthly with recurrenceMonthDay picks that day next month when already past it this month', () => {
    // NOW is June 10. recurrenceMonthDay=5 has already passed this month.
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceMonthDay: 5 };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(5);
  });

  it('monthly with recurrenceMonthDay picks that day this month when still upcoming', () => {
    // NOW is June 10. recurrenceMonthDay=20 hasn't happened yet this month.
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceMonthDay: 20 };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(20);
  });

  it('monthly with recurrenceMonthDay clamps to the last day of short months', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceMonthDay: 31,
      dueDate: new Date(2025, 0, 31, 0, 0, 0).toISOString(), // Jan 31
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28); // clamped, 2025 not a leap year
  });

  it('monthly with recurrenceMonthDay=-1 (last day) picks the last day of next month when already past it', () => {
    // NOW is June 10, 30-day month, so June 30 already lies ahead — but this
    // asserts the "already past" branch using a due date deep in June instead.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceMonthDay: -1,
      dueDate: new Date(2025, 5, 30, 0, 0, 0).toISOString(), // June 30, already the last day
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(31); // last day of July
  });

  it('monthly with recurrenceMonthDay=-1 (last day) picks this month\'s last day when still upcoming', () => {
    // NOW is June 10; June's last day (30) hasn't happened yet.
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceMonthDay: -1 };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(30);
  });

  it('monthly with recurrenceMonthDay=-1 lands on Feb 28 (non-leap year)', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceMonthDay: -1,
      dueDate: new Date(2025, 0, 31, 0, 0, 0).toISOString(), // Jan 31, already the last day
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28);
  });

  it('monthly with recurrenceWeekOrdinal picks the Nth weekday next month when already past it', () => {
    // NOW is June 10 (Tuesday). The 2nd Tuesday of June (the 10th) is today's
    // due date, so the next occurrence is the 2nd Tuesday of July.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceWeekOrdinal: 2,
      recurrenceDays: [2], // Tuesday
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(8); // 2nd Tuesday of July 2025
  });

  it('monthly with recurrenceWeekOrdinal picks this month\'s Nth weekday when still upcoming', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceWeekOrdinal: 4,
      recurrenceDays: [2], // Tuesday
      dueDate: new Date(2025, 5, 1, 0, 0, 0).toISOString(), // June 1
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(24); // 4th Tuesday of June 2025
  });

  it('monthly with recurrenceWeekOrdinal=-1 (last) picks the last weekday of the month', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceWeekOrdinal: -1,
      recurrenceDays: [5], // Friday
      dueDate: new Date(2025, 5, 1, 0, 0, 0).toISOString(), // June 1
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(27); // last Friday of June 2025
  });

  it('monthly recurrenceWeekOrdinal takes precedence over recurrenceMonthDay when both are set', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceWeekOrdinal: 1,
      recurrenceDays: [1], // Monday
      recurrenceMonthDay: 15,
      dueDate: new Date(2025, 5, 1, 0, 0, 0).toISOString(), // June 1
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(2); // 1st Monday of June 2025, not the 15th
  });

  it('yearly interval=1 adds 1 year', () => {
    const task: Task = { ...baseTask, recurrenceType: 'yearly', recurrenceInterval: 1 };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(10);
  });

  it('weekly with days picks the next upcoming weekday', () => {
    // NOW is Tuesday (2). recurrenceDays=[4] means Thursday.
    // Next Thursday from Tuesday = +2 days → June 12
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: [4],
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getDate()).toBe(12); // Thursday June 12
    expect(result.getDay()).toBe(4);
  });

  it('weekly with days wraps to next week when all days are earlier in the week', () => {
    // NOW is Tuesday (2). recurrenceDays=[1] means Monday.
    // Next Monday = 7 - 2 + 1 = 6 days later → June 16
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: [1],
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getDate()).toBe(16); // Monday June 16
    expect(result.getDay()).toBe(1);
  });

  it('weekly with days and interval=2 does not add extra days within the same week', () => {
    // NOW is Tuesday (2). recurrenceDays=[4] (Thursday) is still upcoming this
    // week, so "every 2 weeks" should still land this Thursday, not skip a week.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 2,
      recurrenceDays: [4],
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getDate()).toBe(12); // Thursday June 12
    expect(result.getDay()).toBe(4);
  });

  it('weekly with days and interval=2 skips a week once wrapping past the last selected day', () => {
    // NOW is Tuesday (2). recurrenceDays=[1] (Monday) has already passed this
    // week, so "every 2 weeks" should wrap an extra 7 days past the normal wrap.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 2,
      recurrenceDays: [1],
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(23); // Monday June 23, not June 16
    expect(result.getDay()).toBe(1);
  });

  it('monthly with recurrenceMonthDay and interval=2 skips 2 months once past this month', () => {
    // NOW is June 10. recurrenceMonthDay=5 has already passed this month.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceInterval: 2,
      recurrenceMonthDay: 5,
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(7); // August, not July
    expect(result.getDate()).toBe(5);
  });

  it('monthly with recurrenceWeekOrdinal and interval=2 skips 2 months once past this month', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceInterval: 2,
      recurrenceWeekOrdinal: 2,
      recurrenceDays: [2], // Tuesday
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(), // 2nd Tuesday of June
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getMonth()).toBe(7); // August, not July
    expect(result.getDate()).toBe(12); // 2nd Tuesday of August 2025
  });

  it('weekly with multiple days picks the nearest upcoming day', () => {
    // NOW is Tuesday (2). recurrenceDays=[2, 5] means Tuesday and Friday.
    // Next day > 2 is 5 (Friday) → June 13
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: [2, 5],
    };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getDate()).toBe(13); // Friday June 13
    expect(result.getDay()).toBe(5);
  });

  it('falls back to +1 day for unknown recurrence type', () => {
    // @ts-expect-error — testing the default branch
    const task: Task = { ...baseTask, recurrenceType: 'unknown' };
    const result = getNextDueDate(task, '00:00')!;
    expect(result.getDate()).toBe(11);
  });

  it('returns null when next date is after recurrenceEndDate', () => {
    // NOW is June 10 2025. Next daily occurrence = June 11. End date = June 10 → null.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceEndDate: new Date(2025, 5, 10, 23, 59, 59).toISOString(),
    };
    expect(getNextDueDate(task, '00:00')).toBeNull();
  });

  it('returns a date when next date is on the same day as recurrenceEndDate', () => {
    // Next occurrence is June 11; end date is end of June 11 → still valid.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceEndDate: new Date(2025, 5, 11, 23, 59, 59).toISOString(),
    };
    expect(getNextDueDate(task, '00:00')).not.toBeNull();
  });

  it('returns null when weekly next date exceeds recurrenceEndDate', () => {
    // NOW is Tuesday June 10. Weekly recurrenceDays=[4] → next = June 12 (Thu).
    // End date = June 11 → next (June 12) is after end date → null.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: [4],
      recurrenceEndDate: new Date(2025, 5, 11, 23, 59, 59).toISOString(),
    };
    expect(getNextDueDate(task, '00:00')).toBeNull();
  });

  it('returns null when recurrenceCount is 1 (this is the last occurrence)', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceCount: 1,
    };
    expect(getNextDueDate(task, '00:00')).toBeNull();
  });

  it('returns a date when recurrenceCount has more than one occurrence remaining', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceCount: 2,
    };
    expect(getNextDueDate(task, '00:00')).not.toBeNull();
  });

  it('treats recurrenceCount null as unlimited', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceCount: null,
    };
    expect(getNextDueDate(task, '00:00')).not.toBeNull();
  });

  it('advances a full day even when the previous dueDate\'s clock time precedes dayResetTime', () => {
    // Fixed-schedule tasks anchor to their own dueDate rather than "now" — but
    // the dueDate's clock time (e.g. a midnight anchor predating a later
    // dayResetTime) must not be reinterpreted as "still the previous logical
    // day" the way getDayStart's rollback does for "now". Doing so pulls the
    // anchor back a day before +1 is applied, so the recurrence lands right
    // back on the same day instead of advancing — the task looks permanently
    // stuck (and overdue) rather than moving forward.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 9, 0, 0, 0).toISOString(), // June 9, midnight anchor
    };
    const result = getNextDueDate(task, '04:00')!;
    expect(result.getDate()).toBe(10); // June 10 — not stuck on June 9
  });
});

// ─── getStreakOutcome ───────────────────────────────────────────────────────

describe('getStreakOutcome', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // Tue June 10 2025, 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns reset for non-recurring tasks', () => {
    const task: Task = { ...baseTask, recurrenceType: 'none', streakDate: new Date(2025, 5, 9).toISOString() };
    expect(getStreakOutcome(task)).toBe('reset');
  });

  it('returns reset when streakDate is null', () => {
    expect(getStreakOutcome({ ...baseTask, recurrenceType: 'daily', streakDate: null })).toBe('reset');
  });

  it('returns same-day when already completed today', () => {
    const task: Task = { ...baseTask, recurrenceType: 'daily', streakDate: new Date(2025, 5, 10, 0, 0, 0).toISOString() };
    expect(getStreakOutcome(task)).toBe('same-day');
  });

  it('continues a daily streak completed the very next day', () => {
    const task: Task = { ...baseTask, recurrenceType: 'daily', recurrenceInterval: 1, streakDate: new Date(2025, 5, 9).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('resets a daily streak after missing several days', () => {
    const task: Task = { ...baseTask, recurrenceType: 'daily', recurrenceInterval: 1, streakDate: new Date(2025, 5, 7).toISOString() };
    expect(getStreakOutcome(task)).toBe('reset');
  });

  it('respects recurrenceInterval for a "every 2 days" habit', () => {
    const task: Task = { ...baseTask, recurrenceType: 'daily', recurrenceInterval: 2, streakDate: new Date(2025, 5, 8).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('continues a weekly streak (no fixed days) completed a week later — the #691 regression', () => {
    const task: Task = { ...baseTask, recurrenceType: 'weekly', recurrenceInterval: 1, streakDate: new Date(2025, 5, 3).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('tolerates a weekly streak completed a day late', () => {
    const task: Task = { ...baseTask, recurrenceType: 'weekly', recurrenceInterval: 1, streakDate: new Date(2025, 5, 2).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('resets a weekly streak once it is more than a day late', () => {
    const task: Task = { ...baseTask, recurrenceType: 'weekly', recurrenceInterval: 1, streakDate: new Date(2025, 5, 1).toISOString() };
    expect(getStreakOutcome(task)).toBe('reset');
  });

  it('derives the gap from selected weekdays, not a flat 7', () => {
    // Mon/Wed/Fri habit last completed Monday June 2 — the next slot is Wednesday June 4, a 2-day gap.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceDays: [1, 3, 5],
      streakDate: new Date(2025, 5, 2).toISOString(),
    };
    jest.setSystemTime(new Date(2025, 5, 4, 10, 0, 0)); // Wed June 4
    expect(getStreakOutcome(task)).toBe('continued');

    jest.setSystemTime(new Date(2025, 5, 6, 10, 0, 0)); // Fri June 6 — two slots missed
    expect(getStreakOutcome(task)).toBe('reset');
  });

  it('continues a monthly streak completed a calendar month later', () => {
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceInterval: 1, streakDate: new Date(2025, 4, 10).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('resets a monthly streak after skipping a month', () => {
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceInterval: 1, streakDate: new Date(2025, 3, 10).toISOString() };
    expect(getStreakOutcome(task)).toBe('reset');
  });

  it('respects recurrenceInterval for a bimonthly habit', () => {
    const task: Task = { ...baseTask, recurrenceType: 'monthly', recurrenceInterval: 2, streakDate: new Date(2025, 3, 10).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('continues a yearly streak completed a calendar year later', () => {
    const task: Task = { ...baseTask, recurrenceType: 'yearly', recurrenceInterval: 1, streakDate: new Date(2024, 5, 10).toISOString() };
    expect(getStreakOutcome(task)).toBe('continued');
  });

  it('resets a yearly streak after skipping a year', () => {
    const task: Task = { ...baseTask, recurrenceType: 'yearly', recurrenceInterval: 1, streakDate: new Date(2023, 5, 10).toISOString() };
    expect(getStreakOutcome(task)).toBe('reset');
  });
});

// ─── getDeadlineCountdown ──────────────────────────────────────────────────────

describe('getDeadlineCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // June 10 2025 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 0 when the deadline is today', () => {
    expect(getDeadlineCountdown(new Date(2025, 5, 10, 22, 0, 0).toISOString(), '00:00')).toBe(0);
  });

  it('returns a positive count for a future deadline', () => {
    expect(getDeadlineCountdown(new Date(2025, 5, 13).toISOString(), '00:00')).toBe(3);
  });

  it('returns a negative count for a deadline already passed', () => {
    expect(getDeadlineCountdown(new Date(2025, 5, 8).toISOString(), '00:00')).toBe(-2);
  });

  it('respects dayResetTime for both today and the deadline', () => {
    // 1:30 AM on June 11 is still logical-day June 10 with a 2 AM reset.
    jest.setSystemTime(new Date(2025, 5, 11, 1, 30, 0));
    expect(getDeadlineCountdown(new Date(2025, 5, 11, 1, 0, 0).toISOString(), '02:00')).toBe(0);
  });
});

// ─── getDeadlineFromMonthDay ─────────────────────────────────────────────────

describe('getDeadlineFromMonthDay', () => {
  it('returns the last day of the due date\'s month when day is -1', () => {
    const result = getDeadlineFromMonthDay(new Date(2026, 0, 20), -1); // Jan 20, 2026
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(31);
  });

  it('resolves the last day correctly for a shorter month', () => {
    const result = getDeadlineFromMonthDay(new Date(2026, 1, 20), -1); // Feb 20, 2026 (not a leap year)
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it('returns a fixed day-of-month within the due date\'s own month', () => {
    const result = getDeadlineFromMonthDay(new Date(2026, 0, 5), 15);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(15);
  });

  it('clamps a day beyond the month length to the last day', () => {
    const result = getDeadlineFromMonthDay(new Date(2026, 1, 1), 31); // February
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });
});

// ─── dated series ────────────────────────────────────────────────────────────

describe('seriesMonthDaysFrom', () => {
  it('reads the day-of-month anchors off a picked set', () => {
    expect(seriesMonthDaysFrom([new Date(2025, 8, 15), new Date(2025, 8, 10)])).toEqual([10, 15]);
  });

  it('dedupes the same day picked in two different months', () => {
    expect(seriesMonthDaysFrom([new Date(2025, 8, 10), new Date(2025, 9, 10)])).toEqual([10]);
  });
});

describe('getNextSeriesDates', () => {
  const set = (...days: number[]) => days.map(d => new Date(2025, 8, d, 12, 0, 0));

  it('moves the whole set into the next month', () => {
    const next = getNextSeriesDates(set(10, 15), [10, 15], 1);
    expect(next.map(d => [d.getMonth(), d.getDate()])).toEqual([[9, 10], [9, 15]]);
  });

  it('honours a multi-month interval', () => {
    const next = getNextSeriesDates(set(10, 15), [10, 15], 3);
    expect(next.map(d => d.getMonth())).toEqual([11, 11]);
  });

  it('anchors off the set\'s last date, not its first', () => {
    // A set spanning two months rolls forward from the later one.
    const spanning = [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 9, 15, 12, 0, 0)];
    const next = getNextSeriesDates(spanning, [10, 15], 1);
    expect(next.map(d => d.getMonth())).toEqual([10, 10]); // November
  });

  it('clamps a day the target month does not have', () => {
    const jan = [new Date(2026, 0, 31, 12, 0, 0)];
    const next = getNextSeriesDates(jan, [31], 1);
    expect(next[0].getMonth()).toBe(1);
    expect(next[0].getDate()).toBe(28);
  });

  it('recovers the real anchor after a clamped month instead of staying clamped', () => {
    // February clamped the 31st to the 28th; March gets the 31st back
    // because the anchor is stored, not re-derived from the clamped date.
    const feb = [new Date(2026, 1, 28, 12, 0, 0)];
    const next = getNextSeriesDates(feb, [31], 1);
    expect(next[0].getMonth()).toBe(2);
    expect(next[0].getDate()).toBe(31);
  });

  it('collapses two anchors that clamp onto the same short-month day', () => {
    const jan = [new Date(2026, 0, 30, 12, 0, 0), new Date(2026, 0, 31, 12, 0, 0)];
    const next = getNextSeriesDates(jan, [30, 31], 1);
    expect(next).toHaveLength(1);
    expect(next[0].getDate()).toBe(28);
  });

  it('supports -1 as the last day of the month', () => {
    const next = getNextSeriesDates(set(30), [-1], 1);
    expect(next[0].getMonth()).toBe(9);
    expect(next[0].getDate()).toBe(31); // October
  });

  it('carries the time of day over from the finished set', () => {
    const next = getNextSeriesDates([new Date(2025, 8, 10, 7, 45, 0)], [10], 1);
    expect(next[0].getHours()).toBe(7);
    expect(next[0].getMinutes()).toBe(45);
  });

  it('returns nothing when the set does not repeat', () => {
    expect(getNextSeriesDates(set(10, 15), [], 1)).toEqual([]);
  });
});
