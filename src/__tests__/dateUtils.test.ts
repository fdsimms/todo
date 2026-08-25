import {
  getDayStart,
  formatDeadlineDate,
  formatScheduledDate,
  formatStartDate,
  formatGroupHeader,
  getNextDueDate,
  getStreakOutcome,
  getDeadlineCountdown,
  getDeadlineFromMonthDay,
  getDeadlineFromOffset,
  describeDeadlineOffset,
  getLogicalToday,
  getLogicalTomorrow,
  getLogicalNow,
  dayKeyOf,
  dayKeyToDate,
  getLogicalDayKey,
  isBeforeDayReset,
  getEffectiveTaskDate,
  formatTaskDate,
  seriesMonthDaysFrom,
  getNextSeriesDates,
  recurrenceAnchorDayFor,
} from '../utils/dateUtils';
import type { Task } from '../types';

// weekStartsOn is mutable because getNextWeekdayOccurrence reads it: an
// interval > 1 has to know which seven days "the next week" is.
const settings = { dayResetTime: '00:00', weekStartsOn: 0 as 0 | 1 };

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => settings,
  },
}));

const baseTask: Task = {
  id: 'test-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
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
  recurrenceAnchorDay: null,
  recurrenceAnchorDate: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  tags: [],
  sortOrder: 0,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  recurrenceFromCompletion: false,
  supplyCount: null,
  supplyUnit: null,
  supplyRefillCount: null,
  supplyReorderAt: 1,
  supplyLeadDays: null,
  supplyDeclinedAtCount: null,
  supplyGroceryItemId: null,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
  reminderTime: null,
  reminderKind: 'notification',
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
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
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  waitingOnPersonId: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
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

// ─── formatDeadlineDate ───────────────────────────────────────────────────────

describe('formatDeadlineDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Today" for a date matching the current day', () => {
    expect(formatDeadlineDate(new Date(2025, 5, 10, 9, 0, 0).toISOString())).toBe('Today');
  });

  it('returns "Tomorrow" for the next day', () => {
    expect(formatDeadlineDate(new Date(2025, 5, 11, 9, 0, 0).toISOString())).toBe('Tomorrow');
  });

  it('returns overdue label for past dates', () => {
    expect(formatDeadlineDate(new Date(2025, 5, 7, 9, 0, 0).toISOString())).toBe('3d overdue');
    expect(formatDeadlineDate(new Date(2025, 5, 9, 9, 0, 0).toISOString())).toBe('1d overdue');
  });

  it('returns a day name for dates within the current week', () => {
    // June 12 (Thursday) is within the same Sun-Sat week as June 10 (Tuesday)
    const result = formatDeadlineDate(new Date(2025, 5, 12, 9, 0, 0).toISOString());
    expect(result).toBe('Thursday');
  });

  it('returns "MMM d" for dates beyond this week', () => {
    expect(formatDeadlineDate(new Date(2025, 6, 15, 9, 0, 0).toISOString())).toBe('Jul 15');
  });

  it('returns "MMM d, yyyy" for dates in a different year', () => {
    expect(formatDeadlineDate(new Date(2026, 0, 1, 9, 0, 0).toISOString())).toBe('Jan 1, 2026');
    expect(formatDeadlineDate(new Date(2029, 7, 19, 9, 0, 0).toISOString())).toBe('Aug 19, 2029');
  });

  it('is not "overdue" for a deadline on the logical day, checked after midnight but before dayResetTime', () => {
    // It's 12:30 AM on June 11, but with a 4 AM reset the logical day is still June 10.
    jest.setSystemTime(new Date(2025, 5, 11, 0, 30, 0));
    const dueToday = formatDeadlineDate(new Date(2025, 5, 10, 18, 0, 0).toISOString(), '04:00');
    expect(dueToday).toBe('Today');
  });
});

// ─── formatScheduledDate ──────────────────────────────────────────────────────

