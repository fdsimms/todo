import { mealSkipId, useMealSkipStore } from '../store/useMealSkipStore';
import { dbDeleteMealSkip, dbGetMealSkipsInRange, dbGetMealSkipsSince, dbInsertMealSkip } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetMealSkipsSince: jest.fn(() => []),
  dbGetMealSkipsInRange: jest.fn(() => []),
  dbInsertMealSkip: jest.fn(),
  dbDeleteMealSkip: jest.fn(),
}));

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  useMealSkipStore.setState({ skips: [], initialized: false });
});

const state = () => useMealSkipStore.getState();
const DAY = '2026-11-07';

describe('mealSkipId', () => {
  it('is the same for the same meal on the same day, and differs otherwise', () => {
    expect(mealSkipId(DAY, 'breakfast')).toBe(mealSkipId(DAY, 'breakfast'));
    expect(mealSkipId(DAY, 'breakfast')).not.toBe(mealSkipId(DAY, 'lunch'));
    expect(mealSkipId(DAY, 'breakfast')).not.toBe(mealSkipId('2026-11-08', 'breakfast'));
  });
});

describe('initialize', () => {
  it('loads from a week before the logical today', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 7, 9));
    try {
      state().initialize();
      expect(dbGetMealSkipsSince).toHaveBeenCalledWith('2026-10-31');
      expect(state().initialized).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('setSkipped', () => {
  it('writes one row under the derived id and reads it back', () => {
    const undo = state().setSkipped(DAY, 'breakfast', true);
    expect(undo).not.toBeNull();
    expect(dbInsertMealSkip).toHaveBeenCalledWith(
      expect.objectContaining({ id: mealSkipId(DAY, 'breakfast'), dayKey: DAY, slot: 'breakfast' })
    );
    expect(state().isSkipped(DAY, 'breakfast')).toBe(true);
    expect(state().isSkipped(DAY, 'lunch')).toBe(false);
  });

  it('does nothing, and offers no undo, when the meal is already in that state', () => {
    state().setSkipped(DAY, 'lunch', true);
    expect(state().setSkipped(DAY, 'lunch', true)).toBeNull();
    expect(state().skips).toHaveLength(1);
    expect(state().setSkipped(DAY, 'dinner', false)).toBeNull();
    expect(dbDeleteMealSkip).not.toHaveBeenCalled();
  });

  it('un-skips by deleting the row, and the undo puts it back', () => {
    state().setSkipped(DAY, 'dinner', true);
    const undo = state().setSkipped(DAY, 'dinner', false)!;
    expect(dbDeleteMealSkip).toHaveBeenCalledWith(mealSkipId(DAY, 'dinner'));
    expect(state().isSkipped(DAY, 'dinner')).toBe(false);
    undo();
    expect(state().isSkipped(DAY, 'dinner')).toBe(true);
  });
});

describe('skipsInRange', () => {
  it('reads the range from the database', () => {
    state().skipsInRange('2026-11-02', '2026-11-08');
    expect(dbGetMealSkipsInRange).toHaveBeenCalledWith('2026-11-02', '2026-11-08');
  });
});
