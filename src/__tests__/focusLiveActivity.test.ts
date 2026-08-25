// react-native and the stores aren't loadable under the node test env, and
// this suite only exercises the pure payload-building logic (buildFocusRun
// takes the session/tasks/enabled as explicit params), so stub them out —
// mirrors liveActivity.test.ts's and tripLiveActivity.test.ts's own mocks.
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));
jest.mock('../store/useFocusStore', () => ({ useFocusStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useTaskStore', () => ({ useTaskStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { subscribe: jest.fn(), getState: jest.fn() } }));
// Pulled in transitively via visibilityUtils.ts (displayTitleFor); no task
// here carries a category, so a stub that resolves nothing is enough.
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ getCategoryByName: () => null }) },
}));

import { buildFocusRun } from '../utils/focusLiveActivity';
import type { FocusSession, FocusStep, Task } from '../types';

const SESSION_START = '2026-08-11T11:00:00.000Z';
const STEP_START = '2026-08-11T12:00:00.000Z';
const STEP_START_MS = Date.parse(STEP_START);

const BASE: Task = {
  id: 'task-1',
  title: 'Write the report',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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
  backfillDismissedFields: [],
  personIds: [],
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return { ...BASE, ...overrides };
}

function work(taskId: string, minutes: number, part = 1, partCount = 1): FocusStep {
  return { kind: 'work', taskId, minutes, part, partCount, long: false };
}

function rest(minutes: number, long = false): FocusStep {
  return { kind: 'rest', taskId: null, minutes, part: 1, partCount: 1, long };
}

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'session-1',
    startedAt: SESSION_START,
    steps: [work('task-1', 25), rest(5), work('task-2', 25)],
    stepIndex: 0,
    stepStartedAt: STEP_START,
    stepElapsedSeconds: 0,
    completedTaskIds: [],
    ...overrides,
  };
}

const TASKS = [makeTask(), makeTask({ id: 'task-2', title: 'Reply to Sam' })];

