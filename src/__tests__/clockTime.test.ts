import { hhmmToDate, formatHHMM, dateToHHMM, clockTimeToken } from '../utils/clockTime';

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
