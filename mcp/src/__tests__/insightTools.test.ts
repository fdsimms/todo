/**
 * The cross-cutting reads against a stub replica. The readers they project
 * (`buildLookAhead`, `isRealCompletion`, `mostMissed`) are the app's own and are
 * tested where they live; replica.test.ts checks they stand up in Node. What is
 * tested here is the projection: the counting, the caps and what is left out.
 */
import { completionHistory, daysBetweenKeys, duplicateKey, getAgenda, getOverview, reviewTasks } from '../insightTools';
import type { Replica } from '../replica';
import type { Category, Project, Task } from '../../../src/types';
import type { LookAhead } from '../../../src/utils/lookAhead';

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({
    notes: '', completed: false, archived: false, category: null, tags: [], timeSegments: [], priority: 0,
    parentId: null, projectId: null, dueDate: null, deadline: null, deferUntil: null, recurrenceType: 'none',
    chainItems: [], chainIndex: 0, pinned: false, createdAt: '2026-10-01T09:00:00', completedAt: null,
    missedAt: null, seriesId: null, ...over,
  }) as Task;

const project = (over: Partial<Project> & { id: string; title: string }): Project =>
  ({ notes: '', deadline: null, archived: false, completed: false, kind: 'project', pausedUntil: null,
     createdAt: '2026-01-01T09:00:00', ...over }) as Project;

const emptyLookAhead = (over: Partial<LookAhead> = {}): LookAhead =>
  ({ days: [], carriedOver: [], tight: [], away: [], dayCount: 0,
     totals: { taskCount: 0, minutes: 0, unestimated: 0, projected: 0, busyMinutes: 0, busyKnown: false, busyDays: 0, fullDays: 0 },
     window: { start: new Date(), cutoff: new Date(), awayEnd: null }, ...over }) as LookAhead;

