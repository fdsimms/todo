import type { Alarm } from '../types';
import {
  alarmMissionLine,
  alarmNativeUuid,
  alarmSubtitle,
  describeRepeat,
  describeTimeUntil,
  formatAlarmMinutes,
  isSpent,
  missedMissionRing,
  MISSED_MISSION_WINDOW_MS,
  nextClockTime,
  nextFireAt,
  previousFireAt,
  quickAlarmFields,
  scheduleFields,
  sortAlarms,
} from '../utils/alarms';
import { taskAlarmUuid } from '../utils/alarmChain';

// Wed 14 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0);

function alarm(over: Partial<Alarm> = {}): Alarm {
  return {
    id: 'a1',
    label: '',
    hour: 7,
    minute: 0,
    repeatDays: [1, 2, 3, 4, 5],
    fireAt: null,
    enabled: true,
    mission: null,
    quick: false,
    armedAt: new Date(2026, 9, 1).toISOString(),
    missionDoneAt: null,
    missionGaveUp: false,
    sound: null,
    wakeSong: null,
    override: null,
    createdAt: new Date(2026, 9, 1).toISOString(),
    ...over,
  };
}

const pushups = { kind: 'pushups' as const, count: 20 };

describe('nextClockTime', () => {
  it('is today when the time is still ahead, else tomorrow', () => {
    expect(nextClockTime(11, 30, NOW)).toEqual(new Date(2026, 9, 14, 11, 30));
    expect(nextClockTime(9, 0, NOW)).toEqual(new Date(2026, 9, 15, 9, 0));
    expect(nextClockTime(10, 0, NOW)).toEqual(new Date(2026, 9, 15, 10, 0));
  });
});

describe('nextFireAt', () => {
  it('finds the next repeat day', () => {
    // Weekdays at 7: today's has passed, so Thursday.
    expect(nextFireAt(alarm(), NOW)).toEqual(new Date(2026, 9, 15, 7, 0));
    // Weekends at 7 from a Wednesday: Saturday.
    expect(nextFireAt(alarm({ repeatDays: [0, 6] }), NOW)).toEqual(new Date(2026, 9, 17, 7, 0));
  });

  it('rings later today when the time is still ahead', () => {
    expect(nextFireAt(alarm({ hour: 22 }), NOW)).toEqual(new Date(2026, 9, 14, 22, 0));
  });

  it('wraps a whole week for a single day already past today', () => {
    expect(nextFireAt(alarm({ repeatDays: [3] }), NOW)).toEqual(new Date(2026, 9, 21, 7, 0));
  });

  it('reads a one-off from its instant, and a spent one as none', () => {
    const at = new Date(2026, 9, 14, 10, 30);
    expect(nextFireAt(alarm({ repeatDays: [], fireAt: at.toISOString() }), NOW)).toEqual(at);
    expect(nextFireAt(alarm({ repeatDays: [], fireAt: new Date(2026, 9, 14, 9).toISOString() }), NOW)).toBeNull();
  });
});

describe('previousFireAt and isSpent', () => {
  it('finds the last ring of a repeating alarm', () => {
    expect(previousFireAt(alarm(), NOW)).toEqual(new Date(2026, 9, 14, 7, 0));
    expect(previousFireAt(alarm({ repeatDays: [0, 6] }), NOW)).toEqual(new Date(2026, 9, 11, 7, 0));
  });

  it('marks a passed one-off spent and never a repeating alarm', () => {
    const past = alarm({ repeatDays: [], fireAt: new Date(2026, 9, 14, 9).toISOString() });
    expect(isSpent(past, NOW)).toBe(true);
    expect(previousFireAt(past, NOW)).toEqual(new Date(2026, 9, 14, 9));
    expect(isSpent(alarm(), NOW)).toBe(false);
  });
});

describe('missedMissionRing', () => {
  it('owes the mission for a ring this morning that nobody finished', () => {
    expect(missedMissionRing(alarm({ mission: pushups }), NOW)).toEqual(new Date(2026, 9, 14, 7, 0));
  });

  it('owes nothing once the mission was done after that ring', () => {
    const done = alarm({ mission: pushups, missionDoneAt: new Date(2026, 9, 14, 7, 5).toISOString() });
    expect(missedMissionRing(done, NOW)).toBeNull();
  });

  it('owes nothing for a ring from before the alarm was set', () => {
    const fresh = alarm({ mission: pushups, armedAt: new Date(2026, 9, 14, 8).toISOString() });
    expect(missedMissionRing(fresh, NOW)).toBeNull();
  });

  it('owes nothing for a ring too long ago, a switched-off alarm, or one with no mission', () => {
    const later = new Date(new Date(2026, 9, 14, 7).getTime() + MISSED_MISSION_WINDOW_MS + 60_000);
    expect(missedMissionRing(alarm({ mission: pushups }), later)).toBeNull();
    expect(missedMissionRing(alarm({ mission: pushups, enabled: false }), NOW)).toBeNull();
    expect(missedMissionRing(alarm(), NOW)).toBeNull();
  });

  it('owes the mission for a quick alarm that has rung', () => {
    const nap = alarm({ mission: pushups, repeatDays: [], quick: true, fireAt: new Date(2026, 9, 14, 9, 30).toISOString() });
    expect(missedMissionRing(nap, NOW)).toEqual(new Date(2026, 9, 14, 9, 30));
  });
});

