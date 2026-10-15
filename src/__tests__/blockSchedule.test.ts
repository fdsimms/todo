import {
  activeSchedules, currentWindowEnd, describeDays, describeWindow, formatMinutes, isScheduleActive,
  nativeScheduleWindows, nextScheduleBoundary, parseBlockSchedules, pauseActiveSchedules, scheduleProblem,
  serializeBlockSchedules,
  windowLengthMinutes, type BlockSchedule,
} from '../utils/blockSchedule';

const make = (over: Partial<BlockSchedule> = {}): BlockSchedule => ({
  id: 's1',
  name: 'Work',
  groupIds: ['default'],
  days: [1, 2, 3, 4, 5],
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  enabled: true,
 
  pausedUntil: null,
  ...over,
});

// 2026-08-12 is a Wednesday. Local times, per the repo's timezone rule.
const WED = (h: number, m = 0) => new Date(2026, 7, 12, h, m);
const THU = (h: number, m = 0) => new Date(2026, 7, 13, h, m);
const SAT = (h: number, m = 0) => new Date(2026, 7, 15, h, m);
const SUN = (h: number, m = 0) => new Date(2026, 7, 16, h, m);

describe('a same-day window', () => {
  it('is on from its start up to, not including, its end', () => {
    const s = make();
    expect(isScheduleActive(s, WED(8, 59))).toBe(false);
    expect(isScheduleActive(s, WED(9))).toBe(true);
    expect(isScheduleActive(s, WED(16, 59))).toBe(true);
    expect(isScheduleActive(s, WED(17))).toBe(false);
  });

  it('is off on days it does not cover', () => {
    expect(isScheduleActive(make(), SAT(12))).toBe(false);
  });

  it('is off when switched off', () => {
    expect(isScheduleActive(make({ enabled: false }), WED(12))).toBe(false);
  });
});

describe('an overnight window', () => {
  const night = make({ days: [5], startMinutes: 22 * 60, endMinutes: 6 * 60 }); // Fridays

  it('belongs to the day it starts on', () => {
    const fri = new Date(2026, 7, 14, 23);
    expect(isScheduleActive(night, fri)).toBe(true);
    expect(isScheduleActive(night, SAT(2))).toBe(true);
    expect(isScheduleActive(night, SAT(6))).toBe(false);
  });

  it('does not run on the morning after a day it does not cover', () => {
    expect(isScheduleActive(night, SUN(2))).toBe(false);
    expect(isScheduleActive(night, THU(23))).toBe(false);
    expect(isScheduleActive(night, new Date(2026, 7, 14, 21, 59))).toBe(false);
  });

  it('ends next morning', () => {
    const end = currentWindowEnd(night, new Date(2026, 7, 14, 23));
    expect(end).toEqual(new Date(2026, 7, 15, 6));
    expect(currentWindowEnd(night, SAT(2))).toEqual(new Date(2026, 7, 15, 6));
  });
});

describe('ending blocks early', () => {
  it('lifts the open window until it ends, then the next one starts on time', () => {
    const { schedules, paused } = pauseActiveSchedules([make()], WED(10));
    expect(paused).toBe(1);
    expect(isScheduleActive(schedules[0], WED(12))).toBe(false);
    expect(isScheduleActive(schedules[0], WED(17))).toBe(false);
    expect(isScheduleActive(schedules[0], THU(9))).toBe(true);
  });

  it('skips a schedule that is not open and one already paused', () => {
    const closed = make({ id: 'b', startMinutes: 18 * 60, endMinutes: 20 * 60 });
    const already = make({ id: 'c', pausedUntil: WED(17).toISOString() });
    const { paused, schedules } = pauseActiveSchedules([closed, already], WED(10));
    expect(paused).toBe(0);
    expect(schedules).toEqual([closed, already]);
  });

  it('pauses only the schedules that are open', () => {
    const open = make({ id: 'a' });
    const other = make({ id: 'b', startMinutes: 18 * 60, endMinutes: 20 * 60 });
    const { schedules, paused } = pauseActiveSchedules([open, other], WED(10));
    expect(paused).toBe(1);
    expect(schedules[1].pausedUntil).toBeNull();
  });
});

