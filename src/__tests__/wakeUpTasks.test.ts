import type { Alarm } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { morningAlarmFor, morningDate } from '../utils/morningAlarm';
import {
  clampWakeUpMinutes,
  eventIsWakeUpEligible,
  isWakeUpTaskStale,
  matchedWakeUp,
  parseWakeUpAlarmIds,
  wakeAlarmKey,
  wakeAlarmPlan,
  wakeUpAt,
  wakeUpSourceId,
  wakeUpTitle,
} from '../utils/wakeUpTasks';

// Sun 25 Oct 2026, 9:00 PM local: the evening before Monday's early start.
const SUNDAY_NIGHT = new Date(2026, 9, 25, 21, 0);
const MORNING = morningDate(SUNDAY_NIGHT);
const LEADS = { defaultMinutes: 25, byCalendar: {}, arriveEarlyMinutes: 5 };
const PREFS = { usualMinutes: 8 * 60, getReadyMinutes: 45 };

function at(h: number, m = 0, dayOffset = 1): string {
  return new Date(2026, 9, 25 + dayOffset, h, m).toISOString();
}

function event(over: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'evt-1', title: 'Dentist', start: at(7, 30), end: at(8, 30), allDay: false,
    calendarId: 'cal-1', location: '123 Main St', status: 'confirmed', availability: 'busy', ...over,
  };
}

function alarm(over: Partial<Alarm> = {}): Alarm {
  return {
    id: 'wake', label: '', hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5], fireAt: null, enabled: true,
    mission: null, quick: false, armedAt: new Date(2026, 9, 1).toISOString(), missionDoneAt: null, missionGaveUp: false,
    sound: null, wakeSong: null, override: null, createdAt: new Date(2026, 9, 1).toISOString(), ...over,
  };
}

const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('wakeUpAt', () => {
  it('takes the trip, the arrive-early time and getting ready off the start', () => {
    // 7:30 - (25 + 5) - 45 = 6:15
    expect(clock(wakeUpAt(event(), LEADS, 45)!)).toBe('6:15');
  });

  it('floors to five minutes', () => {
    expect(clock(wakeUpAt(event({ start: at(7, 33) }), LEADS, 45)!)).toBe('6:15');
  });

  it('takes no trip off an event with no place, or a video call', () => {
    // 7:30 - 5 - 45 = 6:40
    expect(clock(wakeUpAt(event({ location: null }), LEADS, 45)!)).toBe('6:40');
    expect(clock(wakeUpAt(event({ videoCall: true }), LEADS, 45)!)).toBe('6:40');
  });

  it('uses the event calendar\'s own lead', () => {
    const leads = { ...LEADS, byCalendar: { 'cal-1': 60 } };
    expect(clock(wakeUpAt(event(), leads, 45)!)).toBe('5:40');
  });

  it('is null for a start that does not parse', () => {
    expect(wakeUpAt(event({ start: 'nope' }), LEADS, 45)).toBeNull();
  });
});

describe('eventIsWakeUpEligible', () => {
  it('refuses an all-day event and one already under way', () => {
    expect(eventIsWakeUpEligible(event({ allDay: true }), SUNDAY_NIGHT)).toBe(false);
    expect(eventIsWakeUpEligible(event({ start: at(20, 0, 0) }), SUNDAY_NIGHT)).toBe(false);
    expect(eventIsWakeUpEligible(event(), SUNDAY_NIGHT)).toBe(true);
  });
});

describe('matchedWakeUp', () => {
  it('matches an event that needs a wake-up before the usual time', () => {
    const match = matchedWakeUp(LEADS, PREFS, [event()], SUNDAY_NIGHT, MORNING, {});
    expect(match).not.toBeNull();
    expect(clock(match!.wakeAt)).toBe('6:15');
    expect(match!.handled).toBe(false);
  });

  it('writes nothing for an ordinary morning', () => {
    // 10:00 - 30 - 45 = 8:45, after the usual 8:00.
    expect(matchedWakeUp(LEADS, PREFS, [event({ start: at(10, 0) })], SUNDAY_NIGHT, MORNING, {})).toBeNull();
  });

  it('ignores events on other dates', () => {
    expect(matchedWakeUp(LEADS, PREFS, [event({ start: at(7, 30, 2) })], SUNDAY_NIGHT, MORNING, {})).toBeNull();
    expect(matchedWakeUp(LEADS, PREFS, [event({ start: at(23, 0, 0) })], SUNDAY_NIGHT, MORNING, {})).toBeNull();
  });

  it('picks the event that needs the earliest wake-up', () => {
    const early = event({ id: 'early', start: at(6, 45), location: null });
    const later = event({ id: 'later', start: at(7, 30) });
    // early: 6:45 - 5 - 45 = 5:55; later: 6:15
    const match = matchedWakeUp(LEADS, PREFS, [later, early], SUNDAY_NIGHT, MORNING, {});
    expect(match!.event.id).toBe('early');
  });

  it('reads a handled occurrence as handled, by either of its keys', () => {
    const e = event({ externalId: 'server-1' });
    const handled = { [`evt-1|${e.start}`]: e.end };
    const match = matchedWakeUp(LEADS, PREFS, [e], SUNDAY_NIGHT, MORNING, handled);
    expect(match!.handled).toBe(true);
    expect(match!.sourceId).toBe(`evt-1|${e.start}`);
  });
});