function stub(tasks: Task[], over: Partial<Replica> = {}): Replica {
  return {
    tasks: () => tasks,
    taskById: (id: string) => tasks.find(t => t.id === id) ?? null,
    projects: () => [],
    projectProgress: () => ({ done: 0, total: 0 }),
    categories: () => [],
    isVisible: (t: Task) => t.id.startsWith('today'),
    isUnscheduled: (t: Task) => t.id.startsWith('someday'),
    isInbox: (t: Task) => t.id.startsWith('inbox'),
    isBlocked: () => false,
    isNotNeeded: () => false,
    displayTitle: (t: Task) => t.title,
    estimatedMinutes: (t: Task) => t.estimatedMinutes ?? null,
    deliverableKind: () => null,
    deliverableOptions: () => [],
    todayKey: () => '2026-10-04',
    shiftDayKey: (key: string, days: number) => {
      const d = new Date(`${key}T12:00:00`);
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    logicalDayKeyOf: (iso: string) => iso.slice(0, 10),
    isRealCompletion: (t: Task) => t.completed && !t.missedAt,
    describeBounty: () => null,
    onTimeSummary: (list: readonly Task[]) => {
      const judged = list.filter(t => t.deadline);
      const onTime = judged.filter(t => t.completedAt! <= t.deadline!).length;
      return { onTime, total: judged.length, rate: 0 };
    },
    mostMissed: () => [],
    lookAhead: () => emptyLookAhead(),
    foodLogEntries: () => [],
    moodLogs: () => [],
    medicationLogs: () => [],
    settings: () => ({
      dayResetTime: '04:00', weekStartsOn: 1, vacationMode: false, vacationEnd: null,
      kitchenEnabled: false, simpleMode: false, rewardsEnabled: true, completedRetentionDays: 90,
    }),
    lastSyncedAt: () => null,
    agentNotes: () => [],
    ...over,
  } as unknown as Replica;
}

describe('daysBetweenKeys', () => {
  it('counts calendar days, across a DST change', () => {
    expect(daysBetweenKeys('2026-10-01', '2026-10-04')).toBe(3);
    expect(daysBetweenKeys('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysBetweenKeys('2026-10-04', '2026-10-01')).toBe(-3);
  });
});

describe('getOverview', () => {
  it('counts each lens once, names the day the way the app does, and says what is switched off', () => {
    const tasks = [
      task({ id: 'today-1', title: 'A', category: 'Work', tags: ['call'], pinned: true }),
      task({ id: 'today-2', title: 'B', category: 'Work', tags: ['call', 'quick'] }),
      task({ id: 'later-1', title: 'C' }),
      task({ id: 'someday-1', title: 'D', category: 'Home' }),
      task({ id: 'inbox-1', title: 'E' }),
      task({ id: 'today-done', title: 'F', completed: true }),
      task({ id: 'today-sub', title: 'G', parentId: 'today-1' }),
    ];
    const categories = [
      { id: 'c1', name: 'Work', scheduleDays: [1, 2, 3, 4, 5], scheduleStart: '09:00', scheduleEnd: '17:00', hideOnVacation: true },
      { id: 'c2', name: 'Home', scheduleDays: null, scheduleStart: null, scheduleEnd: null, hideOnVacation: false },
    ] as Category[];
    const overview = getOverview(stub(tasks, {
      categories: () => categories,
      lookAhead: () => emptyLookAhead({ carriedOver: [tasks[0]] }),
    }), 'write');

    expect(overview.counts).toEqual({ today: 2, later: 1, unscheduled: 1, inbox: 1, overdue: 1, pinned: 1, blocked: 0 });
    expect(overview.today).toEqual({ date: '2026-10-04', weekday: 'Sunday', dayStartsAt: '04:00', weekStartsOn: 'Monday' });
    expect(overview.categories).toEqual([
      { name: 'Work', open: 2, schedule: 'Mon, Tue, Wed, Thu, Fri 09:00–17:00', hiddenOnVacation: true },
      { name: 'Home', open: 1 },
    ]);
    expect(overview.tags).toEqual([{ name: 'call', count: 2 }, { name: 'quick', count: 1 }]);
    expect(overview.features).toEqual({ kitchen: false, simplifiedMode: false, rewards: true });
    expect(overview.completedTasksKeptForDays).toBe(90);
    expect(overview.access).toBe('write');
  });

  it('says why the health logs might be empty rather than calling it a quiet month', () => {
    expect(getOverview(stub([])).healthLogs.note).toMatch(/Include health logs/);
    const withLogs = getOverview(stub([], { moodLogs: () => [{} as never] }));
    expect(withLogs.healthLogs).toEqual({ food: 0, mood: 1, medication: 0 });
  });
});

describe('getAgenda', () => {
  it('lays out each day with its rows and projections, and says the calendar is unknown', () => {
    const dentist = task({ id: 'd', title: 'Dentist', estimatedMinutes: 60 });
    const taxes = task({ id: 't', title: 'Taxes', dueDate: '2026-10-01T12:00:00' });
    const lookAhead = jest.fn(() => emptyLookAhead({
      days: [
        { key: '2026-10-04', date: new Date(), tasks: [], expected: [{ taskId: 's', title: 'Stretch' }],
          load: { taskMinutes: 0, unestimated: 0, away: false } as never, weight: null },
        { key: '2026-10-05', date: new Date(), tasks: [dentist], expected: [],
          load: { taskMinutes: 60, unestimated: 0, away: false } as never, weight: 'busy' },
      ],
      carriedOver: [taxes],
      totals: { taskCount: 1, minutes: 60, unestimated: 0, projected: 1, busyMinutes: 0, busyKnown: false, busyDays: 1, fullDays: 0 },
    }));
    const agenda = getAgenda(stub([], { lookAhead }), { days: 2 });

    expect(lookAhead).toHaveBeenCalledWith(2);
    expect(agenda.from).toBe('2026-10-04');
    expect(agenda.to).toBe('2026-10-05');
    expect(agenda.days[0]).toEqual({ date: '2026-10-04', weekday: 'Sunday', tasks: [], expected: [{ taskId: 's', title: 'Stretch' }] });
    expect(agenda.days[1]).toMatchObject({ weekday: 'Monday', estimatedMinutes: 60, weight: 'busy' });
    expect(agenda.days[1].tasks.map(t => t.id)).toEqual(['d']);
    expect(agenda.carriedOver).toEqual([expect.objectContaining({ id: 't', daysAgo: 3 })]);
    expect(agenda.totals).toEqual({ tasks: 1, estimatedMinutes: 60, unestimated: 0, projectedOccurrences: 1 });
    expect(agenda.calendar).toMatch(/not necessarily a free day/);
  });

  it('clamps the span', () => {
    const lookAhead = jest.fn(() => emptyLookAhead());
    getAgenda(stub([], { lookAhead }), { days: 500 });
    getAgenda(stub([], { lookAhead }), { days: 0 });
    expect(lookAhead.mock.calls).toEqual([[60], [1]]);
  });
});

describe('completionHistory', () => {
  const tasks = [
    task({ id: 'a', title: 'Run', completed: true, completedAt: '2026-10-03T07:30:00', category: 'Health', estimatedMinutes: 30 }),
    task({ id: 'b', title: 'Report', completed: true, completedAt: '2026-10-03T15:00:00', category: 'Work', projectId: 'p1',
      tags: ['deep'], deadline: '2026-10-04T00:00:00' }),
    task({ id: 'c', title: 'Plan', completed: true, completedAt: '2026-09-28T10:00:00', category: 'Work', deadline: '2026-09-27T00:00:00' }),
    task({ id: 'missed', title: 'Floss', completed: true, completedAt: '2026-10-02T00:00:00', missedAt: '2026-10-02T00:00:00' }),
    task({ id: 'old', title: 'Ancient', completed: true, completedAt: '2026-01-01T10:00:00' }),
    task({ id: 'sub', title: 'Step', completed: true, completedAt: '2026-10-03T10:00:00', parentId: 'b' }),
    task({ id: 'open', title: 'Open' }),
  ];
  const replica = stub(tasks, { projects: () => [project({ id: 'p1', title: 'Q4 report' })] });

  it('summarizes real completions in the range, newest first, keeping missed ones separate', () => {
    const history = completionHistory(replica, { days: 7 });
    expect(history.range).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(history.tasks.map(t => t.id)).toEqual(['b', 'a', 'c']);
    expect(history.tasks[0].completedAt).toBe('2026-10-03T15:00:00');
    expect(history.summary).toMatchObject({
      completed: 3,
      activeDays: 2,
      daysInRange: 7,
      byDay: { '2026-09-28': 1, '2026-10-03': 2 },
      byWeekday: { Monday: 1, Saturday: 2 },
      byHour: { '7': 1, '15': 1, '10': 1 },
      byCategory: [{ name: 'Work', count: 2 }, { name: 'Health', count: 1 }],
      byProject: [{ name: 'Q4 report', count: 1 }],
      byTag: [{ name: 'deep', count: 1 }],
      estimatedMinutes: 30,
      withEstimate: 1,
      deadlines: { met: 1, total: 2 },
      missed: 1,
    });
  });

  it('filters, and says when the list was cut', () => {
    expect(completionHistory(replica, { days: 7, category: 'Work' }).tasks.map(t => t.id)).toEqual(['b', 'c']);
    const cut = completionHistory(replica, { days: 7, limit: 1 });
    expect(cut.tasks).toHaveLength(1);
    expect(cut.truncated).toBe(true);
    expect(cut.summary.completed).toBe(3);
  });

  it("leaves an archived task out of a project's history, as the app's project readers do", () => {
    const filed = task({ id: 'filed', title: 'Draft', completed: true, completedAt: '2026-10-03T09:00:00', projectId: 'p1', archived: true });
    const r = stub([...tasks, filed], { projects: () => [project({ id: 'p1', title: 'Q4 report' })] });
    expect(completionHistory(r, { days: 7, projectId: 'p1' }).tasks.map(t => t.id)).toEqual(['b']);
    // The whole log keeps it, as the Logbook does.
    expect(completionHistory(r, { days: 7 }).tasks.map(t => t.id)).toContain('filed');
  });

  it('refuses a backwards range', () => {
    expect(() => completionHistory(replica, { from: '2026-10-05', to: '2026-10-01' })).toThrow(/after/);
  });
});

describe('reviewTasks', () => {
  it('lists what has sat a long time, and duplicates by title, without counting a series against itself', () => {
    const tasks = [
      task({ id: 'inbox-old', title: 'Look into this', createdAt: '2026-09-01T09:00:00' }),
      task({ id: 'inbox-new', title: 'Fresh', createdAt: '2026-10-03T09:00:00' }),
      task({ id: 'someday-old', title: 'Learn piano', createdAt: '2026-06-01T09:00:00' }),
      task({ id: 'someday-recent', title: 'Repaint', createdAt: '2026-09-20T09:00:00' }),
      task({ id: 'x1', title: 'Call Mom!' }),
      task({ id: 'x2', title: 'call  mom', category: 'Family' }),
      task({ id: 's1', title: 'Walk dog', seriesId: 'ser' }),
      task({ id: 's2', title: 'Walk dog', seriesId: 'ser' }),
    ];
    const review = reviewTasks(stub(tasks));

    expect(review.inboxAging.items.map(t => [t.id, t.ageDays])).toEqual([['inbox-old', 33]]);
    expect(review.somedayAging.items.map(t => t.id)).toEqual(['someday-old']);
    expect(review.possibleDuplicates.items).toEqual([
      { title: 'Call Mom!', tasks: [{ id: 'x1' }, { id: 'x2', category: 'Family' }] },
    ]);
  });

  it('finds quiet projects, but not a list, a paused one, or one with nothing left', () => {
    const projects = [
      project({ id: 'quiet', title: 'Garage' }),
      project({ id: 'busy', title: 'Launch' }),
      project({ id: 'list', title: 'Wish list', kind: 'list' }),
      project({ id: 'paused', title: 'Novel', pausedUntil: '2027-01-01' }),
      project({ id: 'done', title: 'Move' }),
    ];
    const tasks = [
      task({ id: 'g1', title: 'Sort shelves', projectId: 'quiet', completed: true, completedAt: '2026-08-01T10:00:00' }),
      task({ id: 'l1', title: 'Ship', projectId: 'busy', completed: true, completedAt: '2026-10-02T10:00:00' }),
    ];
    const outstanding: Record<string, number> = { quiet: 3, busy: 2, list: 5, paused: 4, done: 0 };
    const review = reviewTasks(stub(tasks, {
      projects: () => projects,
      projectProgress: (id: string) => ({ done: 0, total: outstanding[id] }),
    }));
    expect(review.quietProjects.items).toEqual([
      { id: 'quiet', title: 'Garage', outstanding: 3, lastCompletedAt: '2026-08-01T10:00:00', daysQuiet: 64 },
    ]);
  });
});

describe('duplicateKey', () => {
  it('folds case, punctuation and spacing but keeps letters from any script', () => {
    expect(duplicateKey('  Call   Mom! ')).toBe('call mom');
    expect(duplicateKey('Café — book')).toBe('café book');
    expect(duplicateKey('!!!')).toBe('');
  });
});
