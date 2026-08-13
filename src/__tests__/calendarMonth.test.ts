import type { Task } from '../types';
import type { DayBucket } from '../utils/calendarMonth';
import {
  MAX_PROJECTION_STEPS,
  buildDayBuckets,
  canProject,
  dayDetail,
  dotsFor,
  projectOccurrences,
  projectedDeadlineFor,
  summarizeDay,
} from '../utils/calendarMonth';

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
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
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
  deliverableKind: null,
  deliverableValue: null,
  mealEntryId: null,
  groceryItemId: null,
  leftoverId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  pendingImport: null,
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

function kindsOn(buckets: Map<string, DayBucket>, key: string) {
  return buckets.get(key)!.dots.map(d => d.kind);
}

// August 2026, padded to a full grid the way buildCalendarGrid pads one.
const FROM = at(2026, 7, 26);
const TO = at(2026, 9, 5);
const GRID = { from: FROM, to: TO };

describe('buildDayBuckets', () => {
  it('buckets a due date onto its own calendar day', () => {
    const buckets = buildDayBuckets([makeTask({ dueDate: iso(2026, 8, 10) })], GRID);
    expect([...buckets.keys()]).toEqual(['2026-08-10']);
    expect(buckets.get('2026-08-10')!.marks).toEqual([
      expect.objectContaining({ kind: 'due', projected: false, completed: false }),
    ]);
  });

  it('buckets the three date signals separately', () => {
    const task = makeTask({
      dueDate: iso(2026, 8, 10),
      deadline: iso(2026, 8, 14),
      deferUntil: iso(2026, 8, 5),
    });
    const buckets = buildDayBuckets([task], GRID);
    expect(kindsOn(buckets, '2026-08-10')).toEqual(['due']);
    expect(kindsOn(buckets, '2026-08-14')).toEqual(['deadline']);
    expect(kindsOn(buckets, '2026-08-05')).toEqual(['defer']);
  });

  it('orders a cell\'s kinds by MARK_KINDS, not by task order', () => {
    const tasks = [
      makeTask({ deferUntil: iso(2026, 8, 10) }),
      makeTask({ deadline: iso(2026, 8, 10) }),
      makeTask({ dueDate: iso(2026, 8, 10) }),
    ];
    expect(kindsOn(buildDayBuckets(tasks, GRID), '2026-08-10')).toEqual(['due', 'deadline', 'defer']);
  });

  it('ignores a window with no date — it has no cell to land in', () => {
    const task = makeTask({ windowStart: '09:00', windowEnd: '17:00' });
    expect(buildDayBuckets([task], GRID).size).toBe(0);
  });

  it('skips subtasks and archived rows', () => {
    const tasks = [
      makeTask({ dueDate: iso(2026, 8, 10), parentId: 'parent-1' }),
      makeTask({ dueDate: iso(2026, 8, 10), archived: true, archivedAt: iso(2026, 8, 1) }),
    ];
    expect(buildDayBuckets(tasks, GRID).size).toBe(0);
  });

  it('keeps a completed task on its day — a past month is history', () => {
    const task = makeTask({ dueDate: iso(2026, 8, 3), completed: true, completedAt: iso(2026, 8, 3) });
    const bucket = buildDayBuckets([task], GRID).get('2026-08-03')!;
    expect(bucket.marks[0].completed).toBe(true);
    expect(bucket.outstanding).toBe(0);
  });

  it('drops a completed task\'s spent deferUntil', () => {
    const task = makeTask({
      dueDate: iso(2026, 8, 3),
      deferUntil: iso(2026, 8, 2),
      completed: true,
      completedAt: iso(2026, 8, 3),
    });
    const buckets = buildDayBuckets([task], GRID);
    expect(buckets.has('2026-08-02')).toBe(false);
    expect(buckets.has('2026-08-03')).toBe(true);
  });

  it('counts outstanding as real incomplete rows only', () => {
    const tasks = [
      makeTask({ dueDate: iso(2026, 8, 10) }),
      makeTask({ dueDate: iso(2026, 8, 10), completed: true, completedAt: iso(2026, 8, 10) }),
    ];
    const bucket = buildDayBuckets(tasks, GRID).get('2026-08-10')!;
    expect(bucket.marks).toHaveLength(2);
    expect(bucket.outstanding).toBe(1);
    expect(bucket.projectedOnly).toBe(false);
  });

  it('states a kind as firmly as its marks allow', () => {
    const tasks = [
      makeTask({ dueDate: iso(2026, 8, 10) }),
      makeTask({ deadline: iso(2026, 8, 10), completed: true, completedAt: iso(2026, 8, 9) }),
      makeTask({ dueDate: iso(2026, 8, 3), deferUntil: iso(2026, 8, 10) }),
    ];
    expect(buildDayBuckets(tasks, GRID).get('2026-08-10')!.dots).toEqual([
      { kind: 'due', state: 'solid' },
      { kind: 'deadline', state: 'done' },
      { kind: 'defer', state: 'solid' },
    ]);
  });

  it('drops dates outside the grid', () => {
    const tasks = [
      makeTask({ dueDate: iso(2026, 7, 1) }),
      makeTask({ dueDate: iso(2026, 10, 1) }),
      makeTask({ dueDate: iso(2026, 8, 10) }),
    ];
    expect([...buildDayBuckets(tasks, GRID).keys()]).toEqual(['2026-08-10']);
  });
});

