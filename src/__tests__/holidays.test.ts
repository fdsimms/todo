import {
  holidaysInYear, holidayOn, hasAnyHolidays, nextHoliday, parseHolidaySet, parseCustomHolidays,
} from '../utils/holidays';

const keys = (year: number) => holidaysInYear('us', year).map(h => h.dayKey);

describe('US federal holidays', () => {
  it('lands every rule-based date in 2026', () => {
    expect(holidaysInYear('us', 2026)).toEqual([
      { dayKey: '2026-01-01', name: "New Year’s Day" },
      { dayKey: '2026-01-19', name: 'Martin Luther King Jr. Day' },
      { dayKey: '2026-02-16', name: "Presidents’ Day" },
      { dayKey: '2026-05-25', name: 'Memorial Day' },
      { dayKey: '2026-06-19', name: 'Juneteenth' },
      { dayKey: '2026-07-03', name: 'Independence Day (observed)' },
      { dayKey: '2026-07-04', name: 'Independence Day' },
      { dayKey: '2026-09-07', name: 'Labor Day' },
      { dayKey: '2026-10-12', name: 'Columbus Day' },
      { dayKey: '2026-11-11', name: 'Veterans Day' },
      { dayKey: '2026-11-26', name: 'Thanksgiving' },
      { dayKey: '2026-12-25', name: 'Christmas Day' },
    ]);
  });

  it('observes a Saturday holiday on the Friday and a Sunday one on the Monday', () => {
    // 2027: Juneteenth is a Saturday, July 4th a Sunday, Christmas a Saturday.
    expect(keys(2027)).toEqual(expect.arrayContaining([
      '2027-06-18', '2027-06-19', '2027-07-04', '2027-07-05', '2027-12-24', '2027-12-25',
    ]));
  });

  it('puts a Saturday New Year\'s Day\'s observed Friday in the year before', () => {
    // Jan 1, 2022 was a Saturday.
    expect(keys(2021)).toContain('2021-12-31');
    expect(keys(2022)).toContain('2022-01-01');
    expect(keys(2022)).not.toContain('2021-12-31');
  });

  it('has no Juneteenth before it became a federal holiday', () => {
    expect(keys(2020).some(k => k.endsWith('-06-19'))).toBe(false);
  });

  it('has nothing in the empty set', () => {
    expect(holidaysInYear('none', 2026)).toEqual([]);
  });
});

describe('holidayOn', () => {
  const us = { set: 'us' as const, custom: ['2026-11-27'] };

  it('names a built-in holiday, then a day of the user\'s own', () => {
    expect(holidayOn('2026-11-26', us)).toBe('Thanksgiving');
    expect(holidayOn('2026-11-27', us)).toBe('Day off');
    expect(holidayOn('2026-11-25', us)).toBeNull();
  });

  it('reads only the custom days with no built-in set', () => {
    expect(holidayOn('2026-11-26', { set: 'none', custom: [] })).toBeNull();
    expect(holidayOn('2026-11-27', { set: 'none', custom: ['2026-11-27'] })).toBe('Day off');
  });

  it('knows when there is nothing to skip at all', () => {
    expect(hasAnyHolidays({ set: 'none', custom: [] })).toBe(false);
    expect(hasAnyHolidays({ set: 'none', custom: ['2026-11-27'] })).toBe(true);
    expect(hasAnyHolidays({ set: 'us', custom: [] })).toBe(true);
  });

  it('finds the next one, across a year end', () => {
    expect(nextHoliday('2026-11-12', us)).toEqual({ dayKey: '2026-11-26', name: 'Thanksgiving' });
    expect(nextHoliday('2026-12-26', { set: 'us', custom: [] })).toEqual({ dayKey: '2027-01-01', name: "New Year’s Day" });
    expect(nextHoliday('2026-12-26', { set: 'none', custom: [] })).toBeNull();
  });
});

describe('stored settings', () => {
  it('defaults the set to US and refuses an unknown one', () => {
    expect(parseHolidaySet(null)).toBe('us');
    expect(parseHolidaySet('none')).toBe('none');
    expect(parseHolidaySet('mars')).toBe('us');
  });

  it('keeps only well-formed day keys, sorted and once each', () => {
    expect(parseCustomHolidays('["2026-12-24","nope","2026-11-27","2026-12-24",5]')).toEqual(['2026-11-27', '2026-12-24']);
    expect(parseCustomHolidays('not json')).toEqual([]);
    expect(parseCustomHolidays(null)).toEqual([]);
  });
});
