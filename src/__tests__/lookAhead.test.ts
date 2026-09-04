import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { BUSY_DAY_MINUTES } from '../utils/dayLoad';
import {
  awayEntries,
  buildLookAhead,
  buildPushPlan,
  carriedOverTasks,
  describeAwayEntry,
  describeCrowding,
  describeLookAheadEvents,
  describeLookAheadLead,
  describeLookAheadLoad,
} from '../utils/lookAhead';

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
  reminderOffsetDays: null, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  followUpTaskEveryN: null,
  followUpTaskTitle: null,
  followUpTaskTally: 0,
  previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  followUpTaskDraft: null,
  followUpTaskOneAtATime: false,
  vacationPause: false, excludeFromSuggestions: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null,
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
function eventAt(y: number, m: number, d: number, fromH: number, toH: number): BusyEvent {
  return {
    id: `ev-${y}-${m}-${d}-${fromH}`,
    calendarId: 'cal',
    title: 'Meeting',
    start: new Date(y, m - 1, d, fromH).toISOString(),
    end: new Date(y, m - 1, d, toH).toISOString(),
    allDay: false,
    location: null,
    status: 'confirmed',
    availability: 'busy',
  };
}

/** Aug 22 → Sep 5, the "two weeks before the trip" shape throughout. */
const NOW = at(2026, 8, 22);
const CUTOFF = at(2026, 9, 5);
const AWAY_END = at(2026, 9, 12);

const build = (tasks: Task[], overrides = {}) =>
  buildLookAhead(tasks, { cutoff: CUTOFF, now: NOW, dayResetTime: '00:00', ...overrides });

describe('buildLookAhead — the window', () => {
  it('spans from today up to but not including the cutoff', () => {
    const la = build([]);
    // Aug 22..Sep 4 inclusive. The day you leave is not a day you have.
    expect(la.dayCount).toBe(14);
    expect(la.days[0].key).toBe('2026-08-22');
    expect(la.days[la.days.length - 1].key).toBe('2026-09-04');
  });

  it('handles a cutoff of today without producing days', () => {
    const la = buildLookAhead([], { cutoff: NOW, now: NOW, dayResetTime: '00:00' });
    expect(la.dayCount).toBe(0);
    expect(la.days).toEqual([]);
    expect(describeLookAheadLead(la)).toBe('Nothing is scheduled before you go');
  });

  it('places a dated task on its own day and nowhere else', () => {
    const task = makeTask({ title: 'Book parking', dueDate: iso(2026, 8, 25) });
    const la = build([task]);
    const landed = la.days.filter(d => d.tasks.length > 0);
    expect(landed).toHaveLength(1);
    expect(landed[0].key).toBe('2026-08-25');
    expect(landed[0].tasks[0].title).toBe('Book parking');
  });

  it('leaves a task dated past the cutoff out of the window entirely', () => {
    const la = build([makeTask({ dueDate: iso(2026, 9, 20) })]);
    expect(la.totals.taskCount).toBe(0);
    expect(la.days.every(d => d.tasks.length === 0)).toBe(true);
  });

  it('excludes completed, archived and subtask rows', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 25), completed: true }),
      makeTask({ dueDate: iso(2026, 8, 25), archived: true }),
      makeTask({ dueDate: iso(2026, 8, 25), parentId: 'parent-1' }),
    ]);
    expect(la.totals.taskCount).toBe(0);
  });
});

