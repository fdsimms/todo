import { subDays } from 'date-fns/subDays';
import {
  buildProjectPullPlan,
  describePullEmpty,
  diagnosePullEmpty,
  dripCandidate,
  nextPullCandidate,
  findProjectStalls,
  type PullEmptyReason,
  lastTouchedAt,
  projectPullUpdates,
  rankPullCandidates,
  MAX_PULLED_PROJECTS,
  MAX_CANDIDATES_PER_PROJECT,
  PULL_TODAY_BUDGET_MINUTES,
  suggestPullDate,
} from '../utils/projectPull';
import { registerTaskSource } from '../utils/blockerRegistry';
import { registerSectionSource } from '../utils/sectionRegistry';
import type { Project, Task, TaskGroup } from '../types';

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
  recurrenceMonth: null,
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
  rotationEnabled: false,
  rotationItems: [],
  rotationLog: [],
  rotationPeriodStart: null,
  rotationLastDone: {},
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
  penaltyMinutes: null,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  penaltyCreditedAt: null,
  gatesApps: false,
  showStreak: false,
  streakRequiresWindow: false,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTracksVisibility: false, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  parentId: null,
  groupId: null,
  projectId: 'p1',
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  followUpTaskEveryN: null,
  followUpTaskTitle: null,
  followUpTaskDraft: null,
  followUpTaskOneAtATime: false,
  followUpTaskTally: 0,
  previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  vacationPause: false, excludeFromSuggestions: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
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
  waitingOnPersonSince: null,
  waitingFollowUpDeclinedAt: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  logCompletionToCalendar: false,
  completionCalendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({ ...BASE, ...overrides });

