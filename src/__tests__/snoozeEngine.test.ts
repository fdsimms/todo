import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { computeSnoozeSuggestion } from '../utils/snoozeEngine';
import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';

const settingsState = { dayResetTime: '00:00' };

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ getCategoryByName: () => null }),
  },
}));

const BASE: Task = {
  id: 'task-1',
  title: 'Test',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date().toISOString(),
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
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
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
  vacationPause: false, excludeFromSuggestions: false,
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

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

let busySeq = 0;
function busyEvent(start: Date, end: Date, overrides: Partial<BusyEvent> = {}): BusyEvent {
  busySeq += 1;
  return {
    id: `busy-${busySeq}`,
    title: 'Meeting',
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

describe('computeSnoozeSuggestion', () => {
  it('returns tomorrow when no other tasks exist', () => {
    const task = makeTask({ id: 'snooze-me' });
    const result = computeSnoozeSuggestion(task, [task]);
    const tomorrow = addDays(new Date(), 1);
    expect(isoDate(result.date)).toBe(isoDate(tomorrow));
    expect(result.dayLabel).toBe('Tomorrow');
  });

  it('falls back to "balanced schedule" when every day has equal load and no history', () => {
    // Put 3 tasks on every candidate day so no day is "light" or "fewest",
    // and provide no completion history — reason falls through to default.
    const today = new Date();
    const filler = Array.from({ length: 7 }, (_, i) =>
      [0, 1, 2].map(j =>
        makeTask({ id: `filler-${i}-${j}`, dueDate: addDays(today, i + 1).toISOString() })
      )
    ).flat();
    const task = makeTask({ id: 'snooze-me' });
    const result = computeSnoozeSuggestion(task, [task, ...filler]);
    expect(result.reason).toBe('balanced schedule');
  });

  it('avoids a day packed with tasks', () => {
    const tomorrow = addDays(new Date(), 1);
    const tomorrowISO = tomorrow.toISOString();

    // Pile 5 tasks onto tomorrow
    const crowded = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `other-${i}`, dueDate: tomorrowISO })
    );
    const task = makeTask({ id: 'snooze-me' });

    const result = computeSnoozeSuggestion(task, [task, ...crowded]);

    // Should NOT pick tomorrow
    expect(isoDate(result.date)).not.toBe(isoDate(tomorrow));
    expect(['fewest tasks', 'light day'].some(s => result.reason.includes(s))).toBe(true);
  });

  it('prefers a day that matches tag completion history', () => {
    // Mark every Wednesday in the last 4 weeks as a completion for 'work' tasks
    const wednesdays = [7, 14, 21, 28].map(daysAgo => {
      const d = addDays(new Date(), -daysAgo);
      // Find the wednesday of that week (day 3)
      const dow = d.getDay();
      const diff = (3 - dow + 7) % 7;
      return addDays(d, diff);
    });

    const completed = wednesdays.map((d, i) =>
      makeTask({
        id: `done-${i}`,
        completed: true,
        completedAt: d.toISOString(),
        tags: ['work'],
      })
    );

    const task = makeTask({ id: 'snooze-me', tags: ['work'] });
    const result = computeSnoozeSuggestion(task, [task, ...completed]);

    // The result's day-of-week should be Wednesday (3)
    expect(result.date.getDay()).toBe(3);
    expect(result.reason).toContain('work');
  });

  it('accounts for projected recurring task load', () => {
    // A daily recurring task: due today, so tomorrow and beyond are projections
    const today = new Date();
    const dailyTask = makeTask({
      id: 'daily',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: today.toISOString(),
    });

    // An extra one-off task on D+2 to make it extra busy
    const d2 = addDays(today, 2);
    const extraTask = makeTask({ id: 'extra', dueDate: d2.toISOString() });

    const task = makeTask({ id: 'snooze-me' });
    const result = computeSnoozeSuggestion(task, [task, dailyTask, extraTask]);

    // Every day has the recurring task, but D+2 also has the extra — it should
    // never be chosen as the lightest day if another option has the same recurring load
    // but no extra task. (Just ensure result is valid and D+2 is disfavored.)
    const resultDayKey = isoDate(result.date);
    const d2Key = isoDate(d2);
    // D+2 should score worse than D+1 (same recurring load + 1 extra), so result should not be D+2
    expect(resultDayKey).not.toBe(d2Key);
  });

  it('keeps high-priority tasks close', () => {
    const urgentTask = makeTask({ id: 'snooze-me', priority: 4 });
    const lowTask = makeTask({ id: 'snooze-low', priority: 0 });

    const resultUrgent = computeSnoozeSuggestion(urgentTask, [urgentTask]);
    const resultLow = computeSnoozeSuggestion(lowTask, [lowTask]);

    const urgentDaysOut = differenceInCalendarDays(resultUrgent.date, new Date());
    const lowDaysOut = differenceInCalendarDays(resultLow.date, new Date());

    // Urgent task should be recommended closer than a low-priority task
    // (both have no load, so priority is the only differentiating signal)
    expect(urgentDaysOut).toBeLessThanOrEqual(lowDaysOut);
  });

  it('tie-breaks toward the earlier date', () => {
    // No other tasks, no history — all signals equal except recency
    const task = makeTask({ id: 'snooze-me' });
    const result = computeSnoozeSuggestion(task, [task]);
    const tomorrow = addDays(new Date(), 1);
    expect(isoDate(result.date)).toBe(isoDate(tomorrow));
  });

  it('never proposes a day past a recurring task\'s own next occurrence', () => {
    // A daily task pushed to the lightest day of the week isn't rescheduled,
    // it's skipped six times over — so the window stops at tomorrow, however
    // busy tomorrow is.
    const today = new Date();
    const task = makeTask({
      id: 'snooze-me',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: today.toISOString(),
    });
    const crowd = Array.from({ length: 8 }, (_, i) =>
      makeTask({ id: `busy${i}`, estimatedMinutes: 60, dueDate: addDays(today, 1).toISOString() })
    );

    const result = computeSnoozeSuggestion(task, [task, ...crowd]);

    expect(isoDate(result.date)).toBe(isoDate(addDays(today, 1)));
    expect(result.reason).toBe('when it next repeats');
  });

  it('lets an every-third-day task reach its third day', () => {
    const today = new Date();
    const task = makeTask({
      id: 'snooze-me',
      recurrenceType: 'daily',
      recurrenceInterval: 3,
      dueDate: today.toISOString(),
    });
    const crowd = [1, 2].flatMap(d =>
      Array.from({ length: 8 }, (_, i) =>
        makeTask({ id: `busy${d}-${i}`, estimatedMinutes: 60, dueDate: addDays(today, d).toISOString() })
      )
    );

    const result = computeSnoozeSuggestion(task, [task, ...crowd]);
    expect(isoDate(result.date)).toBe(isoDate(addDays(today, 3)));
  });

  it('only suggests a day the category is scheduled for', () => {
    // Whichever of the next 7 days is NOT the category's scheduled day-of-week
    const tomorrow = addDays(new Date(), 1);
    const scheduledDow = (tomorrow.getDay() + 2) % 7; // definitely not tomorrow's dow

    jest.spyOn(
      require('../store/useCategoryStore').useCategoryStore,
      'getState',
    ).mockReturnValue({
      getCategoryByName: () => ({ scheduleDays: [scheduledDow] }),
    });

    const task = makeTask({ id: 'snooze-me', category: 'Errands' });
    const result = computeSnoozeSuggestion(task, [task]);
    expect(result.date.getDay()).toBe(scheduledDow);
  });

  describe('calendar busy time', () => {
    it('avoids a day packed with meetings even though it has no tasks', () => {
      const tomorrow = addDays(new Date(), 1);
      const dayAfter = addDays(new Date(), 2);

      // Tomorrow is otherwise the obvious pick — nothing due, nearest day — but
      // it's an 8-hour meeting day. The day after has nothing on it at all.
      const meetingStart = new Date(tomorrow);
      meetingStart.setHours(9, 0, 0, 0);
      const meetingEnd = new Date(tomorrow);
      meetingEnd.setHours(17, 0, 0, 0);
      const events = [busyEvent(meetingStart, meetingEnd)];

      const task = makeTask({ id: 'snooze-me' });

      const withoutCalendar = computeSnoozeSuggestion(task, [task]);
      expect(isoDate(withoutCalendar.date)).toBe(isoDate(tomorrow));

      const withCalendar = computeSnoozeSuggestion(task, [task], events);
      expect(isoDate(withCalendar.date)).toBe(isoDate(dayAfter));
    });

    it('ignores an all-day event and one marked Free', () => {
      const tomorrow = addDays(new Date(), 1);
      const events = [
        busyEvent(tomorrow, addDays(tomorrow, 1), { allDay: true }),
        busyEvent(tomorrow, addDays(tomorrow, 1), { availability: 'free' }),
      ];
      const task = makeTask({ id: 'snooze-me' });
      const result = computeSnoozeSuggestion(task, [task], events);
      expect(isoDate(result.date)).toBe(isoDate(tomorrow));
    });

    it('defaults to no calendar data when the parameter is omitted', () => {
      const task = makeTask({ id: 'snooze-me' });
      const withDefault = computeSnoozeSuggestion(task, [task]);
      const withEmpty = computeSnoozeSuggestion(task, [task], []);
      expect(isoDate(withDefault.date)).toBe(isoDate(withEmpty.date));
    });
  });

  describe('day reset time', () => {
    afterEach(() => {
      jest.useRealTimers();
      settingsState.dayResetTime = '00:00';
    });

    it('anchors candidate days to the logical day during the early-morning grace window', () => {
      // 1:30 AM on June 11, with a 2:00 AM reset — still "June 10" logically,
      // so the nearest candidate ("tomorrow") should be June 11, not June 12.
      settingsState.dayResetTime = '02:00';
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2025, 5, 11, 1, 30, 0));

      const task = makeTask({ id: 'snooze-me' });
      const result = computeSnoozeSuggestion(task, [task]);

      expect(result.date.getDate()).toBe(11);
      expect(result.date.getMonth()).toBe(5);
      expect(result.dayLabel).toBe('Tomorrow');
    });
  });
});

// need differenceInCalendarDays for the priority test above
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
