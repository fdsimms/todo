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
// What the store already holds. Only read with deletion off, where the names
// on these rows are what stands in for the delete.
let mockTasks: { title: string }[] = [];
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ addTask: mockAddTask, tasks: mockTasks }) },
}));

// The second drain destination. Mocked out rather than imported for the same
// reason as the task store: the real one reaches expo-sqlite, which doesn't
// load under the node test env.
const mockAddByName = jest.fn();
let mockGroceryItems: { nameKey: string }[] = [];
jest.mock('../store/useGroceryStore', () => ({
  useGroceryStore: { getState: () => ({ addByName: mockAddByName, items: mockGroceryItems }) },
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
  mockTasks = [];
  mockGroceryItems = [];
  mockSettings = {
    remindersImportEnabled: true,
    remindersImportListId: LIST.id,
    remindersImportConfirmedListId: LIST.id,
    // The shipped defaults, so the common path through these tests is the one
    // real users are on. remindersImportDelete especially: with it off the
    // drain stops deleting and starts consulting names instead, which is a
    // different set of rules entirely.
    remindersImportReview: true,
    remindersImportDelete: true,
    groceryImportDelete: true,
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
    expect(outcome).toEqual({ imported: 1, deleteFailed: 0, skipped: 0, reason: 'ok' });
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
    expect(outcome).toEqual({ imported: 3, deleteFailed: 1, skipped: 0, reason: 'ok' });
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
    expect(sync.lastImportOutcome()).toEqual({ imported: 1, deleteFailed: 0, skipped: 0, reason: 'ok' });
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

describe('importReminders — what it does with a reminder that carries a schedule', () => {
  const DATED = () =>
    reminder('a', {
      title: 'go running',
      recurrenceRule: { frequency: 'daily' },
    } as Partial<Reminder>);

  it('parks the schedule as a suggestion, leaving the row bare enough for the Inbox', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([DATED()]);

    await freshSync().importReminders();

    const draft = mockAddTask.mock.calls[0][0];
    // The task itself carries nothing that isInboxTask would treat as filed —
    // that is the whole reason the suggestion is a separate field.
    expect(draft.recurrenceType).toBeUndefined();
    expect(draft.dueDate).toBeUndefined();
    expect(draft.reminderTime).toBeUndefined();
    expect(draft.title).toBe('go running');
    expect(draft.pendingImport).toMatchObject({ recurrenceType: 'daily' });
  });

  it('applies the schedule directly when the user has turned review off', async () => {
    mockSettings.remindersImportReview = false;
    mockCalendar.getRemindersAsync.mockResolvedValue([DATED()]);

    await freshSync().importReminders();

    const draft = mockAddTask.mock.calls[0][0];
    expect(draft.recurrenceType).toBe('daily');
    expect(draft.pendingImport).toBeUndefined();
  });

  it('adds no suggestion to a reminder that implies no schedule', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a')]);

    await freshSync().importReminders();

    expect(mockAddTask).toHaveBeenCalledWith({ title: 'Task a' });
  });

  it('still creates before deleting when a suggestion is involved', async () => {
    // The ordering rule is what stops a failed create from destroying a
    // capture; parsing must not have quietly moved anything ahead of it.
    const order: string[] = [];
    mockAddTask.mockImplementation(() => order.push('addTask'));
    mockCalendar.deleteReminderAsync.mockImplementation(async () => {
      order.push('delete');
    });
    mockCalendar.getRemindersAsync.mockResolvedValue([DATED()]);

    await freshSync().importReminders();

    expect(order).toEqual(['addTask', 'delete']);
  });

  it('carries the notes across as part of the task, not as a suggestion', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('a', { title: 'Pay rent', notes: 'the landlord emailed' }),
    ]);

    await freshSync().importReminders();

    expect(mockAddTask).toHaveBeenCalledWith({
      title: 'Pay rent',
      notes: 'the landlord emailed',
    });
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

// ─── the grocery destination ─────────────────────────────────────────────────

const GROCERY_LIST = {
  id: 'list-2',
  title: 'Groceries',
  allowsModifications: true,
  source: { id: 's', name: 'iCloud', type: 'CalDAV' },
};

/** Points settings at the grocery list only, with the task import off. */
function groceryOnly() {
  mockSettings = {
    remindersImportEnabled: false,
    remindersImportListId: null,
    remindersImportConfirmedListId: null,
    remindersImportDelete: true,
    groceryImportEnabled: true,
    groceryImportListId: GROCERY_LIST.id,
    groceryImportConfirmedListId: GROCERY_LIST.id,
    groceryImportDelete: true,
    initialized: true,
  };
  mockCalendar.getCalendarsAsync.mockResolvedValue([LIST, GROCERY_LIST]);
}

describe('importReminders — the grocery destination', () => {
  it('sends a reminder to the grocery list, not the Inbox', async () => {
    groceryOnly();
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'milk' })]);

    const outcome = await freshSync().importReminders();

    expect(outcome.imported).toBe(1);
    expect(mockAddByName).toHaveBeenCalledWith('milk');
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  // Same rule as the task side, and for the same reason: a failed delete
  // leaves a visible duplicate, a failed create after a delete loses the
  // capture silently.
  it('creates the grocery item before deleting the reminder', async () => {
    groceryOnly();
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'milk' })]);
    const order: string[] = [];
    mockAddByName.mockImplementation(() => order.push('create'));
    mockCalendar.deleteReminderAsync.mockImplementation(async () => { order.push('delete'); });

    await freshSync().importReminders();

    expect(order).toEqual(['create', 'delete']);
  });

  it('reports a delete that failed after the item was created', async () => {
    groceryOnly();
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'milk' })]);
    mockCalendar.deleteReminderAsync.mockRejectedValue(new Error('nope'));

    const outcome = await freshSync().importReminders();

    expect(outcome.imported).toBe(1);
    expect(outcome.deleteFailed).toBe(1);
  });

  it('stays off until its own list is confirmed', async () => {
    groceryOnly();
    mockSettings.groceryImportConfirmedListId = 'a-different-list';
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('no-list');
    expect(mockAddByName).not.toHaveBeenCalled();
  });

  it('refuses a read-only list, which would otherwise re-import for ever', async () => {
    groceryOnly();
    mockCalendar.getCalendarsAsync.mockResolvedValue([
      { ...GROCERY_LIST, allowsModifications: false },
    ]);
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('list-readonly');
    expect(mockAddByName).not.toHaveBeenCalled();
  });

  it('reports a list that has gone from the device', async () => {
    groceryOnly();
    mockCalendar.getCalendarsAsync.mockResolvedValue([LIST]);
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('list-missing');
  });

  it('does nothing when both destinations are off', async () => {
    groceryOnly();
    mockSettings.groceryImportEnabled = false;
    const outcome = await freshSync().importReminders();
    expect(outcome.reason).toBe('off');
    expect(mockCalendar.getRemindersAsync).not.toHaveBeenCalled();
  });

  it('drains both destinations in one pass, each to its own sink', async () => {
    mockSettings = {
      remindersImportEnabled: true,
      remindersImportListId: LIST.id,
      remindersImportConfirmedListId: LIST.id,
      remindersImportDelete: true,
      groceryImportEnabled: true,
      groceryImportListId: GROCERY_LIST.id,
      groceryImportConfirmedListId: GROCERY_LIST.id,
      groceryImportDelete: true,
      initialized: true,
    };
    mockCalendar.getCalendarsAsync.mockResolvedValue([LIST, GROCERY_LIST]);
    mockCalendar.getRemindersAsync.mockImplementation(async (ids: string[]) =>
      ids[0] === LIST.id
        ? [reminder('t1', { title: 'call the dentist' })]
        : [reminder('g1', { title: 'milk' })]
    );

    const outcome = await freshSync().importReminders();

    expect(outcome.imported).toBe(2);
    expect(mockAddTask).toHaveBeenCalledTimes(1);
    expect(mockAddTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'call the dentist' }));
    expect(mockAddByName).toHaveBeenCalledTimes(1);
    expect(mockAddByName).toHaveBeenCalledWith('milk');
  });

  // One misconfigured destination must not strand the other.
  it('still drains groceries when the task list has gone missing', async () => {
    mockSettings = {
      remindersImportEnabled: true,
      remindersImportListId: 'a-list-that-vanished',
      remindersImportConfirmedListId: 'a-list-that-vanished',
      remindersImportDelete: true,
      groceryImportEnabled: true,
      groceryImportListId: GROCERY_LIST.id,
      groceryImportConfirmedListId: GROCERY_LIST.id,
      groceryImportDelete: true,
      initialized: true,
    };
    mockCalendar.getCalendarsAsync.mockResolvedValue([GROCERY_LIST]);
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('g1', { title: 'milk' })]);

    const outcome = await freshSync().importReminders();

    expect(outcome.imported).toBe(1);
    expect(mockAddByName).toHaveBeenCalledWith('milk');
  });
});