const PROJECT_BASE: Project = {
  id: 'p1',
  title: 'Kitchen remodel',
  notes: '',
  deadline: null,
  category: null,
  defaultTaskCategory: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  ongoing: false,
  // Old enough that the default cadence is comfortably exceeded unless a test
  // says otherwise.
  createdAt: subDays(new Date(), 60).toISOString(),
  nudgeCadenceDays: 14,
  autoSchedule: false,
  nudgeOptIn: true,
  weekendSource: false,
  reviewDeclinedAt: null,
  reviewedAt: null,
  backfillDismissedFields: [],
  kind: 'project' as const,
  awayStart: null,
  awayEnd: null,
  awayPauses: false,
  awayPauseDeclinedFor: null,
  destination: null,
  awayListId: null,
  awayListDeclinedFor: null,
  pausedUntil: null,
  personIds: [],
  links: [],
  inOrder: false,
  showChecked: false,
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

  // One dated member means the project can appear somewhere, so it isn't
  // silent.
  it('is not stalled when a member has a due date', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b', dueDate: new Date().toISOString() })];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(0);
  });

  // The other placement fields don't put a *project* task anywhere:
  // isTaskVisible keeps one off every list until it has a due date. These
  // used to count as a schedule, so the member hid itself and silenced the
  // project with it.
  it.each([
    ['deferUntil', { deferUntil: new Date().toISOString() }],
    ['timeSegments', { timeSegments: ['morning' as const] }],
    ['windowStart', { windowStart: '09:00' }],
  ])('is still stalled when a member has only %s', (_label, placement) => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b', ...placement })];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(1);
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

  // "Nothing to pull, mark reviewed" (ProjectPullSheet) stamps reviewedAt —
  // it must buy the project's own cadence, not just today, or the very next
  // sweep writes back an identical review task.
  it('is not stalled right after being marked reviewed, even with undated members', () => {
    const project = makeProject({ reviewedAt: subDays(new Date(), 2).toISOString() });
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];

    expect(findProjectStalls([project], tasks)).toHaveLength(0);
  });

  it('stalls again once quiet for the full cadence past the review', () => {
    const project = makeProject({ reviewedAt: subDays(new Date(), 15).toISOString() });
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];

    const stalls = findProjectStalls([project], tasks);

    expect(stalls).toHaveLength(1);
    expect(stalls[0].quietDays).toBe(15);
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

  it('excludes completed projects', () => {
    expect(findProjectStalls([makeProject({ completed: true })], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('treats cadence 0 as never ask', () => {
    expect(findProjectStalls([makeProject({ nudgeCadenceDays: 0 })], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('excludes a project with nudgeOptIn false, even with a real cadence', () => {
    expect(findProjectStalls([makeProject({ nudgeOptIn: false })], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('excludes a nudgeOptIn: false project in "ask" mode too, unlike cadence 0', () => {
    expect(
      findProjectStalls([makeProject({ nudgeOptIn: false })], [makeTask({ id: 'a' })], 'ask')
    ).toHaveLength(0);
  });

  it('goes silent entirely in vacation mode', () => {
    settingsState.vacationMode = true;

    expect(findProjectStalls([makeProject()], [makeTask({ id: 'a' })])).toHaveLength(0);
  });

  it('is not stalled when the only live members are mid-chain steps', () => {
    const tasks = [
      makeTask({ id: 'a', chainEnabled: true, chainIndex: 2, chainItems: [
        { id: 'c1', title: 'one', estimatedMinutes: null },
        { id: 'c2', title: 'two', estimatedMinutes: null },
        { id: 'c3', title: 'three', estimatedMinutes: null },
      ] }),
    ];

    expect(findProjectStalls([makeProject()], tasks)).toHaveLength(0);
  });

  // A task waiting on another one can't appear anywhere a date would put it,
  // so dating it is the one thing the pull must not offer.
  describe('members waiting on another task', () => {
    const blocker = makeTask({ id: 'blocker', projectId: null, dueDate: new Date().toISOString() });
    const register = (tasks: Task[]) => {
      registerTaskSource(() => [...tasks, blocker]);
    };

    afterEach(() => {
      registerTaskSource(null);
    });

    it('leaves a waiting member out of the pullable set but still counts it', () => {
      const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b', blockedById: 'blocker' })];
      register(tasks);

      const stalls = findProjectStalls([makeProject()], tasks);

      expect(stalls).toHaveLength(1);
      expect(stalls[0].pullable.map(t => t.id)).toEqual(['a']);
      expect(stalls[0].members).toHaveLength(2);
    });

    it('is not stalled when every live member is waiting on something', () => {
      const tasks = [makeTask({ id: 'a', blockedById: 'blocker' })];
      register(tasks);

      expect(findProjectStalls([makeProject()], tasks)).toHaveLength(0);
    });

    // A date on a waiting member puts it nowhere, so it can't be the schedule
    // that says the project isn't quiet.
    it('does not count a waiting member as the project having a schedule', () => {
      const tasks = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', blockedById: 'blocker', dueDate: new Date().toISOString() }),
      ];
      register(tasks);

      expect(findProjectStalls([makeProject()], tasks)[0]?.pullable.map(t => t.id)).toEqual(['a']);
    });

    // The drip dates a task with nobody watching, so a waiting one would be
    // dated silently — and would then read as a schedule the project hasn't
    // got, keeping it quiet until its blocker was done.
    it('is never picked by the auto-schedule drip', () => {
      const project = makeProject({ autoSchedule: true });
      const tasks = [
        makeTask({ id: 'a', sortOrder: 0, blockedById: 'blocker' }),
        makeTask({ id: 'b', sortOrder: 1 }),
      ];
      register(tasks);

      expect(dripCandidate(project, tasks)?.id).toBe('b');
    });

    it('reports all-waiting as the empty reason', () => {
      const tasks = [makeTask({ id: 'a', blockedById: 'blocker' })];
      register(tasks);

      const state = diagnosePullEmpty([makeProject()], tasks);

      expect(state?.reason).toBe('all-waiting');
      expect(describePullEmpty(state!)).toContain('waiting on another task');
    });
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

  // The cadence answers "when should I speak up unasked". Asked directly, it
  // ranks but never excludes — otherwise the sheet is inert for every project
  // ever created, since 0 is the default for new ones too.
  describe("'ask' mode", () => {
    it('includes a project that was never opted in, which nudge mode skips', () => {
      const project = makeProject({ nudgeCadenceDays: 0 });
      const tasks = [makeTask({ id: 'a' })];

      expect(findProjectStalls([project], tasks, 'nudge')).toHaveLength(0);
      expect(findProjectStalls([project], tasks, 'ask')).toHaveLength(1);
    });

    it('includes a project whose own cadence has not come round yet', () => {
      const project = makeProject({ nudgeCadenceDays: 30, createdAt: subDays(new Date(), 4).toISOString() });
      const tasks = [makeTask({ id: 'a' })];

      expect(findProjectStalls([project], tasks, 'nudge')).toHaveLength(0);
      expect(findProjectStalls([project], tasks, 'ask')).toHaveLength(1);
    });

    // overdueBy carries both cases without a second sort key: no cadence
    // subtracts nothing, and a cadence that hasn't come round goes negative.
    it('ranks the overdue above the un-opted-in above the not-yet-due', () => {
      const overdue = makeProject({ id: 'overdue', nudgeCadenceDays: 7, createdAt: subDays(new Date(), 90).toISOString() });
      const never = makeProject({ id: 'never', nudgeCadenceDays: 0, createdAt: subDays(new Date(), 40).toISOString() });
      const early = makeProject({ id: 'early', nudgeCadenceDays: 30, createdAt: subDays(new Date(), 4).toISOString() });
      const tasks = [overdue, never, early].map(p => makeTask({ id: `t-${p.id}`, projectId: p.id }));

      const stalls = findProjectStalls([early, never, overdue], tasks, 'ask');

      expect(stalls.map(s => s.project.id)).toEqual(['overdue', 'never', 'early']);
      expect(stalls.map(s => s.overdueBy)).toEqual([83, 40, -26]);
    });

    it('still obeys vacation mode — asking does not override hiding work', () => {
      settingsState.vacationMode = true;

      expect(findProjectStalls([makeProject()], [makeTask({ id: 'a' })], 'ask')).toHaveLength(0);
    });

    it('still requires every member to be undated', () => {
      const tasks = [makeTask({ id: 'a', dueDate: new Date().toISOString() })];

      expect(findProjectStalls([makeProject({ nudgeCadenceDays: 0 })], tasks, 'ask')).toHaveLength(0);
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

  it('counts a "mark reviewed" stamp as a touch, restarting the quiet clock', () => {
    const reviewedAt = subDays(new Date(), 2).toISOString();
    const project = makeProject({ reviewedAt });

    expect(lastTouchedAt(project, [makeTask({ id: 'a' })])).toBe(reviewedAt);
  });

  it('still prefers a newer completion over an older reviewedAt stamp', () => {
    const completedAt = subDays(new Date(), 1).toISOString();
    const project = makeProject({ reviewedAt: subDays(new Date(), 10).toISOString() });
    const members = [makeTask({ id: 'a', completed: true, completedAt })];

    expect(lastTouchedAt(project, members)).toBe(completedAt);
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

  it('gets the singular right, and gives no reason at all for a project touched today', () => {
    expect(suggestPullDate(makeTask(), [], [], 1).reason).toBe('quiet 1 day');
    expect(suggestPullDate(makeTask(), [], [], 0).reason).toBe('');
  });

  it('falls back to a future day when today is already loaded', () => {
    const task = makeTask({ id: 'pull' });
    // Enough estimated minutes on today to blow the budget.
    const heavy = [makeTask({ id: 'h1', estimatedMinutes: PULL_TODAY_BUDGET_MINUTES + 30 })];

    const result = suggestPullDate(task, [task, ...heavy], heavy, 20);

    expect(result.dayLabel).not.toBe('Today');
    expect(result.date.getTime()).toBeGreaterThan(Date.now());
  });

  it('honours dayResetTime during the early-morning grace window', () => {
    // 1:30 AM on June 11, with a 2:00 AM reset — still "June 10" logically.
    const originalDayResetTime = settingsState.dayResetTime;
    settingsState.dayResetTime = '02:00';
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 11, 1, 30, 0));

    try {
      const result = suggestPullDate(makeTask(), [], [], 20);

      expect(result.dayLabel).toBe('Today');
      expect(result.date.getDate()).toBe(10);
      expect(result.date.getMonth()).toBe(5);
    } finally {
      jest.useRealTimers();
      settingsState.dayResetTime = originalDayResetTime;
    }
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

  // Every proposal starts selected, so each one sent to today counts against
  // the budget the next is checked with.
  it('stops sending proposals to today once the ones before them fill it', () => {
    const projects = [0, 1, 2].map(i =>
      makeProject({ id: `p${i}`, sortOrder: i, createdAt: subDays(new Date(), 60 - i).toISOString() })
    );
    const half = Math.ceil(PULL_TODAY_BUDGET_MINUTES / 2);
    const tasks = projects.map(p => makeTask({ id: `t-${p.id}`, projectId: p.id, estimatedMinutes: half }));

    const labels = buildProjectPullPlan(projects, tasks, []).proposals.map(p => p.suggestion.dayLabel);

    expect(labels.slice(0, 2)).toEqual(['Today', 'Today']);
    expect(labels[2]).not.toBe('Today');
  });

  // Past today it is the snooze engine choosing, and it has to see the pulls
  // before this one or it names the same lightest day for all of them.
  it('spreads pulls past a full today over different days', () => {
    const projects = [0, 1, 2].map(i =>
      makeProject({ id: `p${i}`, sortOrder: i, createdAt: subDays(new Date(), 60 - i).toISOString() })
    );
    const tasks = projects.map(p => makeTask({ id: `t-${p.id}`, projectId: p.id, estimatedMinutes: 60 }));
    const heavy = [makeTask({ id: 'h1', estimatedMinutes: PULL_TODAY_BUDGET_MINUTES + 30 })];

    const days = buildProjectPullPlan(projects, [...tasks, ...heavy], heavy)
      .proposals.map(p => p.suggestion.date.toDateString());

    expect(new Set(days).size).toBe(days.length);
  });

  // Opened for one project, the sheet's empty message has to be about that
  // project, not counts drawn from the rest of the board.
  it('diagnoses a scoped empty plan over the scoped projects alone', () => {
    const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' }), makeProject({ id: 'p3' })];
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', dueDate: new Date().toISOString() }),
      makeTask({ id: 'b', projectId: 'p2', dueDate: new Date().toISOString() }),
      makeTask({ id: 'c', projectId: 'p3', dueDate: new Date().toISOString() }),
    ];
    expect(buildProjectPullPlan(projects, tasks, [], ['p1']).empty).toEqual({
      reason: 'has-schedule',
      count: 1,
      total: 1,
    });
  });

  it('diagnoses an empty plan and leaves the diagnosis off a full one', () => {
    const undated = [makeTask({ id: 'a' })];
    const dated = [makeTask({ id: 'a', dueDate: new Date().toISOString() })];

    expect(buildProjectPullPlan([makeProject()], undated, []).empty).toBeNull();
    expect(buildProjectPullPlan([makeProject()], dated, []).empty).toEqual({
      reason: 'has-schedule',
      count: 1,
      total: 1,
    });
  });

  // The reported bug: nudgeCadenceDays defaults to 0 for new projects as well
  // as the migration backfill, so gating the sheet on it made a board of
  // entirely undated projects report that everything was scheduled.
  it('proposes from projects that were never opted in for nudging', () => {
    const projects = [
      makeProject({ id: 'p1', nudgeCadenceDays: 0 }),
      makeProject({ id: 'p2', nudgeCadenceDays: 0 }),
    ];
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1' }),
      makeTask({ id: 'b', projectId: 'p2' }),
    ];

    const plan = buildProjectPullPlan(projects, tasks, []);

    expect(plan.proposals.map(p => p.project.id)).toEqual(['p1', 'p2']);
    expect(plan.empty).toBeNull();
  });
});

describe('diagnosePullEmpty', () => {
  // An unset cadence is no longer a reason the *sheet* can be empty — it
  // doesn't gate there — so it only ever reports one in nudge mode.
  it('names the unset cadence only for the surfaces the cadence gates', () => {
    const projects = [
      makeProject({ id: 'p1', nudgeCadenceDays: 0 }),
      makeProject({ id: 'p2', nudgeCadenceDays: 0 }),
    ];
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1' }),
      makeTask({ id: 'b', projectId: 'p2' }),
    ];

    expect(diagnosePullEmpty(projects, tasks, 'ask')).toBeNull();

    const state = diagnosePullEmpty(projects, tasks, 'nudge');
    expect(state).toEqual({ reason: 'cadence-off', count: 2, total: 2 });
    // Names the control and the answer that turns it on, since nothing else
    // in the sheet points at the setting that is off.
    expect(describePullEmpty(state!)).toContain('Bring this up');
    expect(describePullEmpty(state!)).toContain('Every');
  });

  // Unlike cadence-off, nudgeOptIn is a hard exclusion — it reports in both
  // modes, because the manually-opened sheet is excluded too (see classifyProject).
  it('names nudgeOptIn: false in both modes', () => {
    const projects = [
      makeProject({ id: 'p1', nudgeOptIn: false }),
      makeProject({ id: 'p2', nudgeOptIn: false }),
    ];
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1' }),
      makeTask({ id: 'b', projectId: 'p2' }),
    ];

    for (const mode of ['ask', 'nudge'] as const) {
      const state = diagnosePullEmpty(projects, tasks, mode);
      expect(state).toEqual({ reason: 'nudge-excluded', count: 2, total: 2 });
      expect(describePullEmpty(state!)).toContain('Bring this up');
      expect(describePullEmpty(state!)).toContain('When I ask');
    }
  });

  it('reports vacation mode before looking at anything else', () => {
    settingsState.vacationMode = true;

    expect(diagnosePullEmpty([makeProject()], [makeTask({ id: 'a' })])).toEqual({
      reason: 'vacation',
      count: 0,
      total: 0,
    });
  });

  it('reports having no projects at all, archived ones not counting', () => {
    expect(diagnosePullEmpty([], [])).toEqual({ reason: 'no-projects', count: 0, total: 0 });
    expect(diagnosePullEmpty([makeProject({ archived: true })], [])).toEqual({
      reason: 'no-projects',
      count: 0,
      total: 0,
    });
  });

  it('reports having no projects at all, completed ones not counting either', () => {
    expect(diagnosePullEmpty([makeProject({ completed: true })], [])).toEqual({
      reason: 'no-projects',
      count: 0,
      total: 0,
    });
  });

  const emptyCases: [PullEmptyReason, Partial<Task>][] = [
    ['has-schedule', { dueDate: new Date().toISOString() }],
    ['no-live-tasks', { completed: true, completedAt: new Date().toISOString() }],
    [
      'no-pullable',
      {
        chainEnabled: true,
        chainItems: [
          { id: 'c1', title: 'Step one', estimatedMinutes: null },
          { id: 'c2', title: 'Step two', estimatedMinutes: null },
        ],
        chainIndex: 1,
      },
    ],
  ];

  it.each(emptyCases)('reports %s', (reason, taskOverrides) => {
    const state = diagnosePullEmpty([makeProject()], [makeTask({ id: 'a', ...taskOverrides })]);

    expect(state?.reason).toBe(reason);
    expect(state?.count).toBe(1);
  });

  it('reports how long until the nearest project goes quiet', () => {
    const projects = [
      makeProject({ id: 'p1', createdAt: subDays(new Date(), 3).toISOString() }),
      makeProject({ id: 'p2', createdAt: subDays(new Date(), 10).toISOString() }),
    ];
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1' }),
      makeTask({ id: 'b', projectId: 'p2' }),
    ];

    const state = diagnosePullEmpty(projects, tasks, 'nudge');

    expect(state).toEqual({ reason: 'too-soon', count: 2, total: 2, daysUntilQuiet: 4 });
    expect(describePullEmpty(state!)).toContain('4 days');
  });

  // A stalled project only reaches the diagnosis if buildProjectPullPlan
  // dropped it, and auto-schedule is the only thing it drops.
  it('reports a quiet project that auto-schedules itself', () => {
    const project = makeProject({ autoSchedule: true });

    const state = diagnosePullEmpty([project], [makeTask({ id: 'a' })]);

    expect(state?.reason).toBe('auto-scheduled');
    expect(describePullEmpty(state!)).toContain('auto-schedule');
  });

  it('returns null when a project actually stalled — the plan was not empty', () => {
    expect(diagnosePullEmpty([makeProject()], [makeTask({ id: 'a' })])).toBeNull();
  });

  it('picks the reason covering the most projects', () => {
    const projects = ['p1', 'p2', 'p3'].map(id => makeProject({ id }));
    const dated = { dueDate: new Date().toISOString() };
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true, completedAt: new Date().toISOString() }),
      makeTask({ id: 'b', projectId: 'p2', ...dated }),
      makeTask({ id: 'c', projectId: 'p3', ...dated }),
    ];

    expect(diagnosePullEmpty(projects, tasks)).toEqual({
      reason: 'has-schedule',
      count: 2,
      total: 3,
    });
  });
});

describe('describePullEmpty', () => {
  // The head sentence must never imply it covers every project when it
  // doesn't — that's the same overclaim the old fixed copy made.
  it('does not claim to cover every project when it covers some', () => {
    const all = describePullEmpty({ reason: 'has-schedule', count: 3, total: 3 });
    const some = describePullEmpty({ reason: 'has-schedule', count: 2, total: 3 });

    expect(all).toBe('Every project has something scheduled.');
    expect(some).toContain('2 projects of 3');
    expect(some).toContain('The rest');
  });

  it('has a sentence for every reason', () => {
    const reasons: PullEmptyReason[] = [
      'vacation',
      'no-projects',
      'nudge-excluded',
      'cadence-off',
      'auto-scheduled',
      'too-soon',
      'has-schedule',
      'all-waiting',
      'no-pullable',
      'no-live-tasks',
    ];

    for (const reason of reasons) {
      expect(describePullEmpty({ reason, count: 1, total: 1 })).toMatch(/\w.*\.$/);
    }
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

// A routine (water weekly) is always dated and always being ticked off, so
// counting it kept a project from ever going quiet about its one-offs.
describe('repeating members', () => {
  it("don't keep a project from going quiet, and are never pulled", () => {
    const tasks = [
      makeTask({ id: 'water', recurrenceType: 'weekly', dueDate: new Date().toISOString() }),
      makeTask({ id: 'bed', title: 'Build raised bed' }),
    ];
    const stalls = findProjectStalls([makeProject()], tasks, 'ask');
    expect(stalls).toHaveLength(1);
    expect(stalls[0].pullable.map(t => t.id)).toEqual(['bed']);
  });

  it("don't restart the quiet clock when they're ticked off", () => {
    const project = makeProject({ createdAt: subDays(new Date(), 60).toISOString() });
    const tasks = [
      makeTask({ id: 'w1', recurrenceType: 'weekly', completed: true, completedAt: subDays(new Date(), 1).toISOString() }),
      makeTask({ id: 'bed' }),
    ];
    expect(findProjectStalls([project], tasks, 'ask')[0].quietDays).toBe(60);
  });

  it('leave a project of nothing but routines out, as scheduled', () => {
    const tasks = [makeTask({ id: 'water', recurrenceType: 'weekly', dueDate: new Date().toISOString() })];
    expect(findProjectStalls([makeProject()], tasks, 'ask')).toHaveLength(0);
  });
});

describe('a paused project', () => {
  it('is left out of Pull, even when asked, until its day', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const plan = buildProjectPullPlan([makeProject({ pausedUntil: key })], [makeTask({ id: 'a' })], []);
    expect(plan.proposals).toEqual([]);
    expect(plan.empty?.reason).toBe('paused');
  });
});

describe('nextPullCandidate', () => {
  // What the weekend nudge quotes. dripCandidate answered only for projects
  // that schedule themselves, so the notes named no task for any other.
  it('names the top task for a project that does not schedule itself', () => {
    const tasks = [makeTask({ id: 'a', sortOrder: 0 }), makeTask({ id: 'b', sortOrder: 1 })];
    expect(nextPullCandidate(makeProject(), tasks)?.id).toBe('a');
  });

  it('is null for a project left out of every nudge', () => {
    expect(nextPullCandidate(makeProject({ nudgeOptIn: false }), [makeTask({ id: 'a' })])).toBeNull();
  });
});

describe('buildProjectPullPlan with a landing day', () => {
  it('puts every proposal on that day, and shows a named auto-scheduling project', () => {
    const project = makeProject({ id: 'p1', autoSchedule: true });
    const plan = buildProjectPullPlan([project], [makeTask({ id: 'a', projectId: 'p1' })], [], ['p1'], '2030-10-05');
    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0].suggestion.date.getDate()).toBe(5);
    expect(plan.proposals[0].suggestion.dayLabel).toBe('Saturday');
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

  // The bug this back-off exists for: clearing a date restores hasNoDateSignal,
  // which is exactly what makes a project stalled, so before the stamp the very
  // next drip re-dated the same task — every foreground, indefinitely, since
  // lastTouchedAt only moves on a completion.
  it('stands down for the rest of the day once its own suggestion is cleared', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, dueDate: null, autoScheduledAt: new Date().toISOString() }),
      makeTask({ id: 'b', sortOrder: 1 }),
    ];

    expect(dripCandidate(project, tasks)).toBeNull();
  });

  // Scoped to the project, not the task: offering the runner-up instead would
  // be the same interruption under a different title.
  it('offers no other candidate from a project declined today', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, dueDate: null, autoScheduledAt: new Date().toISOString() }),
      makeTask({ id: 'b', sortOrder: 1, priority: 3 }),
      makeTask({ id: 'c', sortOrder: 2 }),
    ];

    expect(dripCandidate(project, tasks)).toBeNull();
  });

  // A day, not a cadence: the same task is still the right next thing, so it
  // comes back tomorrow rather than being buried for the project's interval.
  it('resumes the next day, on the same task', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [
      makeTask({
        id: 'a',
        sortOrder: 0,
        dueDate: null,
        autoScheduledAt: subDays(new Date(), 1).toISOString(),
      }),
      makeTask({ id: 'b', sortOrder: 1 }),
    ];

    expect(dripCandidate(project, tasks)?.id).toBe('a');
  });

  // The stamp only means "declined" while the date it explains is gone. A
  // stamped task the user has since re-dated is an ordinary scheduled task.
  it('is not a decline while the dated task still carries its date', () => {
    const project = makeProject({ autoSchedule: true });
    const tasks = [
      makeTask({
        id: 'a',
        sortOrder: 0,
        dueDate: new Date().toISOString(),
        autoScheduledAt: new Date().toISOString(),
      }),
      makeTask({ id: 'b', sortOrder: 1 }),
    ];

    // Not because of the stamp — because the project has a scheduled member.
    expect(dripCandidate(project, tasks)).toBeNull();
  });
});

describe('a declined project and the sheet', () => {
  // The cadence rationale, applied to the back-off: tapping "Pull from
  // projects" is the user asking, and a change of mind an hour after clearing
  // should be honoured rather than met with an empty sheet.
  it('still offers the project when the user asks directly', () => {
    const project = makeProject({ autoSchedule: false });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, dueDate: null, autoScheduledAt: new Date().toISOString() }),
    ];

    const plan = buildProjectPullPlan([project], tasks, []);
    expect(plan.proposals.map(p => p.candidates[0].id)).toEqual(['a']);
  });

  it('keeps it out of the unprompted nudge', () => {
    const project = makeProject({ nudgeCadenceDays: 14 });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, dueDate: null, autoScheduledAt: new Date().toISOString() }),
    ];

    expect(findProjectStalls([project], tasks, 'nudge')).toEqual([]);
  });

  it('names the reason when diagnosed in nudge mode', () => {
    const project = makeProject({ nudgeCadenceDays: 14 });
    const tasks = [
      makeTask({ id: 'a', sortOrder: 0, dueDate: null, autoScheduledAt: new Date().toISOString() }),
    ];

    const empty = diagnosePullEmpty([project], tasks, 'nudge');
    expect(empty?.reason).toBe('declined-today');
    expect(describePullEmpty(empty!)).toContain('until tomorrow');
  });
});

