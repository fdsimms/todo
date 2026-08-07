import type { Reminder } from 'expo-calendar';

/**
 * This feature deletes reminders out of another app, so the ordering and
 * isolation rules in the drain are the part worth testing hardest — a mistake
 * here destroys something the user can't get back.
 *
 * `notifications.test.ts` already mocks an entire Expo module to test an
 * effectful file, so the same approach works here despite the "only pure logic
 * is tested" convention.
 */

// Named `mock…` so jest allows the factory to close over it, and never imported
// at the top level — so the factory only runs inside the isolated requires
// below, long after this is initialised. Returning the same object every time
// means the spies stay stable while the module under test gets fresh
// module-level state (skipIds, lastOutcome) for each test.
const mockCalendar = {
  getRemindersPermissionsAsync: jest.fn(),
  requestRemindersPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  getRemindersAsync: jest.fn(),
  deleteReminderAsync: jest.fn(),
  EntityTypes: { REMINDER: 'reminder', EVENT: 'event' },
};
jest.mock('expo-calendar', () => mockCalendar);

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

const mockAddTask = jest.fn();
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ addTask: mockAddTask }) },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSettings: Record<string, any> = {};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings, subscribe: jest.fn() },
}));

const LIST = {
  id: 'list-1',
  title: 'Reminders',
  allowsModifications: true,
  source: { id: 's', name: 'iCloud', type: 'CalDAV' },
};

function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return { id, title: `Task ${id}`, completed: false, ...overrides };
}

/** A fresh copy of the module, so skipIds and lastOutcome don't leak between tests. */
function freshSync(): typeof import('../utils/remindersImportSync') {
  let mod!: typeof import('../utils/remindersImportSync');
  jest.isolateModules(() => {
    mod = require('../utils/remindersImportSync');
  });
  return mod;
}

beforeEach(() => {
  // reset, not clear: one test makes addTask throw, and clearAllMocks would
  // leave that implementation in place for everything after it.
  jest.resetAllMocks();
  mockSettings = {
    remindersImportEnabled: true,
    remindersImportListId: LIST.id,
    remindersImportConfirmedListId: LIST.id,
    initialized: true,
  };
  mockCalendar.getRemindersPermissionsAsync.mockResolvedValue({
    granted: true,
    status: 'granted',
    canAskAgain: false,
  });
  mockCalendar.getCalendarsAsync.mockResolvedValue([LIST]);
  mockCalendar.getRemindersAsync.mockResolvedValue([]);
  mockCalendar.deleteReminderAsync.mockResolvedValue(undefined);
});

describe('importReminders — what it refuses to do', () => {
  it('does nothing when the import is switched off', async () => {
    mockSettings.remindersImportEnabled = false;
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('off');
    expect(mockCalendar.getRemindersAsync).not.toHaveBeenCalled();
  });

  it('does nothing until the chosen list has been confirmed', async () => {
    mockSettings.remindersImportConfirmedListId = 'a-different-list';
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('no-list');
    expect(mockCalendar.getRemindersAsync).not.toHaveBeenCalled();
  });

  it('does nothing without permission', async () => {
    mockCalendar.getRemindersPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('no-permission');
    expect(mockCalendar.getRemindersAsync).not.toHaveBeenCalled();
  });

  it('never fetches with a list id that is no longer on the device', async () => {
    // The stale id would otherwise reach predicateForReminders(in: []) — see
    // the comment in the drain. Bailing is the whole point.
    mockCalendar.getCalendarsAsync.mockResolvedValue([]);
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('list-missing');
    expect(mockCalendar.getRemindersAsync).not.toHaveBeenCalled();
    expect(mockCalendar.deleteReminderAsync).not.toHaveBeenCalled();
  });

  it('stops if the chosen list has become read-only since it was picked', async () => {
    mockCalendar.getCalendarsAsync.mockResolvedValue([{ ...LIST, allowsModifications: false }]);
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('list-readonly');
    expect(mockCalendar.getRemindersAsync).not.toHaveBeenCalled();
  });

  it('asks only for reminder lists, never for calendars', async () => {
    await freshSync().importReminders();
    expect(mockCalendar.getCalendarsAsync).toHaveBeenCalledWith('reminder');
  });

  it('fetches with a null status, so undated reminders are not filtered out', async () => {
    await freshSync().importReminders();
    expect(mockCalendar.getRemindersAsync).toHaveBeenCalledWith([LIST.id], null, null, null);
  });
});

