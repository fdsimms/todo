import { projectStats, RECENT_FINISHED_LIMIT } from '../utils/projectStats';
import type { Project, Task } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllProjects: jest.fn().mockReturnValue([]),
  dbInsertProject: jest.fn(),
  dbUpdateProject: jest.fn(),
  dbDeleteProject: jest.fn(),
  dbBatchUpdateProjectSortOrders: jest.fn(),
}));

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: 'Kitchen refresh',
  notes: '',
  deadline: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  ongoing: false,
  createdAt: '2026-01-01T09:00:00.000Z',
  nudgeCadenceDays: 0,
  autoSchedule: false,
  sequential: false,
  nudgeOptIn: false,
  reviewDeclinedAt: null,
  backfillDismissedFields: [],
  kind: 'project' as const,
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1', title: 'A task', notes: '', completed: false, completedAt: null, missedAt: null,
  autoScheduledAt: null, createdAt: '2026-01-01T00:00:00.000Z', seenAt: null, dueDate: null,
  deadline: null, deadlineOffsetDays: null, deadlineMonthDay: null, deferUntil: null,
  timeSegments: [], windowStart: null, windowEnd: null, recurrenceType: 'none',
  recurrenceInterval: 1, recurrenceDays: [], recurrenceMonthDay: null, recurrenceWeekOrdinal: null,
  recurrenceAnchorDay: null, recurrenceAnchorDate: null, recurrenceEndDate: null,
  recurrenceCount: null, recurrenceFromCompletion: false, supplyCount: null, supplyUnit: null,
  supplyRefillCount: null, supplyReorderAt: 1, supplyLeadDays: null, supplyDeclinedAtCount: null,
  supplyGroceryItemId: null, targetCount: null, targetUnit: null, allowOvershoot: false,
  quotaIntervalMinutes: null, quotaReminders: false, quotaStartedAt: null, quotaAlwaysVisible: false,
  progressCount: 0, tags: [], category: null, sortOrder: 1, pinned: false, pinnedOrder: 0,
  postponeCount: 0, postponeMuted: false, driftingSince: null, priority: 0, effort: 0,
  estimatedMinutes: null, streakCount: 0, streakDate: null, previousStreakCount: 0,
  previousStreakDate: null, priorBestStreak: 0, showStreak: false, streakRequiresWindow: false, parentId: null,
  groupId: null, projectId: null, reminderTime: null, reminderKind: 'notification',
  reminderOffsetDays: null, chainEnabled: false, chainIndex: 0, chainItems: [],
  chainStepOnSchedule: false, extraTaskEveryN: null, extraTaskTitle: null, extraTaskDraft: null,
  extraTaskTally: 0, previousExtraTaskTally: 0, vacationPause: false,
  excludeFromSuggestions: false, timerStartedAt: null, timedMinutes: null, timerElapsedSeconds: 0,
  actualMinutes: null, previousOccurrenceId: null, seriesId: null, seriesMonthDays: [],
  seriesRepeatMonths: 1, seriesDefaults: null, archived: false, archivedAt: null, linkUrl: null,
  phoneNumber: null, emailAddress: null, location: null, blockedById: null, waitingOnPersonId: null,
  deliverableKind: null, deliverableValue: null, generatedKind: null, generatedSourceId: null,
  deadlineOnCalendar: false, calendarEventId: null, timeBlockEventId: null, pendingImport: null,
  backfillDismissedFields: [], personIds: [],
  ...overrides,
});

const NOW = new Date(2026, 7, 26, 12, 0, 0);

