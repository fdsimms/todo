import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import {
  buildCalendarGrid, buildWeekDays, weekdayHeaders,
  canPageToPreviousMonth, clampMonthToEarliest, isDayBefore,
  canPageToNextMonth, clampMonthToLatest, isDayAfter,
} from '../utils/calendarGrid';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

describe('buildCalendarGrid', () => {
  it('always returns 42 cells (6 weeks)', () => {
    // Every month of a year, plus the pathological ones: a 28-day February
    // starting on a Sunday fills exactly 4 weeks and has to be padded twice.
    for (let m = 0; m < 12; m++) {
      expect(buildCalendarGrid(new Date(2025, m, 1))).toHaveLength(42);
      expect(buildCalendarGrid(new Date(2024, m, 15))).toHaveLength(42);
    }
    expect(buildCalendarGrid(new Date(2015, 1, 1))).toHaveLength(42); // Feb 2015: Sun 1st, 28 days
  });

  it('starts on a Sunday and runs consecutive days throughout', () => {
    const days = buildCalendarGrid(new Date(2025, 7, 6));
    expect(days[0].getDay()).toBe(0);
    expect(days[41].getDay()).toBe(6);
    for (let i = 1; i < days.length; i++) {
      const expected = new Date(days[i - 1]);
      expected.setDate(expected.getDate() + 1);
      expect(iso(days[i])).toBe(iso(expected));
    }
  });

  it('leads with the trailing days of the previous month', () => {
    // Aug 2025 starts on a Friday, so the grid opens on Sun Jul 27.
    const days = buildCalendarGrid(new Date(2025, 7, 10));
    expect(iso(days[0])).toBe('2025-07-27');
    expect(iso(days[5])).toBe('2025-08-01');
  });

  it('opens on the 1st itself when the month starts on a Sunday', () => {
    // Jun 2025 starts on a Sunday — no leading padding at all.
    const days = buildCalendarGrid(new Date(2025, 5, 20));
    expect(iso(days[0])).toBe('2025-06-01');
  });

  it('handles a month starting on each weekday', () => {
    // Sep 2025 → Aug 2026 covers all seven possible first-weekdays.
    for (let i = 0; i < 12; i++) {
      const month = new Date(2025, 8 + i, 1);
      const days = buildCalendarGrid(month);
      expect(days).toHaveLength(42);
      expect(days[0].getDay()).toBe(0);
      // The 1st sits at index = its weekday, since the grid opens on Sunday.
      const firstIdx = days.findIndex(d => isSameDay(d, month));
      expect(firstIdx).toBe(month.getDay());
    }
  });

  it('includes every day of the month exactly once', () => {
    const days = buildCalendarGrid(new Date(2025, 7, 6));
    for (let d = 1; d <= 31; d++) {
      expect(days.filter(x => isSameDay(x, new Date(2025, 7, d)))).toHaveLength(1);
    }
  });

  it('includes Feb 29 in a leap year and stops at the 28th otherwise', () => {
    const leap = buildCalendarGrid(new Date(2024, 1, 10));
    expect(leap.some(d => iso(d) === '2024-02-29')).toBe(true);

    const common = buildCalendarGrid(new Date(2025, 1, 10));
    expect(common.some(d => iso(d) === '2025-02-29')).toBe(false);
    expect(common.some(d => iso(d) === '2025-02-28')).toBe(true);
    // 2100 is divisible by 100 but not 400 — not a leap year.
    expect(buildCalendarGrid(new Date(2100, 1, 10)).some(d => iso(d) === '2100-02-29')).toBe(false);
  });

  it('crosses a year boundary without skipping a day', () => {
    const days = buildCalendarGrid(new Date(2025, 11, 15));
    expect(days.some(d => iso(d) === '2025-12-31')).toBe(true);
    expect(days.some(d => iso(d) === '2026-01-01')).toBe(true);
  });

  it('does not skip or repeat a calendar day across a DST transition', () => {
    // US DST starts Mar 9 2025 (spring forward) and ends Nov 2 2025.
    for (const month of [new Date(2025, 2, 15), new Date(2025, 10, 15)]) {
      const days = buildCalendarGrid(month);
      expect(new Set(days.map(iso)).size).toBe(42);
    }
  });

  it('is unaffected by the time of day on the input', () => {
    const morning = buildCalendarGrid(new Date(2025, 7, 6, 0, 0, 0));
    const evening = buildCalendarGrid(new Date(2025, 7, 6, 23, 59, 59));
    expect(morning.map(iso)).toEqual(evening.map(iso));
  });

  describe('weekStartsOn', () => {
    it('starts every row on Monday when asked', () => {
      const days = buildCalendarGrid(new Date(2025, 7, 6), 1);
      expect(days).toHaveLength(42);
      for (let i = 0; i < 42; i += 7) {
        expect(days[i].getDay()).toBe(1);
      }
    });

    it('still covers the whole month it was asked for', () => {
      // August 2025 starts on a Friday, so a Monday grid has to reach further
      // back than a Sunday one to pick the 1st up.
      const days = buildCalendarGrid(new Date(2025, 7, 6), 1).map(iso);
      expect(days).toContain('2025-08-01');
      expect(days).toContain('2025-08-31');
    });

    it('keeps 42 consecutive unique days for every month of a year', () => {
      for (let m = 0; m < 12; m++) {
        const days = buildCalendarGrid(new Date(2025, m, 1), 1);
        expect(days).toHaveLength(42);
        expect(new Set(days.map(iso)).size).toBe(42);
      }
    });

    it('shifts the grid by exactly one day versus a Sunday start', () => {
      // The Monday grid for a month beginning mid-week starts a day later than
      // the Sunday one — not a week earlier, which is the off-by-seven this
      // guards against.
      const sunday = buildCalendarGrid(new Date(2025, 7, 6), 0);
      const monday = buildCalendarGrid(new Date(2025, 7, 6), 1);
      expect(iso(sunday[0])).toBe('2025-07-27');
      expect(iso(monday[0])).toBe('2025-07-28');
    });

    it('defaults to Sunday', () => {
      const days = buildCalendarGrid(new Date(2025, 7, 6));
      expect(days.map(iso)).toEqual(buildCalendarGrid(new Date(2025, 7, 6), 0).map(iso));
    });
  });
});

