import { hhmmToDate, formatHHMM, dateToHHMM, clockTimeToken, effectiveWindowEndTime, onLogicalDay, carryClockTime } from '../utils/clockTime';

const NOW = new Date(2025, 5, 10, 14, 30, 0); // Tue Jun 10 2025, 2:30 PM

describe('hhmmToDate', () => {
  it('applies the given clock time to today by default', () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    const result = hhmmToDate('08:30');
    expect(result.getDate()).toBe(10);
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(30);
    jest.useRealTimers();
  });

  it('applies the clock time to a given base date', () => {
    const base = new Date(2025, 5, 15, 3, 0, 0);
    const result = hhmmToDate('13:00', base);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(13);
    expect(result.getMinutes()).toBe(0);
  });

  it('keeps the base date untouched', () => {
    const base = new Date(2025, 5, 15, 3, 0, 0);
    hhmmToDate('13:00', base);
    expect(base.getHours()).toBe(3);
  });

  it('zeroes out seconds and milliseconds', () => {
    const base = new Date(2025, 5, 15, 3, 0, 45, 123);
    const result = hhmmToDate('09:15', base);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('handles midnight and the last minute of the day', () => {
    const base = new Date(2025, 5, 15, 12, 0, 0);
    expect(hhmmToDate('00:00', base).getHours()).toBe(0);
    expect(hhmmToDate('00:00', base).getDate()).toBe(15);
    expect(hhmmToDate('23:59', base).getHours()).toBe(23);
    expect(hhmmToDate('23:59', base).getMinutes()).toBe(59);
  });
});

describe('formatHHMM', () => {
  it('formats a morning time', () => {
    expect(formatHHMM('08:00')).toBe('8:00 AM');
  });

  it('formats an afternoon time', () => {
    expect(formatHHMM('13:00')).toBe('1:00 PM');
  });

  it('formats midnight and noon', () => {
    expect(formatHHMM('00:00')).toBe('12:00 AM');
    expect(formatHHMM('12:00')).toBe('12:00 PM');
  });

  it('formats 24-hour when asked, zero-padded', () => {
    expect(formatHHMM('08:00', true)).toBe('08:00');
    expect(formatHHMM('13:00', true)).toBe('13:00');
    expect(formatHHMM('23:59', true)).toBe('23:59');
  });

  // The two times 12-hour notation handles specially are the two a 24-hour
  // clock renders most plainly, so they're the ones worth pinning.
  it('formats midnight as 00:00 and noon as 12:00 in 24-hour', () => {
    expect(formatHHMM('00:00', true)).toBe('00:00');
    expect(formatHHMM('12:00', true)).toBe('12:00');
  });

  it('stays 12-hour when the preference is not passed', () => {
    expect(formatHHMM('13:00')).toBe('1:00 PM');
    expect(formatHHMM('13:00', false)).toBe('1:00 PM');
  });
});

describe('clockTimeToken', () => {
  it('picks the format string matching the preference', () => {
    expect(clockTimeToken(false)).toBe('h:mm a');
    expect(clockTimeToken(true)).toBe('HH:mm');
  });

  it('defaults to 12-hour', () => {
    expect(clockTimeToken()).toBe('h:mm a');
  });
});

describe('dateToHHMM', () => {
  it('formats a Date back into "HH:MM"', () => {
    expect(dateToHHMM(new Date(2025, 5, 10, 8, 5, 0))).toBe('08:05');
    expect(dateToHHMM(new Date(2025, 5, 10, 13, 0, 0))).toBe('13:00');
  });

  it('zero-pads both halves', () => {
    expect(dateToHHMM(new Date(2025, 5, 10, 0, 0, 0))).toBe('00:00');
    expect(dateToHHMM(new Date(2025, 5, 10, 9, 9, 0))).toBe('09:09');
    expect(dateToHHMM(new Date(2025, 5, 10, 23, 59, 0))).toBe('23:59');
  });

  it('ignores seconds rather than rounding on them', () => {
    expect(dateToHHMM(new Date(2025, 5, 10, 10, 30, 59))).toBe('10:30');
  });

  it('round-trips with hhmmToDate, midnight and noon included', () => {
    for (const hhmm of ['00:00', '09:45', '12:00', '13:07', '23:59']) {
      expect(dateToHHMM(hhmmToDate(hhmm))).toBe(hhmm);
    }
  });

  it('round-trips across a DST boundary', () => {
    // Mar 9 2025: US clocks spring forward at 2 AM. A time on either side
    // still round-trips (2:xx AM itself doesn't exist and isn't asserted).
    const springForward = new Date(2025, 2, 9, 12, 0, 0);
    for (const hhmm of ['01:30', '03:30', '23:00']) {
      expect(dateToHHMM(hhmmToDate(hhmm, springForward))).toBe(hhmm);
    }
    const fallBack = new Date(2025, 10, 2, 12, 0, 0);
    for (const hhmm of ['00:30', '01:30', '03:00']) {
      expect(dateToHHMM(hhmmToDate(hhmm, fallBack))).toBe(hhmm);
    }
  });
});

describe('effectiveWindowEndTime', () => {
  it('returns the end when it is after the start', () => {
    expect(effectiveWindowEndTime('09:00', '17:00')).toBe('17:00');
  });

  it('passes an end with no start through', () => {
    expect(effectiveWindowEndTime(null, '17:00')).toBe('17:00');
    expect(effectiveWindowEndTime('09:00', null)).toBeNull();
  });

  // Under a midnight reset "22:00–02:00" runs into the small hours, which the
  // single logical day both gates anchor to can't hold: open-ended.
  it('is open-ended when the end is not after the start', () => {
    expect(effectiveWindowEndTime('22:00', '02:00')).toBeNull();
    expect(effectiveWindowEndTime('09:00', '09:00')).toBeNull();
  });

  // "After" is measured from dayResetTime, because onLogicalDay rolls a clock
  // time earlier than the reset onto the next date. Under a 4 AM reset the
  // overnight window closes six hours after it opens, and it is "03:00–05:00"
  // that inverts: its start rolls to tomorrow while its end stays on today.
  // Compared as raw minutes the second kept its end and was expired all day.
  it('measures "after the start" from dayResetTime', () => {
    expect(effectiveWindowEndTime('22:00', '02:00', '04:00')).toBe('02:00');
    expect(effectiveWindowEndTime('03:00', '05:00', '04:00')).toBeNull();
    expect(effectiveWindowEndTime('09:00', '17:00', '04:00')).toBe('17:00');
  });
});

describe('onLogicalDay (clock time on a logical day)', () => {
  const dayStart = new Date(2026, 7, 26, 4, 0); // a day that starts at 04:00

  it('places a time after the reset on the day start\'s own date', () => {
    expect(onLogicalDay(dayStart, '09:30')).toEqual(new Date(2026, 7, 26, 9, 30));
    expect(onLogicalDay(dayStart, '04:00')).toEqual(dayStart);
  });

  // The small hours belong to the end of the logical day, not the morning
  // before it began.
  it('rolls a time earlier than the reset onto the next date', () => {
    expect(onLogicalDay(dayStart, '01:00')).toEqual(new Date(2026, 7, 27, 1, 0));
    expect(onLogicalDay(dayStart, '03:59')).toEqual(new Date(2026, 7, 27, 3, 59));
  });

  it('is the plain clock time under a midnight reset', () => {
    const midnight = new Date(2026, 7, 26, 0, 0);
    expect(onLogicalDay(midnight, '01:00')).toEqual(new Date(2026, 7, 26, 1, 0));
  });
});

describe('carryClockTime', () => {
  // A 1 AM reminder on a task due logical Aug 20 (under a 4 AM reset) fires at
  // Aug 21 01:00; carried onto a due date of Aug 27 it is Aug 28 01:00, not
  // Aug 27 01:00, which is still logical Aug 26.
  it('keeps a small-hours reminder at the end of its new day', () => {
    const original = new Date(2026, 7, 21, 1, 0);
    const due = new Date(2026, 7, 27, 12, 0);
    expect(carryClockTime(due, original, '04:00')).toEqual(new Date(2026, 7, 28, 1, 0));
  });

  it('copies a daytime reminder onto the new date', () => {
    const original = new Date(2026, 7, 20, 17, 30);
    const due = new Date(2026, 7, 27, 12, 0);
    expect(carryClockTime(due, original, '04:00')).toEqual(new Date(2026, 7, 27, 17, 30));
    expect(carryClockTime(due, original, '00:00')).toEqual(new Date(2026, 7, 27, 17, 30));
  });
});