describe('projectOccurrences', () => {
  const daily = () =>
    makeTask({ title: 'Water plants', dueDate: iso(2026, 8, 10), recurrenceType: 'daily' });

  it('walks a daily rule forward through the grid', () => {
    const hits = projectOccurrences(daily(), FROM, at(2026, 8, 14), '00:00');
    expect(hits.map(d => d.getDate())).toEqual([11, 12, 13, 14]);
  });

  it('never includes the task\'s own due date — that one is a real row', () => {
    const hits = projectOccurrences(daily(), FROM, TO, '00:00');
    expect(hits.every(d => d.getDate() !== 10 || d.getMonth() !== 7)).toBe(true);
  });

  it('honours an interval', () => {
    const task = makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'daily', recurrenceInterval: 3 });
    const hits = projectOccurrences(task, FROM, at(2026, 8, 20), '00:00');
    expect(hits.map(d => d.getDate())).toEqual([13, 16, 19]);
  });

  it('walks a weekly rule', () => {
    const task = makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'weekly' });
    const hits = projectOccurrences(task, FROM, at(2026, 8, 31), '00:00');
    expect(hits.map(d => d.getDate())).toEqual([17, 24, 31]);
  });

  it('walks a monthly rule', () => {
    const task = makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'monthly' });
    const hits = projectOccurrences(task, FROM, at(2026, 11, 30), '00:00');
    expect(hits.map(d => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual(['9-10', '10-10', '11-10']);
  });

  it('stops at recurrenceEndDate', () => {
    const task = makeTask({
      dueDate: iso(2026, 8, 10),
      recurrenceType: 'daily',
      recurrenceEndDate: iso(2026, 8, 13),
    });
    expect(projectOccurrences(task, FROM, TO, '00:00').map(d => d.getDate())).toEqual([11, 12, 13]);
  });

  it('runs a bounded repeat down instead of projecting it forever', () => {
    // recurrenceCount is "occurrences remaining, including this one", and
    // completeTask takes one off per spawn. Three total = the live row plus two.
    const task = makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'daily', recurrenceCount: 3 });
    expect(projectOccurrences(task, FROM, TO, '00:00').map(d => d.getDate())).toEqual([11, 12]);
  });

  it('projects nothing for a repeat with one occurrence left', () => {
    const task = makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'daily', recurrenceCount: 1 });
    expect(projectOccurrences(task, FROM, TO, '00:00')).toEqual([]);
  });

  it('keeps occurrences before the grid out of the results', () => {
    const task = makeTask({ dueDate: iso(2026, 7, 1), recurrenceType: 'daily' });
    const hits = projectOccurrences(task, FROM, at(2026, 7, 28), '00:00');
    expect(hits.map(d => d.getDate())).toEqual([26, 27, 28]);
  });

  it('truncates rather than hanging when a rule outruns the step ceiling', () => {
    const task = makeTask({ dueDate: iso(2020, 1, 1), recurrenceType: 'daily' });
    const hits = projectOccurrences(task, FROM, TO, '00:00');
    // 2020 is far more than 500 daily steps from the grid, so the walk runs out
    // before it ever arrives.
    expect(hits).toEqual([]);
    expect(MAX_PROJECTION_STEPS).toBeGreaterThan(0);
  });
});

