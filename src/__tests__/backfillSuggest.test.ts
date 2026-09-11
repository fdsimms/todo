import {
  isSuggestibleBackfillField, suggestionTasks, suggestionExamples, readSuggestions,
  suggestibleEstimateMinutes, MAX_SUGGESTION_TASKS, MAX_SUGGESTION_EXAMPLES,
  SUGGESTION_NOTES_MAX_CHARS,
} from '../utils/backfillSuggest';
import { displayTitleFor } from '../utils/visibilityUtils';
import type { Task } from '../types';

// `displayTitleFor` lives in `visibilityUtils`, which reaches both stores at
// import time and so pulls in `expo-sqlite`. Same two mocks
// `visibilityUtils.test.ts` uses, and for the same reason: nothing here needs
// a store, only the title rule.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ categories: [], getCategoryByName: () => null }),
  },
}));

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
  recurrenceAnchorDate: null,
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
  priorBestStreak: 0,
  polarity: 'positive',
  slipCount: 0,
  slipDate: null,
  penaltyMinutes: null,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  gatesApps: false,
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
  quotaIntervalMinutes: null,
  quotaReminders: false,
  quotaStartedAt: null, quotaAlwaysVisible: false,
  quotaPeriod: 'day',
  progressCount: 0,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  parentId: null,
  groupId: null,
  projectId: null,
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
  healthTarget: null, completionTimerMinutes: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null,
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
  logCompletionToCalendar: false,
  completionCalendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
};

const task = (over: Partial<Task>): Task => ({ ...baseTask, ...over });

describe('isSuggestibleBackfillField', () => {
  it('covers the two fields a task title can answer', () => {
    expect(isSuggestibleBackfillField('category')).toBe(true);
    expect(isSuggestibleBackfillField('estimate')).toBe(true);
  });

  // The refusals, not a formality: priority is defined against the rest of the
  // list and the other four are preferences, so none of them has an answer in
  // the task to find.
  it('refuses the preference fields', () => {
    for (const id of ['priority', 'streak', 'vacation', 'reminder', 'suggestions'] as const) {
      expect(isSuggestibleBackfillField(id)).toBe(false);
    }
  });
});

describe('suggestionTasks', () => {
  it('carries the title and trimmed notes', () => {
    const [sent] = suggestionTasks([task({ id: 'a', title: 'Clean the gutters', notes: '  ladder  ' })], displayTitleFor);
    expect(sent).toEqual({ id: 'a', title: 'Clean the gutters', notes: 'ladder' });
  });

  it('caps the batch', () => {
    const many = Array.from({ length: MAX_SUGGESTION_TASKS + 10 }, (_, i) => task({ id: `t${i}` }));
    expect(suggestionTasks(many, displayTitleFor)).toHaveLength(MAX_SUGGESTION_TASKS);
  });

  it('truncates long notes', () => {
    const [sent] = suggestionTasks([task({ notes: 'x'.repeat(SUGGESTION_NOTES_MAX_CHARS + 50) })], displayTitleFor);
    expect(sent.notes).toHaveLength(SUGGESTION_NOTES_MAX_CHARS);
  });

  // The card shows the active step's name mid-chain, so the question asked has
  // to be about the step, not about the chain it belongs to.
  it('sends the active chain step title, matching what the card shows', () => {
    const chained = task({
      title: 'Laundry',
      chainEnabled: true,
      chainIndex: 1,
      chainItems: [
        { id: 's1', title: 'Load the washer', estimatedMinutes: null },
        { id: 's2', title: 'Move to the dryer', estimatedMinutes: null },
      ],
    });
    expect(suggestionTasks([chained], displayTitleFor)[0].title).toBe('Move to the dryer');
  });
});