describe('isWakeUpTaskStale', () => {
  const e = event();
  const sourceId = wakeUpSourceId(e);
  const match = matchedWakeUp(LEADS, PREFS, [e], SUNDAY_NIGHT, MORNING, {});

  it('keeps the row while its event is the match', () => {
    expect(isWakeUpTaskStale(sourceId, match, SUNDAY_NIGHT)).toBe(false);
  });

  it('clears it when the event moved, was cancelled, or an earlier one took over', () => {
    expect(isWakeUpTaskStale(sourceId, null, SUNDAY_NIGHT)).toBe(true);
    const other = matchedWakeUp(LEADS, PREFS, [event({ id: 'other', start: at(6, 45) })], SUNDAY_NIGHT, MORNING, {});
    expect(isWakeUpTaskStale(sourceId, other, SUNDAY_NIGHT)).toBe(true);
  });

  it('leaves it alone once the event has started', () => {
    expect(isWakeUpTaskStale(sourceId, null, new Date(2026, 9, 26, 8, 0))).toBe(false);
  });
});

describe('wakeAlarmPlan', () => {
  const wakeAt = new Date(2026, 9, 26, 6, 15);

  it('adds a one-off when nothing rings that morning', () => {
    const morning = morningAlarmFor('next', [], SUNDAY_NIGHT);
    expect(wakeAlarmPlan(morning, wakeAt, SUNDAY_NIGHT)).toEqual({ kind: 'add' });
  });

  it('moves a repeating alarm that rings later, for that morning only', () => {
    const a = alarm();
    const plan = wakeAlarmPlan(morningAlarmFor('next', [a], SUNDAY_NIGHT), wakeAt, SUNDAY_NIGHT);
    expect(plan).toEqual({ kind: 'override', alarm: a });
  });

  it('leaves an alarm that already rings in time', () => {
    const plan = wakeAlarmPlan(morningAlarmFor('next', [alarm({ hour: 6, minute: 0 })], SUNDAY_NIGHT), wakeAt, SUNDAY_NIGHT);
    expect(plan).toEqual({ kind: 'covered' });
  });

  it('leaves a one-off the person made, even when it rings too late', () => {
    const mine = alarm({ repeatDays: [], fireAt: new Date(2026, 9, 26, 7, 0).toISOString() });
    const plan = wakeAlarmPlan(morningAlarmFor('next', [mine], SUNDAY_NIGHT), wakeAt, SUNDAY_NIGHT);
    expect(plan).toEqual({ kind: 'none' });
  });

  it('does nothing for a wake-up time already past', () => {
    const morning = morningAlarmFor('next', [], SUNDAY_NIGHT);
    expect(wakeAlarmPlan(morning, new Date(2026, 9, 25, 20, 0), SUNDAY_NIGHT)).toEqual({ kind: 'none' });
  });
});

describe('small helpers', () => {
  it('keys an applied alarm by the time, so a moved event sets it again', () => {
    expect(wakeAlarmKey('a|b', new Date(2026, 9, 26, 6, 15))).not.toBe(wakeAlarmKey('a|b', new Date(2026, 9, 26, 6, 0)));
  });

  it('titles the task with the time', () => {
    expect(wakeUpTitle(new Date(2026, 9, 26, 6, 15), clock)).toBe('Wake up at 6:15');
  });

  it('clamps a typed number and falls back for one that is not', () => {
    expect(clampWakeUpMinutes(500, 45, 0, 180)).toBe(180);
    expect(clampWakeUpMinutes(NaN, 45, 0, 180)).toBe(45);
    expect(clampWakeUpMinutes(12.4, 45, 0, 180)).toBe(12);
  });
});

describe('parseWakeUpAlarmIds', () => {
  it('reads string pairs and drops everything else', () => {
    expect(parseWakeUpAlarmIds('{"a|b":"alarm-1","c|d":"override:alarm-2","e":3,"f":""}'))
      .toEqual({ 'a|b': 'alarm-1', 'c|d': 'override:alarm-2' });
  });

  it('answers empty for a missing, malformed or non-object value', () => {
    expect(parseWakeUpAlarmIds(null)).toEqual({});
    expect(parseWakeUpAlarmIds('nope')).toEqual({});
    expect(parseWakeUpAlarmIds('[1,2]')).toEqual({});
  });
});
