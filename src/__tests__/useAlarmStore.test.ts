import type { Alarm } from '../types';

const mockRows = new Map<string, Alarm>();
const mockSettings: Record<string, string> = {};
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockSettings[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockSettings[key] = value; }),
  dbGetAlarms: jest.fn(() => [...mockRows.values()]),
  dbSaveAlarm: jest.fn((a: Alarm) => { mockRows.set(a.id, a); }),
  dbDeleteAlarm: jest.fn((id: string) => { mockRows.delete(id); }),
}));
const mockSync = jest.fn().mockResolvedValue(true);
const mockRemove = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/alarmSchedule', () => ({
  syncAlarmToDevice: (...args: unknown[]) => mockSync(...args),
  removeAlarmFromDevice: (...args: unknown[]) => mockRemove(...args),
}));

import { useAlarmStore } from '../store/useAlarmStore';

// Wed 14 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0);
const pushups = { kind: 'pushups' as const, count: 20 };

beforeEach(() => {
  mockRows.clear();
  mockSync.mockClear();
  mockRemove.mockClear();
  useAlarmStore.getState().reload();
});

describe('useAlarmStore', () => {
  it('saves a repeating alarm, switched on, and puts it on the device', () => {
    const alarm = useAlarmStore.getState().saveAlarm(
      { label: ' Wake up ', hour: 7, minute: 0, repeatDays: [5, 1, 2, 3, 4], mission: pushups }, NOW);
    expect(alarm).toMatchObject({ label: 'Wake up', repeatDays: [1, 2, 3, 4, 5], fireAt: null, enabled: true, mission: pushups });
    expect(mockRows.get(alarm.id)).toEqual(alarm);
    expect(mockSync).toHaveBeenCalledWith(alarm);
  });

  it('gives a one-off the next time its clock time comes round', () => {
    const alarm = useAlarmStore.getState().saveAlarm({ label: '', hour: 9, minute: 0, repeatDays: [], mission: null }, NOW);
    expect(alarm.fireAt).toBe(new Date(2026, 9, 15, 9, 0).toISOString());
  });

  it('edits in place, keeping when it was made', () => {
    const first = useAlarmStore.getState().saveAlarm({ label: 'A', hour: 7, minute: 0, repeatDays: [1], mission: null }, NOW);
    const later = new Date(2026, 9, 14, 11, 0);
    const edited = useAlarmStore.getState().saveAlarm({ id: first.id, label: 'B', hour: 8, minute: 0, repeatDays: [1], mission: null }, later);
    expect(useAlarmStore.getState().alarms).toHaveLength(1);
    expect(edited).toMatchObject({ id: first.id, label: 'B', hour: 8, createdAt: first.createdAt, armedAt: later.toISOString() });
  });

  it('sets a quick alarm minutes from now, and remembers its mission for the next', () => {
    const nap = useAlarmStore.getState().addQuickAlarm(30, pushups, NOW);
    expect(nap).toMatchObject({ quick: true, hour: 10, minute: 30, fireAt: new Date(2026, 9, 14, 10, 30).toISOString(), mission: pushups });
    expect(useAlarmStore.getState().lastQuickMission()).toEqual(pushups);
    useAlarmStore.getState().addQuickAlarm(10, null, NOW);
    expect(useAlarmStore.getState().lastQuickMission()).toBeNull();
  });

  it('switching a rung one-off back on sets it for the next time', () => {
    const once = useAlarmStore.getState().saveAlarm({ label: '', hour: 11, minute: 0, repeatDays: [], mission: null }, NOW);
    const nextDay = new Date(2026, 9, 15, 12, 0);
    useAlarmStore.getState().setEnabled(once.id, false, nextDay);
    useAlarmStore.getState().setEnabled(once.id, true, nextDay);
    expect(useAlarmStore.getState().alarms[0].fireAt).toBe(new Date(2026, 9, 16, 11, 0).toISOString());
  });

  it('deletes an alarm from the database and the device', () => {
    const alarm = useAlarmStore.getState().saveAlarm({ label: '', hour: 7, minute: 0, repeatDays: [1], mission: null }, NOW);
    useAlarmStore.getState().deleteAlarm(alarm.id);
    expect(mockRows.size).toBe(0);
    expect(mockRemove).toHaveBeenCalledWith(alarm.id);
  });

  it('stamps a finished mission, and lets a spent quick alarm go with it', () => {
    const wake = useAlarmStore.getState().saveAlarm({ label: '', hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5], mission: pushups }, NOW);
    const nap = useAlarmStore.getState().addQuickAlarm(10, pushups, NOW);
    const after = new Date(2026, 9, 14, 10, 20);
    useAlarmStore.getState().markMissionDone(wake.id, true, after);
    useAlarmStore.getState().markMissionDone(nap.id, false, after);
    const ids = useAlarmStore.getState().alarms.map(a => a.id);
    expect(ids).toEqual([wake.id]);
    expect(useAlarmStore.getState().alarms[0]).toMatchObject({ missionDoneAt: after.toISOString(), missionGaveUp: true });
  });

  it('prunes spent quick alarms unless a mission is still owed for one', () => {
    const owedNap = useAlarmStore.getState().addQuickAlarm(10, pushups, NOW);
    const doneNap = useAlarmStore.getState().addQuickAlarm(10, null, NOW);
    const after = new Date(2026, 9, 14, 11, 0);
    useAlarmStore.getState().pruneSpent(new Set([owedNap.id]), after);
    expect(useAlarmStore.getState().alarms.map(a => a.id)).toEqual([owedNap.id]);
    expect(mockRows.has(doneNap.id)).toBe(false);
  });
});
