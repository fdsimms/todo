import { parseNaturalDate } from '../utils/parseNaturalDate';

// Tuesday, June 10 2025, 10:00 AM
const NOW = new Date(2025, 5, 10, 10, 0, 0);

const parse = (input: string) => parseNaturalDate(input, NOW);

describe('parseNaturalDate', () => {
  describe('invalid / unparseable input', () => {
    it('returns null for empty input', () => {
      expect(parse('')).toBeNull();
      expect(parse('   ')).toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(parse('asdfghjkl')).toBeNull();
      expect(parse('do the thing')).toBeNull();
    });
  });

  describe('keywords', () => {
    it('parses "today" at the default hour', () => {
      const d = parse('today')!;
      expect(d.getDate()).toBe(10);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(0);
    });

    it('parses "tomorrow"', () => {
      const d = parse('tomorrow')!;
      expect(d.getDate()).toBe(11);
      expect(d.getHours()).toBe(9);
    });

    it('parses "tonight" at 8 PM', () => {
      const d = parse('tonight')!;
      expect(d.getDate()).toBe(10);
      expect(d.getHours()).toBe(20);
    });

    it('parses shorthand "tmrw"', () => {
      expect(parse('tmrw')!.getDate()).toBe(11);
    });
  });

  describe('time of day', () => {
    it('parses "tomorrow at 3pm"', () => {
      const d = parse('tomorrow at 3pm')!;
      expect(d.getDate()).toBe(11);
      expect(d.getHours()).toBe(15);
      expect(d.getMinutes()).toBe(0);
    });

    it('parses "tomorrow at 3:30pm"', () => {
      const d = parse('tomorrow at 3:30pm')!;
      expect(d.getHours()).toBe(15);
      expect(d.getMinutes()).toBe(30);
    });

    it('parses "today at 5" via am/pm-less time only when am/pm given', () => {
      // bare "5" is not a time; "5pm" is
      const d = parse('today at 5pm')!;
      expect(d.getHours()).toBe(17);
    });

    it('parses 24-hour "tomorrow 15:00"', () => {
      const d = parse('tomorrow 15:00')!;
      expect(d.getDate()).toBe(11);
      expect(d.getHours()).toBe(15);
    });

    it('parses "noon" and "midnight"', () => {
      expect(parse('tomorrow at noon')!.getHours()).toBe(12);
      expect(parse('tomorrow at midnight')!.getHours()).toBe(0);
    });

    it('parses "12pm" as noon and "12am" as midnight', () => {
      expect(parse('tomorrow 12pm')!.getHours()).toBe(12);
      expect(parse('tomorrow 12am')!.getHours()).toBe(0);
    });

    it('rolls a bare past time to tomorrow', () => {
      // NOW is 10 AM, so "9am" has passed → tomorrow
      const d = parse('9am')!;
      expect(d.getDate()).toBe(11);
      expect(d.getHours()).toBe(9);
    });

    it('keeps a bare future time today', () => {
      const d = parse('3pm')!;
      expect(d.getDate()).toBe(10);
      expect(d.getHours()).toBe(15);
    });
  });

  describe('day parts', () => {
    it('parses "tomorrow morning"', () => {
      const d = parse('tomorrow morning')!;
      expect(d.getDate()).toBe(11);
      expect(d.getHours()).toBe(9);
    });

    it('parses "tomorrow evening"', () => {
      expect(parse('tomorrow evening')!.getHours()).toBe(18);
    });
  });

  describe('relative offsets', () => {
    it('parses "in 3 days"', () => {
      const d = parse('in 3 days')!;
      expect(d.getDate()).toBe(13);
    });

    it('parses "in 2 weeks"', () => {
      const d = parse('in 2 weeks')!;
      expect(d.getDate()).toBe(24);
    });

    it('parses "in 1 hour" preserving the clock time', () => {
      const d = parse('in 1 hour')!;
      expect(d.getDate()).toBe(10);
      expect(d.getHours()).toBe(11);
      expect(d.getMinutes()).toBe(0);
    });

    it('parses "in 30 minutes"', () => {
      const d = parse('in 30 minutes')!;
      expect(d.getHours()).toBe(10);
      expect(d.getMinutes()).toBe(30);
    });

    it('parses "in a week"', () => {
      const d = parse('in a week')!;
      expect(d.getDate()).toBe(17);
    });

    it('parses "in 1 month"', () => {
      const d = parse('in 1 month')!;
      expect(d.getMonth()).toBe(6); // July
      expect(d.getDate()).toBe(10);
    });
  });

  describe('next week/month/year', () => {
    it('parses "next week"', () => {
      expect(parse('next week')!.getDate()).toBe(17);
    });

    it('parses "next month"', () => {
      const d = parse('next month')!;
      expect(d.getMonth()).toBe(6);
    });

    it('parses "next year"', () => {
      expect(parse('next year')!.getFullYear()).toBe(2026);
    });
  });

  describe('weekdays', () => {
    it('parses upcoming "thursday" (2 days ahead)', () => {
      // Tuesday → Thursday is +2
      const d = parse('thursday')!;
      expect(d.getDate()).toBe(12);
      expect(d.getDay()).toBe(4);
    });

    it('parses "monday" as the next upcoming Monday', () => {
      const d = parse('monday')!;
      expect(d.getDate()).toBe(16);
      expect(d.getDay()).toBe(1);
    });

    it('treats "next friday" as the following week', () => {
      // This week's Friday (June 13) is in the same week → next friday = June 20
      const d = parse('next friday')!;
      expect(d.getDate()).toBe(20);
      expect(d.getDay()).toBe(5);
    });

    it('parses a weekday with a time, e.g. "friday 9am"', () => {
      const d = parse('friday 9am')!;
      expect(d.getDate()).toBe(13);
      expect(d.getHours()).toBe(9);
    });

    it('parses abbreviations, e.g. "next mon"', () => {
      const d = parse('next mon')!;
      expect(d.getDay()).toBe(1);
      expect(d.getDate()).toBe(16);
    });
  });

  describe('weekend', () => {
    it('parses "this weekend" as the upcoming Saturday', () => {
      const d = parse('this weekend')!;
      expect(d.getDay()).toBe(6);
      expect(d.getDate()).toBe(14);
    });
  });

  describe('explicit dates', () => {
    it('parses "jun 15"', () => {
      const d = parse('jun 15')!;
      expect(d.getMonth()).toBe(5);
      expect(d.getDate()).toBe(15);
    });

    it('parses "june 15 2026"', () => {
      const d = parse('june 15 2026')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(5);
      expect(d.getDate()).toBe(15);
    });

    it('parses "15 jun"', () => {
      const d = parse('15 jun')!;
      expect(d.getMonth()).toBe(5);
      expect(d.getDate()).toBe(15);
    });

    it('rolls a past month/day to next year', () => {
      // NOW is June 10 → "jan 5" should be 2026
      const d = parse('jan 5')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(5);
    });

    it('parses ISO "2026-12-25"', () => {
      const d = parse('2026-12-25')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
    });

    it('parses numeric "12/25"', () => {
      const d = parse('12/25')!;
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
    });

    it('parses numeric "12/25/2026"', () => {
      const d = parse('12/25/2026')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
    });

    it('rejects an impossible date like "feb 31"', () => {
      expect(parse('feb 31')).toBeNull();
    });

    it('combines an explicit date with a time, e.g. "dec 25 at 6pm"', () => {
      const d = parse('dec 25 at 6pm')!;
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(25);
      expect(d.getHours()).toBe(18);
    });
  });

  describe('robustness', () => {
    it('is case-insensitive and tolerant of extra whitespace', () => {
      const d = parse('  Tomorrow   At   3 PM ')!;
      expect(d.getDate()).toBe(11);
      expect(d.getHours()).toBe(15);
    });
  });
});