describe('buildLookAhead — totals', () => {
  it('counts a task landing on two days of the window once, and prices it once', () => {
    // Due one day, returning from a defer on another — one thing to do.
    const task = makeTask({
      dueDate: iso(2026, 8, 25),
      deferUntil: iso(2026, 8, 27),
      estimatedMinutes: 60,
    });
    const la = build([task]);
    expect(la.days.filter(d => d.tasks.length > 0)).toHaveLength(2);
    expect(la.totals.taskCount).toBe(1);
    expect(la.totals.minutes).toBe(60);
  });

  it('counts an unestimated task without pricing it', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 90 }),
      makeTask({ dueDate: iso(2026, 8, 26) }),
    ]);
    expect(la.totals.taskCount).toBe(2);
    expect(la.totals.minutes).toBe(90);
    expect(la.totals.unestimated).toBe(1);
  });

  it('counts projected occurrences apart from real rows', () => {
    const la = build([
      makeTask({ title: 'Water plants', dueDate: iso(2026, 8, 23), recurrenceType: 'daily' }),
    ]);
    // One real row, and the rest of the fortnight projected behind it.
    expect(la.totals.taskCount).toBe(1);
    expect(la.totals.projected).toBeGreaterThan(5);
    const withGhosts = la.days.filter(d => d.expected.length > 0);
    expect(withGhosts.length).toBeGreaterThan(5);
    // A projection is never handed over as a row.
    expect(withGhosts.every(d => d.tasks.length === 0)).toBe(true);
  });

  it('keeps meeting minutes out of the task total', () => {
    const la = build([makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 60 })], {
      busyEvents: [eventAt(2026, 8, 25, 9, 12)],
      busyWindow: { start: at(2026, 8, 20), end: at(2026, 9, 10) },
    });
    expect(la.totals.minutes).toBe(60);
    expect(la.totals.busyMinutes).toBe(180);
  });

  it('reports busyKnown false when the calendar window does not cover the span', () => {
    const la = build([], {
      busyEvents: [eventAt(2026, 8, 25, 9, 12)],
      busyWindow: { start: at(2026, 8, 20), end: at(2026, 8, 27) },
    });
    expect(la.totals.busyKnown).toBe(false);
  });
});

describe('carriedOverTasks', () => {
  it('collects rows dated before today, oldest first', () => {
    const tasks = [
      makeTask({ title: 'Newer', dueDate: iso(2026, 8, 20) }),
      makeTask({ title: 'Older', dueDate: iso(2026, 8, 15) }),
    ];
    expect(carriedOverTasks(tasks, NOW, '00:00').map(t => t.title)).toEqual(['Older', 'Newer']);
  });

  it('does not double-count them as landing in the window', () => {
    const la = build([makeTask({ dueDate: iso(2026, 8, 15) })]);
    expect(la.carriedOver).toHaveLength(1);
    expect(la.totals.taskCount).toBe(0);
  });

  it('ignores a task dated today', () => {
    expect(carriedOverTasks([makeTask({ dueDate: iso(2026, 8, 22) })], NOW, '00:00')).toEqual([]);
  });
});

describe('awayEntries', () => {
  it('is empty without an away end, however much lands past the cutoff', () => {
    const la = build([makeTask({ dueDate: iso(2026, 9, 8) })]);
    expect(la.away).toEqual([]);
  });

  it('names a task due inside the trip', () => {
    const la = build([makeTask({ title: 'Reply to Dana', dueDate: iso(2026, 9, 9) })], {
      awayEnd: AWAY_END,
    });
    expect(la.away).toHaveLength(1);
    expect(la.away[0].task.title).toBe('Reply to Dana');
    expect(la.away[0].kind).toBe('due');
    expect(describeAwayEntry(la.away[0])).toBe('Due while you are away');
  });

  it('prefers the deadline when a task carries both inside the trip', () => {
    const la = build(
      [makeTask({ dueDate: iso(2026, 9, 7), deadline: iso(2026, 9, 8) })],
      { awayEnd: AWAY_END },
    );
    expect(la.away).toHaveLength(1);
    expect(la.away[0].kind).toBe('deadline');
    expect(describeAwayEntry(la.away[0])).toBe('Deadline lands while you are away');
  });

  it('collapses a recurring task to one entry carrying its count', () => {
    const la = build(
      [makeTask({ title: 'Water plants', dueDate: iso(2026, 9, 6), recurrenceType: 'daily' })],
      { awayEnd: AWAY_END },
    );
    expect(la.away).toHaveLength(1);
    // Sep 6 itself, plus Sep 7..12 projected behind it.
    expect(la.away[0].occurrences).toBe(7);
    expect(describeAwayEntry(la.away[0])).toBe('7 times while you are away');
  });

  it('ignores anything landing past the end of the trip', () => {
    expect(awayEntries([makeTask({ dueDate: iso(2026, 9, 20) })], CUTOFF, AWAY_END, '00:00'))
      .toEqual([]);
  });
});