describe('a date further out', () => {
  const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d.toISOString(); };

  it("doesn't keep a project from being pulled from, where a date this week does", () => {
    const far = [makeTask({ id: 'booked', dueDate: inDays(30) }), makeTask({ id: 'loose', sortOrder: 2 })];
    expect(nextPullCandidate(makeProject(), far)?.id).toBe('loose');
    const near = [makeTask({ id: 'booked', dueDate: inDays(3) }), makeTask({ id: 'loose', sortOrder: 2 })];
    expect(nextPullCandidate(makeProject(), near)).toBeNull();
  });
});

describe('working a project in order', () => {
  const section = (o: Partial<TaskGroup>): TaskGroup => ({
    id: 's1', title: 'Walls', notes: '', tags: [], category: null, sortOrder: 5,
    collapsed: false, onToday: false, projectId: 'p1', checklist: false, ...o,
  });
  afterEach(() => registerSectionSource(null));

  it('offers only the first open task on the page', () => {
    const tasks = [makeTask({ id: 'patch', sortOrder: 1 }), makeTask({ id: 'paint', sortOrder: 2, priority: 4 })];
    expect(nextPullCandidate(makeProject({ inOrder: true }), tasks)?.id).toBe('patch');
    const plan = buildProjectPullPlan([makeProject({ inOrder: true })], tasks, [], ['p1']);
    expect(plan.proposals[0].candidates.map(t => t.id)).toEqual(['patch']);
  });

  it('reads the order off the page, so a section above a loose task comes first', () => {
    registerSectionSource(() => [section({ sortOrder: 1 })]);
    const tasks = [
      makeTask({ id: 'loose', sortOrder: 3 }),
      makeTask({ id: 'inSection', sortOrder: 1, groupId: 's1' }),
    ];
    expect(nextPullCandidate(makeProject({ inOrder: true }), tasks)?.id).toBe('inSection');
  });

  it('ranks in page order when not worked in order too, reading a section by its place on the page', () => {
    // Each section numbers its own tasks, so the lower sortOrder is in the
    // section further down the page.
    registerSectionSource(() => [section({ id: 's1', sortOrder: 1 }), section({ id: 's2', sortOrder: 2 })]);
    const tasks = [
      makeTask({ id: 'upper', sortOrder: 5, groupId: 's1' }),
      makeTask({ id: 'lower', sortOrder: 1, groupId: 's2' }),
    ];
    expect(rankPullCandidates(tasks).map(t => t.id)).toEqual(['upper', 'lower']);
  });

  it('offers nothing while the first task is waiting, rather than letting a later one jump ahead', () => {
    const blocker = makeTask({ id: 'elsewhere', projectId: null });
    const tasks = [makeTask({ id: 'first', sortOrder: 1, blockedById: 'elsewhere' }), makeTask({ id: 'second', sortOrder: 2 })];
    registerTaskSource(() => [...tasks, blocker]);
    try {
      expect(nextPullCandidate(makeProject({ inOrder: true }), tasks)).toBeNull();
      expect(nextPullCandidate(makeProject(), tasks)?.id).toBe('second');
    } finally {
      registerTaskSource(null);
    }
  });
});

describe('checklist sections', () => {
  afterEach(() => registerSectionSource(null));

  it('never offers a checklist line', () => {
    registerSectionSource(() => [{
      id: 'pack', title: 'Packing', notes: '', tags: [], category: null, sortOrder: 0,
      collapsed: false, onToday: false, projectId: 'p1', checklist: true,
    }]);
    const tasks = [makeTask({ id: 'socks', groupId: 'pack', sortOrder: 0 }), makeTask({ id: 'book', sortOrder: 5 })];
    expect(nextPullCandidate(makeProject(), tasks)?.id).toBe('book');
    expect(nextPullCandidate(makeProject(), [tasks[0]])).toBeNull();
    expect(diagnosePullEmpty([makeProject()], [tasks[0]])?.reason).toBe('no-pullable');
  });
});
