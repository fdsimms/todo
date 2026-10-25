import type { Alarm } from '../types';

let mockDemo = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo }));
jest.mock('todo-alarmkit-bridge', () => ({
  isAlarmKitAvailable: jest.fn(() => true),
  requestAlarmAuthorization: jest.fn().mockResolvedValue('authorized'),
  cancelNativeAlarm: jest.fn().mockResolvedValue(true),
  completeNativeMission: jest.fn().mockResolvedValue(true),
  scheduleNativeAlarm: jest.fn().mockResolvedValue(true),
  scheduleWeeklyNativeAlarm: jest.fn().mockResolvedValue(true),
}));
const mockSoundFile = jest.fn(async (sound: string | null) => (sound === 'chime' ? 'dundundun-chime.caf' : null));
jest.mock('../utils/alarmSoundDevice', () => ({
  soundFileForAlarm: (sound: string | null) => mockSoundFile(sound),
}));

import {
  cancelNativeAlarm,
  completeNativeMission,
  scheduleNativeAlarm,
  scheduleWeeklyNativeAlarm,
} from 'todo-alarmkit-bridge';
import { removeAlarmFromDevice, syncAlarmToDevice } from '../utils/alarmSchedule';
import { alarmNativeUuid } from '../utils/alarms';

const NOW = new Date(2026, 9, 14, 10, 0);

function alarm(over: Partial<Alarm> = {}): Alarm {
  return {
    id: 'a1', label: 'Wake up', hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5], fireAt: null, enabled: true,
    mission: { kind: 'pushups', count: 20 }, quick: false, armedAt: NOW.toISOString(), missionDoneAt: null,
    missionGaveUp: false, sound: null, wakeSong: null,
    createdAt: NOW.toISOString(), ...over,
  };
}

beforeEach(() => {
  mockDemo = false;
  jest.clearAllMocks();
});

describe('syncAlarmToDevice', () => {
  it('schedules a repeating alarm weekly, carrying its mission', async () => {
    expect(await syncAlarmToDevice(alarm(), NOW)).toBe(true);
    expect(cancelNativeAlarm).toHaveBeenCalledWith(alarmNativeUuid('a1'));
    expect(scheduleWeeklyNativeAlarm).toHaveBeenCalledWith(
      alarmNativeUuid('a1'), 7, 0, [1, 2, 3, 4, 5], 'Wake up',
      { key: 'alarm:a1', kind: 'pushups', count: 20, title: 'Wake up', buttonLabel: 'Pushups' },
      null,
    );
  });

  it('schedules a one-off at its instant', async () => {
    const at = new Date(2026, 9, 14, 10, 30);
    await syncAlarmToDevice(alarm({ repeatDays: [], fireAt: at.toISOString(), mission: null, label: '' }), NOW);
    expect(scheduleNativeAlarm).toHaveBeenCalledWith(alarmNativeUuid('a1'), at, 'Alarm', null, null);
  });

  it('rings with its sound once the file is installed', async () => {
    await syncAlarmToDevice(alarm({ sound: 'chime' }), NOW);
    expect(mockSoundFile).toHaveBeenCalledWith('chime');
    expect(scheduleWeeklyNativeAlarm).toHaveBeenCalledWith(
      alarmNativeUuid('a1'), 7, 0, [1, 2, 3, 4, 5], 'Wake up', expect.anything(), 'dundundun-chime.caf');
  });

  it('rings with the default when the sound can’t be had', async () => {
    await syncAlarmToDevice(alarm({ sound: 'custom:gone' }), NOW);
    expect(scheduleWeeklyNativeAlarm).toHaveBeenCalledWith(
      alarmNativeUuid('a1'), 7, 0, [1, 2, 3, 4, 5], 'Wake up', expect.anything(), null);
  });

  it('only cancels an alarm that is off or spent', async () => {
    await syncAlarmToDevice(alarm({ enabled: false }), NOW);
    await syncAlarmToDevice(alarm({ repeatDays: [], fireAt: new Date(2026, 9, 14, 9).toISOString() }), NOW);
    expect(cancelNativeAlarm).toHaveBeenCalledTimes(2);
    expect(scheduleNativeAlarm).not.toHaveBeenCalled();
    expect(scheduleWeeklyNativeAlarm).not.toHaveBeenCalled();
  });

  it('does nothing on the device in demo mode', async () => {
    mockDemo = true;
    expect(await syncAlarmToDevice(alarm(), NOW)).toBe(false);
    await removeAlarmFromDevice('a1');
    expect(cancelNativeAlarm).not.toHaveBeenCalled();
    expect(completeNativeMission).not.toHaveBeenCalled();
  });
});

describe('removeAlarmFromDevice', () => {
  it('cancels the alarm and ends any mission it left owed', async () => {
    await removeAlarmFromDevice('a1');
    expect(cancelNativeAlarm).toHaveBeenCalledWith(alarmNativeUuid('a1'));
    expect(completeNativeMission).toHaveBeenCalledWith('alarm:a1');
  });
});