describe('describeRepeat', () => {
  it('names the common sets', () => {
    expect(describeRepeat([])).toBe('Once');
    expect(describeRepeat([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeRepeat([5, 1, 2, 3, 4])).toBe('Weekdays');
    expect(describeRepeat([6, 0])).toBe('Weekends');
  });

  it('lists the rest in week order', () => {
    expect(describeRepeat([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(describeRepeat([0, 3])).toBe('Sun, Wed');
    expect(describeRepeat([0, 3], 1)).toBe('Wed, Sun');
  });
});

describe('describing time', () => {
  it('formats minutes and the wait', () => {
    expect(formatAlarmMinutes(30)).toBe('30 min');
    expect(formatAlarmMinutes(60)).toBe('1 hr');
    expect(formatAlarmMinutes(90)).toBe('1.5 hr');
    expect(describeTimeUntil(new Date(NOW.getTime() + 28 * 60_000), NOW)).toBe('in 28 min');
    expect(describeTimeUntil(new Date(NOW.getTime() + 125 * 60_000), NOW)).toBe('in 2 hr 5 min');
    expect(describeTimeUntil(new Date(NOW.getTime() + 120 * 60_000), NOW)).toBe('in 2 hr');
  });

  it('builds the row subtitle', () => {
    expect(alarmSubtitle(alarm({ label: 'Wake up' }), NOW)).toBe('Wake up · Weekdays');
    const nap = alarm({ label: 'Nap', repeatDays: [], fireAt: new Date(NOW.getTime() + 28 * 60_000).toISOString() });
    expect(alarmSubtitle(nap, NOW)).toBe('Nap · in 28 min');
    expect(alarmSubtitle({ ...nap, fireAt: new Date(2026, 9, 14, 9).toISOString() }, NOW)).toBe('Nap · Rang');
  });
});

describe('scheduleFields and quickAlarmFields', () => {
  it('gives a one-off the next instant of its time, and a repeating alarm none', () => {
    expect(scheduleFields(7, 30, [], NOW).fireAt).toBe(new Date(2026, 9, 15, 7, 30).toISOString());
    expect(scheduleFields(7, 30, [3, 1, 1], NOW)).toEqual({ hour: 7, minute: 30, repeatDays: [1, 3], fireAt: null });
  });

  it('sets a quick alarm to the minute', () => {
    const now = new Date(2026, 9, 14, 14, 15, 40);
    expect(quickAlarmFields(30, now)).toEqual({
      hour: 14, minute: 45, repeatDays: [], fireAt: new Date(2026, 9, 14, 14, 45).toISOString(), quick: true,
    });
  });
});

describe('sortAlarms', () => {
  it('puts the next to ring first and the switched off last', () => {
    const soon = alarm({ id: 'soon', repeatDays: [], fireAt: new Date(2026, 9, 14, 10, 30).toISOString() });
    const morning = alarm({ id: 'morning' });
    const off = alarm({ id: 'off', hour: 5, enabled: false });
    expect(sortAlarms([off, morning, soon], NOW).map(a => a.id)).toEqual(['soon', 'morning', 'off']);
  });
});

describe('alarmNativeUuid', () => {
  it('is a UUID that never collides with a task ring', () => {
    expect(alarmNativeUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(alarmNativeUuid('x')).not.toBe(taskAlarmUuid('x'));
  });
});

describe('alarmMissionLine', () => {
  it('names the mission, and a give-up for a day after', () => {
    expect(alarmMissionLine(alarm(), NOW)).toBeNull();
    expect(alarmMissionLine(alarm({ mission: pushups }), NOW)).toBe('20 pushups');
    const gaveUp = alarm({ mission: pushups, missionGaveUp: true, missionDoneAt: new Date(2026, 9, 14, 7, 5).toISOString() });
    expect(alarmMissionLine(gaveUp, NOW)).toBe('20 pushups · gave up');
    expect(alarmMissionLine(gaveUp, new Date(2026, 9, 15, 8))).toBe('20 pushups');
  });
});
