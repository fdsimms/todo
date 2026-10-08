import { parseQuietTaps, tapsToRequeue, planQuietTaps, widgetTapNeedsApp, type QuietTap } from '../utils/widgetQuietTaps';
import type { GroceryListEntry, Task } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  vacationMode: false,
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

const NOW = new Date(2025, 5, 10, 10, 0, 0);
const AT = NOW.toISOString();
const YESTERDAY = new Date(2025, 5, 9, 21, 0, 0).toISOString();
const isCurrentDay = (iso: string) => new Date(iso).getDate() === NOW.getDate();

const baseTask = {
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
  recurrenceMonth: null,
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
  penaltyCreditedAt: null,
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
  quotaStartedAt: null, quotaAlwaysVisible: false, followWaterTarget: false,
  quotaPeriod: 'day',
  rotationEnabled: false,
  rotationItems: [],
  rotationLog: [],
  rotationPeriodStart: null,
  rotationLastDone: {},
  rotationPlan: null,
  progressCount: 0,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTracksVisibility: false, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
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
  followUpTaskOneAtATime: false, followUpTaskAtEnd: false,
  followUpTaskTally: 0,
  previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  followUpTaskSourceId: null,
  vacationPause: false, excludeFromSuggestions: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null, healthFollowGoal: false, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
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
} as Task;

const task = (overrides: Partial<Task> = {}): Task => ({ ...baseTask, ...overrides }) as Task;
const target = (overrides: Partial<Task> = {}) => task({ id: 'water', targetCount: 3, progressCount: 0, ...overrides });

const tap = (kind: QuietTap['kind'], id: string, at = AT, listId: string | null = null): QuietTap =>
  ({ kind, id, listId, at });

