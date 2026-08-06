import { subDays } from 'date-fns/subDays';
import {
  buildProjectPullPlan,
  dripCandidate,
  findProjectStalls,
  lastTouchedAt,
  projectPullUpdates,
  rankPullCandidates,
  MAX_PULLED_PROJECTS,
  MAX_CANDIDATES_PER_PROJECT,
  PULL_TODAY_BUDGET_MINUTES,
  suggestPullDate,
} from '../utils/projectPull';
import type { Project, Task } from '../types';

const settingsState = { dayResetTime: '00:00', vacationMode: false, morningStart: '06:00', afternoonStart: '12:00', eveningStart: '18:00', nightStart: '21:00' };

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ getCategoryByName: () => null, categories: [] }),
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
  targetCount: null,
  progressCount: 0,
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
  projectId: 'p1',
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
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({ ...BASE, ...overrides });

const PROJECT_BASE: Project = {
  id: 'p1',
  title: 'Kitchen remodel',
  notes: '',
  targetStartDate: null,
  targetEndDate: null,
  category: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  // Old enough that the default cadence is comfortably exceeded unless a test
  // says otherwise.
  createdAt: subDays(new Date(), 60).toISOString(),
  nudgeCadenceDays: 14,
  autoSchedule: false,
};

const makeProject = (overrides: Partial<Project> = {}): Project => ({ ...PROJECT_BASE, ...overrides });

beforeEach(() => {
  settingsState.vacationMode = false;
});

