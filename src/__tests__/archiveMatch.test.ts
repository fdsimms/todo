import { findArchivedMatch } from '../utils/archiveMatch';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Duolingo',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'daily',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
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
  archived: true,
  archivedAt: '2025-01-01T00:00:00.000Z',
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

describe('findArchivedMatch', () => {
  it('matches an exact, case-insensitive title', () => {
    const archived = [makeTask({ title: 'Duolingo' })];
    expect(findArchivedMatch(archived, 'duolingo')?.id).toBe('1');
    expect(findArchivedMatch(archived, '  Duolingo  ')?.id).toBe('1');
  });

  it('matches a strong substring/fuzzy candidate', () => {
    const archived = [makeTask({ title: 'Duolingo Spanish practice' })];
    expect(findArchivedMatch(archived, 'Duolingo')?.id).toBe('1');
  });

  it('returns null when nothing matches closely enough', () => {
    const archived = [makeTask({ title: 'Duolingo' })];
    expect(findArchivedMatch(archived, 'Water the plants')).toBeNull();
  });

  it('returns null for an empty query', () => {
    const archived = [makeTask({ title: 'Duolingo' })];
    expect(findArchivedMatch(archived, '   ')).toBeNull();
  });

  it('returns null when there are no archived tasks', () => {
    expect(findArchivedMatch([], 'Duolingo')).toBeNull();
  });
});
