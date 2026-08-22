// react-native and the stores aren't loadable under the node test env, and
// this suite only exercises the pure request-building logic (buildTimerRuns
// takes tasks/recipes/enabled as explicit params), so stub them out — mirrors
// deepLinks.test.ts's react-native mock and snoozeEngine.test.ts's store one.
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));
jest.mock('../store/useTaskStore', () => ({ useTaskStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useRecipeStore', () => ({ useRecipeStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { subscribe: jest.fn(), getState: jest.fn() } }));
// Pulled in transitively via visibilityUtils.ts (displayTitleFor); this
// suite's tasks never carry a category, so a stub that resolves nothing is
// enough — mirrors snoozeEngine.test.ts's own mock of the same store.
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ getCategoryByName: () => null }) },
}));

import { buildTimerRuns } from '../utils/liveActivity';
import type { Task, Recipe, ChainItem } from '../types';

const NOW = new Date(2026, 7, 11, 12, 0, 0).getTime();

const BASE: Task = {
  id: 'task-1',
  title: 'Test',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date().toISOString(),
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
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
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
  pendingImport: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
};

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

let recipeSeq = 0;
function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  recipeSeq += 1;
  return {
    id: `recipe-${recipeSeq}`,
    name: 'Chili',
    nameKey: 'chili',
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    favorite: false,
    sortOrder: recipeSeq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
  };
}

const startedAgo = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

describe('buildTimerRuns', () => {
  it('returns nothing when disabled, even with runs in flight', () => {
    const tasks = [makeTask({ timerStartedAt: startedAgo(10) })];
    expect(buildTimerRuns(tasks, [], { enabled: false })).toEqual([]);
  });

  it('ignores a task with no timer running', () => {
    const tasks = [makeTask({ timerStartedAt: null })];
    expect(buildTimerRuns(tasks, [], { enabled: true })).toEqual([]);
  });

  it('ignores a completed task, even mid-timer', () => {
    const tasks = [makeTask({ timerStartedAt: startedAgo(5), completed: true })];
    expect(buildTimerRuns(tasks, [], { enabled: true })).toEqual([]);
  });

  it('ignores an archived task, even mid-timer', () => {
    const tasks = [makeTask({ timerStartedAt: startedAgo(5), archived: true })];
    expect(buildTimerRuns(tasks, [], { enabled: true })).toEqual([]);
  });

  it('builds a stopwatch run (no target) for an untimed running task', () => {
    const tasks = [makeTask({ id: 'abc', title: 'Practice Spanish', timerStartedAt: startedAgo(30) })];
    const [run] = buildTimerRuns(tasks, [], { enabled: true });
    expect(run).toEqual({
      key: 'task:abc',
      kind: 'task',
      itemId: 'abc',
      title: 'Practice Spanish',
      subtitle: '',
      symbolName: 'timer',
      startedAtMs: NOW - 30_000,
      targetEndMs: null,
    });
  });

  it('builds a countdown run for a timed task, remaining computed against the start time', () => {
    const tasks = [
      makeTask({ id: 'abc', timedMinutes: 15, timerElapsedSeconds: 60, timerStartedAt: startedAgo(0) }),
    ];
    const [run] = buildTimerRuns(tasks, [], { enabled: true });
    // 15 minutes minus 60s already banked = 14 minutes left from the start instant.
    expect(run.targetEndMs).toBe(run.startedAtMs + 14 * 60 * 1000);
  });

  it('clamps an already-overdue countdown so the target never precedes the start', () => {
    // 10 banked minutes against a 5 minute target: already finished before this run began.
    const tasks = [
      makeTask({ id: 'abc', timedMinutes: 5, timerElapsedSeconds: 10 * 60, timerStartedAt: startedAgo(0) }),
    ];
    const [run] = buildTimerRuns(tasks, [], { enabled: true });
    expect(run.targetEndMs).toBe(run.startedAtMs);
  });

  it('uses the active chain step as the title mid-chain', () => {
    const tasks = [
      makeTask({
        id: 'abc',
        title: 'Morning routine',
        timerStartedAt: startedAgo(5),
        chainEnabled: true,
        chainIndex: 1,
        chainItems: [
          { id: 'step-1', title: 'Stretch', estimatedMinutes: null },
          { id: 'step-2', title: 'Journal', estimatedMinutes: null },
        ] as ChainItem[],
      }),
    ];
    const [run] = buildTimerRuns(tasks, [], { enabled: true });
    expect(run.title).toBe('Journal');
  });

  it('builds a cook run for a recipe with a running cook timer', () => {
    const recipes = [makeRecipe({ id: 'r1', name: 'Chili', estimatedMinutes: 40, timerStartedAt: startedAgo(60) })];
    const [run] = buildTimerRuns([], recipes, { enabled: true });
    expect(run).toEqual({
      key: 'cook:r1',
      kind: 'cook',
      itemId: 'r1',
      title: 'Chili',
      subtitle: 'Cooking',
      symbolName: 'flame.fill',
      startedAtMs: NOW - 60_000,
      // Remaining is computed against the start of *this* run (nothing banked
      // yet from it), so the full 40 minutes are still ahead from that instant.
      targetEndMs: NOW - 60_000 + 40 * 60 * 1000,
    });
  });

  it('builds a prep run independently of a cook run on the same recipe', () => {
    const recipes = [
      makeRecipe({
        id: 'r1',
        estimatedMinutes: 40,
        timerStartedAt: startedAgo(60),
        prepMinutes: 10,
        prepTimerStartedAt: startedAgo(30),
      }),
    ];
    const runs = buildTimerRuns([], recipes, { enabled: true });
    expect(runs.map(r => r.key).sort()).toEqual(['cook:r1', 'prep:r1']);
    const prep = runs.find(r => r.kind === 'prep')!;
    expect(prep.subtitle).toBe('Prep');
    expect(prep.symbolName).toBe('fork.knife');
  });

  it('ignores a recipe with neither timer running', () => {
    const recipes = [makeRecipe({ timerStartedAt: null, prepTimerStartedAt: null })];
    expect(buildTimerRuns([], recipes, { enabled: true })).toEqual([]);
  });

  it('gives a cook/prep timer with no target duration a stopwatch run', () => {
    const recipes = [makeRecipe({ estimatedMinutes: null, timerStartedAt: startedAgo(10) })];
    const [run] = buildTimerRuns([], recipes, { enabled: true });
    expect(run.targetEndMs).toBeNull();
  });

  it('truncates a long title', () => {
    const tasks = [makeTask({ id: 'abc', title: 'x'.repeat(80), timerStartedAt: startedAgo(1) })];
    const [run] = buildTimerRuns(tasks, [], { enabled: true });
    expect(run.title.length).toBe(60);
    expect(run.title.endsWith('…')).toBe(true);
  });

  it('combines a running task timer and running recipe timers into one list', () => {
    const tasks = [makeTask({ id: 't1', timerStartedAt: startedAgo(5) })];
    const recipes = [makeRecipe({ id: 'r1', timerStartedAt: startedAgo(5) })];
    const runs = buildTimerRuns(tasks, recipes, { enabled: true });
    expect(runs.map(r => r.key).sort()).toEqual(['cook:r1', 'task:t1']);
  });
});