describe('findProjectStalls', () => {
  it('flags a project whose only members are undated', () => {
    const project = makeProject();
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];

    const stalls = findProjectStalls([project], tasks);

    expect(stalls).toHaveLength(1);
    expect(stalls[0].project.id).toBe('p1');
    expect(stalls[0].members).toHaveLength(2);
    expect(stalls[0].quietDays).toBe(60);
    expect(stalls[0].overdueBy).toBe(46);
  });

  // One scheduled member means the project can appear somewhere, so it isn't
  // silent — one case per field hasNoDateSignal looks at.
  it.each([
    ['dueDate', { dueDate: new Date().toISOString() }],
    ['deferUntil', { deferUntil: new Date().toISOString() }],
    ['timeSegments', { timeSegments: ['morning' as const] }],
    ['windowStart', { windowStart: '09:00' }],
  ])('is not stalled when a member has %s', (_label, scheduled) => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b', ...scheduled })];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(0);
  });

  it('is not stalled with no members at all', () => {
    expect(findProjectStalls([makeProject()], [])).toHaveLength(0);
  });

  it('is not stalled when every member is complete — that is finished, not silent', () => {
    const tasks = [
      makeTask({ id: 'a', completed: true, completedAt: subDays(new Date(), 40).toISOString() }),
      makeTask({ id: 'b', completed: true, completedAt: subDays(new Date(), 40).toISOString() }),
    ];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(0);
  });

  it('ignores archived members when deciding, but counts their completions as a touch', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({
        id: 'b',
        archived: true,
        completed: true,
        completedAt: subDays(new Date(), 2).toISOString(),
      }),
    ];

    const stalls = findProjectStalls([makeProject()], tasks);

    // The archived row doesn't count as a live member, but its completion two
    // days ago still means the project was touched two days ago.
    expect(stalls).toHaveLength(0);
  });

  it('ignores subtasks — they never rescue a project or count as members', () => {
    const tasks = [
      makeTask({ id: 'sub', parentId: 'a', dueDate: new Date().toISOString() }),
      makeTask({ id: 'a' }),
    ];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(1);
  });

  it('excludes archived projects', () => {
    expect(findProjectStalls([makeProject({ archived: true })], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('treats cadence 0 as never ask', () => {
    expect(findProjectStalls([makeProject({ nudgeCadenceDays: 0 })], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('goes silent entirely in vacation mode', () => {
    settingsState.vacationMode = true;

    expect(findProjectStalls([makeProject()], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('is not stalled when the only live members are mid-chain steps', () => {
    const tasks = [
      makeTask({ id: 'a', chainEnabled: true, chainIndex: 2, chainItems: [
        { id: 'c1', title: 'one', notes: '' },
        { id: 'c2', title: 'two', notes: '' },
        { id: 'c3', title: 'three', notes: '' },
      ] }),
    ];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(0);
  });

  describe('cadence boundary', () => {
    it('stalls when quiet for exactly the cadence', () => {
      const project = makeProject({ nudgeCadenceDays: 7, createdAt: subDays(new Date(), 7).toISOString() });

      expect(findProjectStalls([project], [makeTask({ id: 'a' })])).toHaveLength(1);
    });

    it('does not stall one day short of the cadence', () => {
      const project = makeProject({ nudgeCadenceDays: 7, createdAt: subDays(new Date(), 6).toISOString() });

      expect(findProjectStalls([project], [makeTask({ id: 'a' })])).toHaveLength(0);
    });
  });

  it('orders by how overdue each project is, then by the user’s own project order', () => {
    const a = makeProject({ id: 'a', sortOrder: 1, nudgeCadenceDays: 7, createdAt: subDays(new Date(), 10).toISOString() });
    const b = makeProject({ id: 'b', sortOrder: 2, nudgeCadenceDays: 7, createdAt: subDays(new Date(), 30).toISOString() });
    const c = makeProject({ id: 'c', sortOrder: 0, nudgeCadenceDays: 7, createdAt: subDays(new Date(), 10).toISOString() });
    const tasks = [
      makeTask({ id: 't-a', projectId: 'a' }),
      makeTask({ id: 't-b', projectId: 'b' }),
      makeTask({ id: 't-c', projectId: 'c' }),
    ];

    expect(findProjectStalls([a, b, c], tasks).map(s => s.project.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('lastTouchedAt', () => {
  it('falls back to the project’s creation when nothing was ever completed', () => {
    const project = makeProject();

    expect(lastTouchedAt(project, [makeTask({ id: 'a' })])).toBe(project.createdAt);
  });

  it('prefers the newest member completion', () => {
    const recent = subDays(new Date(), 3).toISOString();
    const members = [
      makeTask({ id: 'a', completed: true, completedAt: subDays(new Date(), 20).toISOString() }),
      makeTask({ id: 'b', completed: true, completedAt: recent }),
    ];

    expect(lastTouchedAt(makeProject(), members)).toBe(recent);
  });
});

describe('rankPullCandidates', () => {

  it('returns at most MAX_CANDIDATES_PER_PROJECT', () => {
    const tasks = [0, 1, 2, 3, 4].map(i => makeTask({ id: `t${i}`, sortOrder: i }));

    expect(rankPullCandidates(tasks)).toHaveLength(MAX_CANDIDATES_PER_PROJECT);
  });

  it('is deterministic — the same board always yields the same picks', () => {
    const tasks = [0, 1, 2, 3, 4].map(i => makeTask({ id: `t${i}`, sortOrder: i }));

    expect(rankPullCandidates(tasks).map(t => t.id)).toEqual(
      rankPullCandidates(tasks).map(t => t.id)
    );
  });

  it('follows the project’s own order when nothing else distinguishes the tasks', () => {
    const tasks = [
      makeTask({ id: 'third', sortOrder: 2 }),
      makeTask({ id: 'first', sortOrder: 0 }),
      makeTask({ id: 'second', sortOrder: 1 }),
    ];

    expect(rankPullCandidates(tasks).map(t => t.id)).toEqual(['first', 'second', 'third']);
  });

  it('lets an urgent task buried deep overtake the top of the list', () => {
    const tasks = [
      makeTask({ id: 'top', sortOrder: 0 }),
      makeTask({ id: 'buried', sortOrder: 8, priority: 4 }),
    ];

    expect(rankPullCandidates(tasks)[0].id).toBe('buried');
  });

  it('ranks a task with a passed deadline above an undated peer', () => {
    const tasks = [
      makeTask({ id: 'plain', sortOrder: 0 }),
      makeTask({ id: 'deadline', sortOrder: 1, deadline: subDays(new Date(), 1).toISOString() }),
    ];

    expect(rankPullCandidates(tasks)[0].id).toBe('deadline');
  });

  it('returns fewer than the max when the project has fewer pullable tasks', () => {
    expect(rankPullCandidates([makeTask({ id: 'only' })])).toHaveLength(1);
  });
});

describe('suggestPullDate', () => {
  it('lands on today when today is light', () => {
    const result = suggestPullDate(makeTask(), [], [], 20);

    expect(result.dayLabel).toBe('Today');
    expect(result.reason).toBe('quiet 20 days');
    expect(result.date.toDateString()).toBe(new Date().toDateString());
  });

  it('falls back to a future day when today is already loaded', () => {
    const task = makeTask({ id: 'pull' });
    // Enough estimated minutes on today to blow the budget.
    const heavy = [makeTask({ id: 'h1', estimatedMinutes: PULL_TODAY_BUDGET_MINUTES + 30 })];

    const result = suggestPullDate(task, [task, ...heavy], heavy, 20);

    expect(result.dayLabel).not.toBe('Today');
    expect(result.date.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('buildProjectPullPlan', () => {
  it('caps the proposals and reports the overflow', () => {
    const projects = [0, 1, 2, 3, 4].map(i =>
      makeProject({ id: `p${i}`, sortOrder: i, createdAt: subDays(new Date(), 60 - i).toISOString() })
    );
    const tasks = projects.map(p => makeTask({ id: `t-${p.id}`, projectId: p.id }));

    const plan = buildProjectPullPlan(projects, tasks, []);

    expect(plan.proposals).toHaveLength(MAX_PULLED_PROJECTS);
    expect(plan.overflowCount).toBe(2);
  });

  it('leaves auto-scheduling projects out — the drip handles those', () => {
    const manual = makeProject({ id: 'manual' });
    const auto = makeProject({ id: 'auto', autoSchedule: true });
    const tasks = [
      makeTask({ id: 't-manual', projectId: 'manual' }),
      makeTask({ id: 't-auto', projectId: 'auto' }),
    ];

    const plan = buildProjectPullPlan([manual, auto], tasks, []);

    expect(plan.proposals.map(p => p.project.id)).toEqual(['manual']);
    expect(plan.overflowCount).toBe(0);
  });

  it('pre-selects every proposal and offers up to three candidates each', () => {
    const tasks = [0, 1, 2, 3].map(i => makeTask({ id: `t${i}`, sortOrder: i }));

    const plan = buildProjectPullPlan([makeProject()], tasks, []);

    expect(plan.proposals[0].selected).toBe(true);
    expect(plan.proposals[0].candidates).toHaveLength(MAX_CANDIDATES_PER_PROJECT);
    expect(plan.proposals[0].quietDays).toBe(60);
  });

  it('is empty when nothing is quiet', () => {
    const tasks = [makeTask({ id: 'a', dueDate: new Date().toISOString() })];

    expect(buildProjectPullPlan([makeProject()], tasks, tasks).proposals).toEqual([]);
  });
});

describe('projectPullUpdates', () => {
  it('always reschedules outright — a pull candidate has no date to protect', () => {
    const date = new Date('2026-03-01T12:00:00.000Z');

    expect(projectPullUpdates(date)).toEqual({
      dueDate: date.toISOString(),
      deferUntil: null,
    });
  });
});

describe('dripCandidate', () => {
  it('picks the top-ranked task for an opted-in quiet project', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [makeTask({ id: 'a', sortOrder: 0 }), makeTask({ id: 'b', sortOrder: 1 })];

    expect(dripCandidate(project, tasks)?.id).toBe('a');
  });

  it('returns null for a project that has not opted in', () => {
    expect(dripCandidate(makeProject(), [makeTask({ id: 'a' })])).toBeNull();
  });

  // The idempotency proof: once anything in the project carries a date the
  // project is no longer stalled, so a second drip in the same session finds
  // nothing. No "already dripped" flag is involved.
  it('returns null once a member has been dated', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, dueDate: new Date().toISOString() }),
      makeTask({ id: 'b', sortOrder: 1 }),
    ];

    expect(dripCandidate(project, tasks)).toBeNull();
  });

  it('returns null once the dated member is completed — the clock restarts', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, completed: true, completedAt: new Date().toISOString() }),
      makeTask({ id: 'b', sortOrder: 1 }),
    ];

    expect(dripCandidate(project, tasks)).toBeNull();
  });
});
