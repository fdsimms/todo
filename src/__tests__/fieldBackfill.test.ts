import {
  isFieldMissing, isBackfillDismissed, backfillCandidates, backfillFieldCounts,
  dismissBackfillField, estimatePatchFor, BACKFILL_FIELDS,
} from '../utils/fieldBackfill';
import type { Task, Category } from '../types';

const baseCategory: Category = {
  id: 'cat-1',
  name: 'Home',
  scheduleDays: null,
  scheduleStart: null,
  scheduleEnd: null,
  hideOnVacation: false,
  excludeFromSuggestions: false,
  excludeFromNewTasksBanner: false,
  defaultTimeSegments: [],
  sortOrder: 0,
  emoji: null,
  backfillDismissedFields: [],
};

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
  recurrenceAnchorDay: null,
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
  backfillDismissedFields: [],
};

describe('isFieldMissing', () => {
  it('treats a null estimate as missing, regardless of effort', () => {
    expect(isFieldMissing(baseTask, 'estimate')).toBe(true);
    expect(isFieldMissing({ ...baseTask, effort: 3, estimatedMinutes: null }, 'estimate')).toBe(true);
  });

  it('treats any set estimate as not missing', () => {
    expect(isFieldMissing({ ...baseTask, estimatedMinutes: 30 }, 'estimate')).toBe(false);
  });

  it('treats the active chain step\'s own estimate as not missing, even with no task-level estimate', () => {
    // A recipe-backed "Cook X" step (or a meal-slot step with a remembered
    // default) already has a real duration on chainItems — the backfill
    // wizard shouldn't ask for one it can already read.
    const task = {
      ...baseTask,
      chainEnabled: true,
      chainIndex: 0,
      chainItems: [{ id: 's1', title: 'Cook', estimatedMinutes: 35 }, { id: 's2', title: 'Eat', estimatedMinutes: null }],
    };
    expect(isFieldMissing(task, 'estimate')).toBe(false);
  });

  it('still treats it as missing when the current step has no estimate of its own', () => {
    const task = {
      ...baseTask,
      chainEnabled: true,
      chainIndex: 1,
      chainItems: [{ id: 's1', title: 'Cook', estimatedMinutes: 35 }, { id: 's2', title: 'Eat', estimatedMinutes: null }],
    };
    expect(isFieldMissing(task, 'estimate')).toBe(true);
  });

  it('excludes generated "use up" tasks from the estimate field entirely', () => {
    // Every one names a different food with its own prep time — there's no
    // step-type to remember a duration against, and no recipe to read one
    // from either, so these are never asked about rather than asked forever.
    expect(isFieldMissing({ ...baseTask, generatedKind: 'groceryUseUp' }, 'estimate')).toBe(false);
    expect(isFieldMissing({ ...baseTask, generatedKind: 'leftoverUseUp' }, 'estimate')).toBe(false);
  });

  it('does not exclude a "use up" task from other fields', () => {
    expect(isFieldMissing({ ...baseTask, generatedKind: 'groceryUseUp' }, 'priority')).toBe(true);
    expect(isFieldMissing({ ...baseTask, generatedKind: 'groceryUseUp', category: 'Home' }, 'category')).toBe(false);
  });

  it('treats priority 0 (None) as missing', () => {
    expect(isFieldMissing(baseTask, 'priority')).toBe(true);
    expect(isFieldMissing({ ...baseTask, priority: 2 }, 'priority')).toBe(false);
  });

  it('treats a null category as missing', () => {
    expect(isFieldMissing(baseTask, 'category')).toBe(true);
    expect(isFieldMissing({ ...baseTask, category: 'Home' }, 'category')).toBe(false);
  });

  it('treats streak as missing only for a recurring task with the toggle off', () => {
    expect(isFieldMissing(baseTask, 'streak')).toBe(false); // not recurring
    expect(isFieldMissing({ ...baseTask, recurrenceType: 'daily' }, 'streak')).toBe(true);
    expect(isFieldMissing({ ...baseTask, recurrenceType: 'daily', showStreak: true }, 'streak')).toBe(false);
  });

  it('treats vacation pause as missing only for a recurring task with the toggle off', () => {
    expect(isFieldMissing(baseTask, 'vacation')).toBe(false); // not recurring
    expect(isFieldMissing({ ...baseTask, recurrenceType: 'daily' }, 'vacation')).toBe(true);
    expect(isFieldMissing({ ...baseTask, recurrenceType: 'daily', vacationPause: true }, 'vacation')).toBe(false);
  });

  it('does not treat vacation pause as missing when the task\'s own category already hides on vacation', () => {
    const task = { ...baseTask, recurrenceType: 'daily' as const, category: 'Home' };
    const hidingCategory = { ...baseCategory, name: 'Home', hideOnVacation: true };
    expect(isFieldMissing(task, 'vacation', [hidingCategory])).toBe(false);
    // A category that hasn't turned it on doesn't suppress the question.
    expect(isFieldMissing(task, 'vacation', [{ ...baseCategory, name: 'Home', hideOnVacation: false }])).toBe(true);
    // A different category hiding on vacation is irrelevant to this task.
    expect(isFieldMissing(task, 'vacation', [{ ...baseCategory, name: 'Work', hideOnVacation: true }])).toBe(true);
    // No categories passed at all: falls back to the task-only check.
    expect(isFieldMissing(task, 'vacation')).toBe(true);
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

  it('excludes generated "use up" tasks from the estimate queue', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'grocery', generatedKind: 'groceryUseUp' },
      { ...baseTask, id: 'leftover', generatedKind: 'leftoverUseUp' },
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

  it('excludes a task dismissed for that field, but not for another', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', backfillDismissedFields: ['estimate'] },
      { ...baseTask, id: 'b', backfillDismissedFields: ['priority'] },
    ];
    expect(backfillCandidates(tasks, 'estimate').map(t => t.id)).toEqual(['b']);
  });

  it('only includes recurring tasks for streak', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'not-recurring' },
      { ...baseTask, id: 'recurring-off', recurrenceType: 'daily' },
      { ...baseTask, id: 'recurring-on', recurrenceType: 'daily', showStreak: true },
    ];
    expect(backfillCandidates(tasks, 'streak').map(t => t.id)).toEqual(['recurring-off']);
  });

  it('only includes recurring tasks for vacation pause', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'not-recurring' },
      { ...baseTask, id: 'recurring-off', recurrenceType: 'daily' },
      { ...baseTask, id: 'recurring-on', recurrenceType: 'daily', vacationPause: true },
    ];
    expect(backfillCandidates(tasks, 'vacation').map(t => t.id)).toEqual(['recurring-off']);
  });

  it('excludes a recurring task whose category already hides on vacation', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'no-category', recurrenceType: 'daily' },
      { ...baseTask, id: 'hidden-category', recurrenceType: 'daily', category: 'Home' },
      { ...baseTask, id: 'other-category', recurrenceType: 'daily', category: 'Work' },
    ];
    const categories: Category[] = [{ ...baseCategory, name: 'Home', hideOnVacation: true }];
    expect(backfillCandidates(tasks, 'vacation', { categories }).map(t => t.id))
      .toEqual(['no-category', 'other-category']);
  });

  describe('fromScratch', () => {
    it('includes tasks that already have the field set', () => {
      const tasks: Task[] = [
        { ...baseTask, id: 'a', estimatedMinutes: 30 },
        { ...baseTask, id: 'b', estimatedMinutes: null },
      ];
      expect(backfillCandidates(tasks, 'estimate', { fromScratch: true }).map(t => t.id))
        .toEqual(['a', 'b']);
    });

    it('includes tasks dismissed for that field', () => {
      const tasks: Task[] = [
        { ...baseTask, id: 'a', backfillDismissedFields: ['estimate'] },
      ];
      expect(backfillCandidates(tasks, 'estimate', { fromScratch: true }).map(t => t.id))
        .toEqual(['a']);
    });

    it('still excludes subtasks, completed tasks and archived tasks', () => {
      const tasks: Task[] = [
        { ...baseTask, id: 'sub', parentId: 'test-1' },
        { ...baseTask, id: 'done', completed: true },
        { ...baseTask, id: 'gone', archived: true },
        { ...baseTask, id: 'live' },
      ];
      expect(backfillCandidates(tasks, 'estimate', { fromScratch: true }).map(t => t.id))
        .toEqual(['live']);
    });
  });
});

