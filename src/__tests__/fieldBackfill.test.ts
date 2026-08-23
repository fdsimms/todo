import {
  isFieldMissing, backfillCandidates, backfillFieldCounts, estimatePatchFor, BACKFILL_FIELDS,
} from '../utils/fieldBackfill';
import type { Task } from '../types';

const baseTask: Task = {
  id: 'test-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date(2025, 0, 1).toISOString(),
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
  streakRequiresWindow: false,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
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
  extraTaskDraft: null,
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
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
};

describe('isFieldMissing', () => {
  it('treats a null estimate as missing, regardless of effort', () => {
    expect(isFieldMissing(baseTask, 'estimate')).toBe(true);
    expect(isFieldMissing({ ...baseTask, effort: 3, estimatedMinutes: null }, 'estimate')).toBe(true);
  });

  it('treats any set estimate as not missing', () => {
    expect(isFieldMissing({ ...baseTask, estimatedMinutes: 30 }, 'estimate')).toBe(false);
  });

  it('treats priority 0 (None) as missing', () => {
    expect(isFieldMissing(baseTask, 'priority')).toBe(true);
    expect(isFieldMissing({ ...baseTask, priority: 2 }, 'priority')).toBe(false);
  });

  it('treats a null category as missing', () => {
    expect(isFieldMissing(baseTask, 'category')).toBe(true);
    expect(isFieldMissing({ ...baseTask, category: 'Home' }, 'category')).toBe(false);
  });
});

describe('backfillCandidates', () => {
  it('excludes subtasks, completed tasks and archived tasks', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'sub', parentId: 'test-1' },
      { ...baseTask, id: 'done', completed: true },
      { ...baseTask, id: 'gone', archived: true },
      { ...baseTask, id: 'live' },
    ];
    expect(backfillCandidates(tasks, 'estimate').map(t => t.id)).toEqual(['live']);
  });

  it('excludes tasks that already have the field set', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', estimatedMinutes: 30 },
      { ...baseTask, id: 'b', estimatedMinutes: null },
    ];
    expect(backfillCandidates(tasks, 'estimate').map(t => t.id)).toEqual(['b']);
  });

  it('sorts candidates by title', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', title: 'Zebra' },
      { ...baseTask, id: 'b', title: 'Apple' },
    ];
    expect(backfillCandidates(tasks, 'estimate').map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('backfillFieldCounts', () => {
  it('counts each field independently, skipping subtasks/completed/archived', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', estimatedMinutes: 30 },
      { ...baseTask, id: 'b', priority: 2 },
      { ...baseTask, id: 'c', category: 'Home' },
      { ...baseTask, id: 'd', completed: true },
    ];
    expect(backfillFieldCounts(tasks)).toEqual({ estimate: 2, priority: 2, category: 2 });
  });

  it('covers every declared backfillable field', () => {
    const counts = backfillFieldCounts([baseTask]);
    for (const field of BACKFILL_FIELDS) {
      expect(counts[field.id]).toBe(1);
    }
  });
});

describe('estimatePatchFor', () => {
  it('pairs effort with its canonical minutes', () => {
    expect(estimatePatchFor(3)).toEqual({ effort: 3, estimatedMinutes: 30 });
  });

  it('maps the unknown bucket to a null estimate', () => {
    expect(estimatePatchFor(0)).toEqual({ effort: 0, estimatedMinutes: null });
  });
});
