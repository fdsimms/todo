import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { buildDayBuckets } from '../utils/calendarMonth';
import {
  ASSUMED_TASK_MINUTES,
  BUSY_DAY_MINUTES,
  FULL_DAY_MINUTES,
  buildDayLoads,
  describeDayLoad,
  describeDayWeight,
  weightFor,
} from '../utils/dayLoad';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
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
  quotaIntervalMinutes: null,
  quotaReminders: false,
  quotaStartedAt: null, quotaAlwaysVisible: false,
  quotaPeriod: 'day',
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
  priorBestStreak: 0,
  polarity: 'positive',
  slipCount: 0,
  slipDate: null,
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
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  extraTaskDraft: null,
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
  emailAddress: null, location: null,
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

let seq = 0;
function makeTask(overrides: Partial<Task>): Task {
  seq += 1;
  return { ...BASE, id: `task-${seq}`, ...overrides };
}

/** Local noon on a given day, so nothing here depends on the runner's zone. */
function at(year: number, month1: number, day: number): Date {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0);
}
function iso(year: number, month1: number, day: number): string {
  return at(year, month1, day).toISOString();
}
/** Local wall-clock time on a day, for events. */
function hour(year: number, month1: number, day: number, h: number): string {
  return new Date(year, month1 - 1, day, h, 0, 0, 0).toISOString();
}

