// #2950: the one-time launch pass that reads the calendar server id for every
// event this phone wrote before the app kept one.

let mockSettings: Record<string, string> = {};
const mockWanting = jest.fn((): string[] => []);
jest.mock('../db/database', () => ({
  dbGetSetting: (key: string) => mockSettings[key] ?? null,
  dbSetSetting: (key: string, value: string) => { mockSettings[key] = value; },
  dbCalendarEventIdsWantingExternalIds: () => mockWanting(),
}));

const mockFillTasks = jest.fn();
const mockFillMeals = jest.fn();
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ fillCalendarExternalIds: mockFillTasks }) },
}));
jest.mock('../store/useMealPlanStore', () => ({
  useMealPlanStore: { getState: () => ({ fillCalendarExternalIds: mockFillMeals }) },
}));

let mockPermission = 'granted';
jest.mock('../utils/calendarSync', () => ({
  getCalendarPermission: () => Promise.resolve(mockPermission),
}));

let mockCanRead = true;
const mockRead = jest.fn((_ids: readonly string[]) => Promise.resolve({} as Record<string, string>));
jest.mock('../utils/calendarEventLink', () => ({
  canReadExternalEventIds: () => mockCanRead,
  readExternalEventIds: (ids: readonly string[]) => mockRead(ids),
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { backfillCalendarExternalIds, CALENDAR_ID_BACKFILL_KEY } from '../utils/calendarIdBackfill';

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = {};
  mockPermission = 'granted';
  mockCanRead = true;
  mockDemoActive = false;
  mockWanting.mockReturnValue(['dl-1', 'meal-1']);
  mockRead.mockResolvedValue({ 'dl-1': 'ext-dl-1', 'meal-1': 'ext-meal-1' });
});

describe('backfillCalendarExternalIds', () => {
  it('reads every wanting id in one call, fills both stores, and records itself as done', async () => {
    await backfillCalendarExternalIds();
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledWith(['dl-1', 'meal-1']);
    const found = { 'dl-1': 'ext-dl-1', 'meal-1': 'ext-meal-1' };
    expect(mockFillTasks).toHaveBeenCalledWith(found);
    expect(mockFillMeals).toHaveBeenCalledWith(found);
    expect(mockSettings[CALENDAR_ID_BACKFILL_KEY]).toBe('1');
  });

  it('runs once: a later launch reads nothing', async () => {
    await backfillCalendarExternalIds();
    mockRead.mockClear();
    await backfillCalendarExternalIds();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('records itself as done with nothing to read, having asked the bridge nothing', async () => {
    mockWanting.mockReturnValue([]);
    await backfillCalendarExternalIds();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockSettings[CALENDAR_ID_BACKFILL_KEY]).toBe('1');
  });

  // Each of these answers every read empty, so recording the pass as done
  // would fill nothing and never try again.
  it.each([
    ['without calendar access', () => { mockPermission = 'denied'; }],
    ['without the native module', () => { mockCanRead = false; }],
    ['in demo mode', () => { mockDemoActive = true; }],
  ])('does nothing, and tries again next launch, %s', async (_label, arrange) => {
    arrange();
    await backfillCalendarExternalIds();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockFillTasks).not.toHaveBeenCalled();
    expect(mockSettings[CALENDAR_ID_BACKFILL_KEY]).toBeUndefined();
  });

  it('writes nothing when demo mode came on during the read, since the database it read from is gone', async () => {
    mockRead.mockImplementation(async () => {
      mockDemoActive = true;
      return { 'dl-1': 'ext-dl-1' };
    });
    await backfillCalendarExternalIds();
    expect(mockFillTasks).not.toHaveBeenCalled();
    expect(mockFillMeals).not.toHaveBeenCalled();
    expect(mockSettings[CALENDAR_ID_BACKFILL_KEY]).toBeUndefined();
  });

  it('never throws, and leaves the pass to run again', async () => {
    mockWanting.mockImplementation(() => { throw new Error('boom'); });
    await expect(backfillCalendarExternalIds()).resolves.toBeUndefined();
    expect(mockSettings[CALENDAR_ID_BACKFILL_KEY]).toBeUndefined();
  });
});
