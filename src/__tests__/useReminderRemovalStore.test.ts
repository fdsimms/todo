import { useReminderRemovalStore } from '../store/useReminderRemovalStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
  dbDeleteSetting: jest.fn(),
}));

const mockFinish = jest.fn().mockReturnValue(0);
const mockSetLastAction = jest.fn();
let mockItems: { id: string; onList: boolean; lastPurchasedAt: string | null }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUndoStack: any[] = [];
jest.mock('../store/useGroceryStore', () => ({
  useGroceryStore: {
    getState: () => ({
      items: mockItems,
      finishShopping: mockFinish,
      undoStack: mockUndoStack,
      setLastAction: mockSetLastAction,
    }),
  },
}));

const mockGet = dbGetSetting as jest.MockedFunction<typeof dbGetSetting>;
const mockSet = dbSetSetting as jest.MockedFunction<typeof dbSetSetting>;
const mockDelete = dbDeleteSetting as jest.MockedFunction<typeof dbDeleteSetting>;

const KEY = 'groceryImportRemovals';
const recent = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReturnValue(null);
  mockItems = [];
  mockUndoStack = [];
  useReminderRemovalStore.setState({ removals: [], hydrated: false });
});

describe('hydrate and reload', () => {
  it('reads the record back once', () => {
    const when = recent(1);
    mockGet.mockReturnValue(JSON.stringify([{ itemId: 'a', inCart: true, removedAt: when }]));
    useReminderRemovalStore.getState().hydrate();
    useReminderRemovalStore.getState().hydrate();
    expect(useReminderRemovalStore.getState().removals).toEqual([{ itemId: 'a', inCart: true, removedAt: when }]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  // Demo mode and a restore swap the database underneath; the record on
  // screen has to be the live database's.
  it('reload reads again whatever was hydrated', () => {
    useReminderRemovalStore.getState().hydrate();
    mockGet.mockReturnValue(JSON.stringify([{ itemId: 'b', inCart: false, removedAt: recent(1) }]));
    useReminderRemovalStore.getState().reload();
    expect(useReminderRemovalStore.getState().removals.map(r => r.itemId)).toEqual(['b']);
  });
});

describe('record', () => {
  it('persists a pass, under a device-local key', () => {
    const when = recent(0);
    useReminderRemovalStore.getState().record([{ itemId: 'a', checked: true }], when);
    expect(mockSet).toHaveBeenCalledWith(KEY, JSON.stringify([{ itemId: 'a', inCart: true, removedAt: when }]));
  });

  it('drops what has aged out when it writes', () => {
    const old = new Date(Date.now() - 20 * 24 * 3600_000).toISOString();
    mockGet.mockReturnValue(JSON.stringify([{ itemId: 'old', inCart: true, removedAt: old }]));
    const when = recent(0);
    useReminderRemovalStore.getState().record([{ itemId: 'a', checked: false }], when);
    expect(useReminderRemovalStore.getState().removals).toEqual([{ itemId: 'a', inCart: false, removedAt: when }]);
  });

  it('does nothing for a pass that removed nothing', () => {
    useReminderRemovalStore.getState().record([]);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('answer', () => {
  it('records the bought rows as a purchase at the time they came off, and forgets the rest', () => {
    // Two times on today's date, so they're one shop whatever the hour.
    const today = new Date();
    const milkAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 1).toISOString();
    const eggsAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 2).toISOString();
    mockItems = [
      { id: 'milk', onList: false, lastPurchasedAt: null },
      { id: 'eggs', onList: false, lastPurchasedAt: null },
      { id: 'foil', onList: false, lastPurchasedAt: null },
    ];
    useReminderRemovalStore.setState({
      hydrated: true,
      removals: [
        { itemId: 'milk', inCart: true, removedAt: milkAt },
        { itemId: 'eggs', inCart: true, removedAt: eggsAt },
        { itemId: 'foil', inCart: false, removedAt: eggsAt },
      ],
    });
    mockFinish.mockReturnValue(2);

    expect(useReminderRemovalStore.getState().answer(['milk', 'eggs'], ['milk', 'eggs', 'foil'])).toBe(2);

    // Capped at now, which only matters in the first two minutes of the day.
    const expected = new Date(Math.min(Date.parse(eggsAt), Date.now())).toISOString();
    expect(mockFinish).toHaveBeenCalledWith(null, {}, expected, undefined, {}, { itemIds: ['milk', 'eggs'] });
    expect(mockSetLastAction).not.toHaveBeenCalled();
    // The bought rows stay, so an undo of the purchase brings the question back.
    expect(useReminderRemovalStore.getState().removals.map(r => r.itemId)).toEqual(['milk', 'eggs']);
  });

  // Checked on two different days: two shops, each dated from its own, and
  // one undo for the one tap.
  it('dates each day it was checked separately, under one undo entry', () => {
    const day1 = new Date(Date.now() - 3 * 24 * 3600_000);
    const day2 = new Date(Date.now() - 1 * 24 * 3600_000);
    mockItems = [
      { id: 'milk', onList: false, lastPurchasedAt: null },
      { id: 'eggs', onList: false, lastPurchasedAt: null },
    ];
    useReminderRemovalStore.setState({
      hydrated: true,
      removals: [
        { itemId: 'milk', inCart: true, removedAt: recent(0), checkedAt: day1.toISOString() },
        { itemId: 'eggs', inCart: true, removedAt: recent(0), checkedAt: day2.toISOString() },
      ],
    });
    const undoMilk = jest.fn();
    const undoEggs = jest.fn();
    mockFinish.mockImplementation((_s, _p, at: string) => {
      mockUndoStack = [...mockUndoStack, { label: 'Bought 1 thing', undo: at === day1.toISOString() ? undoMilk : undoEggs }];
      return 1;
    });

    expect(useReminderRemovalStore.getState().answer(['milk', 'eggs'], ['milk', 'eggs'])).toBe(2);

    expect(mockFinish.mock.calls.map(c => [c[2], c[5]])).toEqual([
      [day1.toISOString(), { itemIds: ['milk'] }],
      [day2.toISOString(), { itemIds: ['eggs'] }],
    ]);
    expect(mockSetLastAction).toHaveBeenCalledTimes(1);
    const [action, opts] = mockSetLastAction.mock.calls[0];
    expect(action.label).toBe('Bought 2 things');
    expect(opts).toEqual({ replacing: [] });
    action.undo();
    expect(undoEggs).toHaveBeenCalled();
    expect(undoMilk).toHaveBeenCalled();
    // Newest first, the order the stack would have undone them in.
    expect(undoEggs.mock.invocationCallOrder[0]).toBeLessThan(undoMilk.mock.invocationCallOrder[0]);
    mockFinish.mockReset();
    mockFinish.mockReturnValue(0);
  });

  it('records nothing when none were bought, and clears the record', () => {
    mockItems = [{ id: 'foil', onList: false, lastPurchasedAt: null }];
    useReminderRemovalStore.setState({
      hydrated: true,
      removals: [{ itemId: 'foil', inCart: false, removedAt: recent(1) }],
    });

    expect(useReminderRemovalStore.getState().answer([], ['foil'])).toBe(0);

    expect(mockFinish).not.toHaveBeenCalled();
    expect(useReminderRemovalStore.getState().removals).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(KEY);
  });

  // A row that went back on the list between the card rendering and the tap
  // is a plan to buy it, not a purchase.
  it('does not record a row that is no longer live', () => {
    mockItems = [{ id: 'milk', onList: true, lastPurchasedAt: null }];
    useReminderRemovalStore.setState({
      hydrated: true,
      removals: [{ itemId: 'milk', inCart: true, removedAt: recent(1) }],
    });

    useReminderRemovalStore.getState().answer(['milk'], ['milk']);

    expect(mockFinish).not.toHaveBeenCalled();
  });
});

// Keeps the import used: the store reads the grocery store lazily.
void useGroceryStore;