describe('projectStats', () => {
  it('is all zeroes with no projects', () => {
    expect(projectStats([], [], NOW)).toEqual({
      active: 0,
      finished: 0,
      finishedThisYear: 0,
      activeDone: 0,
      activeTotal: 0,
      typicalDays: null,
      recentlyFinished: [],
    });
  });

  it('counts only the projects that are neither finished nor filed away as active', () => {
    const stats = projectStats([
      makeProject({ id: 'a' }),
      makeProject({ id: 'b', completed: true, completedAt: '2026-03-01T00:00:00.000Z' }),
      makeProject({ id: 'c', archived: true, archivedAt: '2026-03-01T00:00:00.000Z' }),
    ], [], NOW);
    expect(stats.active).toBe(1);
  });

  // Archiving is filing away, and a project is often filed long after it was
  // done. Only `completed` says the work ended.
  it('counts an archived-and-completed project as finished', () => {
    const stats = projectStats([
      makeProject({ id: 'a', completed: true, completedAt: '2026-03-01T00:00:00.000Z', archived: true }),
    ], [], NOW);
    expect(stats.finished).toBe(1);
    expect(stats.active).toBe(0);
  });

  it('ignores an archived project that was never marked complete', () => {
    const stats = projectStats([
      makeProject({ id: 'a', archived: true, archivedAt: '2026-03-01T00:00:00.000Z' }),
    ], [], NOW);
    expect(stats.finished).toBe(0);
  });

  it('aggregates member progress across the active projects only', () => {
    const projects = [
      makeProject({ id: 'a' }),
      makeProject({ id: 'b' }),
      makeProject({ id: 'c', completed: true, completedAt: '2026-03-01T00:00:00.000Z' }),
    ];
    const tasks = [
      makeTask({ id: '1', projectId: 'a', completed: true }),
      makeTask({ id: '2', projectId: 'a' }),
      makeTask({ id: '3', projectId: 'b', completed: true }),
      // The finished project's members must not swell the active totals.
      makeTask({ id: '4', projectId: 'c', completed: true }),
      makeTask({ id: '5', projectId: 'c', completed: true }),
    ];
    const stats = projectStats(projects, tasks, NOW);
    expect(stats.activeDone).toBe(2);
    expect(stats.activeTotal).toBe(3);
  });

  it('counts this year separately from ever', () => {
    const stats = projectStats([
      makeProject({ id: 'a', completed: true, completedAt: '2026-03-01T00:00:00.000Z' }),
      makeProject({ id: 'b', completed: true, completedAt: '2026-07-01T00:00:00.000Z' }),
      makeProject({ id: 'c', completed: true, completedAt: '2025-11-01T00:00:00.000Z' }),
    ], [], NOW);
    expect(stats.finished).toBe(3);
    expect(stats.finishedThisYear).toBe(2);
  });

  describe('typicalDays', () => {
    it('is null with nothing finished', () => {
      expect(projectStats([makeProject()], [], NOW).typicalDays).toBeNull();
    });

    it('is the span for a single finished project', () => {
      const stats = projectStats([
        makeProject({ id: 'a', completed: true, createdAt: '2026-01-01T09:00:00.000Z', completedAt: '2026-01-11T09:00:00.000Z' }),
      ], [], NOW);
      expect(stats.typicalDays).toBe(10);
    });

    // The whole reason this is a median: one project left running all year
    // drags a mean past a month and describes nothing anyone did.
    it('is not dragged out by a single long project', () => {
      const stats = projectStats([
        makeProject({ id: 'a', completed: true, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-03T00:00:00.000Z' }),
        makeProject({ id: 'b', completed: true, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-05T00:00:00.000Z' }),
        makeProject({ id: 'c', completed: true, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-11-01T00:00:00.000Z' }),
      ], [], NOW);
      expect(stats.typicalDays).toBe(4);
    });

    it('averages the middle pair on an even count', () => {
      const stats = projectStats([
        makeProject({ id: 'a', completed: true, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-03T00:00:00.000Z' }),
        makeProject({ id: 'b', completed: true, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-08T00:00:00.000Z' }),
      ], [], NOW);
      expect(stats.typicalDays).toBe(5);
    });

    // A restored backup, or a completedAt edited back past the creation date.
    it('never reports a negative span', () => {
      const stats = projectStats([
        makeProject({ id: 'a', completed: true, createdAt: '2026-05-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' }),
      ], [], NOW);
      expect(stats.typicalDays).toBe(0);
    });
  });

  describe('recentlyFinished', () => {
    it('is newest first and carries each project its own span', () => {
      const stats = projectStats([
        makeProject({ id: 'old', completed: true, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-02-01T00:00:00.000Z' }),
        makeProject({ id: 'new', completed: true, createdAt: '2026-06-01T00:00:00.000Z', completedAt: '2026-06-11T00:00:00.000Z' }),
      ], [], NOW);
      expect(stats.recentlyFinished.map(f => f.project.id)).toEqual(['new', 'old']);
      expect(stats.recentlyFinished[0].days).toBe(10);
      expect(stats.recentlyFinished[1].days).toBe(31);
    });

    it('caps the list', () => {
      const many = Array.from({ length: RECENT_FINISHED_LIMIT + 3 }, (_, i) =>
        makeProject({
          id: `p${i}`,
          completed: true,
          completedAt: `2026-0${(i % 9) + 1}-01T00:00:00.000Z`,
        })
      );
      expect(projectStats(many, [], NOW).recentlyFinished).toHaveLength(RECENT_FINISHED_LIMIT);
    });

    it('leaves out a completed project with no completedAt to sort by', () => {
      const stats = projectStats([makeProject({ id: 'a', completed: true, completedAt: null })], [], NOW);
      expect(stats.recentlyFinished).toEqual([]);
      expect(stats.finished).toBe(0);
    });
  });
});