describe('canProject', () => {
  const recurring = (over: Partial<Task>) =>
    makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'daily', ...over });

  it('accepts a plain live recurring task', () => {
    expect(canProject(recurring({}))).toBe(true);
  });

  it('refuses a completed row, so tombstones don\'t re-project the future', () => {
    expect(canProject(recurring({ completed: true, completedAt: iso(2026, 8, 10) }))).toBe(false);
  });

  it('refuses an archived row', () => {
    expect(canProject(recurring({ archived: true }))).toBe(false);
  });

  it('refuses recurrenceFromCompletion — its next date needs a completion that hasn\'t happened', () => {
    expect(canProject(recurring({ recurrenceFromCompletion: true }))).toBe(false);
  });

  it('refuses a task stepping through a chain', () => {
    const chained = recurring({
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
      ],
    });
    expect(canProject(chained)).toBe(false);
  });

  it('still projects a single-item chain, which steps through nothing', () => {
    const one = recurring({
      chainEnabled: true,
      chainItems: [{ id: 'a', title: 'Step A', estimatedMinutes: null }],
    });
    expect(canProject(one)).toBe(true);
  });

  it('refuses a non-recurring task, a dateless one, and a subtask', () => {
    expect(canProject(recurring({ recurrenceType: 'none' }))).toBe(false);
    expect(canProject(recurring({ dueDate: null }))).toBe(false);
    expect(canProject(recurring({ parentId: 'parent-1' }))).toBe(false);
  });

  it('refuses a series row — a series carries no recurrence rule to walk', () => {
    const seriesRow = makeTask({ dueDate: iso(2026, 8, 10), seriesId: 'series-1', recurrenceType: 'none' });
    expect(canProject(seriesRow)).toBe(false);
  });
});

describe('projectedDeadlineFor', () => {
  it('carries a relative offset onto the projected occurrence', () => {
    const task = makeTask({ deadlineOffsetDays: 2 });
    expect(projectedDeadlineFor(task, at(2026, 8, 20))!.getDate()).toBe(18);
  });

  it('pins a monthly deadline to its day of the occurrence\'s month', () => {
    const task = makeTask({ deadlineMonthDay: 25 });
    const deadline = projectedDeadlineFor(task, at(2026, 9, 10))!;
    expect(deadline.getMonth() + 1).toBe(9);
    expect(deadline.getDate()).toBe(25);
  });

  it('projects nothing for a fixed deadline, which does not carry forward', () => {
    expect(projectedDeadlineFor(makeTask({ deadline: iso(2026, 8, 20) }), at(2026, 9, 10))).toBeNull();
  });
});

describe('buildDayBuckets with projection', () => {
  it('marks projected occurrences as ghosts, and the real row as real', () => {
    const task = makeTask({ title: 'Bins out', dueDate: iso(2026, 8, 10), recurrenceType: 'weekly' });
    const buckets = buildDayBuckets([task], GRID);
    expect(buckets.get('2026-08-10')!.marks[0].projected).toBe(false);
    const ghost = buckets.get('2026-08-17')!;
    expect(ghost.marks[0]).toEqual(expect.objectContaining({ projected: true, title: 'Bins out' }));
    expect(ghost.projectedOnly).toBe(true);
    expect(ghost.outstanding).toBe(0);
  });

  it('projects the relative deadline alongside the occurrence', () => {
    const task = makeTask({
      dueDate: iso(2026, 8, 10),
      deadline: iso(2026, 8, 8),
      deadlineOffsetDays: 2,
      recurrenceType: 'weekly',
    });
    const buckets = buildDayBuckets([task], GRID);
    expect(kindsOn(buckets, '2026-08-15')).toEqual(['deadline']);
    expect(buckets.get('2026-08-15')!.marks[0].projected).toBe(true);
  });

  it('draws only the database when projecting is off', () => {
    const task = makeTask({ dueDate: iso(2026, 8, 10), recurrenceType: 'weekly' });
    const buckets = buildDayBuckets([task], { ...GRID, projecting: false });
    expect([...buckets.keys()]).toEqual(['2026-08-10']);
  });

  it('does not double a recurrence that has left tombstones behind', () => {
    const done = makeTask({
      title: 'Bins out',
      dueDate: iso(2026, 8, 3),
      recurrenceType: 'weekly',
      completed: true,
      completedAt: iso(2026, 8, 3),
    });
    const live = makeTask({ title: 'Bins out', dueDate: iso(2026, 8, 10), recurrenceType: 'weekly' });
    const buckets = buildDayBuckets([done, live], GRID);
    // The 17th is one occurrence, not one per completion in the chain's history.
    expect(buckets.get('2026-08-17')!.marks).toHaveLength(1);
  });
});