const entry = (overrides: Partial<GroceryListEntry> = {}): GroceryListEntry => ({
  itemId: 'milk',
  listId: null,
  checked: false,
  sortOrder: 0,
  choiceGroup: null,
  addedAt: AT,
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('widgetTapNeedsApp', () => {
  it('lets a plain task and a target below its last unit apply quietly', () => {
    expect(widgetTapNeedsApp(baseTask, true)).toBe(false);
    expect(widgetTapNeedsApp(target(), true)).toBe(false);
  });

  it('opens the app for anything a tap answers with a question or a picker', () => {
    expect(widgetTapNeedsApp(task({ deliverableKind: 'text' }), true)).toBe(true);
    expect(widgetTapNeedsApp(task({ completionTimerMinutes: 60 }), true)).toBe(true);
    expect(widgetTapNeedsApp(task({ logMealSlot: 'lunch' }), true)).toBe(true);
  });
});

describe('parseQuietTaps', () => {
  it('keeps well-formed taps and drops the rest', () => {
    const json = JSON.stringify([
      { kind: 'complete', id: 'a', at: AT },
      { kind: 'grocery', id: 'milk', listId: 'away', at: AT },
      { kind: 'shout', id: 'b', at: AT },
      { kind: 'unit', id: '', at: AT },
      { kind: 'unit', id: 'c', at: 'not a date' },
      'junk',
    ]);
    expect(parseQuietTaps(json)).toEqual([
      { kind: 'complete', id: 'a', listId: null, at: AT },
      { kind: 'grocery', id: 'milk', listId: 'away', at: AT },
    ]);
  });

  it('reads a corrupt file as an empty queue', () => {
    expect(parseQuietTaps('{nope')).toEqual([]);
    expect(parseQuietTaps('{}')).toEqual([]);
  });

  // The Apple Watch's taps join this queue (WatchSession.swift) with one key
  // the widget's don't have, the id the watch settles them by, and with no
  // list key at all for a task or the home list.
  it('reads a watch tap exactly as it reads a widget tap', () => {
    const json = JSON.stringify([
      { kind: 'complete', id: 'a', at: AT, watchTapId: 'w1' },
      { kind: 'grocery', id: 'milk', at: AT, watchTapId: 'w2' },
    ]);
    expect(parseQuietTaps(json)).toEqual([
      { kind: 'complete', id: 'a', listId: null, at: AT, watchTapId: 'w1' },
      { kind: 'grocery', id: 'milk', listId: null, at: AT, watchTapId: 'w2' },
    ]);
  });

  it('leaves the watch id off a widget tap', () => {
    const [tap] = parseQuietTaps(JSON.stringify([{ kind: 'complete', id: 'a', at: AT }]));
    expect('watchTapId' in tap).toBe(false);
  });
});

describe('tapsToRequeue', () => {
  // A drain with nobody looking can't hand a tap to the Today screen, so the
  // taps on a task that needs the app go back to wait for a foreground.
  it('puts back every tap on a handed-off task, in order, and nothing else', () => {
    const taps = [
      { kind: 'unit' as const, id: 'water', listId: null, at: AT, watchTapId: 'w1' },
      { kind: 'complete' as const, id: 'plain', listId: null, at: AT },
      { kind: 'complete' as const, id: 'asks', listId: null, at: AT, watchTapId: 'w2' },
      { kind: 'unit' as const, id: 'water', listId: null, at: AT, watchTapId: 'w3' },
    ];
    expect(tapsToRequeue(taps, new Set(['water', 'asks'])).map(t => t.watchTapId)).toEqual(['w1', 'w2', 'w3']);
  });

  it('never puts back a grocery tap, whose id is an item rather than a task', () => {
    const taps = [{ kind: 'grocery' as const, id: 'asks', listId: null, at: AT }];
    expect(tapsToRequeue(taps, new Set(['asks']))).toEqual([]);
  });
});

describe('planQuietTaps', () => {
  const plan = (taps: QuietTap[], tasks: Task[], entries: GroceryListEntry[] = []) =>
    planQuietTaps(taps, tasks, entries, true, isCurrentDay);

  it('completes a plain task at the time it was tapped, once', () => {
    expect(plan([tap('complete', 'test-1', YESTERDAY), tap('complete', 'test-1')], [baseTask])).toEqual([
      { type: 'complete', id: 'test-1', at: YESTERDAY },
    ]);
  });

  it('logs a run of units, and stops once the target is met', () => {
    const taps = [tap('unit', 'water'), tap('unit', 'water'), tap('unit', 'water'), tap('unit', 'water')];
    expect(plan(taps, [target()])).toEqual([
      { type: 'logUnit', id: 'water' },
      { type: 'logUnit', id: 'water' },
      { type: 'logUnit', id: 'water' },
    ]);
  });

  it("drops a unit tapped on a day that has since rolled over", () => {
    expect(plan([tap('unit', 'water', YESTERDAY)], [target()])).toEqual([]);
  });

  it('hands a tap to the app when the task now asks something', () => {
    expect(plan([tap('complete', 'q')], [task({ id: 'q', deliverableKind: 'text' })])).toEqual([
      { type: 'handToApp', id: 'q', at: AT },
    ]);
    // The unit that would meet the target, on a target that asks on completion.
    expect(plan([tap('unit', 'water')], [target({ progressCount: 2, deliverableKind: 'text' })])).toEqual([
      { type: 'handToApp', id: 'water', at: AT },
    ]);
  });

  it('skips a task that is gone or already done', () => {
    expect(plan([tap('complete', 'missing'), tap('complete', 'test-1')], [task({ completed: true })])).toEqual([]);
  });

  it('checks a grocery row on the list it was tapped on, and nowhere else', () => {
    const entries = [entry({ listId: 'away' }), entry({ itemId: 'eggs', checked: true })];
    expect(plan(
      [tap('grocery', 'milk', AT, 'away'), tap('grocery', 'milk', AT, 'away'), tap('grocery', 'milk'), tap('grocery', 'eggs')],
      [],
      entries,
    )).toEqual([{ type: 'checkGrocery', itemId: 'milk', listId: 'away' }]);
  });

  it('leaves an either/or row for the list itself', () => {
    expect(plan([tap('grocery', 'milk')], [], [entry({ choiceGroup: 'g' })])).toEqual([]);
  });
});
