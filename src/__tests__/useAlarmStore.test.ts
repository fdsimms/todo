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
let mockPick: { status: string; uri?: string; fileName?: string } = { status: 'canceled' };
const mockInstall = jest.fn().mockResolvedValue(true);
const mockRemoveSound = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/alarmSoundDevice', () => ({
  pickSoundFile: jest.fn(async () => mockPick),
  installImportedSound: (...args: unknown[]) => mockInstall(...args),
  removeImportedSound: (...args: unknown[]) => mockRemoveSound(...args),
}));
let mockDemo = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo }));
jest.mock('../utils/alarmSchedule', () => ({
  syncAlarmToDevice: (...args: unknown[]) => mockSync(...args),
  removeAlarmFromDevice: (...args: unknown[]) => mockRemove(...args),
}));

import { useAlarmStore } from '../store/useAlarmStore';

// Wed 14 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0);
const pushups = { kind: 'pushups' as const, count: 20 };

const song = { persistentId: '1234567890123456789', title: 'Mr. Blue Sky', artist: 'ELO' };

beforeEach(() => {
  mockRows.clear();
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  mockPick = { status: 'canceled' };
  mockDemo = false;
  mockInstall.mockClear();
  mockRemoveSound.mockClear();
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

  it('sets a quick alarm minutes from now, and remembers how it was set up for the next', () => {
    const setup = { mission: pushups, sound: 'beacon', wakeSong: song };
    const nap = useAlarmStore.getState().addQuickAlarm(30, setup, NOW);
    expect(nap).toMatchObject({ quick: true, hour: 10, minute: 30, fireAt: new Date(2026, 9, 14, 10, 30).toISOString(), ...setup });
    expect(useAlarmStore.getState().lastQuickSetup()).toEqual(setup);
    useAlarmStore.getState().addQuickAlarm(10, { mission: null, sound: null, wakeSong: null }, NOW);
    expect(useAlarmStore.getState().lastQuickSetup()).toEqual({ mission: null, sound: null, wakeSong: null });
  });

  it('keeps a wake-up song only on an alarm with a mission', () => {
    const plain = useAlarmStore.getState().saveAlarm({ label: '', hour: 7, minute: 0, repeatDays: [], mission: null, wakeSong: song }, NOW);
    expect(plain.wakeSong).toBeNull();
    const withMission = useAlarmStore.getState().saveAlarm({ label: '', hour: 7, minute: 0, repeatDays: [], mission: pushups, wakeSong: song }, NOW);
    expect(withMission.wakeSong).toEqual(song);
  });

  it('reads an unknown sound as the default', () => {
    const alarm = useAlarmStore.getState().saveAlarm({ label: '', hour: 7, minute: 0, repeatDays: [], mission: null, sound: 'kazoo' }, NOW);
    expect(alarm.sound).toBeNull();
  });

  it('imports a sound from Files, named after the file', async () => {
    mockPick = { status: 'ok', uri: 'file:///cache/Rooster_crow.mp3', fileName: 'Rooster_crow.mp3' };
    const result = await useAlarmStore.getState().importSound(NOW);
    expect(result.status).toBe('ok');
    const sound = useAlarmStore.getState().sounds[0];
    expect(sound).toMatchObject({ name: 'Rooster crow', addedAt: NOW.toISOString() });
    expect(mockInstall).toHaveBeenCalledWith('file:///cache/Rooster_crow.mp3', `custom:${sound.id}`);
    expect(JSON.parse(mockSettings.alarmSounds)).toEqual([sound]);
  });

  it('keeps nothing when the file can’t be converted', async () => {
    mockPick = { status: 'ok', uri: 'file:///cache/song.m4p', fileName: 'song.m4p' };
    mockInstall.mockResolvedValueOnce(false);
    expect(await useAlarmStore.getState().importSound(NOW)).toEqual({ status: 'failed' });
    expect(useAlarmStore.getState().sounds).toEqual([]);
  });

  it('imports nothing in demo mode', async () => {
    mockDemo = true;
    mockPick = { status: 'ok', uri: 'file:///cache/a.mp3', fileName: 'a.mp3' };
    expect(await useAlarmStore.getState().importSound(NOW)).toEqual({ status: 'canceled' });
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('deleting a sound puts the alarms that used it back on the default', async () => {
    mockPick = { status: 'ok', uri: 'file:///cache/a.mp3', fileName: 'a.mp3' };
    const result = await useAlarmStore.getState().importSound(NOW);
    if (result.status !== 'ok') throw new Error('import failed');
    const ref = `custom:${result.sound.id}`;
    const alarm = useAlarmStore.getState().saveAlarm({ label: '', hour: 7, minute: 0, repeatDays: [1], mission: null, sound: ref }, NOW);
    useAlarmStore.getState().addQuickAlarm(10, { mission: null, sound: ref, wakeSong: null }, NOW);
    mockSync.mockClear();
    useAlarmStore.getState().deleteSound(result.sound.id);
    expect(useAlarmStore.getState().sounds).toEqual([]);
    expect(mockRows.get(alarm.id)?.sound).toBeNull();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: alarm.id, sound: null }));
    expect(mockRemoveSound).toHaveBeenCalledWith(ref);
    expect(useAlarmStore.getState().lastQuickSetup().sound).toBeNull();
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
    const nap = useAlarmStore.getState().addQuickAlarm(10, { mission: pushups, sound: null, wakeSong: null }, NOW);
    const after = new Date(2026, 9, 14, 10, 20);
    useAlarmStore.getState().markMissionDone(wake.id, true, after);
    useAlarmStore.getState().markMissionDone(nap.id, false, after);
    const ids = useAlarmStore.getState().alarms.map(a => a.id);
    expect(ids).toEqual([wake.id]);
    expect(useAlarmStore.getState().alarms[0]).toMatchObject({ missionDoneAt: after.toISOString(), missionGaveUp: true });
  });

  it('prunes spent quick alarms unless a mission is still owed for one', () => {
    const owedNap = useAlarmStore.getState().addQuickAlarm(10, { mission: pushups, sound: null, wakeSong: null }, NOW);
    const doneNap = useAlarmStore.getState().addQuickAlarm(10, { mission: null, sound: null, wakeSong: null }, NOW);
    const after = new Date(2026, 9, 14, 11, 0);
    useAlarmStore.getState().pruneSpent(new Set([owedNap.id]), after);
    expect(useAlarmStore.getState().alarms.map(a => a.id)).toEqual([owedNap.id]);
    expect(mockRows.has(doneNap.id)).toBe(false);
  });
});
