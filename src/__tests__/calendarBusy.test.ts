import {
  busyIntervalsIn,
  busyMinutesIn,
  eventsIn,
  freeGapsIn,
  freeMinutesIn,
  isLiveEvent,
  nextEventAfter,
  occupiesTime,
  type BusyEvent,
} from '../utils/calendarBusy';

const DAY_START = new Date('2026-08-12T00:00:00Z');
const DAY_END = new Date('2026-08-13T00:00:00Z');

let seq = 0;
function ev(start: string, end: string, overrides: Partial<BusyEvent> = {}): BusyEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    title: `Event ${seq}`,
    start,
    end,
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

/** Minutes past midnight UTC on the test day. */
function at(hours: number, minutes = 0): string {
  const d = new Date(DAY_START);
  d.setUTCHours(hours, minutes, 0, 0);
  return d.toISOString();
}

describe('isLiveEvent / occupiesTime', () => {
  it('drops a cancelled event entirely', () => {
    expect(isLiveEvent(ev(at(9), at(10), { status: 'canceled' }))).toBe(false);
    expect(occupiesTime(ev(at(9), at(10), { status: 'canceled' }))).toBe(false);
  });

  it('keeps a cancelled-adjacent status', () => {
    expect(isLiveEvent(ev(at(9), at(10), { status: 'tentative' }))).toBe(true);
    expect(isLiveEvent(ev(at(9), at(10), { status: 'none' }))).toBe(true);
  });

  it('counts tentative as busy — a meeting you have not declined is one you may have to attend', () => {
    expect(occupiesTime(ev(at(9), at(10), { availability: 'tentative' }))).toBe(true);
  });

  it('does not count an all-day event as time', () => {
    const birthday = ev(at(0), at(24), { allDay: true });
    expect(isLiveEvent(birthday)).toBe(true);
    expect(occupiesTime(birthday)).toBe(false);
  });

  it('does not count an event the user marked Free', () => {
    expect(occupiesTime(ev(at(9), at(17), { availability: 'free' }))).toBe(false);
  });
});

describe('busyIntervalsIn', () => {
  it('merges overlapping events instead of summing them', () => {
    const events = [ev(at(9), at(10)), ev(at(9, 30), at(10, 30))];
    expect(busyIntervalsIn(events, DAY_START, DAY_END)).toEqual([
      { start: new Date(at(9)).getTime(), end: new Date(at(10, 30)).getTime() },
    ]);
    expect(busyMinutesIn(events, DAY_START, DAY_END)).toBe(90);
  });

  it('merges an event wholly inside another', () => {
    const events = [ev(at(9), at(12)), ev(at(10), at(11))];
    expect(busyMinutesIn(events, DAY_START, DAY_END)).toBe(180);
  });

  it('merges two meetings that abut, so no zero-length gap is left between them', () => {
    const events = [ev(at(9), at(10)), ev(at(10), at(11))];
    expect(busyIntervalsIn(events, DAY_START, DAY_END)).toHaveLength(1);
  });

  it('keeps a real gap as two intervals', () => {
    const events = [ev(at(9), at(10)), ev(at(11), at(12))];
    expect(busyIntervalsIn(events, DAY_START, DAY_END)).toHaveLength(2);
  });

  it('clips an event that runs past midnight to the day it is asked about', () => {
    const overnight = [ev(at(22), '2026-08-13T01:00:00Z')];
    expect(busyMinutesIn(overnight, DAY_START, DAY_END)).toBe(120);
  });

  it('clips to a partial range, so active hours can bound it', () => {
    const events = [ev(at(7), at(9))];
    expect(busyMinutesIn(events, new Date(at(8)), new Date(at(22)))).toBe(60);
  });

  it('ignores events outside the range', () => {
    expect(busyMinutesIn([ev('2026-08-01T09:00:00Z', '2026-08-01T10:00:00Z')], DAY_START, DAY_END))
      .toBe(0);
  });

  it('ignores a zero-length event and one whose end precedes its start', () => {
    expect(busyMinutesIn([ev(at(9), at(9)), ev(at(12), at(11))], DAY_START, DAY_END)).toBe(0);
  });

  it('ignores an unparseable date rather than treating it as busy', () => {
    expect(busyMinutesIn([ev('not a date', at(10))], DAY_START, DAY_END)).toBe(0);
  });

  it('returns nothing for an inverted range', () => {
    expect(busyIntervalsIn([ev(at(9), at(10))], DAY_END, DAY_START)).toEqual([]);
  });
});

