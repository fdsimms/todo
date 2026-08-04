import { parseTaskInput, describeSchedule, type ParsedSchedule } from '../utils/parseTaskInput';

// Tuesday, June 10 2025, 10:00 AM — same anchor as parseNaturalDate.test.ts
const NOW = new Date(2025, 5, 10, 10, 0, 0);

function expectDay(date: Date, year: number, month: number, day: number) {
  expect(date.getFullYear()).toBe(year);
  expect(date.getMonth()).toBe(month);
  expect(date.getDate()).toBe(day);
}

describe('parseTaskInput — one-off dates', () => {
  it('extracts a trailing "on <weekday>" phrase', () => {
    const r = parseTaskInput('go for a run on tuesday', NOW)!;
    expect(r.cleanTitle).toBe('go for a run');
    expect(r.matchedText).toBe('on tuesday');
    expect(r.schedule.recurrenceType).toBe('none');
    expectDay(r.schedule.dueDate, 2025, 5, 17); // strictly-next Tuesday
    expect(r.schedule.timeSegments).toEqual([]);
  });

  it('parses a bare trailing "tomorrow"', () => {
    const r = parseTaskInput('call mom tomorrow', NOW)!;
    expect(r.cleanTitle).toBe('call mom');
    expectDay(r.schedule.dueDate, 2025, 5, 11);
  });

  it('parses "by <weekday>"', () => {
    const r = parseTaskInput('finish report by friday', NOW)!;
    expect(r.cleanTitle).toBe('finish report');
    expectDay(r.schedule.dueDate, 2025, 5, 13);
  });

  it('parses an explicit month-day date', () => {
    const r = parseTaskInput('pay bills jun 15', NOW)!;
    expect(r.cleanTitle).toBe('pay bills');
    expectDay(r.schedule.dueDate, 2025, 5, 15);
  });

  it('parses "in N units"', () => {
    const r = parseTaskInput('dentist in 2 weeks', NOW)!;
    expect(r.cleanTitle).toBe('dentist');
    expectDay(r.schedule.dueDate, 2025, 5, 24);
  });

  it('maps a clock time to a segment, due today', () => {
    const r = parseTaskInput('standup at 9am', NOW)!;
    expect(r.cleanTitle).toBe('standup');
    expectDay(r.schedule.dueDate, 2025, 5, 10);
    expect(r.schedule.timeSegments).toEqual(['morning']);
  });

  it('maps "tomorrow at 3pm" to tomorrow + afternoon segment', () => {
    const r = parseTaskInput('dentist tomorrow at 3pm', NOW)!;
    expectDay(r.schedule.dueDate, 2025, 5, 11);
    expect(r.schedule.timeSegments).toEqual(['afternoon']);
  });

  it('maps day-part words to segments', () => {
    const r = parseTaskInput('mow lawn saturday morning', NOW)!;
    expect(r.cleanTitle).toBe('mow lawn');
    expectDay(r.schedule.dueDate, 2025, 5, 14);
    expect(r.schedule.timeSegments).toEqual(['morning']);
  });

  it('maps "tonight" to today + evening segment', () => {
    const r = parseTaskInput('take out trash tonight', NOW)!;
    expectDay(r.schedule.dueDate, 2025, 5, 10);
    expect(r.schedule.timeSegments).toEqual(['evening']);
  });

  it('anchors due dates at noon so they stay in the intended logical day', () => {
    // Midnight due dates get reassigned to the previous logical day by
    // getDayStart when dayResetTime is after midnight; noon is immune.
    const r = parseTaskInput('call mom tomorrow', NOW)!;
    expect(r.schedule.dueDate.getHours()).toBe(12);
    expect(r.schedule.dueDate.getMinutes()).toBe(0);

    const rec = parseTaskInput('stretch every tuesday', NOW)!;
    expect(rec.schedule.dueDate.getHours()).toBe(12);
  });

  it('"tomorrow" resolves to the next logical day, not two calendar days out', () => {
    // Regression: with dayResetTime "02:00", typing "tomorrow" at 1:30 AM on
    // June 11 (still logical June 10, per getLogicalNow) previously resolved
    // against the raw wall clock (June 11) and landed on June 12 — two days
    // out instead of one.
    const logicalNow = new Date(2025, 5, 10, 1, 30, 0); // wall clock June 11 1:30 AM, rolled back
    const r = parseTaskInput('call mom tomorrow', logicalNow)!;
    expectDay(r.schedule.dueDate, 2025, 5, 11);
  });

  it('always lands a bare weekday on that weekday', () => {
    // Regression: "Run Sunday" must never resolve to a Saturday.
    const thursday = new Date(2026, 5, 11, 10, 0, 0); // Thu, Jun 11 2026
    const r = parseTaskInput('Run Sunday', thursday)!;
    expect(r.cleanTitle).toBe('Run');
    expectDay(r.schedule.dueDate, 2026, 5, 14);
    expect(r.schedule.dueDate.getDay()).toBe(0);
  });

  it('reports where the matched phrase starts', () => {
    expect(parseTaskInput('go for a run on tuesday', NOW)!.matchStart).toBe(13);
    expect(parseTaskInput('review tuesday notes on friday', NOW)!.matchStart).toBe(21);
  });

  it('matches only the rightmost phrase', () => {
    const r = parseTaskInput('review tuesday notes on friday', NOW)!;
    expect(r.cleanTitle).toBe('review tuesday notes');
    expect(r.matchedText).toBe('on friday');
    expectDay(r.schedule.dueDate, 2025, 5, 13);
  });

  it('preserves original casing in cleanTitle and matchedText', () => {
    const r = parseTaskInput('Go for a run on Tuesday', NOW)!;
    expect(r.cleanTitle).toBe('Go for a run');
    expect(r.matchedText).toBe('on Tuesday');
  });

  it('trims trailing punctuation from the title', () => {
    const r = parseTaskInput('buy milk, tomorrow', NOW)!;
    expect(r.cleanTitle).toBe('buy milk');
  });
});