describe('tightDeadlines', () => {
  /** Enough dated work before `through` to push every day over the threshold. */
  const crowd = (through: number) => {
    const out: Task[] = [];
    for (let day = 22; day <= through; day++) {
      out.push(makeTask({ dueDate: iso(2026, 8, day), estimatedMinutes: BUSY_DAY_MINUTES + 60 }));
    }
    return out;
  };

  it('flags a deadline whose remaining days are already over the threshold', () => {
    const target = makeTask({
      title: 'Draft the handover doc',
      dueDate: iso(2026, 8, 30),
      deadline: iso(2026, 8, 26),
      estimatedMinutes: 180,
    });
    const la = build([...crowd(26), target]);
    expect(la.tight.map(t => t.task.title)).toContain('Draft the handover doc');
    const found = la.tight.find(t => t.task.title === 'Draft the handover doc')!;
    expect(found.minutes).toBe(180);
    expect(found.daysLeft).toBe(5);
  });

  it('stays quiet when the days before the deadline are clear', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 30), deadline: iso(2026, 8, 26), estimatedMinutes: 180 }),
    ]);
    expect(la.tight).toEqual([]);
  });

  it('refuses to judge a task with no estimate', () => {
    const la = build([...crowd(26), makeTask({ deadline: iso(2026, 8, 26) })]);
    expect(la.tight.every(t => t.minutes > 0)).toBe(true);
    expect(la.tight.some(t => t.task.estimatedMinutes == null)).toBe(false);
  });

  it('catches a task whose deadline is near even though it lands outside the window', () => {
    const target = makeTask({
      title: 'File the return',
      dueDate: iso(2026, 10, 1),
      deadline: iso(2026, 8, 26),
      estimatedMinutes: 120,
    });
    const la = build([...crowd(26), target]);
    expect(la.tight.map(t => t.task.title)).toContain('File the return');
    // ...and it is genuinely not among the window's rows.
    expect(la.days.every(d => d.tasks.every(t => t.title !== 'File the return'))).toBe(true);
  });

  it('ignores a deadline past the cutoff', () => {
    const la = build([
      ...crowd(30),
      makeTask({ deadline: iso(2026, 9, 20), estimatedMinutes: 120 }),
    ]);
    expect(la.tight.every(t => t.deadline <= at(2026, 9, 4))).toBe(true);
  });
});

