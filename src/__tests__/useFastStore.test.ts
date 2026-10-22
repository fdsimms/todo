import { useFastStore } from '../store/useFastStore';
import { dbDeleteFast, dbInsertFast, dbUpdateFast } from '../db/database';
import { cancelFastGoal, scheduleFastGoal } from '../utils/notifications';

jest.mock('../db/database', () => ({
  dbGetAllFasts: jest.fn(() => []),
  dbInsertFast: jest.fn(),
  dbUpdateFast: jest.fn(),
  dbDeleteFast: jest.fn(),
}));

jest.mock('../utils/notifications', () => ({
  scheduleFastGoal: jest.fn(() => Promise.resolve()),
  cancelFastGoal: jest.fn(() => Promise.resolve()),
}));

const state = () => useFastStore.getState();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

beforeEach(() => {
  jest.clearAllMocks();
  useFastStore.setState({ fasts: [], initialized: false });
});

describe('startFast', () => {
  it('writes an open fast and schedules the goal notice for start plus goal', () => {
    const start = hoursAgo(2);
    const fast = state().startFast(start, 16)!;
    expect(fast).toEqual(expect.objectContaining({ startedAt: start.toISOString(), endedAt: null, goalHours: 16 }));
    expect(dbInsertFast).toHaveBeenCalledWith(fast);
    expect(scheduleFastGoal).toHaveBeenCalledWith(16, new Date(start.getTime() + 16 * 3_600_000));
  });

  it('refuses a second while one runs, and a start in the future', () => {
    state().startFast(hoursAgo(1), 16);
    expect(state().startFast(hoursAgo(0.5), 16)).toBeNull();
    useFastStore.setState({ fasts: [] });
    expect(state().startFast(hoursAgo(-2), 16)).toBeNull();
    expect(state().fasts).toHaveLength(0);
  });

  it('keeps the goal in range', () => {
    expect(state().startFast(hoursAgo(1), 500)!.goalHours).toBe(72);
  });
});

describe('endFast', () => {
  it('stamps the end and cancels the goal notice', () => {
    state().startFast(hoursAgo(3), 16);
    const end = hoursAgo(1);
    const ended = state().endFast(end)!;
    expect(ended.endedAt).toBe(end.toISOString());
    expect(dbUpdateFast).toHaveBeenCalledWith(ended);
    expect(cancelFastGoal).toHaveBeenCalled();
  });

  it('does nothing with no fast running', () => {
    expect(state().endFast()).toBeNull();
  });
});

describe('updateFast', () => {
  it('moves the start and re-aims the goal notice', () => {
    const fast = state().startFast(hoursAgo(2), 16)!;
    const start = hoursAgo(4);
    state().updateFast(fast.id, { startedAt: start, goalHours: 18 });
    expect(state().fasts[0]).toEqual(expect.objectContaining({ startedAt: start.toISOString(), goalHours: 18 }));
    expect(scheduleFastGoal).toHaveBeenLastCalledWith(18, new Date(start.getTime() + 18 * 3_600_000));
  });

  it('refuses a start after the end of an ended fast', () => {
    const fast = state().startFast(hoursAgo(5), 16)!;
    state().endFast(hoursAgo(3));
    expect(state().updateFast(fast.id, { startedAt: hoursAgo(2) })).toBeNull();
  });
});

describe('deleteFast', () => {
  it('removes the row and clears the notice it was holding', () => {
    const fast = state().startFast(hoursAgo(2), 16)!;
    state().deleteFast(fast.id);
    expect(dbDeleteFast).toHaveBeenCalledWith(fast.id);
    expect(state().fasts).toHaveLength(0);
    expect(cancelFastGoal).toHaveBeenCalled();
  });
});
