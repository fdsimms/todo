import { suggestTitles as suggestTitlesAt } from '../utils/titleSuggestions';
import type { Task } from '../types';

// Fixed reference point so single-occurrence fixtures below (completed 2025-05-01)
// stay within the "recently completed" window most tests aren't exercising.
const NOW = Date.parse('2025-05-03T00:00:00.000Z');
const suggestTitles = (tasks: Task[], query: string, limit?: number, now: number = NOW) =>
  suggestTitlesAt(tasks, query, limit, now);

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Buy groceries',
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
  sortOrder: 1,
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
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskOneAtATime: false,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  extraTaskSourceTitle: null,
  category: null,
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
  ...overrides,
});

// All fixtures default to completed, since only completed titles are eligible.
const done = (overrides: Partial<Task> = {}) =>
  makeTask({ completed: true, completedAt: '2025-05-01T00:00:00.000Z', ...overrides });

describe('suggestTitles', () => {
  describe('query length guard', () => {
    it('returns [] for a query shorter than 3 chars', () => {
      const tasks = [done({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, 'us')).toEqual([]);
    });

    it('returns [] for a whitespace-only query', () => {
      const tasks = [done({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, '   ')).toEqual([]);
    });

    it('matches once the query reaches 3 chars', () => {
      const tasks = [done({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, 'use').map(s => s.title)).toEqual(['use BOGO ticket']);
    });
  });

  describe('matching', () => {
    it('matches a title-start prefix and highlights the matched range', () => {
      const tasks = [done({ id: 'a', title: 'use BOGO ticket before it expires' })];
      const result = suggestTitles(tasks, 'use BOGO');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('use BOGO ticket before it expires');
      expect(result[0].ranges).toEqual([[0, 8]]);
    });

    it('is case-insensitive', () => {
      const tasks = [done({ title: 'Use BOGO ticket' })];
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['Use BOGO ticket']);
    });

    it('matches the start of a word, not only the start of the title', () => {
      const tasks = [done({ title: 'remember to call the dentist' })];
      const result = suggestTitles(tasks, 'dentist');
      expect(result.map(s => s.title)).toEqual(['remember to call the dentist']);
      expect(result[0].ranges).toEqual([[21, 28]]);
    });

    it('does not match mid-word (no fuzzy/substring fallback)', () => {
      // "ea" appears inside "clean", "leaky", "read" — none at a word start.
      const tasks = [
        done({ id: 'a', title: 'clean the garage' }),
        done({ id: 'b', title: 'fix the leaky faucet' }),
        done({ id: 'c', title: 'read chapter 4' }),
      ];
      expect(suggestTitles(tasks, 'ea')).toEqual([]);
    });

    it('returns [] when nothing matches', () => {
      const tasks = [done({ title: 'walk the dog' })];
      expect(suggestTitles(tasks, 'zzz')).toEqual([]);
    });
  });

  describe('dedupe and exclusions', () => {
    it('dedupes case-insensitively into a single suggestion', () => {
      const tasks = [
        done({ id: 'a', title: 'use BOGO ticket' }),
        done({ id: 'b', title: 'Use BOGO Ticket' }),
        done({ id: 'c', title: 'use bogo ticket' }),
      ];
      const result = suggestTitles(tasks, 'use bogo');
      expect(result).toHaveLength(1);
    });

    it('keeps the most recently used casing when deduping', () => {
      const tasks = [
        done({ id: 'old', title: 'use bogo ticket', completedAt: '2025-01-01T00:00:00.000Z' }),
        done({ id: 'new', title: 'Use BOGO Ticket', completedAt: '2025-06-01T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'use bogo')[0].title).toBe('Use BOGO Ticket');
    });

    it('excludes a title that exactly equals the query', () => {
      const tasks = [done({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, 'use BOGO ticket')).toEqual([]);
    });

    it('excludes subtasks', () => {
      const tasks = [done({ title: 'use BOGO ticket', parentId: 'parent-1' })];
      expect(suggestTitles(tasks, 'use bogo')).toEqual([]);
    });

    it('ignores blank titles', () => {
      const tasks = [done({ title: '   ' })];
      expect(suggestTitles(tasks, 'use')).toEqual([]);
    });

    it('excludes a title that already belongs to a currently open task', () => {
      const tasks = [
        done({ id: 'a', title: 'use BOGO ticket', completedAt: '2025-05-01T00:00:00.000Z' }),
        makeTask({ id: 'b', title: 'use BOGO ticket', completed: false, completedAt: null }),
      ];
      expect(suggestTitles(tasks, 'use bogo')).toEqual([]);
    });

    it('is case-insensitive when matching against an open task title', () => {
      const tasks = [
        done({ id: 'a', title: 'use BOGO ticket', completedAt: '2025-05-01T00:00:00.000Z' }),
        makeTask({ id: 'b', title: 'Use Bogo Ticket', completed: false, completedAt: null }),
      ];
      expect(suggestTitles(tasks, 'use bogo')).toEqual([]);
    });

    it('still suggests a completed title when no open task shares it', () => {
      const tasks = [
        done({ id: 'a', title: 'use BOGO ticket', completedAt: '2025-05-01T00:00:00.000Z' }),
        makeTask({ id: 'b', title: 'walk the dog', completed: false, completedAt: null }),
      ];
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['use BOGO ticket']);
    });
  });

  describe('completed tasks', () => {
    it('includes completed tasks (the whole point of surfacing one-offs)', () => {
      const tasks = [
        done({ title: 'use BOGO ticket', completedAt: '2025-05-01T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['use BOGO ticket']);
    });

    it('excludes tasks that have never been completed', () => {
      const tasks = [makeTask({ title: 'use BOGO ticket', completed: false, completedAt: null })];
      expect(suggestTitles(tasks, 'use bogo')).toEqual([]);
    });
  });

  describe('ranking and limit', () => {
    it('ranks a title-start match above a word-start match', () => {
      const tasks = [
        done({ id: 'mid', title: 'go to the gym session' }),
        done({ id: 'pre', title: 'gym session tonight' }),
      ];
      expect(suggestTitles(tasks, 'gym')[0].title).toBe('gym session tonight');
    });

    it('breaks score ties by recency (most recent first)', () => {
      const tasks = [
        done({ id: 'older', title: 'gym at noon', completedAt: '2025-04-28T00:00:00.000Z' }),
        done({ id: 'newer', title: 'gym at dawn', completedAt: '2025-05-02T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'gym at').map(s => s.title)).toEqual(['gym at dawn', 'gym at noon']);
    });

    it('defaults to a limit of 3', () => {
      const tasks = Array.from({ length: 10 }, (_, i) => done({ id: String(i), title: `task number ${i}` }));
      expect(suggestTitles(tasks, 'task')).toHaveLength(3);
    });

    it('respects an explicit limit', () => {
      const tasks = Array.from({ length: 10 }, (_, i) => done({ id: String(i), title: `task number ${i}` }));
      expect(suggestTitles(tasks, 'task', 5)).toHaveLength(5);
    });
  });

  describe('single-occurrence staleness', () => {
    it('suggests a title completed once within the last week', () => {
      const tasks = [done({ title: 'use BOGO ticket', completedAt: '2025-04-27T00:00:00.000Z' })]; // 6 days before NOW
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['use BOGO ticket']);
    });

    it('drops a title completed once more than a week ago', () => {
      const tasks = [done({ title: 'put on new Steam Deck screen protector', completedAt: '2025-04-01T00:00:00.000Z' })];
      expect(suggestTitles(tasks, 'put')).toEqual([]);
    });

    it('keeps suggesting a title completed 2+ times no matter how stale', () => {
      const tasks = [
        done({ id: 'a', title: 'use BOGO ticket', completedAt: '2024-01-01T00:00:00.000Z' }),
        done({ id: 'b', title: 'use BOGO ticket', completedAt: '2024-02-01T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['use BOGO ticket']);
    });
  });
});
