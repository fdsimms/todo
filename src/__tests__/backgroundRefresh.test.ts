import { setDemoModeActive } from '../utils/demoState';

// expo-task-manager and expo-background-task are both native modules, and the
// module under test calls defineTask at import time. Mocked to plain jest.fn()s
// so importing it registers nothing and the run itself can be driven directly.
// The spy is created *inside* the factory rather than closed over: the module
// under test calls defineTask at import time, and an import is hoisted above
// any `const` in this file, so a closed-over one would still be in its temporal
// dead zone when it was reached.
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn().mockResolvedValue(undefined),
  unregisterTaskAsync: jest.fn().mockResolvedValue(undefined),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// Every pass is a store action, and what this file is testing is *which* of
// them the background run calls and in what order — not what any of them does,
// which is each pass's own test file's job.
const mockCalls: string[] = [];
const mockRecord = (name: string) => () => { mockCalls.push(name); };

const mockTaskState = {
  initialize: mockRecord('initialize'),
  sweepExpiredTasks: mockRecord('sweepExpiredTasks'),
  checkVacationExpiry: mockRecord('checkVacationExpiry'),
  rolloverQuotas: mockRecord('rolloverQuotas'),
  sweepOvershootQuotas: mockRecord('sweepOvershootQuotas'),
  dripStalledProjects: mockRecord('dripStalledProjects'),
  checkMealPlanNudge: mockRecord('checkMealPlanNudge'),
  checkProjectReviewTasks: mockRecord('checkProjectReviewTasks'),
  checkMealSlotTasks: mockRecord('checkMealSlotTasks'),
  checkPantryReviewTasks: mockRecord('checkPantryReviewTasks'),
  checkPantryCheckTasks: mockRecord('checkPantryCheckTasks'),
  checkMealShortfallTasks: mockRecord('checkMealShortfallTasks'),
  checkCalendarReviewTasks: mockRecord('checkCalendarReviewTasks'),
  checkWeatherTasks: mockRecord('checkWeatherTasks'),
  checkScreenTimeTasks: mockRecord('checkScreenTimeTasks'),
  checkHealthTasks: mockRecord('checkHealthTasks'),
  checkMoodTasks: mockRecord('checkMoodTasks'),
  checkBirthdayTasks: mockRecord('checkBirthdayTasks'),
  checkBirthdayGiftTasks: mockRecord('checkBirthdayGiftTasks'),
  checkReachOutTasks: mockRecord('checkReachOutTasks'),
  purgeOldCompletedTasks: mockRecord('purgeOldCompletedTasks'),
  tasks: [] as unknown[],
};
const mockSettingsState = { initialized: true, initialize: mockRecord('initializeSettings') };

jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => mockTaskState },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}));
jest.mock('../store/useTemplateStore', () => ({
  useTemplateStore: { getState: () => ({ checkScheduledTemplates: mockRecord('checkScheduledTemplates') }) },
}));
jest.mock('../store/useMealPlanStore', () => ({
  useMealPlanStore: { getState: () => ({ purgeOldEntries: mockRecord('purgeOldMealPlanEntries') }) },
}));
jest.mock('../store/useLeftoverStore', () => ({
  useLeftoverStore: {
    getState: () => ({
      reconcileAllLeftoverTasks: mockRecord('reconcileAllLeftoverTasks'),
      purgeOldLeftovers: mockRecord('purgeOldLeftovers'),
    }),
  },
}));
jest.mock('../store/useGroceryStore', () => ({
  useGroceryStore: { getState: () => ({ tripShopId: null, tripStartedAt: null, shops: [] }) },
}));
jest.mock('../store/useEventReminderStore', () => ({
  useEventReminderStore: { getState: () => ({ remindersByKey: {} }) },
}));
jest.mock('../utils/notifications', () => ({
  rescheduleAllReminders: () => { mockCalls.push('rescheduleAllReminders'); },
}));
jest.mock('../utils/widgetSync', () => ({
  writeWidgetSnapshotNow: () => { mockCalls.push('writeWidgetSnapshot'); },
}));

import * as TaskManager from 'expo-task-manager';
import { runBackgroundRefresh, BACKGROUND_REFRESH_TASK } from '../utils/backgroundRefresh';
import { catchUpPasses, retentionPasses, expiryPasses } from '../utils/maintenancePasses';

beforeEach(() => {
  mockCalls.length = 0;
  setDemoModeActive(false);
  mockSettingsState.initialized = true;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setDemoModeActive(false);
  jest.restoreAllMocks();
});

