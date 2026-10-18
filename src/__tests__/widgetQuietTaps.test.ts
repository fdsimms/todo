import {
  WATCH_NOTE_MAX,
  parseQuietTaps,
  parseWatchSession,
  planQuietTaps,
  tapsToRequeue,
  tickValuesFromWatch,
  widgetTapNeedsApp,
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
        values: { weightKg: 61.235, reps: 8 },
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
        { id: 's1', exerciseId: 'lib:barbell-bench-press', position: 0, setIndex: 0, kind: 'working', weightKg: 83.915, reps: 8, durationSeconds: null, distanceM: null, completedAt: ENDED, note: null },
      ]);
      expect(parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'other', at: AT, workout: workoutJson() }]))).toEqual([]);
      expect(parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'watch-w1', at: AT }]))).toEqual([]);
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
      ]));
      expect(taps.map(t => [t.kind, t.id, t.note ?? t.exerciseId ?? t.setIds ?? t.direction ?? null])).toEqual([
        ['setNote', 'set-3', 'Felt the left shoulder'],
        ['addSet', 'set-9', 'bench'],
        ['addExercise', 'row', ['n1', 'n2']],
        ['addExercise', 'curl', []],
        ['moveExercise', 'row', 'up'],
        ['useSuggestion', 'bench', null],
      ]);
      expect(taps.every(t => t.sessionId === 'w1')).toBe(true);
    });

    it('caps a dictated note', () => {
      const [t] = parseQuietTaps(JSON.stringify([{ kind: 'setNote', id: 's', sessionId: 'w1', note: 'x'.repeat(WATCH_NOTE_MAX + 50), at: AT }]));
      expect(t.note).toHaveLength(WATCH_NOTE_MAX);
    });

    it('reads a watch workout’s set notes', () => {
      const workout = workoutJson({
        sets: [{ id: 's1', exerciseId: 'x', position: 0, setIndex: 0, kind: 'working', weight: 100, reps: 5, completedAt: ENDED, note: ' Belt on ' }],
      });
      const [t] = parseQuietTaps(JSON.stringify([{ kind: 'watchSession', id: 'watch-w1', at: AT, workout }]));
      expect(t.workout!.sets[0].note).toBe('Belt on');
    });
  });

  describe('parseWatchSession', () => {
    it('is null for anything that isn’t a workout with a set done', () => {
      expect(parseWatchSession(null)).toBeNull();
      expect(parseWatchSession(workoutJson({ startedAt: 'never' }))).toBeNull();
      expect(parseWatchSession(workoutJson({ sets: [{ id: 's2', exerciseId: 'x', kind: 'working' }] }))).toBeNull();
    });

    it('reads kilograms as they are, and a kind it doesn’t know as a working set', () => {
      const w = parseWatchSession(workoutJson({
        unit: 'kg',
        sets: [{ id: 's1', exerciseId: 'plank', kind: 'hold', durationSeconds: 45.4, completedAt: ENDED }],
      }));
      expect(w!.sets[0]).toMatchObject({ kind: 'working', weightKg: null, durationSeconds: 45 });
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
    const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, exerciseId: 'bench', kind: 'working', completedAt: null, ...extra });
    // The open sets named, one already done ('done'), and any others given.
    const live = (openSetIds: string[], taskId: string | null = null, others: Row[] = []): QuietTapWorkouts => ({
      live: { id: 'w1', taskId, sets: [...openSetIds.map(id => row(id)), row('done', { completedAt: AT }), ...others] },
      sessionIds: new Set(['w1']),
    });
    const sessionTap = (kind: QuietTap['kind'], id: string, extra: Partial<QuietTap> = {}): QuietTap => ({ ...tap(kind, id), sessionId: 'w1', ...extra });
    const setTap = (id: string, sessionId = 'w1'): QuietTap => ({ ...tap('set', id), sessionId, values: { reps: 8 } });
    const plan = (taps: QuietTap[], workouts: QuietTapWorkouts | null, tasks: Task[] = []) =>
      planQuietTaps(taps, tasks, [], true, isCurrentDay, workouts);

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