describe('activeSchedules', () => {
  it('lists every open schedule', () => {
    const a = make({ id: 'a' });
    const b = make({ id: 'b', startMinutes: 8 * 60, endMinutes: 10 * 60 });
    expect(activeSchedules([a, b], WED(9, 30)).map(s => s.id)).toEqual(['a', 'b']);
  });

  it('keeps blocking through the gap between two overlapping windows ending at different times', () => {
    const a = make({ id: 'a', startMinutes: 9 * 60, endMinutes: 12 * 60 });
    const b = make({ id: 'b', startMinutes: 11 * 60, endMinutes: 15 * 60 });
    expect(activeSchedules([a, b], WED(11, 30)).map(s => s.id)).toEqual(['a', 'b']);
    expect(activeSchedules([a, b], WED(13, 0)).map(s => s.id)).toEqual(['b']);
    expect(activeSchedules([a, b], WED(15, 0))).toEqual([]);
  });

  it('skips a turned-off schedule without touching the one it overlaps', () => {
    const a = make({ id: 'a', enabled: false });
    const b = make({ id: 'b' });
    expect(activeSchedules([a, b], WED(10)).map(s => s.id)).toEqual(['b']);
  });

  it('pauses every overlapping schedule at once, each until its own window ends', () => {
    const a = make({ id: 'a', startMinutes: 9 * 60, endMinutes: 12 * 60 });
    const b = make({ id: 'b', startMinutes: 11 * 60, endMinutes: 15 * 60 });
    const { schedules, paused } = pauseActiveSchedules([a, b], WED(11, 30));
    expect(paused).toBe(2);
    expect(activeSchedules(schedules, WED(11, 30))).toEqual([]);
    expect(isScheduleActive(schedules[0], THU(9))).toBe(true);
  });
});

describe('nextScheduleBoundary', () => {
  it('is the next start or end', () => {
    expect(nextScheduleBoundary([make()], WED(8))).toEqual(WED(9));
    expect(nextScheduleBoundary([make()], WED(10))).toEqual(WED(17));
    expect(nextScheduleBoundary([make()], WED(18))).toEqual(THU(9));
  });

  it('skips the weekend', () => {
    expect(nextScheduleBoundary([make()], new Date(2026, 7, 14, 18))).toEqual(new Date(2026, 7, 17, 9));
  });

  it('is null with nothing on', () => {
    expect(nextScheduleBoundary([make({ enabled: false })], WED(8))).toBeNull();
    expect(nextScheduleBoundary([], WED(8))).toBeNull();
  });

  it('includes the end of a pause', () => {
    const paused = make({ pausedUntil: WED(11).toISOString() });
    expect(nextScheduleBoundary([paused], WED(10))).toEqual(WED(11));
  });
});

describe('validation', () => {
  it('needs a day, two different times and a quarter hour', () => {
    expect(scheduleProblem(make({ days: [] }))).toMatch(/day/);
    expect(scheduleProblem(make({ startMinutes: 600, endMinutes: 600 }))).toMatch(/same/);
    expect(scheduleProblem(make({ startMinutes: 600, endMinutes: 610 }))).toMatch(/15 minutes/);
    expect(scheduleProblem(make())).toBeNull();
  });

  it('measures an overnight window across midnight', () => {
    expect(windowLengthMinutes(22 * 60, 6 * 60)).toBe(8 * 60);
    expect(windowLengthMinutes(9 * 60, 17 * 60)).toBe(8 * 60);
  });
});