describe('formatScheduledDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // Tue June 10, 2025
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Today" for a date matching the current day', () => {
    expect(formatScheduledDate(new Date(2025, 5, 10, 9, 0, 0).toISOString())).toBe('Today');
  });

  it('returns "Tomorrow" for the next day', () => {
    expect(formatScheduledDate(new Date(2025, 5, 11, 9, 0, 0).toISOString())).toBe('Tomorrow');
  });

  // The reason this formatter exists: a due date is the day a task becomes
  // available, so a past one has elapsed, not lapsed. Only Task.deadline is
  // ever "overdue".
  it('reads a past date as elapsed, never as overdue', () => {
    expect(formatScheduledDate(new Date(2025, 5, 9, 9, 0, 0).toISOString())).toBe('Yesterday');
    expect(formatScheduledDate(new Date(2025, 5, 8, 9, 0, 0).toISOString())).toBe('2d ago');
    expect(formatScheduledDate(new Date(2025, 5, 7, 9, 0, 0).toISOString())).toBe('3d ago');
  });

  // June 8 (Sunday) is in the same Sun-Sat week as June 10, but a past date
  // takes the elapsed form rather than the weekday name — "Sunday" alone
  // reads as upcoming.
  it('prefers the elapsed form over a weekday name for a past date this week', () => {
    expect(formatScheduledDate(new Date(2025, 5, 8, 9, 0, 0).toISOString())).toBe('2d ago');
  });

  it('returns a day name for dates within the current week', () => {
    expect(formatScheduledDate(new Date(2025, 5, 12, 9, 0, 0).toISOString())).toBe('Thursday');
  });

  it('returns "MMM d" for dates beyond this week, and adds the year for another one', () => {
    expect(formatScheduledDate(new Date(2025, 6, 15, 9, 0, 0).toISOString())).toBe('Jul 15');
    expect(formatScheduledDate(new Date(2026, 0, 1, 9, 0, 0).toISOString())).toBe('Jan 1, 2026');
  });

  it('is still "Today" for a task dated on the logical day, checked before dayResetTime', () => {
    jest.setSystemTime(new Date(2025, 5, 11, 0, 30, 0));
    expect(formatScheduledDate(new Date(2025, 5, 10, 18, 0, 0).toISOString(), '04:00')).toBe('Today');
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

  it('reads as the deferred day for a task that was pushed back', () => {
    // Due Sunday, deliberately pushed to Thursday — it surfaces Thursday, so
    // dating it to Sunday would misreport a move the user chose.
    const task = {
      dueDate: new Date(2025, 5, 8, 12, 0, 0).toISOString(),
      deferUntil: new Date(2025, 5, 12, 12, 0, 0).toISOString(),
    };
    expect(formatTaskDate(task)).toBe('Thursday');
  });

  // A do-date that has come and gone is a task sitting available, not a task
  // that broke a promise — that word belongs to Task.deadline alone.
  it('reads a past date as elapsed rather than overdue', () => {
    const task = { dueDate: new Date(2025, 5, 7, 12, 0, 0).toISOString(), deferUntil: null };
    expect(formatTaskDate(task)).toBe('3d ago');
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

// #1953: pulling an occurrence forward has to move its real date, because
// there is no "un-hide" to pair with deferUntil's hide — so the grid keeps its
// own anchor and steps from that instead.
describe('getNextDueDate with a grid anchor', () => {
  it('steps from the anchor, not from the day the occurrence was pulled to', () => {
    const friday = new Date(2026, 7, 28, 12);
    const wednesday = new Date(2026, 7, 26, 12);
    const pulled: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: wednesday.toISOString(),
      recurrenceAnchorDate: friday.toISOString(),
    };
    const next = getNextDueDate(pulled)!;
    expect(next.getDay()).toBe(5);
    expect(next.getDate()).toBe(4);
    expect(next.getMonth()).toBe(8);
  });

  it('falls back to dueDate when there is no anchor, which is every existing row', () => {
    const friday = new Date(2026, 7, 28, 12);
    const plain: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: friday.toISOString(),
      recurrenceAnchorDate: null,
    };
    expect(getNextDueDate(plain)!.getDate()).toBe(4);
  });

  // recurrenceFromCompletion measures from the day you finished and has no grid
  // to be knocked off, so the anchor is simply not its business.
  it('is ignored by a from-completion rule', () => {
    const fromCompletion: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 3,
      recurrenceFromCompletion: true,
      dueDate: new Date(2026, 7, 26, 12).toISOString(),
      recurrenceAnchorDate: new Date(2020, 0, 1, 12).toISOString(),
    };
    const next = getNextDueDate(fromCompletion)!;
    expect(next.getFullYear()).toBeGreaterThan(2020);
  });

  it('keeps a monthly task on the 31st after a pull forward', () => {
    // The drift recurrenceAnchorDay exists to stop, arriving by the other door:
    // read the moved date and the 31st is lost for good.
    const pulled: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      dueDate: new Date(2026, 0, 28, 12).toISOString(),
      recurrenceAnchorDate: new Date(2026, 0, 31, 12).toISOString(),
      recurrenceAnchorDay: 31,
    };
    expect(getNextDueDate(pulled)!.getDate()).toBe(28); // February clamps
  });

  it('derives the month anchor day from the grid, not from the moved row', () => {
    expect(recurrenceAnchorDayFor({
      recurrenceType: 'monthly',
      recurrenceMonthDay: null,
      recurrenceWeekOrdinal: null,
      recurrenceFromCompletion: false,
      dueDate: new Date(2026, 0, 28, 12).toISOString(),
      recurrenceAnchorDate: new Date(2026, 0, 31, 12).toISOString(),
    })).toBe(31);
  });

  it('still derives it from dueDate when nothing has been pulled', () => {
    expect(recurrenceAnchorDayFor({
      recurrenceType: 'monthly',
      recurrenceMonthDay: null,
      recurrenceWeekOrdinal: null,
      recurrenceFromCompletion: false,
      dueDate: new Date(2026, 0, 31, 12).toISOString(),
      recurrenceAnchorDate: null,
    })).toBe(31);
  });
});

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
      recurrenceAnchorDay: null,
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
      recurrenceAnchorDay: null,
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
      recurrenceAnchorDay: null,
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
      recurrenceAnchorDay: null,
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
      recurrenceAnchorDay: null,
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

  // ─── the day-of-month anchor ──────────────────────────────────────────────

  it('keeps the 31st through a short month instead of clamping to it for good', () => {
    // The bug this exists for: addMonths clamps Jan 31 to Feb 28, and the
    // clamped date then becomes the next anchor — Feb 28, Mar 28, Apr 28, for
    // ever, off one February. See Task.recurrenceAnchorDay.
    let task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      dueDate: new Date(2026, 0, 31, 12, 0, 0).toISOString(),
      recurrenceAnchorDay: 31,
    };
    const walked: number[] = [];
    for (let i = 0; i < 4; i++) {
      const next = getNextDueDate(task, '00:00')!;
      walked.push(next.getDate());
      task = { ...task, dueDate: next.toISOString() };
    }
    expect(walked).toEqual([28, 31, 30, 31]); // Feb, Mar, Apr, May
  });

  it('falls back to the due date\'s own day when no anchor was captured', () => {
    // A row older than the column: it behaves exactly as it did, which is the
    // clamping walk above. Worth pinning so the fallback can't quietly change.
    let task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      dueDate: new Date(2026, 0, 31, 12, 0, 0).toISOString(),
      recurrenceAnchorDay: null,
    };
    const walked: number[] = [];
    for (let i = 0; i < 3; i++) {
      const next = getNextDueDate(task, '00:00')!;
      walked.push(next.getDate());
      task = { ...task, dueDate: next.toISOString() };
    }
    expect(walked).toEqual([28, 28, 28]);
  });

  it('an explicit recurrenceMonthDay still wins over the anchor', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      dueDate: new Date(2026, 0, 31, 12, 0, 0).toISOString(),
      recurrenceMonthDay: 5,
      recurrenceAnchorDay: 31,
    };
    expect(getNextDueDate(task, '00:00')!.getDate()).toBe(5);
  });

  it('puts Feb 29 back on the next leap year rather than settling on the 28th', () => {
    let task: Task = {
      ...baseTask,
      recurrenceType: 'yearly',
      recurrenceInterval: 1,
      dueDate: new Date(2024, 1, 29, 12, 0, 0).toISOString(),
      recurrenceAnchorDay: 29,
    };
    const walked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = getNextDueDate(task, '00:00')!;
      walked.push(`${next.getFullYear()}-${next.getMonth() + 1}-${next.getDate()}`);
      task = { ...task, dueDate: next.toISOString() };
    }
    expect(walked).toEqual(['2025-2-28', '2026-2-28', '2027-2-28', '2028-2-29']);
  });

  // ─── the week the interval counts in ──────────────────────────────────────

  it('counts a multi-week interval from the user\'s own week start', () => {
    // Fri + Sun, every two weeks, from Fri Aug 7 2026. On a Monday-start week
    // that pair sits inside one week and should land Fri then Sun two days
    // later. Anchored to Sunday instead, the Sunday falls in the *next* block
    // and the pair reads 9 days apart.
    const walk = (): string[] => {
      let task: Task = {
        ...baseTask,
        recurrenceType: 'weekly',
        recurrenceInterval: 2,
        recurrenceDays: [0, 5],
        dueDate: new Date(2026, 7, 7, 12, 0, 0).toISOString(), // Fri Aug 7 2026
      };
      const out: string[] = [];
      for (let i = 0; i < 3; i++) {
        const next = getNextDueDate(task, '00:00')!;
        out.push(next.toDateString());
        task = { ...task, dueDate: next.toISOString() };
      }
      return out;
    };

    settings.weekStartsOn = 1;
    expect(walk()).toEqual(['Sun Aug 09 2026', 'Fri Aug 21 2026', 'Sun Aug 23 2026']);

    // Unchanged for a Sunday-start week, which is what every other test here
    // is written against.
    settings.weekStartsOn = 0;
    expect(walk()).toEqual(['Sun Aug 16 2026', 'Fri Aug 21 2026', 'Sun Aug 30 2026']);
  });

  // ─── catch-up ─────────────────────────────────────────────────────────────

  it('leaves a stale answer alone without catchUp', () => {
    // The default is what projectOccurrences walks a month with, so it must
    // keep stepping one interval at a time from wherever it's anchored.
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 4, 6, 12, 0, 0).toISOString(), // five weeks before NOW
    };
    expect(getNextDueDate(task, '00:00')!.toDateString()).toBe('Tue May 13 2025');
  });

  it('catches an overdue occurrence up to today, staying on the rule\'s own grid', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 4, 6, 12, 0, 0).toISOString(), // Tue May 6, NOW is Tue Jun 10
    };
    // Not "tomorrow" and not May 13: the next Tuesday that isn't in the past,
    // which is today's.
    expect(getNextDueDate(task, '00:00', { catchUp: true })!.toDateString()).toBe('Tue Jun 10 2025');
  });

  it('catches up to the next occurrence ahead when today is not on the grid', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      recurrenceDays: [5], // Fridays; NOW is a Tuesday
      dueDate: new Date(2025, 4, 2, 12, 0, 0).toISOString(),
    };
    expect(getNextDueDate(task, '00:00', { catchUp: true })!.toDateString()).toBe('Fri Jun 13 2025');
  });

  it('does not resurrect a series whose end date passed while it was overdue', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 4, 6, 12, 0, 0).toISOString(),
      recurrenceEndDate: new Date(2025, 4, 20, 23, 59, 59).toISOString(),
    };
    expect(getNextDueDate(task, '00:00', { catchUp: true })).toBeNull();
  });

  it('is inert for a from-completion rule, which is never behind', () => {
    const task: Task = {
      ...baseTask,
      recurrenceType: 'daily',
      recurrenceInterval: 3,
      recurrenceFromCompletion: true,
      supplyCount: null,
      supplyUnit: null,
      supplyRefillCount: null,
      supplyReorderAt: 1,
      supplyLeadDays: null,
      supplyDeclinedAtCount: null,
      supplyGroceryItemId: null,
      dueDate: new Date(2025, 0, 1, 12, 0, 0).toISOString(),
    };
    const plain = getNextDueDate(task, '00:00')!;
    const caught = getNextDueDate(task, '00:00', { catchUp: true })!;
    expect(caught.toDateString()).toBe(plain.toDateString());
    expect(caught.toDateString()).toBe('Fri Jun 13 2025');
  });
});