describe('parseTaskInput — false positives', () => {
  it.each([
    'discuss may budget',
    'email tuesday the dog',
    'walk the dog mon', // bare ambiguous abbreviation needs a connector
    'polish the sun',
    'ask tom',
    'feed the chickens',
    'buy groceries',
  ])('does not match %j', input => {
    expect(parseTaskInput(input, NOW)).toBeNull();
  });

  it('accepts an abbreviated weekday with a connector', () => {
    const r = parseTaskInput('pick up package on wed', NOW)!;
    expect(r.cleanTitle).toBe('pick up package');
    expectDay(r.schedule.dueDate, 2025, 5, 11);
  });

  it('returns null when the whole input is a schedule phrase', () => {
    expect(parseTaskInput('tomorrow', NOW)).toBeNull();
    expect(parseTaskInput('on tuesday', NOW)).toBeNull();
    expect(parseTaskInput('every tuesday', NOW)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseTaskInput('', NOW)).toBeNull();
  });
});

describe('parseTaskInput — recurrence', () => {
  it('parses "every N days"', () => {
    const r = parseTaskInput('water plants every 3 days', NOW)!;
    expect(r.cleanTitle).toBe('water plants');
    expect(r.schedule.recurrenceType).toBe('daily');
    expect(r.schedule.recurrenceInterval).toBe(3);
    expectDay(r.schedule.dueDate, 2025, 5, 10); // anchors today
  });

  it('parses a weekday list with "every"', () => {
    const r = parseTaskInput('gym every mon and wed', NOW)!;
    expect(r.schedule.recurrenceType).toBe('weekly');
    expect(r.schedule.recurrenceDays).toEqual([1, 3]);
    expectDay(r.schedule.dueDate, 2025, 5, 11); // today is Tue → first match is Wed
  });

  it('first occurrence includes today when its weekday matches', () => {
    const r = parseTaskInput('stretch every tuesday', NOW)!;
    expect(r.schedule.recurrenceDays).toEqual([2]);
    expectDay(r.schedule.dueDate, 2025, 5, 10);
  });

  it('parses frequency words', () => {
    expect(parseTaskInput('pay rent monthly', NOW)!.schedule.recurrenceType).toBe('monthly');
    expect(parseTaskInput('review goals weekly', NOW)!.schedule.recurrenceType).toBe('weekly');
    expect(parseTaskInput('renew passport yearly', NOW)!.schedule.recurrenceType).toBe('yearly');
    expect(parseTaskInput('rebalance portfolio annually', NOW)!.schedule.recurrenceType).toBe('yearly');
    expect(parseTaskInput('tidy desk daily', NOW)!.schedule.recurrenceType).toBe('daily');
  });

  it('parses plural weekdays without "every"', () => {
    const r = parseTaskInput('laundry tuesdays', NOW)!;
    expect(r.schedule.recurrenceType).toBe('weekly');
    expect(r.schedule.recurrenceDays).toEqual([2]);
    expectDay(r.schedule.dueDate, 2025, 5, 10);
  });

  it('parses plural weekday lists', () => {
    const r = parseTaskInput('call grandma mondays and thursdays', NOW)!;
    expect(r.schedule.recurrenceDays).toEqual([1, 4]);
    expectDay(r.schedule.dueDate, 2025, 5, 12); // Thu is first upcoming
  });

  it('rejects plural abbreviations without "every"', () => {
    expect(parseTaskInput('fix the mons', NOW)).toBeNull();
  });

  it('parses slash-separated weekday lists', () => {
    const r = parseTaskInput('team sync every tue/thu', NOW)!;
    expect(r.schedule.recurrenceDays).toEqual([2, 4]);
  });

  it('parses "every other week" and "every other tuesday"', () => {
    const week = parseTaskInput('review goals every other week', NOW)!;
    expect(week.schedule.recurrenceType).toBe('weekly');
    expect(week.schedule.recurrenceInterval).toBe(2);
    expect(week.schedule.recurrenceDays).toEqual([]);

    const tue = parseTaskInput('water plants every other tuesday', NOW)!;
    expect(tue.schedule.recurrenceInterval).toBe(2);
    expect(tue.schedule.recurrenceDays).toEqual([2]);
  });

  it('parses "every weekday" and "every weekend"', () => {
    const wd = parseTaskInput('fill timesheet every weekday', NOW)!;
    expect(wd.schedule.recurrenceDays).toEqual([1, 2, 3, 4, 5]);
    expectDay(wd.schedule.dueDate, 2025, 5, 10);

    const we = parseTaskInput('hike every weekend', NOW)!;
    expect(we.schedule.recurrenceDays).toEqual([0, 6]);
    expectDay(we.schedule.dueDate, 2025, 5, 14); // Saturday
  });

  it('maps "every morning" to daily + morning segment', () => {
    const r = parseTaskInput('meditate every morning', NOW)!;
    expect(r.schedule.recurrenceType).toBe('daily');
    expect(r.schedule.timeSegments).toEqual(['morning']);
  });

  it('maps a trailing time on a recurrence to a segment', () => {
    const r = parseTaskInput('journal every night at 10pm', NOW)!;
    expect(r.cleanTitle).toBe('journal');
    expect(r.schedule.recurrenceType).toBe('daily');
    expect(r.schedule.timeSegments).toEqual(['evening']);

    const tue = parseTaskInput('trash out every tuesday at 6pm', NOW)!;
    expect(tue.schedule.recurrenceDays).toEqual([2]);
    expect(tue.schedule.timeSegments).toEqual(['evening']);
  });

  it('rejects out-of-scope recurrence grammar', () => {
    expect(parseTaskInput('pay rent biweekly', NOW)).toBeNull();
    expect(parseTaskInput('check mail fortnightly', NOW)).toBeNull();
  });
});

