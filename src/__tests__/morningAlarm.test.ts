import type { Alarm } from '../types';
import {
  NEXT_ALARM_LINK,
  alarmDetails,
  isOverrideSpent,
  morningAlarmFor,
  morningChipLabel,
  morningDate,
  overrideAt,
  overrideFor,
  ringOn,
} from '../utils/morningAlarm';
import { nextFireAt } from '../utils/alarms';
import { parseAlarmOverride } from '../utils/alarmOverride';

// Sun 25 Oct 2026, 9:00 PM local.
const SUNDAY_NIGHT = new Date(2026, 9, 25, 21, 0);

function alarm(over: Partial<Alarm> = {}): Alarm {
  return {
    id: 'wake', label: 'Wake up', hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5], fireAt: null, enabled: true,
    mission: null, quick: false, armedAt: new Date(2026, 9, 1).toISOString(), missionDoneAt: null, missionGaveUp: false,
    sound: null, wakeSong: null, override: null, createdAt: new Date(2026, 9, 1).toISOString(), ...over,
  };
}

const clock = (at: Date) => `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;

describe('morningDate', () => {
  it('is the calendar date after the logical today', () => {
    expect(morningDate(SUNDAY_NIGHT)).toEqual(new Date(2026, 9, 26));
  });

  it('still asks about Monday in the small hours before the day starts', () => {
    // 1 AM Monday with a 4 AM reset is still Sunday's logical day.
    expect(morningDate(new Date(2026, 9, 26, 1, 0), '04:00')).toEqual(new Date(2026, 9, 26));
  });
});

describe('morningAlarmFor', () => {
  it('finds the first switched-on alarm that rings that morning', () => {
    const gym = alarm({ id: 'gym', hour: 6, minute: 15, repeatDays: [1, 3] });
    const off = alarm({ id: 'off', hour: 5, minute: 0, enabled: false });
    const m = morningAlarmFor(NEXT_ALARM_LINK, [alarm(), gym, off], SUNDAY_NIGHT);
    expect(m.ring?.alarm.id).toBe('gym');
    expect(m.ring?.at).toEqual(new Date(2026, 9, 26, 6, 15));
  });

  it('counts a one-off set for that morning', () => {
    const nap = alarm({ id: 'once', repeatDays: [], fireAt: new Date(2026, 9, 26, 5, 45).toISOString() });
    expect(morningAlarmFor(NEXT_ALARM_LINK, [alarm(), nap], SUNDAY_NIGHT).ring?.alarm.id).toBe('once');
  });

  it('names the next ring when that morning has none', () => {
    const friday = new Date(2026, 9, 30, 21, 0);
    const m = morningAlarmFor(NEXT_ALARM_LINK, [alarm()], friday);
    expect(m.ring).toBeNull();
    expect(m.next?.at).toEqual(new Date(2026, 10, 2, 7, 0));
    expect(morningChipLabel(m, clock)).toBe('No alarm Sat');
  });

  it('looks only at the linked alarm, and treats an id from another phone as the next one', () => {
    const gym = alarm({ id: 'gym', hour: 6, minute: 15, repeatDays: [1, 3] });
    expect(morningAlarmFor('wake', [alarm(), gym], SUNDAY_NIGHT).ring?.alarm.id).toBe('wake');
    expect(morningAlarmFor('elsewhere', [alarm(), gym], SUNDAY_NIGHT).ring?.alarm.id).toBe('gym');
  });

  it('uses the override for that morning', () => {
    const moved = alarm({ override: { date: '2026-10-26', hour: 6, minute: 30 } });
    const m = morningAlarmFor(NEXT_ALARM_LINK, [moved], SUNDAY_NIGHT);
    expect(m.ring?.at).toEqual(new Date(2026, 9, 26, 6, 30));
    expect(morningChipLabel(m, clock)).toBe('Mon 6:30');
  });

  it('doesn’t count a ring that has already gone off that morning', () => {
    const monday8 = new Date(2026, 9, 26, 8, 0);
    expect(morningAlarmFor(NEXT_ALARM_LINK, [alarm()], monday8).ring?.at).toEqual(new Date(2026, 9, 27, 7, 0));
  });
});

describe('overrides', () => {
  it('moves only its own date', () => {
    const moved = alarm({ override: { date: '2026-10-26', hour: 6, minute: 30 } });
    expect(ringOn(moved, new Date(2026, 9, 26))).toEqual(new Date(2026, 9, 26, 6, 30));
    expect(ringOn(moved, new Date(2026, 9, 27))).toEqual(new Date(2026, 9, 27, 7, 0));
    expect(nextFireAt(moved, SUNDAY_NIGHT)).toEqual(new Date(2026, 9, 26, 6, 30));
  });

  it('needs none for the alarm’s own time', () => {
    expect(overrideFor(alarm(), new Date(2026, 9, 26), 7, 0)).toBeNull();
    const o = overrideFor(alarm(), new Date(2026, 9, 26), 6, 30)!;
    expect(o).toEqual({ date: '2026-10-26', hour: 6, minute: 30 });
    expect(overrideAt(o)).toEqual(new Date(2026, 9, 26, 6, 30));
  });

  it('is spent once its day is over', () => {
    const o = { date: '2026-10-26', hour: 6, minute: 30 };
    expect(isOverrideSpent(o, new Date(2026, 9, 26, 23, 59))).toBe(false);
    expect(isOverrideSpent(o, new Date(2026, 9, 27, 0, 0))).toBe(true);
  });

  it('reads back only a well-formed override', () => {
    expect(parseAlarmOverride(JSON.stringify({ date: '2026-10-26', hour: 6, minute: 30 })))
      .toEqual({ date: '2026-10-26', hour: 6, minute: 30 });
    expect(parseAlarmOverride(JSON.stringify({ date: '10/26', hour: 6, minute: 30 }))).toBeNull();
    expect(parseAlarmOverride(JSON.stringify({ date: '2026-10-26', hour: 24, minute: 0 }))).toBeNull();
    expect(parseAlarmOverride('{')).toBeNull();
    expect(parseAlarmOverride(null)).toBeNull();
  });
});

describe('alarmDetails', () => {
  const pushups = { kind: 'pushups' as const, count: 20 };
  const song = { persistentId: '1', title: 'Song', artist: '' };

  it('says nothing for a plain alarm', () => {
    expect(alarmDetails(alarm(), SUNDAY_NIGHT, clock)).toBeNull();
  });

  it('lists the mission, its song and a chosen sound', () => {
    const d = alarmDetails(alarm({ mission: pushups, wakeSong: song as Alarm['wakeSong'], sound: 'chime' }), SUNDAY_NIGHT, clock)!;
    expect(d.icons).toEqual(['barbell-outline', 'musical-notes-outline', 'volume-high-outline']);
    expect(d.text).toBe('20 pushups');
  });

  it('ignores a song on an alarm with no mission', () => {
    expect(alarmDetails(alarm({ wakeSong: song as Alarm['wakeSong'] }), SUNDAY_NIGHT, clock)).toBeNull();
  });

  it('names a one-night time by day until its day is over', () => {
    const moved = alarm({ override: { date: '2026-10-26', hour: 6, minute: 30 } });
    expect(alarmDetails(moved, SUNDAY_NIGHT, clock)).toEqual({ icons: ['moon-outline'], text: '6:30 tomorrow' });
    expect(alarmDetails(moved, new Date(2026, 9, 26, 5, 0), clock)!.text).toBe('6:30 today');
    expect(alarmDetails(moved, new Date(2026, 9, 27, 0, 0), clock)).toBeNull();
  });

  it('joins the mission and a one-night time', () => {
    const d = alarmDetails(alarm({ mission: pushups, override: { date: '2026-10-26', hour: 6, minute: 30 } }), SUNDAY_NIGHT, clock)!;
    expect(d.icons).toEqual(['barbell-outline', 'moon-outline']);
    expect(d.text).toBe('20 pushups · 6:30 tomorrow');
  });
});
