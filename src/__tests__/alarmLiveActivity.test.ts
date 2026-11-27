import type { Alarm } from '../types';

jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('../store/useAlarmStore', () => ({ useAlarmStore: { getState: () => ({ alarms: [] }), subscribe: jest.fn() } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({}), subscribe: jest.fn() } }));
jest.mock('../utils/widgetBridge', () => ({ widgetBridge: () => null }));

import {
  ALARM_LIVE_ACTIVITY_LEAD_MINUTES,
  ALARM_LIVE_ACTIVITY_SCHEDULE_AHEAD_MS,
  buildAlarmCountdownRun,
} from '../utils/alarmLiveActivity';

// Wed 14 Oct 2026, 06:45 local.
const NOW = new Date(2026, 9, 14, 6, 45);

function alarm(over: Partial<Alarm> = {}): Alarm {
  return {
    id: 'a1', label: 'Wake up', hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5], fireAt: null, enabled: true,
    mission: null, savedFocusId: null, quick: false, armedAt: new Date(2026, 9, 1).toISOString(), missionDoneAt: null,
    missionGaveUp: false, sound: null, soundPool: [], soundRolledAt: null, override: null, skippedOn: null,
    createdAt: new Date(2026, 9, 1).toISOString(), ...over,
  };
}

describe('buildAlarmCountdownRun', () => {
  it('counts down to the next ring from the lead before it, and goes stale at the ring', () => {
    const run = buildAlarmCountdownRun([alarm()], NOW, { enabled: true })!;
    const ring = new Date(2026, 9, 14, 7, 0).getTime();
    expect(run).toEqual({
      alarmId: 'a1', title: 'Wake up', ringAtMs: ring,
      startAtMs: ring - ALARM_LIVE_ACTIVITY_LEAD_MINUTES * 60_000, staleAtMs: ring,
    });
  });

  it('is nothing while the setting is off', () => {
    expect(buildAlarmCountdownRun([alarm()], NOW, { enabled: false })).toBeNull();
  });

  it('picks the earliest ring among the alarms, and names an unlabeled one "Alarm"', () => {
    const later = alarm({ id: 'later', hour: 9 });
    const sooner = alarm({ id: 'sooner', label: '', hour: 8 });
    const run = buildAlarmCountdownRun([later, sooner], NOW, { enabled: true })!;
    expect(run.alarmId).toBe('sooner');
    expect(run.title).toBe('Alarm');
  });

  it('leaves out an alarm that is off, one that does not repeat and a quick one', () => {
    const run = buildAlarmCountdownRun([
      alarm({ id: 'off', enabled: false }),
      alarm({ id: 'once', repeatDays: [], fireAt: new Date(2026, 9, 14, 6, 55).toISOString() }),
      alarm({ id: 'quick', quick: true, repeatDays: [], fireAt: new Date(2026, 9, 14, 6, 50).toISOString() }),
    ], NOW, { enabled: true });
    expect(run).toBeNull();
  });

  it('counts down to the next day when today’s ring is skipped', () => {
    const run = buildAlarmCountdownRun([alarm({ skippedOn: '2026-10-14' })], NOW, { enabled: true })!;
    expect(run.ringAtMs).toBe(new Date(2026, 9, 15, 7, 0).getTime());
  });

  it('follows a one-night time', () => {
    const run = buildAlarmCountdownRun(
      [alarm({ override: { date: '2026-10-14', hour: 6, minute: 55 } })], NOW, { enabled: true })!;
    expect(run.ringAtMs).toBe(new Date(2026, 9, 14, 6, 55).getTime());
  });

  it('looks only as far ahead as it schedules', () => {
    // Fri evening to Mon 7:00 is 58 hours: inside. A weekly alarm a week off is not.
    const fri = new Date(2026, 9, 16, 21, 0);
    expect(buildAlarmCountdownRun([alarm()], fri, { enabled: true })?.ringAtMs).toBe(new Date(2026, 9, 19, 7, 0).getTime());
    expect(ALARM_LIVE_ACTIVITY_SCHEDULE_AHEAD_MS).toBe(72 * 3_600_000);
    expect(buildAlarmCountdownRun([alarm({ repeatDays: [3] })], new Date(2026, 9, 14, 7, 30), { enabled: true })).toBeNull();
  });
});