// ─── recurrenceAnchorDayFor ─────────────────────────────────────────────────

describe('recurrenceAnchorDayFor', () => {
  const monthly = (overrides: Partial<Task> = {}): Task => ({
    ...baseTask,
    recurrenceType: 'monthly',
    dueDate: new Date(2026, 0, 31, 12, 0, 0).toISOString(),
    ...overrides,
  });

  it('reads the day off the due date for a monthly rule', () => {
    expect(recurrenceAnchorDayFor(monthly())).toBe(31);
  });

  it('reads it for a yearly rule too', () => {
    expect(recurrenceAnchorDayFor(monthly({ recurrenceType: 'yearly' }))).toBe(31);
  });

  it('is null for the rules that already say where the grid sits', () => {
    expect(recurrenceAnchorDayFor(monthly({ recurrenceMonthDay: 5 }))).toBeNull();
    expect(recurrenceAnchorDayFor(monthly({ recurrenceWeekOrdinal: 2, recurrenceDays: [2] }))).toBeNull();
  });

  it('is null when the rule measures from the completion rather than a date', () => {
    expect(recurrenceAnchorDayFor(monthly({ recurrenceFromCompletion: true }))).toBeNull();
  });

  it('is null for the recurrence types the anchor means nothing to', () => {
    expect(recurrenceAnchorDayFor(monthly({ recurrenceType: 'weekly' }))).toBeNull();
    expect(recurrenceAnchorDayFor(monthly({ recurrenceType: 'none' }))).toBeNull();
  });

  it('is null with no due date to read', () => {
    expect(recurrenceAnchorDayFor(monthly({ dueDate: null }))).toBeNull();
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

// ─── getDeadlineFromOffset / describeDeadlineOffset ──────────────────────────

describe('getDeadlineFromOffset', () => {
  it('counts back from the due date for a positive offset', () => {
    const result = getDeadlineFromOffset(new Date(2026, 0, 20), 3);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(17);
  });

  it('counts forward from the due date for a negative offset', () => {
    const result = getDeadlineFromOffset(new Date(2026, 0, 20), -10);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(30);
  });

  it('crosses a month boundary going forward', () => {
    const result = getDeadlineFromOffset(new Date(2026, 0, 25), -10);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(4);
  });
});

describe('describeDeadlineOffset', () => {
  it('describes a positive offset as before the due date', () => {
    expect(describeDeadlineOffset(3)).toBe('3 days before due');
  });

  it('describes a negative offset as after the due date', () => {
    expect(describeDeadlineOffset(-10)).toBe('10 days after due');
  });

  it('singularises either direction', () => {
    expect(describeDeadlineOffset(1)).toBe('1 day before due');
    expect(describeDeadlineOffset(-1)).toBe('1 day after due');
  });

  it('never renders a negative sign in the day count', () => {
    expect(describeDeadlineOffset(-4)).not.toContain('-');
  });

  it('describes a zero offset as the due date itself', () => {
    expect(describeDeadlineOffset(0)).toBe('on the due date');
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

describe('dayKeyOf', () => {
  it('is the local calendar day, zero-padded', () => {
    expect(dayKeyOf(new Date(2026, 7, 5))).toBe('2026-08-05');
    expect(dayKeyOf(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  // Zero-padding is what lets a range read be a plain `date >= ? AND date <= ?`
  // and a sort be a string compare.
  it('sorts lexically in date order', () => {
    const keys = [
      dayKeyOf(new Date(2026, 7, 10)),
      dayKeyOf(new Date(2026, 7, 9)),
      dayKeyOf(new Date(2026, 6, 31)),
    ].sort();
    expect(keys).toEqual(['2026-07-31', '2026-08-09', '2026-08-10']);
  });

  it('ignores the time of day, including either side of a dayResetTime', () => {
    expect(dayKeyOf(new Date(2026, 7, 5, 0, 0, 0))).toBe('2026-08-05');
    expect(dayKeyOf(new Date(2026, 7, 5, 1, 30, 0))).toBe('2026-08-05');
    expect(dayKeyOf(new Date(2026, 7, 5, 23, 59, 59))).toBe('2026-08-05');
  });
});

describe('getLogicalDayKey', () => {
  it('keys a completion a few hours after midnight to the previous day when it precedes dayResetTime', () => {
    const completedAt = new Date(2026, 7, 5, 1, 0, 0); // 1am
    expect(getLogicalDayKey(completedAt, '04:00')).toBe('2026-08-04');
  });

  it('keys a completion after dayResetTime to that same calendar day', () => {
    const completedAt = new Date(2026, 7, 5, 5, 0, 0); // 5am
    expect(getLogicalDayKey(completedAt, '04:00')).toBe('2026-08-05');
  });

  it('matches the plain calendar day when dayResetTime is midnight', () => {
    const completedAt = new Date(2026, 7, 5, 1, 0, 0);
    expect(getLogicalDayKey(completedAt, '00:00')).toBe('2026-08-05');
  });
});

describe('dayKeyToDate', () => {
  it('round-trips through dayKeyOf', () => {
    const key = dayKeyOf(new Date(2026, 7, 5));
    expect(dayKeyOf(dayKeyToDate(key))).toBe(key);
  });

  it('lands on local midnight, not UTC midnight', () => {
    const d = dayKeyToDate('2026-08-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(0);
  });
});
