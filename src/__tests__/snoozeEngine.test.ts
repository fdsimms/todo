import { addDays, format } from 'date-fns';
import { computeSnoozeSuggestion } from '../utils/snoozeEngine';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
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
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
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
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
};

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
});

// need differenceInCalendarDays for the priority test above
import { differenceInCalendarDays } from 'date-fns';