describe('freeGapsIn / freeMinutesIn', () => {
  it('returns the complement of the busy intervals', () => {
    const events = [ev(at(10), at(11))];
    const gaps = freeGapsIn(events, new Date(at(9)), new Date(at(12)));
    expect(gaps).toEqual([
      { start: new Date(at(9)).getTime(), end: new Date(at(10)).getTime() },
      { start: new Date(at(11)).getTime(), end: new Date(at(12)).getTime() },
    ]);
  });

  it('returns the whole range when nothing is on', () => {
    expect(freeGapsIn([], new Date(at(9)), new Date(at(17)))).toEqual([
      { start: new Date(at(9)).getTime(), end: new Date(at(17)).getTime() },
    ]);
  });

  it('returns nothing when the range is fully booked', () => {
    expect(freeGapsIn([ev(at(9), at(17))], new Date(at(9)), new Date(at(17)))).toEqual([]);
  });

  it('drops gaps shorter than the minimum asked for', () => {
    const events = [ev(at(9), at(10)), ev(at(10, 5), at(12))];
    expect(freeGapsIn(events, new Date(at(9)), new Date(at(12)), 30)).toEqual([]);
    expect(freeGapsIn(events, new Date(at(9)), new Date(at(12)))).toHaveLength(1);
  });

  it('counts free minutes as the range less the busy ones', () => {
    const events = [ev(at(10), at(11)), ev(at(10, 30), at(11, 30))];
    expect(freeMinutesIn(events, new Date(at(9)), new Date(at(12)))).toBe(90);
  });

  it('never goes negative when an event spans the whole range', () => {
    expect(freeMinutesIn([ev(at(0), at(24))], new Date(at(9)), new Date(at(10)))).toBe(0);
  });
});

describe('eventsIn', () => {
  it('includes all-day events, which busy time excludes', () => {
    const events = [ev(at(0), at(24), { allDay: true }), ev(at(9), at(10))];
    expect(eventsIn(events, DAY_START, DAY_END)).toHaveLength(2);
    expect(busyMinutesIn(events, DAY_START, DAY_END)).toBe(60);
  });

  it('excludes cancelled events', () => {
    expect(eventsIn([ev(at(9), at(10), { status: 'canceled' })], DAY_START, DAY_END)).toEqual([]);
  });

  it('sorts by start time', () => {
    const late = ev(at(15), at(16));
    const early = ev(at(8), at(9));
    expect(eventsIn([late, early], DAY_START, DAY_END).map(e => e.id)).toEqual([early.id, late.id]);
  });

  it('excludes an event that ends exactly when the range starts', () => {
    expect(eventsIn([ev(at(8), at(9))], new Date(at(9)), new Date(at(17)))).toEqual([]);
  });

  it('includes an event that starts before the range and runs into it', () => {
    expect(eventsIn([ev(at(8), at(10))], new Date(at(9)), new Date(at(17)))).toHaveLength(1);
  });

  // #1725: an all-day event's startDate/endDate are UTC midnight of the
  // calendar date it names, not a moment in the day — on a device west of
  // UTC, that instant falls in the *previous* local day's evening, and a raw
  // instant-overlap test (what the other cases above exercise, correctly,
  // for timed events) places the event a day early.
  //
  // These two only actually distinguish the fix from the bug when the
  // process itself is running west of UTC — Node resolves its ICU default
  // timezone once at startup, so `process.env.TZ` can't be changed from
  // inside a running test (confirmed empirically; a worker_thread with its
  // own `env` doesn't get its own timezone either — only a genuinely
  // separate process spawned with TZ already set does). This repo's test
  // run is pinned to UTC, where local and UTC calendar-date components are
  // numerically identical, so both cases pass here regardless. Verified for
  // real with `TZ=America/Los_Angeles npx jest calendarBusy.test.ts -t 1725`
  // — fails on the pre-fix code, passes on the fix.
  describe('all-day events off UTC (#1725)', () => {
    // "Aug 13" all-day, as EventKit stores it: UTC midnight to UTC midnight
    // the next day — 5pm to 5pm Pacific, which straddles local Aug 12 and 13.
    const allDayAug13 = () => ev('2026-08-13T00:00:00.000Z', '2026-08-14T00:00:00.000Z', { allDay: true });

    it('does not place it on the local day before the one it names', () => {
      const localAug12 = { start: new Date(2026, 7, 12), end: new Date(2026, 7, 13) };
      expect(eventsIn([allDayAug13()], localAug12.start, localAug12.end)).toEqual([]);
    });

    it('places it on the local day it actually names', () => {
      const localAug13 = { start: new Date(2026, 7, 13), end: new Date(2026, 7, 14) };
      expect(eventsIn([allDayAug13()], localAug13.start, localAug13.end)).toHaveLength(1);
    });
  });
});

describe('nextEventAfter', () => {
  it('picks the earliest event starting at or after the moment given', () => {
    const soon = ev(at(11), at(12));
    const later = ev(at(15), at(16));
    expect(nextEventAfter([later, soon], new Date(at(10)), DAY_END)?.id).toBe(soon.id);
  });

  it('skips an event already under way', () => {
    const running = ev(at(9), at(12));
    const next = ev(at(14), at(15));
    expect(nextEventAfter([running, next], new Date(at(10)), DAY_END)?.id).toBe(next.id);
  });

  it('skips all-day events, which cannot be next', () => {
    const allDay = ev(at(0), at(24), { allDay: true });
    expect(nextEventAfter([allDay], new Date(at(10)), DAY_END)).toBeNull();
  });

  it('skips cancelled events', () => {
    expect(nextEventAfter([ev(at(11), at(12), { status: 'canceled' })], new Date(at(10)), DAY_END))
      .toBeNull();
  });

  it('does not look past the end of the range', () => {
    expect(nextEventAfter([ev(at(20), at(21))], new Date(at(10)), new Date(at(17)))).toBeNull();
  });

  it('returns null when nothing is left', () => {
    expect(nextEventAfter([ev(at(9), at(10))], new Date(at(18)), DAY_END)).toBeNull();
  });
});
