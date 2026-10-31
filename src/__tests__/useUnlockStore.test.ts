import { useUnlockStore, type UnlockDraft } from '../store/useUnlockStore';
import { dbDeleteRewardUnlock, dbUpsertRewardUnlock } from '../db/database';
import { cancelPlayTimeUp, schedulePlayTimeUp } from '../utils/notifications';

jest.mock('../db/database', () => ({
  dbGetAllRewardUnlocks: jest.fn(() => []),
  dbUpsertRewardUnlock: jest.fn(),
  dbDeleteRewardUnlock: jest.fn(),
}));
jest.mock('../utils/notifications', () => ({
  schedulePlayTimeUp: jest.fn(() => Promise.resolve()),
  cancelPlayTimeUp: jest.fn(() => Promise.resolve()),
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const draft = (extra: Partial<UnlockDraft> = {}): UnlockDraft => ({
  title: ' Switch ', glyph: '🕹️', sharePct: 60, requiredTaskIds: ['w', 'w'], playMinutes: 120,
  freeOnWeekends: true, freeOnVacation: false, guardsTaskId: null, pin: ' 4817 ', ...extra,
});

const state = () => useUnlockStore.getState();

beforeEach(() => {
  jest.clearAllMocks();
  useUnlockStore.setState({ unlocks: [], initialized: false });
});

describe('useUnlockStore', () => {
  it('cleans what the form saves', () => {
    const u = state().addUnlock(draft());
    expect(u).toMatchObject({ title: 'Switch', pin: '4817', requiredTaskIds: ['w'], playDay: null });
    expect(dbUpsertRewardUnlock).toHaveBeenCalledTimes(1);
  });

  it('refuses one with no name', () => {
    expect(state().addUnlock(draft({ title: '  ' }))).toBeNull();
  });

  it('schedules the time-up notice on start and cancels it on stop', () => {
    const u = state().addUnlock(draft())!;
    const start = new Date(2026, 10, 4, 19);
    state().startPlay(u.id, start);
    expect(schedulePlayTimeUp).toHaveBeenCalledWith(u.id, 'Switch', new Date(2026, 10, 4, 21));
    state().stopPlay(u.id, new Date(2026, 10, 4, 20));
    expect(cancelPlayTimeUp).toHaveBeenCalledWith(u.id);
    expect(state().unlocks[0].playUsedMs).toBe(60 * 60_000);
  });

  it('finds the unlock a habit is linked to', () => {
    const u = state().addUnlock(draft({ guardsTaskId: 'habit' }))!;
    expect(state().unlockLinkedTo('habit')?.id).toBe(u.id);
    expect(state().unlockLinkedTo('other')).toBeNull();
  });

  it('deletes the row and its notice', () => {
    const u = state().addUnlock(draft())!;
    state().deleteUnlock(u.id);
    expect(dbDeleteRewardUnlock).toHaveBeenCalledWith(u.id);
    expect(cancelPlayTimeUp).toHaveBeenCalledWith(u.id);
    expect(state().unlocks).toEqual([]);
  });
});