/**
 * "Delete after importing" off. The delete is normally what stops a capture
 * arriving twice — with it gone the reminder is handed back on every single
 * foreground, so these tests are about the thing that replaces it.
 */
describe('importReminders — with the reminders left in place', () => {
  beforeEach(() => {
    mockSettings.remindersImportDelete = false;
  });

  it('imports the task and leaves the reminder alone', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'book a haircut' })]);

    const outcome = await freshSync().importReminders();

    expect(outcome).toEqual({ imported: 1, deleteFailed: 0, skipped: 0, reason: 'ok' });
    expect(mockAddTask).toHaveBeenCalledWith({ title: 'book a haircut' });
    expect(mockCalendar.deleteReminderAsync).not.toHaveBeenCalled();
  });

  it('skips a reminder whose name is already a task, and says so', async () => {
    mockTasks = [{ title: 'Book a haircut' }];
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'book a haircut' })]);

    const outcome = await freshSync().importReminders();

    expect(outcome).toMatchObject({ imported: 0, skipped: 1, reason: 'ok' });
    expect(mockAddTask).not.toHaveBeenCalled();
    expect(mockCalendar.deleteReminderAsync).not.toHaveBeenCalled();
  });

  // Wide on purpose: with nothing being deleted a false match costs a skip the
  // user can undo by hand, while a false miss re-imports for ever. A finished
  // task still answers "yes, that one came across already".
  it('counts a completed task as a name already taken', async () => {
    mockTasks = [{ title: 'take out the bins', completed: true } as { title: string }];
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'take out the bins' })]);

    expect((await freshSync().importReminders()).skipped).toBe(1);
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  it('matches the stripped title an earlier import would have saved', async () => {
    // Review off saves "pay rent", not "pay rent tomorrow" — so the name in
    // the store is the stripped one, and only matching the dictated title
    // would re-import this on the next foreground.
    mockSettings.remindersImportReview = false;
    mockTasks = [{ title: 'pay rent' }];
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('a', { title: 'pay rent tomorrow' }),
    ]);

    expect((await freshSync().importReminders()).skipped).toBe(1);
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  it('keeps the index current, so one batch cannot land the same name twice', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([
      reminder('a', { title: 'call mum', creationDate: '2026-08-06T09:00:00.000Z' }),
      reminder('b', { title: 'Call Mum', creationDate: '2026-08-06T10:00:00.000Z' }),
    ]);

    const outcome = await freshSync().importReminders();

    expect(outcome).toMatchObject({ imported: 1, skipped: 1 });
    expect(mockAddTask).toHaveBeenCalledTimes(1);
  });

  // The skip isn't remembered: nothing was created, so deleting the task that
  // blocked it should free the capture to come across.
  it('lets a skipped reminder through once its task is gone', async () => {
    mockTasks = [{ title: 'book a haircut' }];
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'book a haircut' })]);
    const sync = freshSync();

    expect((await sync.importReminders()).skipped).toBe(1);

    mockTasks = [];
    expect((await sync.importReminders()).imported).toBe(1);
    expect(mockAddTask).toHaveBeenCalledTimes(1);
  });

  it('still deletes on the other destination, which has its own setting', async () => {
    mockSettings.groceryImportEnabled = true;
    mockSettings.groceryImportListId = GROCERY_LIST.id;
    mockSettings.groceryImportConfirmedListId = GROCERY_LIST.id;
    mockSettings.groceryImportDelete = true;
    mockCalendar.getCalendarsAsync.mockResolvedValue([LIST, GROCERY_LIST]);
    mockCalendar.getRemindersAsync.mockImplementation(async (ids: string[]) =>
      ids[0] === LIST.id ? [reminder('t1', { title: 'call the dentist' })] : [reminder('g1', { title: 'milk' })]
    );

    await freshSync().importReminders();

    expect(mockCalendar.deleteReminderAsync).toHaveBeenCalledTimes(1);
    expect(mockCalendar.deleteReminderAsync).toHaveBeenCalledWith('g1');
  });
});