describe('buildWeekDays', () => {
  it('returns the seven consecutive days of the week the date falls in', () => {
    // Wed 6 Aug 2025.
    const days = buildWeekDays(new Date(2025, 7, 6));
    expect(days).toHaveLength(7);
    expect(days.map(iso)).toEqual([
      '2025-08-03', '2025-08-04', '2025-08-05', '2025-08-06',
      '2025-08-07', '2025-08-08', '2025-08-09',
    ]);
  });

  it('starts on Monday when asked', () => {
    expect(buildWeekDays(new Date(2025, 7, 6), 1).map(iso)).toEqual([
      '2025-08-04', '2025-08-05', '2025-08-06', '2025-08-07',
      '2025-08-08', '2025-08-09', '2025-08-10',
    ]);
  });

  it('defaults to Sunday', () => {
    expect(buildWeekDays(new Date(2025, 7, 6)).map(iso))
      .toEqual(buildWeekDays(new Date(2025, 7, 6), 0).map(iso));
  });

  // A Sunday under a Monday-first setting belongs to the week that is *ending*,
  // not the one about to start — the off-by-seven that would show the user next
  // week's plan every Sunday.
  it('puts a Sunday at the end of a Monday-first week', () => {
    const days = buildWeekDays(new Date(2025, 7, 3), 1).map(iso);
    expect(days[6]).toBe('2025-08-03');
    expect(days[0]).toBe('2025-07-28');
  });

  it('is unaffected by the time of day on the input', () => {
    const morning = buildWeekDays(new Date(2025, 7, 6, 0, 0, 0));
    const evening = buildWeekDays(new Date(2025, 7, 6, 23, 59, 59));
    expect(morning.map(iso)).toEqual(evening.map(iso));
  });

  it('crosses month and year boundaries without skipping a day', () => {
    expect(buildWeekDays(new Date(2025, 11, 31)).map(iso)).toEqual([
      '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31',
      '2026-01-01', '2026-01-02', '2026-01-03',
    ]);
  });

  it('keeps seven unique consecutive days across a DST transition', () => {
    // US DST starts Mar 9 2025 and ends Nov 2 2025 — a naive +24h would either
    // repeat or skip a calendar day.
    for (const date of [new Date(2025, 2, 12), new Date(2025, 10, 5)]) {
      const days = buildWeekDays(date);
      expect(new Set(days.map(iso)).size).toBe(7);
    }
  });

  it('agrees with the month grid about which days share a week', () => {
    for (const weekStart of [0, 1] as const) {
      const week = buildWeekDays(new Date(2025, 7, 6), weekStart).map(iso);
      const grid = buildCalendarGrid(new Date(2025, 7, 6), weekStart).map(iso);
      const rowStart = grid.indexOf(week[0]);
      expect(grid.slice(rowStart, rowStart + 7)).toEqual(week);
    }
  });
});

