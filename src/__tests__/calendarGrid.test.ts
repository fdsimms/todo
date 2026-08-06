import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { buildCalendarGrid } from '../utils/calendarGrid';

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
});