function makeEvent(overrides: Partial<BusyEvent>): BusyEvent {
  return {
    id: 'ev-1',
    title: 'Standup',
    start: hour(2026, 8, 12, 9),
    end: hour(2026, 8, 12, 10),
    allDay: false,
    calendarId: 'cal-1',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

// August 2026, padded the way buildCalendarGrid pads a grid.
const FROM = at(2026, 7, 26);
const TO = at(2026, 9, 5);

/** Every day of the grid, the way a screen hands its own days over. */
const DAYS = (() => {
  const out: Date[] = [];
  for (let d = new Date(FROM); d <= TO; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)) {
    out.push(new Date(d));
  }
  return out;
})();

function loadsFor(
  tasks: Task[],
  busy?: { events: BusyEvent[]; start: Date; end: Date },
  dayResetTime = '00:00',
) {
  const buckets = buildDayBuckets(tasks, { from: FROM, to: TO, dayResetTime });
  return buildDayLoads(DAYS, buckets, {
    taskById: new Map(tasks.map(t => [t.id, t])),
    busyEvents: busy?.events,
    busyWindow: busy ? { start: busy.start, end: busy.end } : null,
    dayResetTime,
  });
}

describe('buildDayLoads', () => {
  it('counts an outstanding row and its estimate onto its due day', () => {
    const loads = loadsFor([makeTask({ dueDate: iso(2026, 8, 12), estimatedMinutes: 45 })]);
    const day = loads.get('2026-08-12')!;
    expect(day.taskCount).toBe(1);
    expect(day.taskMinutes).toBe(45);
    expect(day.unestimated).toBe(0);
  });

  it('counts a task with no estimate without pricing it', () => {
    const loads = loadsFor([makeTask({ dueDate: iso(2026, 8, 12) })]);
    const day = loads.get('2026-08-12')!;
    expect(day.taskCount).toBe(1);
    expect(day.taskMinutes).toBe(0);
    expect(day.unestimated).toBe(1);
    // Only the cue's number stands in for it.
    expect(day.rankedMinutes).toBe(ASSUMED_TASK_MINUTES);
  });

  it('counts one task once when it is both due and returning on a day', () => {
    const loads = loadsFor([
      makeTask({ dueDate: iso(2026, 8, 12), deferUntil: iso(2026, 8, 12), estimatedMinutes: 30 }),
    ]);
    const day = loads.get('2026-08-12')!;
    expect(day.taskCount).toBe(1);
    expect(day.taskMinutes).toBe(30);
  });

  it('ignores a completed row — the day has already accounted for it', () => {
    const loads = loadsFor([
      makeTask({ dueDate: iso(2026, 8, 12), estimatedMinutes: 60, completed: true, completedAt: iso(2026, 8, 12) }),
    ]);
    expect(loads.get('2026-08-12')!.taskCount).toBe(0);
    expect(loads.get('2026-08-12')!.taskMinutes).toBe(0);
  });

  it('does not charge a deadline day for work that is due elsewhere', () => {
    const loads = loadsFor([
      makeTask({ dueDate: iso(2026, 8, 12), deadline: iso(2026, 8, 20), estimatedMinutes: 90 }),
    ]);
    expect(loads.get('2026-08-12')!.taskMinutes).toBe(90);
    expect(loads.get('2026-08-20')!.taskCount).toBe(0);
    expect(loads.get('2026-08-20')!.rankedMinutes).toBe(0);
  });

  it('keeps a projected occurrence out of the counted rows but inside the ranking', () => {
    const loads = loadsFor([
      makeTask({
        dueDate: iso(2026, 8, 12),
        estimatedMinutes: 60,
        recurrenceType: 'daily',
        recurrenceInterval: 1,
      }),
    ]);
    const nextDay = loads.get('2026-08-13')!;
    expect(nextDay.taskCount).toBe(0);
    expect(nextDay.taskMinutes).toBe(0);
    expect(nextDay.projected).toBe(1);
    expect(nextDay.rankedMinutes).toBe(60);
  });

  it('reads meeting minutes for a day the calendar window covers', () => {
    const loads = loadsFor([makeTask({ dueDate: iso(2026, 8, 12), estimatedMinutes: 30 })], {
      events: [makeEvent({ start: hour(2026, 8, 12, 9), end: hour(2026, 8, 12, 11) })],
      start: at(2026, 8, 10),
      end: at(2026, 8, 24),
    });
    const day = loads.get('2026-08-12')!;
    expect(day.busyKnown).toBe(true);
    expect(day.busyMinutes).toBe(120);
    expect(day.rankedMinutes).toBe(150);
    // The stated task total never absorbs the meeting.
    expect(day.taskMinutes).toBe(30);
  });

  it('says nothing about events on a day the window does not reach', () => {
    const loads = loadsFor([makeTask({ dueDate: iso(2026, 8, 30), estimatedMinutes: 30 })], {
      events: [makeEvent({ start: hour(2026, 8, 30, 9), end: hour(2026, 8, 30, 17) })],
      start: at(2026, 8, 10),
      end: at(2026, 8, 24),
    });
    const day = loads.get('2026-08-30')!;
    expect(day.busyKnown).toBe(false);
    expect(day.busyMinutes).toBe(0);
    expect(day.rankedMinutes).toBe(30);
  });

  it('leaves every day unknown when the caller supplies no window', () => {
    const loads = loadsFor([makeTask({ dueDate: iso(2026, 8, 12) })]);
    expect(loads.get('2026-08-12')!.busyKnown).toBe(false);
  });

  it('weighs a day of meetings that has no task on it at all', () => {
    // No task means no bucket, which is right for the dots — and is exactly
    // the day worth being warned about before scheduling onto it.
    const loads = loadsFor([], {
      events: [makeEvent({ start: hour(2026, 8, 12, 9), end: hour(2026, 8, 12, 16) })],
      start: at(2026, 8, 10),
      end: at(2026, 8, 24),
    });
    const day = loads.get('2026-08-12')!;
    expect(day.taskCount).toBe(0);
    expect(day.busyMinutes).toBe(420);
    expect(weightFor(day)).toBe('full');
  });

  it('reads a day\'s meetings from that day under a late day reset', () => {
    // With a 02:00 reset, anchoring from the key's own midnight lands in the
    // previous logical day and reads yesterday evening's events as today's.
    const loads = loadsFor(
      [],
      {
        events: [
          makeEvent({ id: 'ev-prev', start: hour(2026, 8, 11, 19), end: hour(2026, 8, 11, 23) }),
          makeEvent({ id: 'ev-own', start: hour(2026, 8, 12, 9), end: hour(2026, 8, 12, 10) }),
        ],
        start: at(2026, 8, 10),
        end: at(2026, 8, 24),
      },
      '02:00',
    );
    expect(loads.get('2026-08-12')!.busyMinutes).toBe(60);
    expect(loads.get('2026-08-11')!.busyMinutes).toBe(240);
  });
});

describe('weightFor', () => {
  const load = (rankedMinutes: number) => ({
    key: '2026-08-12',
    taskCount: 0,
    taskMinutes: 0,
    unestimated: 0,
    projected: 0,
    busyKnown: false,
    busyMinutes: 0,
    rankedMinutes,
  });

  it('says nothing about an ordinary day', () => {
    expect(weightFor(load(0))).toBeNull();
    expect(weightFor(load(BUSY_DAY_MINUTES - 1))).toBeNull();
    expect(weightFor(undefined)).toBeNull();
  });

  it('marks a day at the busy threshold and above', () => {
    expect(weightFor(load(BUSY_DAY_MINUTES))).toBe('busy');
    expect(weightFor(load(FULL_DAY_MINUTES - 1))).toBe('busy');
  });

  it('marks a day full once it is twice over', () => {
    expect(weightFor(load(FULL_DAY_MINUTES))).toBe('full');
  });

  it('lets unestimated tasks alone carry a day over the line', () => {
    const tasks = Array.from({ length: 6 }, () => makeTask({ dueDate: iso(2026, 8, 12) }));
    const loads = loadsFor(tasks);
    expect(loads.get('2026-08-12')!.taskMinutes).toBe(0);
    expect(weightFor(loads.get('2026-08-12'))).toBe('busy');
  });

  it('lets meetings alone carry a day over the line', () => {
    const loads = loadsFor([makeTask({ dueDate: iso(2026, 8, 12), estimatedMinutes: 15 })], {
      events: [makeEvent({ start: hour(2026, 8, 12, 9), end: hour(2026, 8, 12, 16) })],
      start: at(2026, 8, 10),
      end: at(2026, 8, 24),
    });
    expect(weightFor(loads.get('2026-08-12'))).toBe('full');
  });

  it('speaks a cue plainly', () => {
    expect(describeDayWeight('busy')).toBe('already busy');
    expect(describeDayWeight('full')).toBe('already full');
  });
});

describe('describeDayLoad', () => {
  const loadFor = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
  function base() {
    return {
      key: '2026-08-12',
      taskCount: 0,
      taskMinutes: 0,
      unestimated: 0,
      projected: 0,
      busyKnown: false,
      busyMinutes: 0,
      rankedMinutes: 0,
    };
  }

  it('says nothing about a day with nothing to report', () => {
    expect(describeDayLoad(loadFor())).toBe('');
    expect(describeDayLoad(undefined)).toBe('');
  });

  it('states a total when every counted row is estimated', () => {
    expect(describeDayLoad(loadFor({ taskCount: 2, taskMinutes: 150 }))).toBe('~2.5h');
  });

  it('states a floor when some counted row is not', () => {
    expect(describeDayLoad(loadFor({ taskCount: 3, taskMinutes: 150, unestimated: 1 }))).toBe('at least 2.5h');
  });

  it('prices nothing at all when no counted row carries an estimate', () => {
    expect(describeDayLoad(loadFor({ taskCount: 3, unestimated: 3, rankedMinutes: 90 }))).toBe('');
  });

  it('drops a partial floor too small to describe the day', () => {
    // Four things to do, two minutes of them priced: "at least 2m" reads as an
    // empty day, and the count above it has already said more.
    expect(describeDayLoad(loadFor({ taskCount: 4, taskMinutes: 2, unestimated: 2 }))).toBe('');
    expect(describeDayLoad(loadFor({ taskCount: 4, taskMinutes: 30, unestimated: 2 }))).toBe('at least 30m');
  });

  it('keeps a small total when it is the whole day', () => {
    expect(describeDayLoad(loadFor({ taskCount: 2, taskMinutes: 2 }))).toBe('~2m');
  });

  it('keeps meeting time in its own clause', () => {
    expect(describeDayLoad(loadFor({ taskCount: 1, taskMinutes: 60, busyKnown: true, busyMinutes: 120 })))
      .toBe('~1h · 2h of events');
  });

  it('never prices an occurrence that has no row', () => {
    expect(describeDayLoad(loadFor({ projected: 4, rankedMinutes: 240 }))).toBe('');
  });
});