describe('importReminders — groceries left in place', () => {
  beforeEach(() => {
    groceryOnly();
    mockSettings.groceryImportDelete = false;
  });

  it('adds the item and leaves the reminder alone', async () => {
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'milk' })]);

    const outcome = await freshSync().importReminders();

    expect(outcome).toMatchObject({ imported: 1, skipped: 0 });
    expect(mockAddByName).toHaveBeenCalledWith('milk');
    expect(mockCalendar.deleteReminderAsync).not.toHaveBeenCalled();
  });

  // The catalog, not the list: a row that came off the list when it was bought
  // still knows the name, which is what keeps a permanent reminder from
  // yanking milk back onto the list after every shop.
  it('skips a name the catalog already knows, quantity and all', async () => {
    mockGroceryItems = [{ nameKey: 'chicken' }];
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: '2 lb chicken' })]);

    expect((await freshSync().importReminders()).skipped).toBe(1);
    expect(mockAddByName).not.toHaveBeenCalled();
  });

  it('lets a name the catalog has never seen through', async () => {
    mockGroceryItems = [{ nameKey: 'milk' }];
    mockCalendar.getRemindersAsync.mockResolvedValue([reminder('a', { title: 'eggs' })]);

    expect((await freshSync().importReminders()).imported).toBe(1);
    expect(mockAddByName).toHaveBeenCalledWith('eggs');
  });
});