describe('runBackgroundRefresh', () => {
  it('does nothing at all in demo mode', () => {
    setDemoModeActive(true);
    expect(runBackgroundRefresh()).toEqual({ ran: false, reason: 'demo' });
    // Not one pass, and — the half that would outlive the demo — no widget
    // write and no notification rebuild off the scratch database.
    expect(mockCalls).toEqual([]);
  });

  it('runs every catch-up pass, in the launch sequence order', () => {
    runBackgroundRefresh();
    const expected = catchUpPasses().map(([name]) => name);
    // Compared against the shared list rather than a copy of it: a generator
    // added to the launch sequence has to reach the background run too, and a
    // hand-written expectation here is exactly how that would stop being true.
    const passNames = [
      'checkVacationExpiry', 'rolloverQuotas', 'sweepOvershootQuotas', 'dripStalledProjects',
      'checkMealPlanNudge', 'checkProjectReviewTasks', 'checkMealSlotTasks',
      'checkPantryReviewTasks', 'checkPantryCheckTasks', 'checkMealShortfallTasks',
      'checkCalendarReviewTasks', 'checkWeatherTasks', 'checkScreenTimeTasks', 'checkHealthTasks',
      'checkMoodTasks',
      'checkBirthdayTasks', 'checkBirthdayGiftTasks', 'checkReachOutTasks',
      'reconcileAllLeftoverTasks', 'checkScheduledTemplates',
    ];
    expect(expected).toHaveLength(passNames.length);
    expect(mockCalls.slice(0, passNames.length)).toEqual(passNames);
  });

  it('never deletes anything', () => {
    runBackgroundRefresh();
    // The expiry sweep and the three purges are launch-only on purpose: nobody
    // benefits from a row being deleted earlier, and a purge deliberately
    // bypasses the undo stack. See maintenancePasses.ts.
    expect([...expiryPasses(), ...retentionPasses()]).toHaveLength(4);
    expect(mockCalls).not.toContain('sweepExpiredTasks');
    expect(mockCalls).not.toContain('purgeOldCompletedTasks');
    expect(mockCalls).not.toContain('purgeOldMealPlanEntries');
    expect(mockCalls).not.toContain('purgeOldLeftovers');
  });

  it('rebuilds the notification queue and the widget snapshot after the passes', () => {
    runBackgroundRefresh();
    // Order matters both ways round: the passes are what write the tasks, so a
    // rebuild before them would schedule the queue the app went to sleep with,
    // and a snapshot before them would describe the old list.
    expect(mockCalls.indexOf('rescheduleAllReminders')).toBeGreaterThan(mockCalls.indexOf('checkBirthdayTasks'));
    expect(mockCalls.indexOf('writeWidgetSnapshot')).toBeGreaterThan(mockCalls.indexOf('rescheduleAllReminders'));
  });

  it('opens the database on a cold background launch, where nothing has', () => {
    mockSettingsState.initialized = false;
    runBackgroundRefresh();
    // iOS launches the app with no React tree, so AppGate's two init steps
    // never ran and the SQLite handle is closed.
    expect(mockCalls[0]).toBe('initialize');
    expect(mockCalls[1]).toBe('initializeSettings');
  });

  it('does not re-initialize a process that is merely backgrounded', () => {
    mockSettingsState.initialized = true;
    runBackgroundRefresh();
    // initialize() reloads every store from disk, which would throw away
    // whatever the user was in the middle of when they switched away.
    expect(mockCalls).not.toContain('initialize');
    expect(mockCalls).not.toContain('initializeSettings');
  });

  it('bails rather than running eighteen passes against a database that would not open', () => {
    mockSettingsState.initialized = false;
    const initialize = mockTaskState.initialize;
    mockTaskState.initialize = () => { throw new Error('locked'); };
    const outcome = runBackgroundRefresh();
    mockTaskState.initialize = initialize;
    // The one step the others depend on, so unlike the launch sequence's
    // independent steps this short-circuits: one useful failure, not nineteen
    // identical ones.
    expect(outcome).toEqual({ ran: true, failed: ['initialize stores'] });
    expect(mockCalls).not.toContain('checkBirthdayTasks');
    expect(mockCalls).not.toContain('writeWidgetSnapshot');
  });

  it('reports a failed pass by name without abandoning the ones after it', () => {
    mockTaskState.checkBirthdayTasks = () => { throw new Error('boom'); };
    const outcome = runBackgroundRefresh();
    mockTaskState.checkBirthdayTasks = mockRecord('checkBirthdayTasks');
    expect(outcome).toEqual({ ran: true, failed: ['check birthday tasks'] });
    // The steps after the throw still ran, which is the whole point of
    // runStartupSequence isolating them.
    expect(mockCalls).toContain('writeWidgetSnapshot');
  });
});

describe('the task registration', () => {
  it('defines the task at import time, under this app\'s own name', () => {
    // A mockDefineTask inside a component would never run on a cold background
    // launch, which is the case the whole feature exists for.
    expect(TaskManager.defineTask).toHaveBeenCalledWith(BACKGROUND_REFRESH_TASK, expect.any(Function));
    expect(BACKGROUND_REFRESH_TASK).toBe('dundundun-background-refresh');
  });
});