describe('suggestionExamples', () => {
  it('draws the user own answers for the field', () => {
    const examples = suggestionExamples(
      [task({ id: 'a', title: 'Pay rent', category: 'Money' }), task({ id: 'b', title: 'No category' })],
      'category', displayTitleFor,
    );
    expect(examples).toEqual([{ title: 'Pay rent', value: 'Money' }]);
  });

  it('speaks in the buckets own minutes rather than an exact figure', () => {
    // effort 3 is the 30-minute bucket; the task carrying 45 is an example of 30.
    const examples = suggestionExamples([task({ title: 'Tidy up', effort: 3, estimatedMinutes: 45 })], 'estimate', displayTitleFor);
    expect(examples).toEqual([{ title: 'Tidy up', value: '30 minutes' }]);
  });

  // Without this a from-scratch run hands the model a task as the example for
  // its own question, and the answer is that task current value every time.
  it('excludes the tasks being asked about', () => {
    const answered = task({ id: 'a', title: 'Pay rent', category: 'Money' });
    expect(suggestionExamples([answered], 'category', displayTitleFor, new Set(['a']))).toEqual([]);
  });

  it('ignores completed, archived and subtask rows', () => {
    const rows = [
      task({ id: 'a', title: 'Done', category: 'Money', completed: true }),
      task({ id: 'b', title: 'Filed', category: 'Money', archived: true }),
      task({ id: 'c', title: 'Sub', category: 'Money', parentId: 'a' }),
      task({ id: 'd', title: 'Live', category: 'Money' }),
    ];
    expect(suggestionExamples(rows, 'category', displayTitleFor)).toEqual([{ title: 'Live', value: 'Money' }]);
  });

  it('caps the examples', () => {
    const many = Array.from({ length: MAX_SUGGESTION_EXAMPLES + 5 }, (_, i) =>
      task({ id: `t${i}`, title: `Task ${i}`, category: 'Home' }));
    expect(suggestionExamples(many, 'category', displayTitleFor)).toHaveLength(MAX_SUGGESTION_EXAMPLES);
  });
});

describe('suggestibleEstimateMinutes', () => {
  it('is the buckets the card already offers, in order', () => {
    expect(suggestibleEstimateMinutes()).toEqual([1, 15, 30, 90, 240, 480]);
  });
});

describe('readSuggestions', () => {
  const sent = [
    { id: 'a', title: 'Pay rent', notes: '' },
    { id: 'b', title: 'Clean the gutters', notes: '' },
  ];
  const categories = ['Home', 'Money'];

  it('maps a 1-based index back onto the task actually sent', () => {
    const out = readSuggestions([{ index: 2, category: 'Home' }], 'category', sent, categories);
    expect(out.get('b')).toEqual({ field: 'category', taskId: 'b', category: 'Home' });
    expect(out.has('a')).toBe(false);
  });

  it('returns the app own spelling of a category matched case-insensitively', () => {
    const out = readSuggestions([{ index: 1, category: '  money ' }], 'category', sent, categories);
    expect(out.get('a')).toEqual({ field: 'category', taskId: 'a', category: 'Money' });
  });

  // An invented category would write a value that exists on one task and shows
  // up in no picker — the same refusal canonicalAisle makes for aisles.
  it('drops a category that is not one of the user own', () => {
    expect(readSuggestions([{ index: 1, category: 'Errands' }], 'category', sent, categories).size).toBe(0);
  });

  it('drops an index outside the batch', () => {
    for (const index of [0, 3, -1, 1.5]) {
      expect(readSuggestions([{ index, category: 'Home' }], 'category', sent, categories).size).toBe(0);
    }
  });

  it('keeps the first answer when a task is answered twice', () => {
    const out = readSuggestions(
      [{ index: 1, category: 'Home' }, { index: 1, category: 'Money' }],
      'category', sent, categories,
    );
    expect(out.get('a')).toEqual({ field: 'category', taskId: 'a', category: 'Home' });
    expect(out.size).toBe(1);
  });

  it('maps a bucket duration back to its effort', () => {
    const out = readSuggestions([{ index: 1, minutes: 30 }, { index: 2, minutes: 240 }], 'estimate', sent);
    expect(out.get('a')).toEqual({ field: 'estimate', taskId: 'a', effort: 3 });
    expect(out.get('b')).toEqual({ field: 'estimate', taskId: 'b', effort: 5 });
  });

  // Dropped rather than snapped to the nearest bucket: a value the model did
  // not mean is not better than no suggestion for that one task.
  it('drops a duration that is not one of the buckets', () => {
    for (const minutes of [45, 0, -30, 7]) {
      expect(readSuggestions([{ index: 1, minutes }], 'estimate', sent).size).toBe(0);
    }
  });

  it('survives a malformed answer', () => {
    expect(readSuggestions(null, 'category', sent, categories).size).toBe(0);
    expect(readSuggestions('nope', 'estimate', sent).size).toBe(0);
    expect(readSuggestions([null, 42, {}, { index: '1' }], 'category', sent, categories).size).toBe(0);
  });
});
