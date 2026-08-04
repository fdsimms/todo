import { findArchivedMatch } from '../utils/archiveMatch';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Duolingo',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'daily',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
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
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
  archived: true,
  archivedAt: '2025-01-01T00:00:00.000Z',
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
