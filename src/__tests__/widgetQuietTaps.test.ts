import {
  WATCH_NOTE_MAX,
  changedWatchValues,
  inTimeOrder,
  parseQuietTaps,
  parseWatchSession,
  planQuietTaps,
  quietDeferUpdates,
  tapsToRequeue,
  tickValuesFromWatch,
  watchQuestionFor,
  widgetTapNeedsApp,
  widgetTapNeedsAppReason,
  workoutHandOffTaps,
  type QuietTap,
  type QuietTapWorkouts,
} from '../utils/widgetQuietTaps';
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
  streakRequiresWindow: false, streakCountsUnits: false, coinsPerTap: false,
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

describe('widgetTapNeedsAppReason', () => {
  it('is null for a tap that applies quietly', () => {
    expect(widgetTapNeedsAppReason(baseTask, true)).toBeNull();
    expect(widgetTapNeedsAppReason(target(), true)).toBeNull();
  });

  it('names what the app would do with the tap', () => {
    expect(widgetTapNeedsAppReason(task({ deliverableKind: 'text' }), true)).toBe('ask');
    expect(widgetTapNeedsAppReason(task({ polarity: 'negative' }), true)).toBe('slip');
  });

  it('names the follow-up a plain tick raises in the app', () => {
    expect(widgetTapNeedsAppReason(task({ completionTimerMinutes: 60 }), true)).toBe('timer');
    expect(widgetTapNeedsAppReason(task({ logMealSlot: 'lunch' }), true)).toBe('meal-log');
  });
});

describe('watchQuestionFor', () => {
  it('asks the kinds the watch can answer, with their buttons', () => {
    expect(watchQuestionFor(task({ deliverableKind: 'yesno' }), true)).toEqual({ kind: 'yesno', options: ['Yes', 'No'] });
    expect(watchQuestionFor(task({ deliverableKind: 'number' }), true)).toEqual({ kind: 'number', options: [] });
    expect(watchQuestionFor(task({ deliverableKind: 'choice', deliverableOptions: ['Tacos', 'Pho'] }), true))
      .toEqual({ kind: 'choice', options: ['Tacos', 'Pho'] });
  });

  it('reads a pick-one with too few options as a text answer, as the app does', () => {
    expect(watchQuestionFor(task({ deliverableKind: 'choice', deliverableOptions: ['Tacos'] }), true))
      .toEqual({ kind: 'text', options: [] });
  });

  it('leaves to the phone what the watch cannot ask', () => {
    expect(watchQuestionFor(baseTask, true)).toBeNull();
    expect(watchQuestionFor(task({ deliverableKind: 'date' }), true)).toBeNull();
    expect(watchQuestionFor(task({ deliverableKind: 'text', completionTimerMinutes: 60 }), true)).toBeNull();
    expect(watchQuestionFor(task({ deliverableKind: 'text', generatedKind: 'reachOut' }), true)).toBeNull();
  });
});