describe('dotsFor', () => {
  const mark = (over: Partial<Parameters<typeof dotsFor>[0][number]>) => ({
    kind: 'due' as const,
    taskId: 'task-1',
    title: 'Test',
    projected: false,
    completed: false,
    ...over,
  });

  it('calls a day of ticked rows done, not projected', () => {
    expect(dotsFor([mark({ completed: true })])).toEqual([{ kind: 'due', state: 'done' }]);
  });

  it('calls a day of pure projection projected', () => {
    expect(dotsFor([mark({ projected: true })])).toEqual([{ kind: 'due', state: 'projected' }]);
  });

  it('lets one outstanding row speak for the kind', () => {
    const marks = [mark({ completed: true }), mark({ projected: true }), mark({})];
    expect(dotsFor(marks)).toEqual([{ kind: 'due', state: 'solid' }]);
  });

  it('resolves each kind on its own', () => {
    const marks = [mark({}), mark({ kind: 'deadline', projected: true })];
    expect(dotsFor(marks)).toEqual([
      { kind: 'due', state: 'solid' },
      { kind: 'deadline', state: 'projected' },
    ]);
  });
});

describe('dayDetail', () => {
  const due = makeTask({ title: 'Pay rent', dueDate: iso(2026, 8, 10) });
  const deadline = makeTask({ title: 'File taxes', deadline: iso(2026, 8, 10) });
  const defer = makeTask({ title: 'Chase invoice', deferUntil: iso(2026, 8, 10) });
  const ghosted = makeTask({ title: 'Bins out', dueDate: iso(2026, 8, 3), recurrenceType: 'weekly' });
  const all = [due, deadline, defer, ghosted];
  const byId = new Map(all.map(t => [t.id, t]));

  const detailFor = (key: string) =>
    dayDetail(buildDayBuckets(all, GRID).get(key), byId);

  it('splits a day\'s real rows by kind', () => {
    const detail = detailFor('2026-08-10');
    expect(detail.due.map(t => t.title)).toEqual(['Pay rent']);
    expect(detail.deadline.map(t => t.title)).toEqual(['File taxes']);
    expect(detail.defer.map(t => t.title)).toEqual(['Chase invoice']);
    expect(detail.isEmpty).toBe(false);
  });

  it('keeps a projected occurrence out of the rows and in the caption', () => {
    const detail = detailFor('2026-08-17');
    expect(detail.due).toEqual([]);
    expect(detail.deadline).toEqual([]);
    expect(detail.expected).toEqual([{ taskId: ghosted.id, title: 'Bins out' }]);
    expect(detail.isEmpty).toBe(false);
  });

  it('names an expected task once, however many marks it left on the day', () => {
    const task = makeTask({
      title: 'Invoice',
      dueDate: iso(2026, 8, 3),
      recurrenceType: 'weekly',
      deadlineOffsetDays: 0,
    });
    const buckets = buildDayBuckets([task], GRID);
    const detail = dayDetail(buckets.get('2026-08-10'), new Map([[task.id, task]]));
    expect(buckets.get('2026-08-10')!.marks).toHaveLength(2);
    expect(detail.expected).toHaveLength(1);
  });

  it('shrugs off a mark whose row has gone', () => {
    const real = [due, deadline, defer];
    const detail = dayDetail(buildDayBuckets(real, GRID).get('2026-08-10'), new Map());
    expect(detail.due).toEqual([]);
    expect(detail.isEmpty).toBe(true);
  });

  it('still captions a projected mark with no row to look up', () => {
    // A ghost carries its own title precisely so it doesn't need the row —
    // resolving it would be one lookup away from naming the wrong occurrence.
    const detail = dayDetail(buildDayBuckets(all, GRID).get('2026-08-17'), new Map());
    expect(detail.expected).toEqual([{ taskId: ghosted.id, title: 'Bins out' }]);
  });

  it('reads an empty day', () => {
    const detail = dayDetail(undefined, byId);
    expect(detail.isEmpty).toBe(true);
    expect(summarizeDay(detail)).toBe('');
  });
});

describe('summarizeDay', () => {
  const byId = new Map<string, Task>();
  const detail = (over: Partial<ReturnType<typeof dayDetail>>) => ({
    ...dayDetail(undefined, byId),
    ...over,
  });

  it('counts real rows by kind', () => {
    const task = makeTask({});
    expect(summarizeDay(detail({ due: [task, task], deadline: [task] }))).toBe('2 due · 1 deadline');
  });

  it('pluralizes deadlines and names a returning task', () => {
    const task = makeTask({});
    expect(summarizeDay(detail({ deadline: [task, task], defer: [task] }))).toBe('2 deadlines · 1 returning');
  });

  it('leaves expected occurrences out of the count', () => {
    expect(summarizeDay(detail({ expected: [{ taskId: 'a', title: 'Bins out' }] }))).toBe('');
  });
});
