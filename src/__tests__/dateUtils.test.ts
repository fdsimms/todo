import {
  getDayStart,
  formatDueDate,
  formatDeferUntil,
  formatGroupHeader,
  getNextDueDate,
  getStreakDisplay,
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
  dueDate: null,
  deferUntil: null,
  timeOfDay: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  tags: [],
  sortOrder: 0,
  focused: false,
  someday: false,
  priority: 0,
  effort: 0,
  streakCount: 0,
  streakDate: null,
  recurrenceFromCompletion: false,
  reminderTime: null,
  parentId: null,
  projectId: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
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
    expect(formatDueDate(new Date(2026, 0, 1, 9, 0, 0).toISOString())).toBe('Jan 1');
  });
});

// ─── formatDeferUntil ─────────────────────────────────────────────────────────

describe('formatDeferUntil', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Today" for today', () => {
    const result = formatDeferUntil(new Date(2025, 5, 10, 15, 30, 0).toISOString());
    expect(result).toBe('Today');
  });

  it('returns "Tomorrow" for tomorrow', () => {
    const result = formatDeferUntil(new Date(2025, 5, 11, 9, 0, 0).toISOString());
    expect(result).toBe('Tomorrow');
  });

  it('returns a day name within this week', () => {
    const result = formatDeferUntil(new Date(2025, 5, 14, 14, 45, 0).toISOString());
    expect(result).toBe('Saturday');
  });

  it('returns "MMM d" for dates beyond this week', () => {
    const result = formatDeferUntil(new Date(2025, 6, 20, 14, 45, 0).toISOString());
    expect(result).toBe('Jul 20');
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

  it('returns "Today" for today', () => {
    expect(formatGroupHeader(new Date(2025, 5, 10, 20, 0, 0).toISOString())).toBe('Today');
  });

  it('returns "Tomorrow" for tomorrow', () => {
    expect(formatGroupHeader(new Date(2025, 5, 11, 8, 0, 0).toISOString())).toBe('Tomorrow');
  });

  it('returns a day name within this week', () => {
    // June 14 is Saturday — still this week
    expect(formatGroupHeader(new Date(2025, 5, 14, 8, 0, 0).toISOString())).toBe('Saturday');
  });

  it('returns "MMMM d" beyond this week', () => {
    expect(formatGroupHeader(new Date(2025, 6, 1, 8, 0, 0).toISOString())).toBe('July 1');
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
});

// ─── getStreakDisplay ─────────────────────────────────────────────────────────

describe('getStreakDisplay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // June 10 2025 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null for non-recurring tasks', () => {
    expect(getStreakDisplay({ ...baseTask, recurrenceType: 'none' })).toBeNull();
  });

  it('returns null when streakDate is null', () => {
    expect(getStreakDisplay({ ...baseTask, recurrenceType: 'daily', streakDate: null })).toBeNull();
  });

  it('returns null when streak count is 1 (not yet a streak)', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      streakCount: 1,
      streakDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    };
    expect(getStreakDisplay(task)).toBeNull();
  });

  it('returns positive streak when completed today', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      streakCount: 5,
      streakDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    };
    expect(getStreakDisplay(task)).toEqual({ sign: '+', count: 5 });
  });

  it('returns positive streak when last completed yesterday', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      streakCount: 3,
      streakDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(), // yesterday
    };
    expect(getStreakDisplay(task)).toEqual({ sign: '+', count: 3 });
  });

  it('returns negative streak (daysMissed - 1) when days were skipped', () => {
    // streakDate = 3 days ago → daysMissed=3 → count = 3-1 = 2
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      streakCount: 7,
      streakDate: new Date(2025, 5, 7, 12, 0, 0).toISOString(),
    };
    expect(getStreakDisplay(task)).toEqual({ sign: '-', count: 2 });
  });

  it('counts exactly 1 missed day correctly', () => {
    // streakDate = 2 days ago → daysMissed=2 → count = 1
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      streakCount: 4,
      streakDate: new Date(2025, 5, 8, 12, 0, 0).toISOString(),
    };
    expect(getStreakDisplay(task)).toEqual({ sign: '-', count: 1 });
  });

  it('works for weekly recurrence too', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      streakCount: 8,
      streakDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    };
    expect(getStreakDisplay(task)).toEqual({ sign: '+', count: 8 });
  });
});