describe('quietDeferUpdates', () => {
  const tomorrowNoon = new Date(2025, 5, 11, 12).toISOString();

  it('gives a one-off task tomorrow as its date', () => {
    expect(quietDeferUpdates(task({ dueDate: AT }))).toEqual({ dueDate: tomorrowNoon, deferUntil: null });
  });

  it('holds a repeating task until tomorrow and keeps its schedule', () => {
    expect(quietDeferUpdates(task({ dueDate: AT, recurrenceType: 'daily' }))).toEqual({ deferUntil: tomorrowNoon });
  });

  it('takes the pin off, as the app does when a pinned task changes day', () => {
    expect(quietDeferUpdates(task({ dueDate: AT, pinned: true }))).toMatchObject({ pinned: false });
  });

  it("counts tomorrow from the user's own day start", () => {
    // 1 AM on the 11th with a 2 AM reset is still the 10th, so tomorrow is the 11th.
    jest.setSystemTime(new Date(2025, 5, 11, 1));
    expect(quietDeferUpdates(task({ dueDate: AT }), '02:00')).toEqual({ dueDate: tomorrowNoon, deferUntil: null });
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

  it("reads an answer's words, and none for an empty or missing one", () => {
    const json = JSON.stringify([
      { kind: 'answer', id: 'a', at: AT, answer: ' Yes ' },
      { kind: 'answer', id: 'b', at: AT, answer: '  ' },
      { kind: 'answer', id: 'c', at: AT },
    ]);
    expect(parseQuietTaps(json)).toEqual([
      { kind: 'answer', id: 'a', listId: null, at: AT, answer: 'Yes' },
      { kind: 'answer', id: 'b', listId: null, at: AT },
      { kind: 'answer', id: 'c', listId: null, at: AT },
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

describe('watch grocery taps', () => {
  const add = (title: unknown, listId?: string) =>
    JSON.stringify([{ kind: 'groceryAdd', id: 'w1', title, at: AT, ...(listId ? { listId } : {}) }]);

  it('reads a dictated item with its trimmed title and list', () => {
    expect(parseQuietTaps(add('  oat milk ', 'away'))).toEqual([
      { kind: 'groceryAdd', id: 'w1', title: 'oat milk', listId: 'away', at: AT },
    ]);
  });

  it('drops a dictated item with no words', () => {
    expect(parseQuietTaps(add('   '))).toEqual([]);
    expect(parseQuietTaps(add(undefined))).toEqual([]);
  });

  it('never puts a dictated item back on the queue for a task hand-off', () => {
    const taps = parseQuietTaps(add('eggs'));
    expect(tapsToRequeue(taps, new Set(['plain']))).toEqual([]);
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

  it('moves a task to tomorrow from the watch, and drops what follows on it', () => {
    expect(plan([tap('defer', 'test-1'), tap('complete', 'test-1')], [baseTask])).toEqual([
      { type: 'deferTask', id: 'test-1' },
    ]);
  });

  it('defers a task that would need the app to complete, since a move asks nothing', () => {
    expect(plan([tap('defer', 'q')], [task({ id: 'q', deliverableKind: 'text' })])).toEqual([
      { type: 'deferTask', id: 'q' },
    ]);
  });

  it('completes a task with the answer given on the watch', () => {
    const answer = (value?: string): QuietTap => ({ ...tap('answer', 'q'), ...(value !== undefined ? { answer: value } : {}) });
    expect(plan([answer('Yes')], [task({ id: 'q', deliverableKind: 'yesno' })])).toEqual([
      { type: 'complete', id: 'q', at: AT, deliverableValue: 'Yes' },
    ]);
    expect(plan([answer('1,200')], [task({ id: 'q', deliverableKind: 'number' })])).toEqual([
      { type: 'complete', id: 'q', at: AT, deliverableValue: '1200' },
    ]);
    // "Complete without an answer" is an answer too: null, not "nobody asked".
    expect(plan([answer()], [task({ id: 'q', deliverableKind: 'text' })])).toEqual([
      { type: 'complete', id: 'q', at: AT, deliverableValue: null },
    ]);
  });

  it('hands an answer to the app rather than losing it', () => {
    const answer = (value: string): QuietTap => ({ ...tap('answer', 'q'), answer: value });
    // Not a number, so the app asks again.
    expect(plan([answer('a few')], [task({ id: 'q', deliverableKind: 'number' })])).toEqual([
      { type: 'handToApp', id: 'q', at: AT },
    ]);
    // The question became a date since the watch asked it.
    expect(plan([answer('Yes')], [task({ id: 'q', deliverableKind: 'date' })])).toEqual([
      { type: 'handToApp', id: 'q', at: AT },
    ]);
  });

  it('drops a defer made on a day that has since ended', () => {
    expect(plan([tap('defer', 'test-1', YESTERDAY)], [baseTask])).toEqual([]);
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

  describe('either/or and dictated items from the watch', () => {
    const option = (itemId: string, overrides: Partial<GroceryListEntry> = {}) =>
      entry({ itemId, choiceGroup: 'fruit', ...overrides });

    it('chooses an option that is still one side of an either/or, once', () => {
      const entries = [option('apples'), option('pears')];
      expect(plan([tap('choose', 'apples'), tap('choose', 'apples')], [], entries)).toEqual([
        { type: 'chooseOption', itemId: 'apples', listId: null },
      ]);
    });

    it('drops a choice already made, or on a row that was never an option', () => {
      const entries = [entry({ itemId: 'apples' }), entry({ itemId: 'milk' })];
      expect(plan([tap('choose', 'apples'), tap('choose', 'milk'), tap('choose', 'gone')], [], entries)).toEqual([]);
    });

    it('scopes a choice to the list the tap names', () => {
      const entries = [option('apples', { listId: 'away' })];
      expect(plan([tap('choose', 'apples')], [], entries)).toEqual([]);
      expect(plan([tap('choose', 'apples', AT, 'away')], [], entries)).toEqual([
        { type: 'chooseOption', itemId: 'apples', listId: 'away' },
      ]);
    });

    it('adds each dictated item in order with the ticks around it', () => {
      const taps: QuietTap[] = [
        { ...tap('groceryAdd', 'w1', AT, 'away'), title: 'eggs' },
        tap('grocery', 'milk'),
      ];
      expect(plan(taps, [], [entry()])).toEqual([
        { type: 'addGrocery', title: 'eggs', listId: 'away' },
        { type: 'checkGrocery', itemId: 'milk', listId: null },
      ]);
    });
  });
});

// ==== the Apple Watch's workout (phase 8) ====

describe('watch workout taps', () => {
  const STARTED = new Date(2025, 5, 10, 9, 0, 0).toISOString();
  const ENDED = new Date(2025, 5, 10, 9, 50, 0).toISOString();
  const workoutJson = (extra: Record<string, unknown> = {}) => ({
    id: 'watch-w1',
    routineId: 'r1',
    programId: null,
    taskId: 'lift',
    title: 'Push A',
    startedAt: STARTED,
    endedAt: ENDED,
    unit: 'lb',
    sets: [
      { id: 's1', exerciseId: 'lib:barbell-bench-press', position: 0, setIndex: 0, kind: 'working', weight: 185, reps: 8, completedAt: ENDED },
      { id: 's2', exerciseId: 'lib:barbell-bench-press', position: 0, setIndex: 1, kind: 'working', weight: 185, reps: 8 },
    ],
    ...extra,
  });

  describe('parseQuietTaps', () => {
    it('reads a set with its numbers in kilograms, and the session it was made on', () => {
      const [t] = parseQuietTaps(JSON.stringify([
        { kind: 'set', id: 'set-3', sessionId: 'w1', at: AT, watchTapId: 'wt1', unit: 'lb', weight: 135, reps: 8 },
      ]));
      expect(t).toEqual({
        kind: 'set', id: 'set-3', sessionId: 'w1', listId: null, at: AT, watchTapId: 'wt1',
        values: { weightKg: 61.235, reps: 8 }, unit: 'lb',
      });
    });

    it('drops a set that names no session, so a stale watch can never log onto whatever is going', () => {
      expect(parseQuietTaps(JSON.stringify([{ kind: 'set', id: 'set-3', at: AT, weight: 60 }]))).toEqual([]);
    });

    it('reads the rest and finish taps against the session they name, and a rest id when given', () => {
      const taps = parseQuietTaps(JSON.stringify([
        { kind: 'restAdd', id: 'w1', sessionId: 'w1', restId: 'rest-1', at: AT },
        { kind: 'restSkip', id: 'w1', at: AT },
        { kind: 'finish', id: 'w1', sessionId: 'w1', restId: 'ignored', at: AT },
      ]));
      expect(taps.map(t => [t.kind, t.sessionId, t.restId])).toEqual([
        ['restAdd', 'w1', 'rest-1'],
        ['restSkip', 'w1', undefined],
        ['finish', 'w1', undefined],
      ]);
    });

    it('reads a watch workout whole, done sets only, and drops one whose id doesn’t match its tap', () => {
      const [t] = parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'watch-w1', at: AT, workout: workoutJson() }]));
      expect(t.workout).toMatchObject({ id: 'watch-w1', taskId: 'lift', title: 'Push A' });
      expect(t.workout!.sets).toEqual([
        { id: 's1', exerciseId: 'lib:barbell-bench-press', position: 0, setIndex: 0, kind: 'working', weightKg: 83.915, reps: 8, durationSeconds: null, distanceM: null, completedAt: ENDED, note: null, supersetKey: null },
      ]);
      expect(parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'other', at: AT, workout: workoutJson() }]))).toEqual([]);
      expect(parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'watch-w1', at: AT }]))).toEqual([]);
    });

    it('reads a set’s exercise and unit, and the sets and notes a Finish carries', () => {
      const [set, finish] = parseQuietTaps(JSON.stringify([
        { kind: 'set', id: 's1', sessionId: 'w1', exerciseId: 'bench', unit: 'lb', reps: 8, at: AT },
        {
          kind: 'finish', id: 'w1', sessionId: 'w1', unit: 'lb', at: AT,
          sets: [
            { id: 's1', exerciseId: 'bench', at: AT, weight: 135, reps: 8 },
            { id: 's2', exerciseId: 'bench', reps: 8 },
            { id: '', exerciseId: 'bench', at: AT },
          ],
          notes: [{ id: 's1', note: ' Belt on ' }, { id: 's2', note: '  ' }],
        },
      ]));
      expect(set).toMatchObject({ exerciseId: 'bench', unit: 'lb', values: { reps: 8 } });
      expect(finish.doneSets).toEqual([{ id: 's1', exerciseId: 'bench', at: AT, values: { weightKg: 61.235, reps: 8 } }]);
      expect(finish.notes).toEqual([{ setId: 's1', note: 'Belt on' }]);
      expect(finish.unit).toBe('lb');
    });

    it('reads the four the watch adds to the phone’s workout, each with what it needs or not at all', () => {
      const taps = parseQuietTaps(JSON.stringify([
        { kind: 'setNote', id: 'set-3', sessionId: 'w1', note: '  Felt the left shoulder ', at: AT },
        { kind: 'setNote', id: 'set-3', sessionId: 'w1', note: '   ', at: AT },
        { kind: 'addSet', id: 'set-9', sessionId: 'w1', exerciseId: 'bench', at: AT },
        { kind: 'addSet', id: 'set-9', sessionId: 'w1', at: AT },
        { kind: 'addExercise', id: 'row', sessionId: 'w1', setIds: ['n1', '', 7, 'n2'], at: AT },
        { kind: 'addExercise', id: 'curl', sessionId: 'w1', at: AT },
        { kind: 'moveExercise', id: 'row', sessionId: 'w1', direction: 'up', at: AT },
        { kind: 'moveExercise', id: 'row', sessionId: 'w1', direction: 'sideways', at: AT },
        { kind: 'useSuggestion', id: 'bench', sessionId: 'w1', at: AT },
        { kind: 'useSuggestion', id: 'bench', at: AT },
        { kind: 'superset', id: 'bench', sessionId: 'w1', exerciseId: 'row', at: AT },
        { kind: 'superset', id: 'bench', sessionId: 'w1', at: AT },
        { kind: 'superset', id: 'bench', sessionId: 'w1', exerciseId: 7, at: AT },
      ]));
      expect(taps.map(t => [t.kind, t.id, t.note ?? t.exerciseId ?? t.setIds ?? t.direction ?? null])).toEqual([
        ['setNote', 'set-3', 'Felt the left shoulder'],
        ['addSet', 'set-9', 'bench'],
        ['addExercise', 'row', ['n1', 'n2']],
        ['addExercise', 'curl', []],
        ['moveExercise', 'row', 'up'],
        ['useSuggestion', 'bench', null],
        ['superset', 'bench', 'row'],
        ['superset', 'bench', null],
      ]);
      expect(taps.every(t => t.sessionId === 'w1')).toBe(true);
    });

    // Phase 9: the watch's HealthKit session.
    it('reads the watch’s Health taps against the session they name, the id of what it saved, and a retraction', () => {
      const taps = parseQuietTaps(JSON.stringify([
        { kind: 'measuring', id: 'w1', sessionId: 'w1', on: true, at: AT },
        { kind: 'measuring', id: 'w1', on: false, at: AT },
        { kind: 'measuring', id: 'w1', at: AT },
        { kind: 'healthWorkout', id: 'w1', sessionId: 'w1', workoutId: 'HK-W', at: AT },
        { kind: 'healthWorkout', id: 'w1', at: AT },
        { kind: 'healthRetracted', id: 'HK-OLD', at: AT },
        { kind: 'healthRetracted', id: '', at: AT },
      ]));
      expect(taps.map(t => [t.kind, t.id, t.sessionId, t.on, t.healthWorkoutId])).toEqual([
        ['measuring', 'w1', 'w1', true, undefined],
        ['measuring', 'w1', 'w1', false, undefined],
        ['measuring', 'w1', 'w1', true, undefined],
        ['healthWorkout', 'w1', 'w1', undefined, 'HK-W'],
        ['healthWorkout', 'w1', 'w1', undefined, null],
        ['healthRetracted', 'HK-OLD', undefined, undefined, undefined],
      ]);
    });

    it('reads a saved workout the app put back on the queue for a drain in front, by its own key', () => {
      const [t] = parseQuietTaps(JSON.stringify([{
        kind: 'healthWorkout', id: 'w1', sessionId: 'w1', healthWorkoutId: 'HK-W', listId: null, at: AT,
        workoutStart: '2026-10-18T17:00:00.000Z', workoutEnd: '2026-10-18T18:00:00.000Z',
      }]));
      expect(t).toMatchObject({
        kind: 'healthWorkout', sessionId: 'w1', healthWorkoutId: 'HK-W',
        workoutStart: '2026-10-18T17:00:00.000Z', workoutEnd: '2026-10-18T18:00:00.000Z',
      });
    });

    it('reads the times a saved workout spans, both or neither', () => {
      const taps = parseQuietTaps(JSON.stringify([
        { kind: 'healthWorkout', id: 'w1', workoutId: 'HK-1', start: '2026-10-18T17:00:00.123Z', end: '2026-10-18T18:00:00Z', at: AT },
        { kind: 'healthWorkout', id: 'w2', workoutId: 'HK-2', start: '2026-10-18T17:00:00Z', at: AT },
        { kind: 'healthWorkout', id: 'w3', workoutId: 'HK-3', start: 'soon', end: '2026-10-18T18:00:00Z', at: AT },
      ]));
      expect(taps.map(t => [t.id, t.workoutStart, t.workoutEnd])).toEqual([
        ['w1', '2026-10-18T17:00:00.123Z', '2026-10-18T18:00:00.000Z'],
        ['w2', undefined, undefined],
        ['w3', undefined, undefined],
      ]);
    });

    it('caps a dictated note', () => {
      const [t] = parseQuietTaps(JSON.stringify([{ kind: 'setNote', id: 's', sessionId: 'w1', note: 'x'.repeat(WATCH_NOTE_MAX + 50), at: AT }]));
      expect(t.note).toHaveLength(WATCH_NOTE_MAX);
    });

    it('reads a watch workout’s set notes and supersets', () => {
      const workout = workoutJson({
        sets: [{ id: 's1', exerciseId: 'x', position: 0, setIndex: 0, kind: 'working', weight: 100, reps: 5, completedAt: ENDED, note: ' Belt on ', supersetKey: 'ss-1' }],
      });
      const [t] = parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'watch-w1', at: AT, workout }]));
      expect(t.workout!.sets[0]).toMatchObject({ note: 'Belt on', supersetKey: 'ss-1' });
    });
  });

  describe('parseWatchSession', () => {
    it('is null for anything that isn’t a workout with a set done', () => {
      expect(parseWatchSession(null)).toBeNull();
      expect(parseWatchSession(workoutJson({ startedAt: 'never' }))).toBeNull();
      expect(parseWatchSession(workoutJson({ sets: [{ id: 's2', exerciseId: 'x', kind: 'working' }] }))).toBeNull();
    });

    it('reads what the watch saved to Health itself, a save made locked included, and nothing when it measured nothing', () => {
      expect(parseWatchSession(workoutJson({ health: { workoutId: 'HK-W' } }))!.health).toEqual({ workoutId: 'HK-W' });
      expect(parseWatchSession(workoutJson({ health: {} }))!.health).toEqual({ workoutId: null });
      expect(parseWatchSession(workoutJson())!.health).toBeUndefined();
      expect(parseWatchSession(workoutJson({ health: 'yes' }))!.health).toBeUndefined();
    });

    it('reads kilograms as they are, and a kind it doesn’t know as a working set', () => {
      const w = parseWatchSession(workoutJson({
        unit: 'kg',
        sets: [{ id: 's1', exerciseId: 'plank', kind: 'hold', durationSeconds: 45.4, completedAt: ENDED }],
      }));
      expect(w!.sets[0]).toMatchObject({ kind: 'working', weightKg: null, durationSeconds: 45 });
    });
  });

  describe('changedWatchValues', () => {
    const current = { weightKg: 60, reps: 8, durationSeconds: null, distanceM: null };

    it('drops a weight that reads the same in the unit shown, so a pound round trip changes nothing', () => {
      const sent = tickValuesFromWatch({ weight: 132.28 }, 'lb');
      expect(sent.weightKg).not.toBe(60);
      expect(changedWatchValues(sent, current, 'lb')).toEqual({});
      expect(changedWatchValues(tickValuesFromWatch({ weight: 135 }, 'lb'), current, 'lb')).toEqual({ weightKg: 61.235 });
    });

    it('drops a 0 sent for a number the set doesn’t have, and a number it already has', () => {
      expect(changedWatchValues({ reps: 8, durationSeconds: 0, distanceM: 0 }, current, 'kg')).toEqual({});
      expect(changedWatchValues({ weightKg: 0, reps: 0 }, { ...current, weightKg: null }, 'kg')).toEqual({ reps: 0 });
      expect(changedWatchValues({ reps: 6, durationSeconds: 45 }, current, 'kg')).toEqual({ reps: 6, durationSeconds: 45 });
    });

    it('sends everything for a set with no numbers to compare yet', () => {
      expect(changedWatchValues({ weightKg: 0, reps: 8 }, null, 'kg')).toEqual({ weightKg: 0, reps: 8 });
    });
  });

  describe('tickValuesFromWatch', () => {
    it('converts only what was sent, and ignores a number that can’t be a set’s', () => {
      expect(tickValuesFromWatch({ weight: 100, reps: 5.4 }, 'kg')).toEqual({ weightKg: 100, reps: 5 });
      expect(tickValuesFromWatch({ weight: -5, distanceM: 400 }, 'lb')).toEqual({ distanceM: 400 });
      expect(tickValuesFromWatch({}, 'kg')).toEqual({});
    });
  });

  describe('planQuietTaps', () => {
    type Row = NonNullable<QuietTapWorkouts['live']>['sets'][number];
    const row = (id: string, extra: Partial<Row> = {}): Row => ({
      id, exerciseId: 'bench', kind: 'working', completedAt: null, weightKg: 60, reps: null, durationSeconds: null, distanceM: null, ...extra,
    });
    // The open sets named, one already done ('done'), and any others given.
    const live = (openSetIds: string[], taskId: string | null = null, others: Row[] = []): QuietTapWorkouts => ({
      live: { id: 'w1', taskId, sets: [...openSetIds.map(id => row(id)), row('done', { completedAt: AT }), ...others] },
      sessionIds: new Set(['w1']),
    });
    const sessionTap = (kind: QuietTap['kind'], id: string, extra: Partial<QuietTap> = {}): QuietTap => ({ ...tap(kind, id), sessionId: 'w1', ...extra });
    const setTap = (id: string, sessionId = 'w1'): QuietTap => ({ ...tap('set', id), sessionId, values: { reps: 8 } });
    const plan = (taps: QuietTap[], workouts: QuietTapWorkouts | null, tasks: Task[] = []) =>
      planQuietTaps(taps, tasks, [], true, isCurrentDay, workouts);

    it('puts a pair total the watch sent back to one dumbbell, and compares in that space', () => {
      const pair = (id: string, kg: number): QuietTap => ({ ...setTap(id), values: { weightKg: kg, reps: 8 } });
      const twice = (_exerciseId: string) => 2;
      const run = (taps: QuietTap[]) => planQuietTaps(taps, [], [], true, isCurrentDay, live(['a']), twice);
      // 60 kg stored is 120 shown: sending 120 back is no change, sending 100 is 50 a dumbbell.
      expect(run([pair('a', 120)])).toEqual([{ type: 'tickWorkoutSet', sessionId: 'w1', setId: 'a', at: AT, values: { reps: 8 } }]);
      expect(run([pair('a', 100)])).toEqual([{ type: 'tickWorkoutSet', sessionId: 'w1', setId: 'a', at: AT, values: { weightKg: 50, reps: 8 } }]);
    });

    it('stores a workout the watch ran alone one dumbbell at a time', () => {
      const workout = parseWatchSession({
        id: 'ws1', startedAt: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T10:30:00Z', unit: 'kg',
        sets: [
          { id: 's1', exerciseId: 'curl', completedAt: '2026-10-01T10:05:00Z', weight: 25, reps: 10 },
          { id: 's2', exerciseId: 'goblet', completedAt: '2026-10-01T10:10:00Z', weight: 20, reps: 10 },
        ],
      })!;
      const actions = planQuietTaps(
        [{ ...tap('watchSession', 'ws1'), workout }], [], [], true, isCurrentDay, null, id => (id === 'curl' ? 2 : 1),
      );
      const stored = actions.find(a => a.type === 'addWatchSession');
      expect(stored && 'workout' in stored ? stored.workout.sets.map(s => s.weightKg) : null).toEqual([12.5, 20]);
    });

    it('ticks a set of the workout in progress with its numbers, once', () => {
      expect(plan([setTap('a'), setTap('a')], live(['a', 'b']))).toEqual([
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'a', at: AT, values: { reps: 8 } },
      ]);
    });

    it('does nothing to a set already done, another workout’s set, or with no workout going', () => {
      expect(plan([setTap('done')], live(['a']))).toEqual([]);
      expect(plan([setTap('a', 'w0')], live(['a']))).toEqual([]);
      expect(plan([setTap('a')], { live: null, sessionIds: new Set() })).toEqual([]);
      expect(plan([setTap('a')], null)).toEqual([]);
    });

    it('nudges and skips the rest of the workout in progress, naming the rest when the tap did', () => {
      const taps: QuietTap[] = [
        { ...tap('restAdd', 'w1'), sessionId: 'w1', restId: 'rest-1' },
        { ...tap('restSkip', 'w1'), sessionId: 'w1' },
        { ...tap('restSkip', 'w0'), sessionId: 'w0' },
      ];
      expect(plan(taps, live([]))).toEqual([
        { type: 'nudgeRest', sessionId: 'w1', restId: 'rest-1' },
        { type: 'skipRest', sessionId: 'w1', restId: null },
      ]);
    });

    it('finishes the workout once, and applies nothing to it afterwards', () => {
      const taps: QuietTap[] = [
        { ...tap('finish', 'w1'), sessionId: 'w1' },
        setTap('a'),
        { ...tap('finish', 'w1'), sessionId: 'w1' },
      ];
      expect(plan(taps, live(['a']))).toEqual([{ type: 'finishWorkout', sessionId: 'w1', at: AT }]);
    });

    it('hands the finished workout’s task to the app when it asks a question', () => {
      const asks = task({ id: 'lift', deliverableKind: 'text' });
      expect(plan([{ ...tap('finish', 'w1'), sessionId: 'w1' }], live([], 'lift'), [asks])).toEqual([
        { type: 'finishWorkout', sessionId: 'w1', at: AT },
        { type: 'handToApp', id: 'lift', at: AT, fromWorkout: true },
      ]);
      // A task that just completes is finishSession's to complete, not the app's.
      expect(plan([{ ...tap('finish', 'w1'), sessionId: 'w1' }], live([], 'lift'), [task({ id: 'lift' })])).toEqual([
        { type: 'finishWorkout', sessionId: 'w1', at: AT },
      ]);
    });

    it('notes a set of the workout in progress, done or still to do, and nothing else', () => {
      expect(plan([
        sessionTap('setNote', 'a', { note: 'Belt on' }),
        sessionTap('setNote', 'done', { note: 'Grindy' }),
        sessionTap('setNote', 'gone', { note: 'Lost' }),
        sessionTap('setNote', 'a', { note: 'Other workout', sessionId: 'w0' }),
      ], live(['a']))).toEqual([
        { type: 'noteWorkoutSet', sessionId: 'w1', setId: 'a', note: 'Belt on' },
        { type: 'noteWorkoutSet', sessionId: 'w1', setId: 'done', note: 'Grindy' },
      ]);
    });

    it('adds a set under the watch’s id once, and lets it be ticked later in the same drain', () => {
      expect(plan([
        sessionTap('addSet', 'n1', { exerciseId: 'bench' }),
        sessionTap('addSet', 'n1', { exerciseId: 'bench' }),
        sessionTap('addSet', 'a', { exerciseId: 'bench' }),
        sessionTap('addSet', 'n2', { exerciseId: 'not-in-it' }),
        { ...setTap('n1') },
      ], live(['a']))).toEqual([
        { type: 'addWorkoutSet', sessionId: 'w1', exerciseId: 'bench', setId: 'n1' },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'n1', at: AT, values: { reps: 8 } },
      ]);
    });

    it('adds an exercise once, with the ids not already taken, and then lets it be moved and ticked', () => {
      expect(plan([
        sessionTap('addExercise', 'row', { setIds: ['r1', 'a', 'r2'] }),
        sessionTap('addExercise', 'row', { setIds: ['r3'] }),
        sessionTap('addExercise', 'bench', { setIds: ['b9'] }),
        sessionTap('moveExercise', 'row', { direction: 'up' }),
        setTap('r2'),
      ], live(['a']))).toEqual([
        { type: 'addWorkoutExercise', sessionId: 'w1', exerciseId: 'row', setIds: ['r1', 'r2'] },
        { type: 'moveWorkoutExercise', sessionId: 'w1', exerciseId: 'row', direction: 'up' },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'r2', at: AT, values: { reps: 8 } },
      ]);
      // With no ids it still lays its sets out, and is in the workout after.
      expect(plan([
        sessionTap('addExercise', 'curl', { setIds: [] }),
        sessionTap('moveExercise', 'curl', { direction: 'down' }),
        sessionTap('useSuggestion', 'curl'),
      ], live([]))).toEqual([
        { type: 'addWorkoutExercise', sessionId: 'w1', exerciseId: 'curl', setIds: [] },
        { type: 'moveWorkoutExercise', sessionId: 'w1', exerciseId: 'curl', direction: 'down' },
        { type: 'useWorkoutSuggestion', sessionId: 'w1', exerciseId: 'curl' },
      ]);
    });

    it('pairs an exercise with another in the workout, or takes it out of its superset, and drops one with a partner it does not have', () => {
      expect(plan([
        sessionTap('superset', 'bench', { exerciseId: 'squat' }),
        sessionTap('superset', 'bench', { exerciseId: 'a-row', sessionId: 'w0' }),
        sessionTap('superset', 'bench'),
      ], live(['a']))).toEqual([
        { type: 'supersetWorkoutExercise', sessionId: 'w1', exerciseId: 'bench', partnerId: null },
      ]);
    });

    it('moves only an exercise in the workout in progress', () => {
      expect(plan([
        sessionTap('moveExercise', 'squat', { direction: 'up' }),
        sessionTap('moveExercise', 'bench', { direction: 'up', sessionId: 'w0' }),
        sessionTap('moveExercise', 'bench', { direction: 'down' }),
      ], live(['a']))).toEqual([{ type: 'moveWorkoutExercise', sessionId: 'w1', exerciseId: 'bench', direction: 'down' }]);
    });

    it('uses a suggestion only while workout mode would offer it: not once a working set is logged', () => {
      expect(plan([sessionTap('useSuggestion', 'bench')], live(['a']))).toEqual([]);
      const fresh = (others: Row[]): QuietTapWorkouts => ({ live: { id: 'w1', taskId: null, sets: others }, sessionIds: new Set(['w1']) });
      const warmedUp = fresh([row('w', { kind: 'warmup', completedAt: AT }), row('a')]);
      expect(plan([sessionTap('useSuggestion', 'bench')], warmedUp)).toEqual([
        { type: 'useWorkoutSuggestion', sessionId: 'w1', exerciseId: 'bench' },
      ]);
      // A set ticked earlier in the same drain counts.
      expect(plan([setTap('a'), sessionTap('useSuggestion', 'bench')], warmedUp)).toEqual([
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'a', at: AT, values: { reps: 8 } },
      ]);
      expect(plan([sessionTap('useSuggestion', 'squat')], warmedUp)).toEqual([]);
    });

    it('ticks a set added on the watch whose addSet hasn’t arrived, by adding it first under the watch’s id', () => {
      const tick: QuietTap = { ...setTap('n1'), exerciseId: 'bench' };
      expect(plan([tick, sessionTap('addSet', 'n1', { exerciseId: 'bench' })], live(['a']))).toEqual([
        { type: 'addWorkoutSet', sessionId: 'w1', exerciseId: 'bench', setId: 'n1' },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'n1', at: AT, values: { reps: 8 } },
      ]);
      // Not for an exercise the workout doesn't have, or a tick that names none.
      expect(plan([{ ...setTap('n1'), exerciseId: 'row' }, setTap('n2')], live(['a']))).toEqual([]);
    });

    it('puts a session’s taps back in the order they were made before judging them', () => {
      const later = new Date(NOW.getTime() + 5000).toISOString();
      const taps: QuietTap[] = [
        { ...setTap('n1'), at: later },
        tap('complete', 'task-1'),
        sessionTap('addSet', 'n1', { exerciseId: 'bench' }),
      ];
      expect(inTimeOrder(taps).map(t => [t.kind, t.id])).toEqual([['addSet', 'n1'], ['complete', 'task-1'], ['set', 'n1']]);
      // Ties keep the order they were queued in; another session's taps keep theirs.
      const other = { ...setTap('x', 'w0'), at: later };
      const tied = [sessionTap('addSet', 'n2', { exerciseId: 'bench' }), setTap('n2'), other, setTap('y', 'w0')];
      expect(inTimeOrder(tied).map(t => t.id)).toEqual(['n2', 'n2', 'y', 'x']);
    });

    it('records what Finish carries: done sets the phone hasn’t heard of, their notes, and sets added on the watch', () => {
      const at = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();
      const finish: QuietTap = sessionTap('finish', 'w1', {
        at: at(60),
        unit: 'kg',
        doneSets: [
          { id: 'b', exerciseId: 'bench', at: at(20), values: { weightKg: 70, reps: 6 } },
          { id: 'a', exerciseId: 'bench', at: at(10), values: { reps: 8 } },
          { id: 'done', exerciseId: 'bench', at: at(5), values: { reps: 9 } },
          { id: 'n1', exerciseId: 'bench', at: at(30), values: { reps: 5 } },
          { id: 'r1', exerciseId: 'row', at: at(40), values: { weightKg: 50, reps: 10 } },
          { id: 'r2', exerciseId: 'row', at: at(50), values: { reps: 10 } },
        ],
        notes: [{ setId: 'a', note: 'Belt on' }, { setId: 'gone', note: 'Lost' }],
      });
      // A set's own tap arriving after the Finish does nothing more.
      expect(plan([finish, { ...setTap('a'), at: at(70) }], live(['a', 'b']))).toEqual([
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'a', at: at(10), values: { reps: 8 } },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'b', at: at(20), values: { weightKg: 70, reps: 6 } },
        { type: 'addWorkoutSet', sessionId: 'w1', exerciseId: 'bench', setId: 'n1' },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'n1', at: at(30), values: { reps: 5 } },
        { type: 'addWorkoutExercise', sessionId: 'w1', exerciseId: 'row', setIds: ['r1'] },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'r1', at: at(40), values: { weightKg: 50, reps: 10 } },
        { type: 'addWorkoutSet', sessionId: 'w1', exerciseId: 'row', setId: 'r2' },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'r2', at: at(50), values: { reps: 10 } },
        { type: 'noteWorkoutSet', sessionId: 'w1', setId: 'a', note: 'Belt on' },
        { type: 'finishWorkout', sessionId: 'w1', at: at(60) },
      ]);
    });

    it('carries nothing twice: a set its own tap ticked earlier is left by Finish', () => {
      const finish: QuietTap = sessionTap('finish', 'w1', { doneSets: [{ id: 'a', exerciseId: 'bench', at: AT, values: { reps: 8 } }] });
      expect(plan([setTap('a'), finish], live(['a']))).toEqual([
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'a', at: AT, values: { reps: 8 } },
        { type: 'finishWorkout', sessionId: 'w1', at: AT },
      ]);
    });

    it('knows a warm-up the watch’s Use added by the id it drew, so a tick on it applies', () => {
      const workouts: QuietTapWorkouts = { live: { id: 'w1', taskId: null, sets: [row('a')] }, sessionIds: new Set(['w1']) };
      const use = sessionTap('useSuggestion', 'bench', { watchTapId: 'tap-9' });
      expect(plan([use, { ...setTap('tap-9-w0'), exerciseId: 'bench' }], workouts)).toEqual([
        { type: 'useWorkoutSuggestion', sessionId: 'w1', exerciseId: 'bench', warmupIdPrefix: 'tap-9' },
        { type: 'tickWorkoutSet', sessionId: 'w1', setId: 'tap-9-w0', at: AT, values: { reps: 8 } },
      ]);
      // A warm-up ticked doesn't count as work logged, so the card's rule is untouched.
      expect(plan([use], workouts)[0]).toMatchObject({ warmupIdPrefix: 'tap-9' });
    });

    it('applies none of the four after the workout is finished in the same drain', () => {
      expect(plan([
        sessionTap('finish', 'w1'),
        sessionTap('setNote', 'a', { note: 'Late' }),
        sessionTap('addSet', 'n1', { exerciseId: 'bench' }),
        sessionTap('addExercise', 'row', { setIds: ['r1'] }),
        sessionTap('moveExercise', 'bench', { direction: 'down' }),
        sessionTap('useSuggestion', 'bench'),
      ], live(['a']))).toEqual([{ type: 'finishWorkout', sessionId: 'w1', at: AT }]);
    });

    it('writes a watch workout once, skips one already in the log, and hands an asking task over', () => {
      const workout = parseWatchSession(workoutJson())!;
      const t: QuietTap = { ...tap('watchSession', workout.id), workout };
      const none = { live: null, sessionIds: new Set<string>() };
      expect(plan([t, t], none, [task({ id: 'lift' })])).toEqual([{ type: 'addWatchSession', workout }]);
      expect(plan([t], { live: null, sessionIds: new Set([workout.id]) })).toEqual([]);
      expect(plan([t], none, [task({ id: 'lift', deliverableKind: 'text' })])).toEqual([
        { type: 'addWatchSession', workout },
        { type: 'handToApp', id: 'lift', at: workout.endedAt, fromWorkout: true },
      ]);
    });
  });

  describe('the watch’s HealthKit session', () => {
    const at = (minute: number) => new Date(2026, 9, 18, 18, minute).toISOString();
    const t = (kind: QuietTap['kind'], id: string, minute: number, extra: Partial<QuietTap> = {}): QuietTap =>
      ({ kind, id, listId: null, at: at(minute), ...extra });
    const plan = (taps: QuietTap[], workouts: QuietTapWorkouts | null) => planQuietTaps(taps, [], [], true, () => true, workouts);
    const none = { live: null, sessionIds: new Set<string>() };

    it('passes each on, for any session in the log or none: the store reads the row again and decides', () => {
      expect(plan([
        t('measuring', 'w1', 1, { sessionId: 'w1', on: true }),
        t('healthWorkout', 'w1', 2, { sessionId: 'w1', healthWorkoutId: 'HK-W' }),
        t('healthRetracted', 'HK-OLD', 3),
        t('healthWorkout', 'gone', 4, { sessionId: 'gone', healthWorkoutId: null }),
      ], none)).toEqual([
        { type: 'watchMeasuring', sessionId: 'w1', on: true },
        { type: 'watchHealthWorkout', sessionId: 'w1', workoutId: 'HK-W', span: null },
        { type: 'watchHealthRetracted', workoutId: 'HK-OLD' },
        { type: 'watchHealthWorkout', sessionId: 'gone', workoutId: null, span: null },
      ]);
    });

    it('puts a saved workout back after the Finish it overtook, so it lands on a finished session', () => {
      const workouts: QuietTapWorkouts = { live: { id: 'w1', taskId: null, sets: [] }, sessionIds: new Set(['w1']) };
      expect(plan([
        t('healthWorkout', 'w1', 6, { sessionId: 'w1', healthWorkoutId: 'HK-W' }),
        t('finish', 'w1', 5, { sessionId: 'w1' }),
      ], workouts)).toEqual([
        { type: 'finishWorkout', sessionId: 'w1', at: at(5) },
        { type: 'watchHealthWorkout', sessionId: 'w1', workoutId: 'HK-W', span: null },
      ]);
    });

    it('passes on the times the watch saved its workout at, for the store to compare with the row', () => {
      expect(plan([
        t('healthWorkout', 'w1', 2, { sessionId: 'w1', healthWorkoutId: 'HK-W', workoutStart: at(0), workoutEnd: at(1) }),
      ], none)).toEqual([
        { type: 'watchHealthWorkout', sessionId: 'w1', workoutId: 'HK-W', span: { start: at(0), end: at(1) } },
      ]);
    });
  });

  describe('requeue', () => {
    it('never puts a workout tap back, and queues a workout’s hand-off as a plain completion', () => {
      const taps: QuietTap[] = [{ ...tap('set', 'lift'), sessionId: 'w1' }, tap('complete', 'lift')];
      expect(tapsToRequeue(taps, new Set(['lift']))).toEqual([tap('complete', 'lift')]);
      expect(workoutHandOffTaps([
        { type: 'finishWorkout', sessionId: 'w1', at: AT },
        { type: 'handToApp', id: 'lift', at: AT, fromWorkout: true },
        { type: 'handToApp', id: 'other', at: AT },
      ])).toEqual([{ kind: 'complete', id: 'lift', listId: null, at: AT }]);
    });
  });
});