describe('parseBlockSchedules', () => {
  it('reads valid ones and drops invalid, repeated and unsafe ones', () => {
    const raw = JSON.stringify([
      make(),
      make({ days: [] }),
      { ...make({ id: 's1' }) },
      { ...make({ id: '../x' }) },
      { ...make({ id: 's2' }), startMinutes: 'x' },
      make({ id: 's3', days: [3, 3, 9, 1] }),
    ]);
    const parsed = parseBlockSchedules(raw);
    expect(parsed.map(s => s.id)).toEqual(['s1', 's3']);
    expect(parsed[1].days).toEqual([1, 3]);
  });

  it('reads a schedule stored before groups could be combined, which has only groupId', () => {
    const { groupIds: _drop, ...legacy } = make();
    const parsed = parseBlockSchedules(JSON.stringify([{ ...legacy, groupId: 'games' }]));
    expect(parsed[0].groupIds).toEqual(['games']);
  });

  it('prefers the list, keeps its order, and drops repeats and unsafe ids', () => {
    const parsed = parseBlockSchedules(JSON.stringify([
      { ...make(), groupId: 'default', groupIds: ['social', 'default', 'social', '../x'] },
    ]));
    expect(parsed[0].groupIds).toEqual(['social', 'default']);
  });

  it('falls back to Default when nothing usable is named', () => {
    const { groupIds: _drop, ...bare } = make();
    expect(parseBlockSchedules(JSON.stringify([bare]))[0].groupIds).toEqual(['default']);
    expect(parseBlockSchedules(JSON.stringify([{ ...bare, groupIds: ['../x'] }]))[0].groupIds).toEqual(['default']);
  });

  it('writes the first group as groupId beside the list, so an older build blocks that one', () => {
    const raw = serializeBlockSchedules([make({ groupIds: ['social', 'games'] })]);
    expect(JSON.parse(raw)[0]).toMatchObject({ groupId: 'social', groupIds: ['social', 'games'] });
    expect(parseBlockSchedules(raw)[0].groupIds).toEqual(['social', 'games']);
  });

  it('is empty for missing or broken input', () => {
    expect(parseBlockSchedules(null)).toEqual([]);
    expect(parseBlockSchedules('[')).toEqual([]);
  });
});

describe('what the native side gets', () => {
  it('has only enabled schedules, with the group resolved', () => {
    const windows = nativeScheduleWindows(
      [make({ groupIds: ['gone'] }), make({ id: 'off', enabled: false })],
      id => (id === 'gone' ? 'default' : id),
    );
    expect(windows).toEqual([{
      id: 's1', name: 'Work', groupId: 'default', groupIds: ['default'], days: [1, 2, 3, 4, 5],
      startMinutes: 540, endMinutes: 1020, pausedUntilIso: null,
    }]);
  });
});

describe('a schedule holding several groups', () => {
  it('cannot be saved with none', () => {
    expect(scheduleProblem(make({ groupIds: [] }))).toMatch(/group/i);
    expect(scheduleProblem(make({ groupIds: ['a', 'b'] }))).toBeNull();
  });

  it('hands the native side every group, resolved and without repeats, with the first as groupId', () => {
    const [window] = nativeScheduleWindows(
      [make({ groupIds: ['gone', 'default', 'social'] })],
      id => (id === 'gone' ? 'default' : id),
    );
    expect(window.groupIds).toEqual(['default', 'social']);
    expect(window.groupId).toBe('default');
  });
});

describe('text', () => {
  it('names the days', () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([5, 4, 3, 2, 1])).toBe('Weekdays');
    expect(describeDays([6, 0])).toBe('Weekends');
    expect(describeDays([1, 3])).toBe('Mon, Wed');
  });

  it('formats times in 12 or 24 hour clocks', () => {
    expect(formatMinutes(0, false)).toBe('12:00 AM');
    expect(formatMinutes(13 * 60 + 5, false)).toBe('1:05 PM');
    expect(formatMinutes(13 * 60 + 5, true)).toBe('13:05');
    expect(describeWindow(make(), false)).toBe('9:00 AM to 5:00 PM');
  });
});