describe('importReminders — the create/delete contract', () => {
  it('creates the task before deleting the reminder', async () => {
    const order: string[] = [];
    mockAddTask.mockImplementation(() => order.push('addTask'));
    mockCalendar.deleteReminderAsync.mockImplementation(async () => {
      order.push('delete');
    });
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);

    const outcome = await freshSync().importReminders();

    // A failed delete leaves a duplicate you can see and fix; a failed create
    // after a delete loses the capture with no trace. Order is the safeguard.
    expect(order).toEqual(['addTask', 'delete']);
    expect(mockAddTask).toHaveBeenCalledWith({ title: 'Task a' });
    expect(mockCalendar.deleteReminderAsync).toHaveBeenCalledWith('a');
    expect(outcome).toEqual({ imported: 1, deleteFailed: 0, reason: 'ok' });
  });

  it('imports in the order things were said', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('later', { title: 'Second', creationDate: '2026-08-06T12:00:00.000Z' }),
      reminder('earlier', { title: 'First', creationDate: '2026-08-06T09:00:00.000Z' }),
    ]);
    await freshSync().importReminders();
    expect(mockAddTask.mock.calls.map(c => c[0].title)).toEqual(['First', 'Second']);
  });

  it('neither imports nor deletes a completed reminder', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('done', { completed: true }),
      reminder('open'),
    ]);
    const outcome = await freshSync().importReminders();
    expect(mockAddTask).toHaveBeenCalledTimes(1);
    expect(mockCalendar.deleteReminderAsync).toHaveBeenCalledTimes(1);
    expect(mockCalendar.deleteReminderAsync).toHaveBeenCalledWith('open');
    expect(outcome.imported).toBe(1);
  });

  it('carries on through a reminder whose delete fails, and counts it', async () => {
    mockCalendar.deleteReminderAsync.mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('read-only');
    });
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('a'),
      reminder('b'),
      reminder('c'),
    ]);

    const outcome = await freshSync().importReminders();

    expect(mockAddTask).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ imported: 3, deleteFailed: 1, reason: 'ok' });
  });

  it('does not import a reminder again once its delete has failed', async () => {
    const sync = freshSync();
    mockCalendar.deleteReminderAsync.mockRejectedValue(new Error('read-only'));
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);

    await sync.importReminders();
    expect(mockAddTask).toHaveBeenCalledTimes(1);

    // Still sitting in the Reminders app, so the next fetch returns it again —
    // without the skip set this duplicates on every foreground.
    await sync.importReminders();
    expect(mockAddTask).toHaveBeenCalledTimes(1);
  });

  it('does not delete anything when creating the task throws', async () => {
    mockAddTask.mockImplementation(() => {
      throw new Error('database is locked');
    });
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);

    const outcome = await freshSync().importReminders();

    expect(mockCalendar.deleteReminderAsync).not.toHaveBeenCalled();
    expect(outcome.reason).toBe('error');
  });

  it('reports a fetch failure without having deleted anything', async () => {
    mockCalendar.getRemindersAsync.mockRejectedValue(new Error('EventKit is unhappy'));
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('error');
    expect(mockCalendar.deleteReminderAsync).not.toHaveBeenCalled();
  });

  it('remembers the last run for the Settings warning rows', async () => {
    const sync = freshSync();
    expect(sync.lastImportOutcome()).toBeNull();
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);
    await sync.importReminders();
    expect(sync.lastImportOutcome()).toEqual({ imported: 1, deleteFailed: 0, reason: 'ok' });
  });

  it('does not import the same reminder twice when two triggers overlap', async () => {
    // EventKit is not consumed on read, and the fetch here keeps returning the
    // reminder however many times it's asked — which is also what a real fetch
    // does if it lands before the delete has propagated. Overlapping triggers
    // must still produce one task.
    const sync = freshSync();
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);

    await Promise.all([sync.importReminders(), sync.importReminders()]);

    expect(mockAddTask).toHaveBeenCalledTimes(1);
  });

  it('does not re-import a reminder a later fetch still returns after deleting it', async () => {
    const sync = freshSync();
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);

    await sync.importReminders();
    await sync.importReminders();

    expect(mockAddTask).toHaveBeenCalledTimes(1);
  });
});

describe('getRemindersPermission', () => {
  it('is granted when it is granted', async () => {
    await expect(freshSync().getRemindersPermission()).resolves.toBe('granted');
  });

  it('is undetermined while the prompt can still be shown', async () => {
    mockCalendar.getRemindersPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
      canAskAgain: true,
    });
    await expect(freshSync().getRemindersPermission()).resolves.toBe('undetermined');
  });

  it('is denied once the prompt has been answered no', async () => {
    mockCalendar.getRemindersPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    await expect(freshSync().getRemindersPermission()).resolves.toBe('denied');
  });
});

describe('countImportableReminders', () => {
  it('counts exactly what a drain would take, so the confirmation is honest', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('a'),
      reminder('done', { completed: true }),
      reminder('blank', { title: '  ' }),
    ]);
    await expect(freshSync().countImportableReminders(LIST.id)).resolves.toBe(1);
  });

  it('returns null when the list cannot be read', async () => {
    mockCalendar.getRemindersAsync.mockRejectedValue(new Error('nope'));
    await expect(freshSync().countImportableReminders(LIST.id)).resolves.toBeNull();
  });
});
