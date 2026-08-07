import { estimateEffort } from '../utils/effortEstimator';
import type { Task } from '../types';

let nextId = 1;

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: String(nextId++),
  title: 'Untitled',
  notes: '',
  completed: true,
  completedAt: '2025-01-01T00:00:00.000Z',
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
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  reminderTime: null,
  reminderKind: 'notification',
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
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
  archived: false,
  archivedAt: null,
  linkUrl: null,
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

beforeEach(() => {
  nextId = 1;
});

describe('estimateEffort', () => {
  it('abstains for a blank title', () => {
    expect(estimateEffort('   ', {}, [])).toEqual({ minutes: null, reason: 'Add a title first.' });
  });

  it('abstains with no history', () => {
    const result = estimateEffort('Write the quarterly report', {}, []);
    expect(result.minutes).toBeNull();
  });

  it('abstains when a tier has fewer than 3 samples', () => {
    const tasks = [
      makeTask({ title: 'Water the plants', actualMinutes: 10 }),
      makeTask({ title: 'Water the plants', actualMinutes: 12 }),
    ];
    const result = estimateEffort('Water the plants', {}, tasks);
    expect(result.minutes).toBeNull();
  });

  describe('tier 1: recurrence series', () => {
    it('walks the previousOccurrenceId chain and takes the median', () => {
      const t1 = makeTask({ id: 'a', title: 'Water the plants', actualMinutes: 10 });
      const t2 = makeTask({ id: 'b', title: 'Water the plants', actualMinutes: 20, previousOccurrenceId: 'a' });
      const t3 = makeTask({ id: 'c', title: 'Water the plants', actualMinutes: 30, previousOccurrenceId: 'b' });
      const tasks = [t1, t2, t3];
      const result = estimateEffort('Water the plants', { previousOccurrenceId: 'c' }, tasks);
      expect(result.minutes).toBe(20);
      expect(result.reason).toContain('3 past occurrences');
    });

    it('ignores occurrences that were never timed', () => {
      const t1 = makeTask({ id: 'a', title: 'Water the plants', actualMinutes: null });
      const t2 = makeTask({ id: 'b', title: 'Water the plants', actualMinutes: 20, previousOccurrenceId: 'a' });
      const tasks = [t1, t2];
      const result = estimateEffort('Water the plants', { previousOccurrenceId: 'b' }, tasks);
      expect(result.minutes).toBeNull();
    });

    it('takes priority over an exact title match with more samples', () => {
      const t1 = makeTask({ id: 'a', title: 'Water the plants', actualMinutes: 10 });
      const t2 = makeTask({ id: 'b', title: 'Water the plants', actualMinutes: 20, previousOccurrenceId: 'a' });
      const t3 = makeTask({ id: 'c', title: 'Water the plants', actualMinutes: 30, previousOccurrenceId: 'b' });
      // Plenty of unrelated exact-title matches that would otherwise win tier 2.
      const extras = [90, 95, 100].map(m => makeTask({ title: 'Water the plants', actualMinutes: m }));
      const tasks = [t1, t2, t3, ...extras];
      const result = estimateEffort('Water the plants', { previousOccurrenceId: 'c' }, tasks);
      expect(result.minutes).toBe(20);
      expect(result.reason).toContain('occurrences');
    });
  });

  describe('tier 2: exact title match', () => {
    it('matches case- and whitespace-insensitively and takes the median', () => {
      const tasks = [
        makeTask({ title: '  Water   the Plants ', actualMinutes: 10 }),
        makeTask({ title: 'water the plants', actualMinutes: 20 }),
        makeTask({ title: 'WATER THE PLANTS', actualMinutes: 30 }),
      ];
      const result = estimateEffort('Water the plants', {}, tasks);
      expect(result.minutes).toBe(20);
      expect(result.reason).toContain('3 past tasks titled');
    });

    it('excludes the task being estimated for itself', () => {
      const self = makeTask({ id: 'self', title: 'Water the plants', actualMinutes: 999 });
      const tasks = [
        self,
        makeTask({ title: 'Water the plants', actualMinutes: 10 }),
        makeTask({ title: 'Water the plants', actualMinutes: 20 }),
      ];
      const result = estimateEffort('Water the plants', { excludeTaskId: 'self' }, tasks);
      // Only 2 remaining exact matches — not enough, falls through to abstain
      // since nothing else in this small pool supports a lower tier.
      expect(result.minutes).toBeNull();
    });
  });

  describe('tier 3: token median', () => {
    it('finds a shared significant token across differently-titled tasks', () => {
      const tasks = [
        makeTask({ title: 'Reply to client email', actualMinutes: 5 }),
        makeTask({ title: 'Send invoice email', actualMinutes: 7 }),
        makeTask({ title: 'Draft follow-up email', actualMinutes: 9 }),
      ];
      const result = estimateEffort('Email the landlord', {}, tasks);
      expect(result.minutes).toBe(7);
      expect(result.reason).toContain('containing "email"');
    });

    it('ignores short stopword tokens', () => {
      const tasks = [
        makeTask({ title: 'Go to the store', actualMinutes: 5 }),
        makeTask({ title: 'Go for a walk', actualMinutes: 7 }),
        makeTask({ title: 'Go home', actualMinutes: 9 }),
      ];
      // "to", "a" are stopwords/too short; "go" is the only shared real token.
      const result = estimateEffort('Go get coffee', {}, tasks);
      expect(result.minutes).toBe(7);
    });
  });

  describe('tier 4: category/tag median', () => {
    it('matches on shared category', () => {
      const tasks = [
        makeTask({ title: 'Unrelated one', category: 'chores', actualMinutes: 15 }),
        makeTask({ title: 'Unrelated two', category: 'chores', actualMinutes: 25 }),
        makeTask({ title: 'Unrelated three', category: 'chores', actualMinutes: 35 }),
      ];
      const result = estimateEffort('Brand new kind of task', { category: 'chores' }, tasks);
      expect(result.minutes).toBe(25);
      expect(result.reason).toContain('category or tag');
    });

    it('matches on a shared tag', () => {
      const tasks = [
        makeTask({ title: 'Unrelated one', tags: ['errand'], actualMinutes: 15 }),
        makeTask({ title: 'Unrelated two', tags: ['errand'], actualMinutes: 25 }),
        makeTask({ title: 'Unrelated three', tags: ['errand', 'home'], actualMinutes: 35 }),
      ];
      const result = estimateEffort('Brand new kind of task', { tags: ['errand'] }, tasks);
      expect(result.minutes).toBe(25);
    });
  });

  describe('tier 5: global median', () => {
    it('falls back to the median of all measured tasks', () => {
      const tasks = [
        makeTask({ title: 'Alpha', actualMinutes: 10 }),
        makeTask({ title: 'Beta', actualMinutes: 20 }),
        makeTask({ title: 'Gamma', actualMinutes: 60 }),
      ];
      const result = estimateEffort('Something completely different', {}, tasks);
      expect(result.minutes).toBe(20);
      expect(result.reason).toContain('median of 3 timed tasks');
    });

    it('averages the two middle values for an even sample count', () => {
      const tasks = [
        makeTask({ title: 'Alpha', actualMinutes: 10 }),
        makeTask({ title: 'Beta', actualMinutes: 20 }),
        makeTask({ title: 'Gamma', actualMinutes: 30 }),
        makeTask({ title: 'Delta', actualMinutes: 40 }),
      ];
      const result = estimateEffort('Something completely different', {}, tasks);
      expect(result.minutes).toBe(25);
    });
  });
});
