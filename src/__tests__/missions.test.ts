import {
  describeMission,
  hasMission,
  missionKeyForAlarm,
  nativeAlarmHold,
  missionKeyForTask,
  normalizeMission,
  owedMissions,
  parseMission,
  parseMissionKey,
} from '../utils/missions';
import { PUSHUP_MAX_COUNT } from '../utils/pushupCounter';

describe('normalizeMission', () => {
  it('keeps a usable pushup mission', () => {
    expect(normalizeMission({ kind: 'pushups', count: 20 })).toEqual({ kind: 'pushups', count: 20 });
    expect(normalizeMission({ kind: 'pushups', count: 9000 })).toEqual({ kind: 'pushups', count: PUSHUP_MAX_COUNT });
  });

  it('reads anything malformed as none', () => {
    expect(normalizeMission(null)).toBeNull();
    expect(normalizeMission({ kind: 'pushups', count: 0 })).toBeNull();
    expect(normalizeMission({ kind: 'pushups', count: '20' })).toBeNull();
    expect(normalizeMission({ kind: 'math', count: 3 })).toBeNull();
    expect(normalizeMission('pushups')).toBeNull();
  });
});

describe('parseMission', () => {
  it('reads the stored JSON back', () => {
    expect(parseMission('{"kind":"pushups","count":15}')).toEqual({ kind: 'pushups', count: 15 });
  });

  it('reads empty or broken text as none', () => {
    expect(parseMission(null)).toBeNull();
    expect(parseMission('')).toBeNull();
    expect(parseMission('{nope')).toBeNull();
  });
});

describe('hasMission', () => {
  it('is set only by a usable mission', () => {
    expect(hasMission({ mission: { kind: 'pushups', count: 10 } })).toBe(true);
    expect(hasMission({ mission: { kind: 'pushups', count: 0 } })).toBe(false);
    expect(hasMission({ mission: null })).toBe(false);
    expect(hasMission({})).toBe(false);
  });
});

describe('describeMission', () => {
  it('names the count', () => {
    expect(describeMission({ kind: 'pushups', count: 20 })).toBe('20 pushups');
    expect(describeMission({ kind: 'pushups', count: 1 })).toBe('1 pushup');
  });
});

describe('mission keys', () => {
  it('round-trip', () => {
    expect(parseMissionKey(missionKeyForTask('t1'))).toEqual({ kind: 'task', id: 't1' });
    expect(parseMissionKey(missionKeyForAlarm('a:b'))).toEqual({ kind: 'alarm', id: 'a:b' });
  });

  it('refuses a key this build does not know', () => {
    expect(parseMissionKey('timer:1')).toBeNull();
    expect(parseMissionKey('task:')).toBeNull();
    expect(parseMissionKey('nothing')).toBeNull();
  });
});

describe('owedMissions', () => {
  const pushups = { kind: 'pushups' as const, count: 20 };
  const task = (over = {}) => ({ id: 't1', title: 'Get up', completed: false, archived: false, mission: pushups, ...over });
  const alarm = (over = {}) => ({ id: 'a1', label: 'Wake up', mission: pushups, ...over });
  const pending = (key: string) => ({ key, kind: 'pushups', count: 20, title: 'Wake up' });

  it('owes a pending mission whose task or alarm still asks it', () => {
    const { owed, stale } = owedMissions({
      pending: [pending('task:t1'), pending('alarm:a1')],
      taskById: () => task(),
      alarmById: () => alarm(),
      missedRingAlarmIds: [],
    });
    expect(owed.map(o => [o.key, o.source, o.title])).toEqual([['task:t1', 'task', 'Get up'], ['alarm:a1', 'alarm', 'Wake up']]);
    expect(stale).toEqual([]);
  });

  it('owes an alarm held only for a focus session, with no mission', () => {
    const { owed, stale } = owedMissions({
      pending: [pending('alarm:a1')], taskById: () => undefined,
      alarmById: () => alarm({ mission: null, savedFocusId: 's1' }), missedRingAlarmIds: [],
    });
    expect(owed.map(o => [o.key, o.mission, o.savedFocusId])).toEqual([['alarm:a1', null, 's1']]);
    expect(stale).toEqual([]);
  });

  it('lets go of an alarm that has neither a mission nor a focus session now', () => {
    const { owed, stale } = owedMissions({
      pending: [pending('alarm:a1')], taskById: () => undefined,
      alarmById: () => alarm({ mission: null, savedFocusId: null }), missedRingAlarmIds: [],
    });
    expect(owed).toEqual([]);
    expect(stale).toEqual(['alarm:a1']);
  });

  it('lets go of a pending mission whose task is done, gone or no longer asks', () => {
    for (const t of [task({ completed: true }), task({ archived: true }), task({ mission: null }), undefined]) {
      const { owed, stale } = owedMissions({
        pending: [pending('task:t1')], taskById: () => t, alarmById: () => undefined, missedRingAlarmIds: [],
      });
      expect(owed).toEqual([]);
      expect(stale).toEqual(['task:t1']);
    }
  });

  it('lets go of a deleted alarm and an unknown key', () => {
    const { stale } = owedMissions({
      pending: [pending('alarm:gone'), pending('timer:x')], taskById: () => undefined, alarmById: () => undefined, missedRingAlarmIds: [],
    });
    expect(stale).toEqual(['alarm:gone', 'timer:x']);
  });

  it('adds a missed ring once, beside the native entry for the same alarm', () => {
    const { owed } = owedMissions({
      pending: [pending('alarm:a1')], taskById: () => undefined, alarmById: () => alarm(), missedRingAlarmIds: ['a1'],
    });
    expect(owed).toHaveLength(1);
    const { owed: missedOnly } = owedMissions({
      pending: [], taskById: () => undefined, alarmById: () => alarm({ label: '' }), missedRingAlarmIds: ['a1'],
    });
    expect(missedOnly.map(o => o.title)).toEqual(['Alarm']);
  });

  it('neither owes nor lets go of a mission that is being ended', () => {
    const { owed, stale } = owedMissions({
      pending: [pending('alarm:a1'), pending('task:t1')],
      taskById: () => task(),
      alarmById: () => alarm(),
      missedRingAlarmIds: ['a1'],
      ending: new Set(['alarm:a1']),
    });
    expect(owed.map(o => o.key)).toEqual(['task:t1']);
    expect(stale).toEqual([]);
  });
});

describe('nativeAlarmHold', () => {
  const pushups = { kind: 'pushups' as const, count: 20 };

  it('holds an alarm for its mission, whether or not it also offers a focus session', () => {
    expect(nativeAlarmHold({ id: 'a1', mission: pushups, savedFocusId: 's1' }, 'Wake up'))
      .toMatchObject({ key: 'alarm:a1', kind: 'pushups', count: 20, buttonLabel: 'Pushups' });
  });

  it('holds an alarm with only a focus session as a focus hold', () => {
    expect(nativeAlarmHold({ id: 'a1', mission: null, savedFocusId: 's1' }, 'Wake up'))
      .toEqual({ key: 'alarm:a1', kind: 'focus', count: 0, title: 'Wake up', buttonLabel: 'Focus' });
  });

  it('holds nothing for an alarm with neither', () => {
    expect(nativeAlarmHold({ id: 'a1', mission: null, savedFocusId: null }, 'Wake up')).toBeNull();
    expect(nativeAlarmHold({ id: 'a1', mission: null }, 'Wake up')).toBeNull();
  });
});
