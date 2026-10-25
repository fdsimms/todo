import {
  activeSchedules, armedActivityCount, currentWindowEnd, MAX_ARMED_ACTIVITIES, windowCovering, describeDays, describeWindow, formatMinutes, isAllDay, isScheduleActive,
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

describe('an all-day window', () => {
  const allDay = make({ days: [3], startMinutes: 0, endMinutes: 0 }); // Wednesdays

  it('is the one pair of equal times that is allowed', () => {
    expect(isAllDay(allDay)).toBe(true);
    expect(isAllDay(make())).toBe(false);
    expect(scheduleProblem(allDay)).toBeNull();
    expect(scheduleProblem(make({ startMinutes: 0, endMinutes: 0, days: [] }))).toMatch(/day/);
    expect(scheduleProblem(make({ startMinutes: 720, endMinutes: 720 }))).toMatch(/same/);
  });

  it('covers every minute of its days and none of the others', () => {
    expect(isScheduleActive(allDay, WED(0))).toBe(true);
    expect(isScheduleActive(allDay, WED(12, 30))).toBe(true);
    expect(isScheduleActive(allDay, WED(23, 59))).toBe(true);
    expect(isScheduleActive(allDay, THU(0))).toBe(false);
    expect(isScheduleActive(allDay, new Date(2026, 7, 11, 23, 59))).toBe(false);
  });

  it('ends at the next midnight, which is where a tag pause lasts until', () => {
    expect(currentWindowEnd(allDay, WED(10))).toEqual(THU(0));
    const { schedules, paused } = pauseActiveSchedules([allDay], WED(10));
    expect(paused).toBe(1);
    expect(isScheduleActive(schedules[0], WED(23, 59))).toBe(false);
    expect(isScheduleActive(schedules[0], new Date(2026, 7, 19, 0))).toBe(true);
  });

  it('survives being stored and read back', () => {
    const [back] = parseBlockSchedules(serializeBlockSchedules([allDay]));
    expect(back.startMinutes).toBe(0);
    expect(back.endMinutes).toBe(0);
  });

  it('is described as all day', () => {
    expect(describeWindow(allDay, false)).toBe('All day');
  });

  it('is handed to the native side as 0 to 0', () => {
    const [w] = nativeScheduleWindows([allDay], id => id);
    expect([w.startMinutes, w.endMinutes]).toEqual([0, 0]);
  });
});

describe('an allow window', () => {
  const MON = (h: number, m = 0) => new Date(2026, 7, 10, h, m);
  const TUE = (h: number, m = 0) => new Date(2026, 7, 11, h, m);
  const FRI = (h: number, m = 0) => new Date(2026, 7, 14, h, m);
  const allow = (over: Partial<BlockSchedule> = {}) =>
    make({ allowWindow: true, days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 19 * 60, endMinutes: 21 * 60, ...over });

  it('blocks everything outside the window and nothing inside it', () => {
    const s = allow();
    expect(isScheduleActive(s, WED(18, 59))).toBe(true);
    expect(isScheduleActive(s, WED(19, 0))).toBe(false);
    expect(isScheduleActive(s, WED(20, 59))).toBe(false);
    expect(isScheduleActive(s, WED(21, 0))).toBe(true);
    expect(isScheduleActive(s, THU(3, 0))).toBe(true);
  });

  it('blocks the whole of a day that was not picked', () => {
    const s = allow({ days: [1, 2, 3, 4, 5] });
    expect(isScheduleActive(s, SAT(20, 0))).toBe(true);
    expect(isScheduleActive(s, SUN(12, 0))).toBe(true);
    expect(isScheduleActive(s, MON(2, 0))).toBe(true);
    expect(isScheduleActive(s, MON(20, 0))).toBe(false);
    expect(isScheduleActive(s, FRI(20, 0))).toBe(false);
  });

  it('is blocked through Friday night to Monday evening when only weekdays are allowed', () => {
    const s = allow({ days: [1, 2, 3, 4, 5] });
    expect(isScheduleActive(s, FRI(21, 30))).toBe(true);
    expect(isScheduleActive(s, MON(18, 59))).toBe(true);
    expect(currentWindowEnd(s, FRI(21, 30))).toEqual(new Date(2026, 7, 17, 19, 0));
    expect(currentWindowEnd(s, SAT(11, 0))).toEqual(new Date(2026, 7, 17, 19, 0));
  });

  it('lifts a block until the allowed time returns, not until midnight', () => {
    const s = allow({ days: [1, 2, 3, 4, 5] });
    const { schedules, paused } = pauseActiveSchedules([s], FRI(22, 0));
    expect(paused).toBe(1);
    expect(schedules[0].pausedUntil).toBe(new Date(2026, 7, 17, 19, 0).toISOString());
    expect(isScheduleActive(schedules[0], SAT(10, 0))).toBe(false);
    expect(isScheduleActive(schedules[0], new Date(2026, 7, 17, 19, 30))).toBe(false);
    expect(isScheduleActive(schedules[0], new Date(2026, 7, 17, 21, 0))).toBe(true);
  });

  it('lets an allowed all-day window block only the other days', () => {
    const s = allow({ days: [0, 6], startMinutes: 0, endMinutes: 0 });
    expect(isScheduleActive(s, SAT(15, 0))).toBe(false);
    expect(isScheduleActive(s, SUN(23, 59))).toBe(false);
    expect(isScheduleActive(s, MON(0, 0))).toBe(true);
    expect(isScheduleActive(s, FRI(23, 59))).toBe(true);
  });

  it('finds the next start or end of a block', () => {
    const s = allow({ days: [1, 2, 3, 4, 5] });
    expect(nextScheduleBoundary([s], WED(18, 0))).toEqual(WED(19, 0));
    expect(nextScheduleBoundary([s], WED(20, 0))).toEqual(WED(21, 0));
    expect(nextScheduleBoundary([s], FRI(22, 0))).toEqual(new Date(2026, 7, 17, 19, 0));
  });

  it('is one overnight window when the same time is allowed every day', () => {
    const windows = nativeScheduleWindows([allow()], id => id);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ days: [0, 1, 2, 3, 4, 5, 6], startMinutes: 21 * 60, endMinutes: 19 * 60 });
  });

  it('hands the native side windows that cover exactly the minutes the arcs do', () => {
    const s = allow({ days: [1, 2, 3, 4, 5] });
    const windows = nativeScheduleWindows([s], id => id);
    const covers = (at: Date) => windows.some(w => windowCovering(w, at) !== null);
    for (const day of [10, 11, 12, 13, 14, 15, 16]) {
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const at = new Date(2026, 7, day, Math.floor(minute / 60), minute % 60);
        expect(covers(at)).toBe(isScheduleActive(s, at));
      }
    }
  });

  it('gives each native window an id of its own, all carrying the one pause', () => {
    const s = allow({ days: [1, 2, 3, 4, 5], pausedUntil: '2026-08-17T19:00:00.000Z' });
    const windows = nativeScheduleWindows([s], id => id);
    expect(windows.length).toBeGreaterThan(1);
    expect(new Set(windows.map(w => w.id)).size).toBe(windows.length);
    expect(windows.every(w => w.pausedUntilIso === '2026-08-17T19:00:00.000Z')).toBe(true);
  });

  it('is refused when it would block nothing, or leave a gap under a quarter hour', () => {
    expect(scheduleProblem(allow({ startMinutes: 0, endMinutes: 0 }))).toMatch(/nothing would be blocked/);
    expect(scheduleProblem(allow({ startMinutes: 0, endMinutes: 23 * 60 + 55 }))).toMatch(/less than 15 minutes/);
    expect(scheduleProblem(allow({ startMinutes: 19 * 60, endMinutes: 19 * 60 + 10 }))).toMatch(/allowed window/);
    expect(scheduleProblem(allow())).toBeNull();
  });

  it('is described as allowed', () => {
    expect(describeWindow(allow(), false)).toBe('Allowed 7:00 PM to 9:00 PM');
    expect(describeWindow(allow({ startMinutes: 0, endMinutes: 0 }), false)).toBe('Allowed all day');
  });

  it('survives being stored and read back, and a plain schedule stays free of the flag', () => {
    const [back] = parseBlockSchedules(serializeBlockSchedules([allow()]));
    expect(back.allowWindow).toBe(true);
    const [plain] = parseBlockSchedules(serializeBlockSchedules([make()]));
    expect('allowWindow' in plain).toBe(false);
  });

  it('counts the activities it arms', () => {
    expect(armedActivityCount([make()])).toBe(1);
    expect(armedActivityCount([make({ startMinutes: 22 * 60, endMinutes: 6 * 60 })])).toBe(2);
    expect(armedActivityCount([allow()])).toBe(2);
    expect(armedActivityCount([allow({ days: [1, 3, 5] })])).toBeLessThanOrEqual(MAX_ARMED_ACTIVITIES);
  });

  it("leaves iOS's twenty room for the bridge's own four activities", () => {
    // The old budget: 8 overnight blocks, 2 activities each, fill it exactly.
    const overnight = Array.from({ length: 8 }, (_, i) => make({ id: `s${i}`, startMinutes: 22 * 60, endMinutes: 6 * 60 }));
    expect(armedActivityCount(overnight)).toBe(MAX_ARMED_ACTIVITIES);
    expect(MAX_ARMED_ACTIVITIES + 4).toBe(20);
  });
});