describe('buildPushPlan', () => {
  it('lands everything on the day after the trip ends', () => {
    const plan = buildPushPlan([makeTask({ dueDate: iso(2026, 8, 25) })], AWAY_END, '00:00');
    expect(plan).toHaveLength(1);
    expect(plan[0].destination?.getDate()).toBe(13);
    expect(plan[0].destination?.getMonth()).toBe(8);
    expect(plan[0].selected).toBe(true);
  });

  it('reschedules a plain task but defers an anchored one', () => {
    const plan = buildPushPlan(
      [
        makeTask({ title: 'One-off', dueDate: iso(2026, 8, 25) }),
        makeTask({ title: 'Weekly', dueDate: iso(2026, 8, 25), recurrenceType: 'weekly' }),
        makeTask({ title: 'Series', dueDate: iso(2026, 8, 25), seriesId: 'ser-1' }),
      ],
      AWAY_END,
      '00:00',
    );
    const byTitle = Object.fromEntries(plan.map(p => [p.task.title, p.mode]));
    expect(byTitle['One-off']).toBe('reschedule');
    expect(byTitle['Weekly']).toBe('defer');
    expect(byTitle['Series']).toBe('defer');
  });

  it('blocks a task whose deadline lands before the return', () => {
    const plan = buildPushPlan(
      [makeTask({ dueDate: iso(2026, 8, 25), deadline: iso(2026, 9, 8) })],
      AWAY_END,
      '00:00',
    );
    expect(plan[0].destination).toBeNull();
    expect(plan[0].blocker).toBe('deadline');
    expect(plan[0].blockerLabel).toBe('Deadline lands before you are back');
  });

  it('carries deloadPlan’s hard blockers through unchanged', () => {
    const plan = buildPushPlan(
      [
        makeTask({ title: 'Pinned', dueDate: iso(2026, 8, 25), pinned: true }),
        makeTask({ title: 'Urgent', dueDate: iso(2026, 8, 25), priority: 4 }),
        makeTask({ title: 'Quota', dueDate: iso(2026, 8, 25), targetCount: 3 }),
      ],
      AWAY_END,
      '00:00',
    );
    expect(plan.every(p => p.destination === null)).toBe(true);
    expect(plan.map(p => p.blocker).sort()).toEqual(['pinned', 'quota', 'urgent']);
  });

  it('offers a soft-blocked task but leaves it unchecked', () => {
    const plan = buildPushPlan(
      [makeTask({ dueDate: iso(2026, 8, 25), streakCount: 12 })],
      AWAY_END,
      '00:00',
    );
    expect(plan[0].destination).not.toBeNull();
    expect(plan[0].selected).toBe(false);
    expect(plan[0].blockerLabel).toBe('12-day streak');
  });

  it('puts the biggest recovery first', () => {
    const plan = buildPushPlan(
      [
        makeTask({ title: 'Small', dueDate: iso(2026, 8, 25), estimatedMinutes: 15 }),
        makeTask({ title: 'Big', dueDate: iso(2026, 8, 25), estimatedMinutes: 240 }),
      ],
      AWAY_END,
      '00:00',
    );
    expect(plan.map(p => p.task.title)).toEqual(['Big', 'Small']);
  });
});

describe('copy', () => {
  it('leads with a count, not a duration', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 25) }),
      makeTask({ dueDate: iso(2026, 8, 26) }),
    ]);
    expect(describeLookAheadLead(la)).toBe('2 tasks land in the next 14 days');
  });

  it('says "at least" when some rows carry no estimate', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 120 }),
      makeTask({ dueDate: iso(2026, 8, 26) }),
    ]);
    expect(describeLookAheadLoad(la)).toBe('At least 2h of work planned · 1 with no estimate');
  });

  it('says "~" when every row is estimated', () => {
    const la = build([makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 120 })]);
    expect(describeLookAheadLoad(la)).toBe('~2h of work planned');
  });

  it('drops a partial total too small to describe the window', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 2 }),
      makeTask({ dueDate: iso(2026, 8, 26) }),
      makeTask({ dueDate: iso(2026, 8, 27) }),
    ]);
    expect(describeLookAheadLoad(la)).toBe('2 with no estimate');
  });

  it('keeps events on their own line', () => {
    const la = build([makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 60 })], {
      busyEvents: [eventAt(2026, 8, 25, 9, 12)],
      busyWindow: { start: at(2026, 8, 20), end: at(2026, 9, 10) },
    });
    expect(describeLookAheadLoad(la)).toBe('~1h of work planned');
    expect(describeLookAheadEvents(la)).toBe('3h of events on your calendar');
  });

  it('says nothing about events when there are none', () => {
    expect(describeLookAheadEvents(build([]))).toBe('');
  });

  it('never tells the reader the window is clear', () => {
    expect(describeCrowding(build([]))).toBeNull();
    expect(describeCrowding(build([makeTask({ dueDate: iso(2026, 8, 25) })]))).toBeNull();
  });

  it('speaks up once days are full', () => {
    const la = build([
      makeTask({ dueDate: iso(2026, 8, 25), estimatedMinutes: 400 }),
      makeTask({ dueDate: iso(2026, 8, 26), estimatedMinutes: 400 }),
    ]);
    expect(describeCrowding(la)).toBe('2 days are already full before anything moves.');
  });

  it('reads singular for one task and one day', () => {
    const la = buildLookAhead([makeTask({ dueDate: iso(2026, 8, 22) })], {
      cutoff: at(2026, 8, 23),
      now: NOW,
      dayResetTime: '00:00',
    });
    expect(describeLookAheadLead(la)).toBe('1 task lands in the last day');
  });
});
