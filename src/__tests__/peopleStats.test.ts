import type { MealPlanEntry, Task } from '../types';

// peopleStats reaches dayKeyOf in dateUtils, which reaches the settings store.
// The same stub the other pure tests use — nothing here reads a setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));
import {
  describeMealsTogether,
  describeTimeTogether,
  mealYearRange,
  mealsTogetherInRange,
  taskYearRange,
  timeTogetherInRange,
} from '../utils/peopleStats';

const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`, title: 'Task', notes: '', completed: true,
    completedAt: iso(2026, 6, 1), missedAt: null, autoScheduledAt: null,
    createdAt: iso(2026, 1, 1), seenAt: null, dueDate: null, deadline: null,
    deadlineOffsetDays: null, deadlineMonthDay: null, deferUntil: null,
    timeSegments: [], windowStart: null, windowEnd: null, personIds: [],
    recurrenceType: 'none', recurrenceInterval: 1, recurrenceDays: [],
    recurrenceMonthDay: null, recurrenceWeekOrdinal: null, recurrenceAnchorDay: null,
    recurrenceAnchorDate: null, recurrenceEndDate: null,
    recurrenceCount: null, recurrenceFromCompletion: false,
    targetCount: null, progressCount: 0, targetUnit: null, allowOvershoot: false,
    supplyCount: null, supplyUnit: null, supplyRefillCount: null, supplyReorderAt: 1,
    supplyLeadDays: null, supplyDeclinedAtCount: null, supplyGroceryItemId: null,
    tags: [], category: null, sortOrder: 0, pinned: false, pinnedOrder: 0, priority: 0, effort: 0,
    estimatedMinutes: null, reminderTime: null, reminderKind: 'notification', reminderOffsetDays: null, linkUrl: null,
    phoneNumber: null, emailAddress: null, location: null, blockedById: null, waitingOnPersonId: null,
    deliverableKind: null, deliverableValue: null, generatedKind: null, generatedSourceId: null,
    deadlineOnCalendar: false, calendarEventId: null, timeBlockEventId: null,
    pendingImport: null, backfillDismissedFields: [],
    streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null,
    showStreak: false, streakRequiresWindow: false,
    parentId: null, groupId: null, projectId: null,
    chainEnabled: false, chainIndex: 0, chainItems: [], chainStepOnSchedule: false, vacationPause: false, excludeFromSuggestions: false,
    extraTaskEveryN: null, extraTaskTitle: null, extraTaskDraft: null,
    extraTaskTally: 0, previousExtraTaskTally: 0,
    archived: false, archivedAt: null, timerStartedAt: null, actualMinutes: null,
    timedMinutes: null, timerElapsedSeconds: 0,
    previousOccurrenceId: null,
    seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1, seriesDefaults: null,
    postponeCount: 0, postponeMuted: false, driftingSince: null,
    quotaIntervalMinutes: null, quotaReminders: false, quotaStartedAt: null,
    ...over,
  };
}

function entry(over: Partial<MealPlanEntry> = {}): MealPlanEntry {
  seq += 1;
  return {
    id: `m${seq}`, date: '2026-06-01', slot: 'dinner', recipeId: null, title: 'Dinner',
    sortOrder: 1, createdAt: iso(2026, 1, 1), cookedAt: iso(2026, 6, 1), leftoverId: null,
    recipeChoices: [], personIds: ['p1'], recipeScale: 1, cookTask: null, shopTask: null,
    calendarEventId: null,
    ...over,
  };
}

describe('timeTogetherInRange', () => {
  it('counts a completed task naming somebody, in range', () => {
    expect(timeTogetherInRange([task({ personIds: ['p1'] })], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(1);
  });

  it('excludes a task naming nobody', () => {
    expect(timeTogetherInRange([task({ personIds: [] })], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(0);
  });

  it('excludes a subtask, the same as personHistory', () => {
    const sub = task({ personIds: ['p1'], parentId: 'parent' });
    expect(timeTogetherInRange([sub], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(0);
  });

  it('excludes a missed task even though it is stored completed', () => {
    const missed = task({ personIds: ['p1'], missedAt: iso(2026, 6, 1) });
    expect(timeTogetherInRange([missed], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(0);
  });

  it('excludes an incomplete task', () => {
    const open = task({ personIds: ['p1'], completed: false, completedAt: null });
    expect(timeTogetherInRange([open], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(0);
  });

  it('excludes a completion outside the range', () => {
    const lastYear = task({ personIds: ['p1'], completedAt: iso(2025, 12, 31) });
    expect(timeTogetherInRange([lastYear], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(0);
  });

  it('counts every event rather than collapsing repeats, like personHistory', () => {
    const rows = [task({ personIds: ['p1'] }), task({ personIds: ['p1'] }), task({ personIds: ['p2'] })];
    expect(timeTogetherInRange(rows, iso(2026, 1, 1), iso(2026, 12, 31))).toBe(3);
  });

  it('never carries forward a generated row with no personIds', () => {
    // Birthday/reachOut tasks deliberately carry no personIds — this is what
    // keeps them out without any generatedKind check needed.
    const generated = task({ generatedKind: 'birthday', personIds: [] });
    expect(timeTogetherInRange([generated], iso(2026, 1, 1), iso(2026, 12, 31))).toBe(0);
  });
});

describe('mealsTogetherInRange', () => {
  it('counts a cooked meal with a guest, in range', () => {
    expect(mealsTogetherInRange([entry()], '2026-01-01', '2026-12-31')).toBe(1);
  });

  it('excludes a meal with no guest', () => {
    expect(mealsTogetherInRange([entry({ personIds: [] })], '2026-01-01', '2026-12-31')).toBe(0);
  });

  it('excludes a planned meal that was never cooked', () => {
    expect(mealsTogetherInRange([entry({ cookedAt: null })], '2026-01-01', '2026-12-31')).toBe(0);
  });

  it('excludes a date outside the range', () => {
    expect(mealsTogetherInRange([entry({ date: '2025-12-31' })], '2026-01-01', '2026-12-31')).toBe(0);
  });

  it('counts several guests on one meal as one meal', () => {
    expect(mealsTogetherInRange([entry({ personIds: ['p1', 'p2'] })], '2026-01-01', '2026-12-31')).toBe(1);
  });
});

describe('describeTimeTogether', () => {
  it('is null for nothing to say, never a zero', () => {
    expect(describeTimeTogether(0)).toBeNull();
  });

  it('is singular for one', () => {
    expect(describeTimeTogether(1)).toBe('You spent time with people on 1 occasion this year.');
  });

  it('is plural otherwise', () => {
    expect(describeTimeTogether(11)).toBe('You spent time with people on 11 occasions this year.');
  });
});

describe('describeMealsTogether', () => {
  it('is null for nothing to say', () => {
    expect(describeMealsTogether(0)).toBeNull();
  });

  it('is singular for one', () => {
    expect(describeMealsTogether(1)).toBe('You had people over for a meal this year.');
  });

  it('is plural otherwise', () => {
    expect(describeMealsTogether(4)).toBe('You had people over for 4 meals this year.');
  });
});

describe('taskYearRange / mealYearRange', () => {
  it('starts on January 1st and ends on the given day', () => {
    const today = new Date(2026, 7, 25, 14, 30);
    const { startIso, endIso } = taskYearRange(today);
    expect(new Date(startIso).getMonth()).toBe(0);
    expect(new Date(startIso).getDate()).toBe(1);
    expect(endIso).toBe(today.toISOString());
  });

  it('agrees with taskYearRange about which year, as day keys', () => {
    const today = new Date(2026, 0, 1, 0, 30);
    const { startKey, endKey } = mealYearRange(today);
    expect(startKey).toBe('2026-01-01');
    expect(endKey).toBe('2026-01-01');
  });
});