describe('describeSchedule', () => {
  const base: ParsedSchedule = {
    dueDate: new Date(2025, 5, 10),
    timeSegments: [],
    recurrenceType: 'none',
    recurrenceInterval: 1,
    recurrenceDays: [],
  };

  it('labels one-off dates', () => {
    expect(describeSchedule(base, NOW)).toBe('Today');
    expect(describeSchedule({ ...base, dueDate: new Date(2025, 5, 11) }, NOW)).toBe('Tomorrow');
    expect(describeSchedule({ ...base, dueDate: new Date(2025, 5, 17) }, NOW)).toBe('Tue, Jun 17');
  });

  it('labels recurrences', () => {
    expect(describeSchedule({ ...base, recurrenceType: 'daily' }, NOW)).toBe('Daily');
    expect(describeSchedule({ ...base, recurrenceType: 'daily', recurrenceInterval: 3 }, NOW)).toBe('Every 3 days');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly' }, NOW)).toBe('Weekly');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly', recurrenceInterval: 2 }, NOW)).toBe('Every other week');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly', recurrenceDays: [2] }, NOW)).toBe('Every Tuesday');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly', recurrenceDays: [1, 3] }, NOW)).toBe('Every Mon & Wed');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly', recurrenceDays: [1, 3, 5] }, NOW)).toBe('Every Mon, Wed & Fri');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly', recurrenceDays: [1, 2, 3, 4, 5] }, NOW)).toBe('Every weekday');
    expect(describeSchedule({ ...base, recurrenceType: 'weekly', recurrenceDays: [0, 6] }, NOW)).toBe('Every weekend');
    expect(describeSchedule({ ...base, recurrenceType: 'monthly' }, NOW)).toBe('Monthly');
    expect(describeSchedule({ ...base, recurrenceType: 'yearly' }, NOW)).toBe('Yearly');
  });

  it('appends the time segment', () => {
    expect(describeSchedule({ ...base, recurrenceType: 'daily', timeSegments: ['morning'] }, NOW)).toBe('Daily · morning');
    expect(describeSchedule({ ...base, timeSegments: ['evening'] }, NOW)).toBe('Today · evening');
  });
});