describe('isBackfillDismissed / dismissBackfillField', () => {
  it('is false until the field has been dismissed', () => {
    expect(isBackfillDismissed(baseTask, 'estimate')).toBe(false);
  });

  it('dismissing appends the field id', () => {
    const patch = dismissBackfillField(baseTask, 'estimate');
    expect(patch.backfillDismissedFields).toEqual(['estimate']);
    expect(isBackfillDismissed({ ...baseTask, ...patch }, 'estimate')).toBe(true);
  });

  it('preserves other dismissed fields already on the task', () => {
    const task = { ...baseTask, backfillDismissedFields: ['priority'] };
    expect(dismissBackfillField(task, 'estimate').backfillDismissedFields).toEqual(['priority', 'estimate']);
  });

  it('dismissing twice does not duplicate the entry', () => {
    const task = { ...baseTask, backfillDismissedFields: ['estimate'] };
    expect(dismissBackfillField(task, 'estimate').backfillDismissedFields).toEqual(['estimate']);
  });
});

describe('backfillFieldCounts', () => {
  it('counts each field independently, skipping subtasks/completed/archived', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', estimatedMinutes: 30 },
      { ...baseTask, id: 'b', priority: 2 },
      { ...baseTask, id: 'c', category: 'Home' },
      { ...baseTask, id: 'd', completed: true },
      { ...baseTask, id: 'e', estimatedMinutes: 30, priority: 2, category: 'Home', recurrenceType: 'daily', showStreak: true, vacationPause: true },
      { ...baseTask, id: 'f', estimatedMinutes: 30, priority: 2, category: 'Home', recurrenceType: 'daily' },
    ];
    expect(backfillFieldCounts(tasks)).toEqual({ estimate: 2, priority: 2, category: 2, streak: 1, vacation: 1 });
  });

  it('covers every declared backfillable field', () => {
    const counts = backfillFieldCounts([{ ...baseTask, recurrenceType: 'daily' }]);
    for (const field of BACKFILL_FIELDS) {
      expect(counts[field.id]).toBe(1);
    }
  });

  it('does not count a task dismissed for that field', () => {
    const task = { ...baseTask, backfillDismissedFields: ['estimate'] };
    expect(backfillFieldCounts([task])).toEqual({ estimate: 0, priority: 1, category: 1, streak: 0, vacation: 0 });
  });

  it('does not count a recurring task whose category already hides on vacation', () => {
    const task = { ...baseTask, recurrenceType: 'daily' as const, category: 'Home' };
    const categories: Category[] = [{ ...baseCategory, name: 'Home', hideOnVacation: true }];
    expect(backfillFieldCounts([task], categories).vacation).toBe(0);
    expect(backfillFieldCounts([task]).vacation).toBe(1);
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