describe('buildFocusRun', () => {
  it('returns nothing when the setting is off, even with a session running', () => {
    expect(buildFocusRun(makeSession(), TASKS, { enabled: false })).toBeNull();
  });

  it('returns nothing when there is no session', () => {
    expect(buildFocusRun(null, TASKS, { enabled: true })).toBeNull();
  });

  it('returns nothing once the plan has been worked through', () => {
    // The summary is an in-app screen; a Live Activity describes a run in
    // flight, so the last advance ends it.
    const session = makeSession({ stepIndex: 3 });
    expect(buildFocusRun(session, TASKS, { enabled: true })).toBeNull();
  });

  it('describes the current work step by its task', () => {
    const run = buildFocusRun(makeSession(), TASKS, { enabled: true });
    expect(run).not.toBeNull();
    expect(run?.title).toBe('Write the report');
    expect(run?.subtitle).toBe('Step 1 of 3');
    expect(run?.symbolName).toBe('hourglass');
    expect(run?.paused).toBe(false);
  });

  it('names a break rather than a task, and says when it is a long one', () => {
    const short = buildFocusRun(makeSession({ stepIndex: 1 }), TASKS, { enabled: true });
    expect(short?.title).toBe('Break');
    expect(short?.symbolName).toBe('cup.and.saucer.fill');

    const long = buildFocusRun(
      makeSession({ steps: [rest(15, true)], stepIndex: 0 }),
      TASKS,
      { enabled: true },
    );
    expect(long?.title).toBe('Long break');
  });

  it('falls back to a label when the step\'s task is no longer in the list', () => {
    // syncWithTasks prunes this on the next write; until then the activity
    // still has to say something, same as FocusBar's own fallback.
    const run = buildFocusRun(makeSession(), [], { enabled: true });
    expect(run?.title).toBe('Focusing');
  });

  it('ends the step its full length after the clock started', () => {
    const run = buildFocusRun(makeSession(), TASKS, { enabled: true });
    expect(run?.startedAtMs).toBe(STEP_START_MS);
    expect(run?.targetEndMs).toBe(STEP_START_MS + 25 * 60 * 1000);
  });

  it('takes banked time off the end rather than off the start', () => {
    // A step paused for a while and resumed has less of its budget left, and
    // the end is what moves — the countdown's own start is when the current
    // segment began.
    const run = buildFocusRun(
      makeSession({ stepElapsedSeconds: 600 }),
      TASKS,
      { enabled: true },
    );
    expect(run?.startedAtMs).toBe(STEP_START_MS);
    expect(run?.targetEndMs).toBe(STEP_START_MS + 15 * 60 * 1000);
  });

  it('clamps a step resumed past its target so the range is never inverted', () => {
    // An inverted range crashes the widget extension rather than rendering
    // oddly — see TimerClockView's own guard.
    const run = buildFocusRun(
      makeSession({ stepElapsedSeconds: 25 * 60 + 120 }),
      TASKS,
      { enabled: true },
    );
    expect(run?.targetEndMs).toBe(run?.startedAtMs);
  });

  it('does not read the clock: the same session builds the same payload', () => {
    // The payload is compared by `key` on the native side, so one that moved
    // with Date.now() would tear the activity down and start a new one on
    // every task write in the app behind it.
    const session = makeSession();
    const first = buildFocusRun(session, TASKS, { enabled: true });
    const second = buildFocusRun(session, TASKS, { enabled: true });
    expect(first?.key).toBe(second?.key);
  });

  it('changes the key when anything drawn changes', () => {
    const base = buildFocusRun(makeSession(), TASKS, { enabled: true });
    const advanced = buildFocusRun(makeSession({ stepIndex: 1 }), TASKS, { enabled: true });
    const extended = buildFocusRun(
      makeSession({ steps: [work('task-1', 30), rest(5), work('task-2', 25)] }),
      TASKS,
      { enabled: true },
    );
    const renamed = buildFocusRun(
      makeSession(),
      [makeTask({ title: 'Write the other report' }), TASKS[1]],
      { enabled: true },
    );
    const keys = [base?.key, advanced?.key, extended?.key, renamed?.key];
    expect(new Set(keys).size).toBe(4);
  });

  describe('paused', () => {
    it('freezes the figure instead of handing SwiftUI a range to tick', () => {
      const run = buildFocusRun(
        makeSession({ stepStartedAt: null, stepElapsedSeconds: 600 }),
        TASKS,
        { enabled: true },
      );
      expect(run?.paused).toBe(true);
      expect(run?.pausedRemaining).toBe('15:00');
    });

    it('signs an over-run the way the session sheet signs it', () => {
      const run = buildFocusRun(
        makeSession({ stepStartedAt: null, stepElapsedSeconds: 25 * 60 + 127 }),
        TASKS,
        { enabled: true },
      );
      expect(run?.pausedRemaining).toBe('+2:07');
    });

    it('offers Resume where a running step offers Pause', () => {
      const running = buildFocusRun(makeSession(), TASKS, { enabled: true });
      expect(running?.primaryLabel).toBe('Pause');
      expect(running?.primaryUrl).toBe('dundundun://focus?do=pause');

      const paused = buildFocusRun(
        makeSession({ stepStartedAt: null }),
        TASKS,
        { enabled: true },
      );
      expect(paused?.primaryLabel).toBe('Resume');
      expect(paused?.primaryUrl).toBe('dundundun://focus?do=resume');
    });
  });

  describe('the advance button', () => {
    it('names the next task', () => {
      const run = buildFocusRun(makeSession({ stepIndex: 1 }), TASKS, { enabled: true });
      expect(run?.advanceLabel).toBe('Next task');
      expect(run?.advanceUrl).toBe('dundundun://focus?do=next');
    });

    it('names a break when that is what comes next', () => {
      const run = buildFocusRun(makeSession(), TASKS, { enabled: true });
      expect(run?.advanceLabel).toBe('Start break');
    });

    it('finishes on the last step', () => {
      const run = buildFocusRun(makeSession({ stepIndex: 2 }), TASKS, { enabled: true });
      expect(run?.advanceLabel).toBe('Finish');
    });
  });
});