describe('weekdayHeaders', () => {
  it('reads Sunday-first by default', () => {
    expect(weekdayHeaders()).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    expect(weekdayHeaders(0)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });

  it('rotates to Monday-first', () => {
    expect(weekdayHeaders(1)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  it('always returns seven labels', () => {
    expect(weekdayHeaders(0)).toHaveLength(7);
    expect(weekdayHeaders(1)).toHaveLength(7);
  });

  // The headers label the grid's columns, so if the two disagree every date in
  // the calendar is displayed under the wrong day name — silently.
  it('labels each column of the grid it sits above', () => {
    for (const weekStart of [0, 1] as const) {
      const headers = weekdayHeaders(weekStart);
      const days = buildCalendarGrid(new Date(2025, 7, 6), weekStart);
      for (let col = 0; col < 7; col++) {
        expect(headers[col]).toBe(format(days[col], 'EEEEE'));
      }
    }
  });
});

describe('the floor a picker may not go below', () => {
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

  describe('isDayBefore', () => {
    it('compares calendar days, not instants', () => {
      // 23:59 today is not before 00:01 today. The floor is a square on a
      // grid; half a day being unavailable is not something a grid can show.
      expect(isDayBefore(new Date(2026, 7, 24, 23, 59), new Date(2026, 7, 24, 0, 1))).toBe(false);
      expect(isDayBefore(new Date(2026, 7, 24, 0, 1), new Date(2026, 7, 24, 23, 59))).toBe(false);
    });

    it('is true only for an earlier day', () => {
      expect(isDayBefore(day(2026, 8, 23), day(2026, 8, 24))).toBe(true);
      expect(isDayBefore(day(2026, 8, 25), day(2026, 8, 24))).toBe(false);
    });

    it('holds across a month and a year boundary', () => {
      expect(isDayBefore(day(2026, 7, 31), day(2026, 8, 1))).toBe(true);
      expect(isDayBefore(day(2025, 12, 31), day(2026, 1, 1))).toBe(true);
      expect(isDayBefore(day(2026, 1, 1), day(2025, 12, 31))).toBe(false);
    });
  });

  describe('clampMonthToEarliest', () => {
    it('pulls a month behind the floor forward to the floor’s month', () => {
      expect(iso(clampMonthToEarliest(day(2026, 3, 15), day(2026, 8, 24)))).toBe('2026-08-01');
    });

    it('leaves the floor’s own month alone, wherever in it the floor falls', () => {
      expect(iso(clampMonthToEarliest(day(2026, 8, 2), day(2026, 8, 24)))).toBe('2026-08-01');
    });

    it('leaves a later month alone', () => {
      expect(iso(clampMonthToEarliest(day(2026, 11, 9), day(2026, 8, 24)))).toBe('2026-11-01');
    });

    it('is a plain start-of-month with no floor', () => {
      expect(iso(clampMonthToEarliest(day(2020, 2, 29), null))).toBe('2020-02-01');
    });
  });

  describe('canPageToPreviousMonth', () => {
    it('is false in the floor’s own month', () => {
      expect(canPageToPreviousMonth(day(2026, 8, 1), day(2026, 8, 24))).toBe(false);
      expect(canPageToPreviousMonth(day(2026, 8, 31), day(2026, 8, 24))).toBe(false);
    });

    it('is true in any later month', () => {
      expect(canPageToPreviousMonth(day(2026, 9, 1), day(2026, 8, 24))).toBe(true);
      expect(canPageToPreviousMonth(day(2027, 1, 1), day(2026, 8, 24))).toBe(true);
    });

    it('is always true with no floor', () => {
      expect(canPageToPreviousMonth(day(1998, 4, 3), null)).toBe(true);
    });
  });
});

describe('the ceiling half', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00`);

  it('spots a day past the ceiling, and lets the ceiling day itself through', () => {
    expect(isDayAfter(day('2026-08-18'), day('2026-08-17'))).toBe(true);
    expect(isDayAfter(day('2026-08-17'), day('2026-08-17'))).toBe(false);
    expect(isDayAfter(day('2026-08-16'), day('2026-08-17'))).toBe(false);
  });

  it('pulls an opening month back to the ceiling, and leaves an earlier one alone', () => {
    // Mirror of clampMonthToEarliest: a month whose every cell is refused reads
    // as a broken calendar rather than as a ceiling.
    expect(clampMonthToLatest(day('2026-12-04'), day('2026-08-17')).getMonth()).toBe(7);
    expect(clampMonthToLatest(day('2026-06-04'), day('2026-08-17')).getMonth()).toBe(5);
    expect(clampMonthToLatest(day('2026-12-04'), null).getMonth()).toBe(11);
  });

  it('stops the forward chevron at the ceiling month', () => {
    expect(canPageToNextMonth(day('2026-07-01'), day('2026-08-17'))).toBe(true);
    expect(canPageToNextMonth(day('2026-08-01'), day('2026-08-17'))).toBe(false);
    expect(canPageToNextMonth(day('2026-08-01'), null)).toBe(true);
  });
});
