import { parseTaskInput, describeSchedule, parseLinkInput, parsePhoneInput, parseDurationInput, parseCategoryInput, parseFromCompletionSuffix, type ParsedSchedule } from '../utils/parseTaskInput';

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

  it('parses "by <weekday>", mirroring the date onto deadline too', () => {
    const r = parseTaskInput('finish report by friday', NOW)!;
    expect(r.cleanTitle).toBe('finish report');
    expectDay(r.schedule.dueDate, 2025, 5, 13);
    expectDay(r.schedule.deadline!, 2025, 5, 13);
  });

  it('parses "due <weekday>" the same way as "by"', () => {
    const r = parseTaskInput('finish report due friday', NOW)!;
    expectDay(r.schedule.dueDate, 2025, 5, 13);
    expectDay(r.schedule.deadline!, 2025, 5, 13);
  });

  it('does not set deadline for "on <weekday>"', () => {
    const r = parseTaskInput('go for a run on tuesday', NOW)!;
    expect(r.schedule.deadline).toBeUndefined();
  });

  it('does not set deadline for a bare date phrase with no connector', () => {
    const r = parseTaskInput('call mom tomorrow', NOW)!;
    expect(r.schedule.deadline).toBeUndefined();
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

  it('parses "N units from now"', () => {
    const r = parseTaskInput('return fiddle by 45 days from now', NOW)!;
    expect(r.cleanTitle).toBe('return fiddle');
    expectDay(r.schedule.dueDate, 2025, 6, 25); // July 25
  });

  it('parses spelled-out counts in "in N units"', () => {
    const r = parseTaskInput('dentist in three months', NOW)!;
    expect(r.cleanTitle).toBe('dentist');
    expect(r.schedule.dueDate.getMonth()).toBe(8); // September
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

  it('maps interval synonyms', () => {
    const biweekly = parseTaskInput('pay rent biweekly', NOW)!;
    expect(biweekly.schedule.recurrenceType).toBe('weekly');
    expect(biweekly.schedule.recurrenceInterval).toBe(2);

    const fortnightly = parseTaskInput('check mail fortnightly', NOW)!;
    expect(fortnightly.schedule.recurrenceType).toBe('weekly');
    expect(fortnightly.schedule.recurrenceInterval).toBe(2);

    const quarterly = parseTaskInput('review budget quarterly', NOW)!;
    expect(quarterly.schedule.recurrenceType).toBe('monthly');
    expect(quarterly.schedule.recurrenceInterval).toBe(3);

    const biannually = parseTaskInput('dentist biannually', NOW)!;
    expect(biannually.schedule.recurrenceType).toBe('monthly');
    expect(biannually.schedule.recurrenceInterval).toBe(6);

    const twiceAYear = parseTaskInput('eye exam twice a year', NOW)!;
    expect(twiceAYear.schedule.recurrenceType).toBe('monthly');
    expect(twiceAYear.schedule.recurrenceInterval).toBe(6);
  });

  it('maps a specific annual date to yearly recurrence anchored to that date', () => {
    const r = parseTaskInput('go running every september 15th', NOW)!;
    expect(r.cleanTitle).toBe('go running');
    expect(r.schedule.recurrenceType).toBe('yearly');
    expect(r.schedule.recurrenceInterval).toBe(1);
    expectDay(r.schedule.dueDate, 2025, 8, 15);

    // Already past this year → rolls to next year.
    const past = parseTaskInput('renew passport every january 1', NOW)!;
    expectDay(past.schedule.dueDate, 2026, 0, 1);

    const yearlyOn = parseTaskInput('review lease yearly on june 1', NOW)!;
    expect(yearlyOn.schedule.recurrenceType).toBe('yearly');
    expectDay(yearlyOn.schedule.dueDate, 2026, 5, 1); // June 1 already passed this year
  });

  it('maps a fixed day-of-month to monthly recurrence with recurrenceMonthDay', () => {
    const a = parseTaskInput('pay rent on the 1st of every month', NOW)!;
    expect(a.schedule.recurrenceType).toBe('monthly');
    expect(a.schedule.recurrenceMonthDay).toBe(1);
    expectDay(a.schedule.dueDate, 2025, 6, 1); // 1st already passed this month

    const b = parseTaskInput('pay bills every month on the 15th', NOW)!;
    expect(b.schedule.recurrenceMonthDay).toBe(15);
    expectDay(b.schedule.dueDate, 2025, 5, 15);

    const c = parseTaskInput('reconcile monthly on the last day', NOW)!;
    expect(c.schedule.recurrenceMonthDay).toBe(-1);
    expectDay(c.schedule.dueDate, 2025, 5, 30);
  });

  it('maps an Nth-weekday-of-month phrase to monthly + recurrenceWeekOrdinal', () => {
    const a = parseTaskInput('team sync every 2nd tuesday', NOW)!;
    expect(a.schedule.recurrenceType).toBe('monthly');
    expect(a.schedule.recurrenceWeekOrdinal).toBe(2);
    expect(a.schedule.recurrenceDays).toEqual([2]);
    expectDay(a.schedule.dueDate, 2025, 5, 10); // 2nd Tuesday of June 2025 is the 10th

    const b = parseTaskInput('board meeting every last friday of the month', NOW)!;
    expect(b.schedule.recurrenceWeekOrdinal).toBe(-1);
    expect(b.schedule.recurrenceDays).toEqual([5]);
    expectDay(b.schedule.dueDate, 2025, 5, 27); // last Friday of June 2025

    const c = parseTaskInput('review first monday of every month', NOW)!;
    expect(c.schedule.recurrenceWeekOrdinal).toBe(1);
    expect(c.schedule.recurrenceDays).toEqual([1]);
  });

  it('applies a "starting <date>" clause as the anchor due date', () => {
    const r = parseTaskInput('water plants every 2 weeks starting next friday', NOW)!;
    expect(r.schedule.recurrenceType).toBe('weekly');
    expect(r.schedule.recurrenceInterval).toBe(2);
    expectDay(r.schedule.dueDate, 2025, 5, 20); // next Friday from Jun 10 2025 (a Tuesday; "next" skips this week's Friday)
  });

  it('maps "after completion" to recurrenceFromCompletion', () => {
    const r = parseTaskInput('water plants every 3 days after completion', NOW)!;
    expect(r.schedule.recurrenceFromCompletion).toBe(true);

    const r2 = parseTaskInput('journal daily after i finish it', NOW)!;
    expect(r2.schedule.recurrenceFromCompletion).toBe(true);
  });

  it('maps an "until <date>" clause to recurrenceEndDate', () => {
    const r = parseTaskInput('gym every monday until december', NOW)!;
    expect(r.schedule.recurrenceType).toBe('weekly');
    expect(r.schedule.recurrenceEndDate).not.toBeNull();
    const end = new Date(r.schedule.recurrenceEndDate!);
    expect(end.getMonth()).toBe(11); // December
    expect(end.getFullYear()).toBe(2025);

    const r2 = parseTaskInput('gym every monday until july 4', NOW)!;
    const end2 = new Date(r2.schedule.recurrenceEndDate!);
    expect(end2.getMonth()).toBe(6);
    expect(end2.getDate()).toBe(4);
  });

  it('maps a "for N times/occurrences" clause to recurrenceCount', () => {
    const r = parseTaskInput('take medicine daily for 10 occurrences', NOW)!;
    expect(r.schedule.recurrenceCount).toBe(10);

    const r2 = parseTaskInput('take medicine daily for 5 times', NOW)!;
    expect(r2.schedule.recurrenceCount).toBe(5);
  });

  it('maps a "for N days/weeks/months" duration clause to recurrenceEndDate', () => {
    const r = parseTaskInput('take antibiotics daily for 10 days', NOW)!;
    expect(r.schedule.recurrenceType).toBe('daily');
    expectDay(new Date(r.schedule.recurrenceEndDate!), 2025, 5, 20);
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

  it('flags a deadline-mirroring one-off date', () => {
    expect(describeSchedule({ ...base, deadline: base.dueDate }, NOW)).toBe('Today · Deadline');
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
    expect(describeSchedule({ ...base, recurrenceType: 'monthly', recurrenceInterval: 3 }, NOW)).toBe('Quarterly');
    expect(describeSchedule({ ...base, recurrenceType: 'monthly', recurrenceInterval: 6 }, NOW)).toBe('Every 6 months');
    expect(describeSchedule({ ...base, recurrenceType: 'monthly', recurrenceMonthDay: 15 }, NOW)).toBe('Monthly on the 15th');
    expect(describeSchedule({ ...base, recurrenceType: 'monthly', recurrenceMonthDay: -1 }, NOW)).toBe('Monthly on the last day');
    expect(describeSchedule({ ...base, recurrenceType: 'monthly', recurrenceWeekOrdinal: 2, recurrenceDays: [2] }, NOW)).toBe('Every 2nd Tuesday');
    expect(describeSchedule({ ...base, recurrenceType: 'monthly', recurrenceWeekOrdinal: -1, recurrenceDays: [5] }, NOW)).toBe('Every last Friday');
    expect(describeSchedule({ ...base, recurrenceType: 'yearly', dueDate: new Date(2025, 8, 15) }, NOW)).toBe('Every Sep 15');
    expect(describeSchedule({ ...base, recurrenceType: 'yearly', recurrenceInterval: 2 }, NOW)).toBe('Every 2 years');
  });

  it('appends the time segment', () => {
    expect(describeSchedule({ ...base, recurrenceType: 'daily', timeSegments: ['morning'] }, NOW)).toBe('Daily · morning');
    expect(describeSchedule({ ...base, timeSegments: ['evening'] }, NOW)).toBe('Today · evening');
  });
});

describe('parseLinkInput', () => {
  it('extracts a pasted https URL trailing the title', () => {
    const result = parseLinkInput('read this article https://example.com/foo');
    expect(result?.url).toBe('https://example.com/foo');
    expect(result?.cleanTitle).toBe('read this article');
  });

  it('extracts a URL leading the title', () => {
    const result = parseLinkInput('https://example.com/foo read this');
    expect(result?.url).toBe('https://example.com/foo');
    expect(result?.cleanTitle).toBe('read this');
  });

  it('extracts a URL in the middle of the title', () => {
    const result = parseLinkInput('read https://example.com/foo later');
    expect(result?.url).toBe('https://example.com/foo');
    expect(result?.cleanTitle).toBe('read later');
  });

  it('extracts an app deep-link scheme', () => {
    const result = parseLinkInput('practice spanish spotify://album/123');
    expect(result?.url).toBe('spotify://album/123');
    expect(result?.cleanTitle).toBe('practice spanish');
  });

  it('trims trailing sentence punctuation off the URL', () => {
    const result = parseLinkInput('check this out: https://example.com/foo.');
    expect(result?.url).toBe('https://example.com/foo');
    expect(result?.cleanTitle).toBe('check this out:');
  });

  it('returns null when there is no URL', () => {
    expect(parseLinkInput('just a normal title')).toBeNull();
  });

  it('returns null when the entire input is the URL', () => {
    expect(parseLinkInput('https://example.com/foo')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseLinkInput('')).toBeNull();
  });
});

// ─── parsePhoneInput ───

describe('parsePhoneInput', () => {
  it('extracts a number trailing the title', () => {
    const result = parsePhoneInput('call the doctor 555-123-4567');
    expect(result?.number).toBe('555-123-4567');
    expect(result?.cleanTitle).toBe('call the doctor');
  });

  it('extracts a number in the middle of the title', () => {
    const result = parsePhoneInput('call (555) 123 4567 about the invoice');
    expect(result?.number).toBe('(555) 123 4567');
    expect(result?.cleanTitle).toBe('call about the invoice');
  });

  it('extracts an international number', () => {
    const result = parsePhoneInput('ring the surgery +44 20 7946 0018');
    expect(result?.number).toBe('+44 20 7946 0018');
    expect(result?.cleanTitle).toBe('ring the surgery');
  });

  it('leaves quantities, prices and years alone', () => {
    expect(parsePhoneInput('pay rent 1500')).toBeNull();
    expect(parsePhoneInput('file taxes for 2026')).toBeNull();
    expect(parsePhoneInput('walk 10000 steps')).toBeNull();
  });

  it('returns null when the entire input is the number', () => {
    expect(parsePhoneInput('555-123-4567')).toBeNull();
  });

  it('returns null when there is no number', () => {
    expect(parsePhoneInput('call the doctor')).toBeNull();
    expect(parsePhoneInput('')).toBeNull();
  });
});

// ─── parseDurationInput ───

describe('parseDurationInput', () => {
  it('extracts the example case', () => {
    const result = parseDurationInput('play violin for 15 minutes');
    expect(result?.minutes).toBe(15);
    expect(result?.cleanTitle).toBe('play violin');
  });

  it('accepts the short unit forms', () => {
    expect(parseDurationInput('stretch for 10 min')?.minutes).toBe(10);
    expect(parseDurationInput('stretch for 10min')?.minutes).toBe(10);
    expect(parseDurationInput('stretch for 45m')?.minutes).toBe(45);
    expect(parseDurationInput('read for 1 hour')?.minutes).toBe(60);
    expect(parseDurationInput('read for 2 hrs')?.minutes).toBe(120);
    expect(parseDurationInput('read for 2h')?.minutes).toBe(120);
  });

  it('converts fractional hours to minutes', () => {
    expect(parseDurationInput('practice for 1.5 hours')?.minutes).toBe(90);
  });

  it('strips a phrase from the middle of the title', () => {
    const result = parseDurationInput('run for 20 minutes outside');
    expect(result?.minutes).toBe(20);
    expect(result?.cleanTitle).toBe('run outside');
  });

  it('reports the matched span so the tooltip can be positioned', () => {
    const input = 'play violin for 15 minutes';
    const result = parseDurationInput(input)!;
    expect(input.slice(result.matchStart, result.matchEnd)).toBe('for 15 minutes');
  });

  it('leaves relative-date phrasing to the schedule parser', () => {
    // "in 1 hour" already means a due time — it must not become a duration.
    expect(parseDurationInput('call mum in 1 hour')).toBeNull();
    expect(parseDurationInput('call mum 15 min')).toBeNull();
  });

  it('does not fire without a title left over', () => {
    expect(parseDurationInput('for 15 minutes')).toBeNull();
  });

  it('rejects a zero, sub-minute, or absurd duration', () => {
    expect(parseDurationInput('nap for 0 minutes')).toBeNull();
    expect(parseDurationInput('blink for 0.2 min')).toBeNull();
    expect(parseDurationInput('wait for 9999 hours')).toBeNull();
  });

  it('returns null when there is no duration phrase', () => {
    expect(parseDurationInput('buy milk')).toBeNull();
    expect(parseDurationInput('')).toBeNull();
  });

  it('is case insensitive', () => {
    expect(parseDurationInput('Meditate For 20 Minutes')?.minutes).toBe(20);
  });
});

// ─── parseCategoryInput ───

describe('parseCategoryInput', () => {
  const categories = ['Home', 'Work', 'Errands'];

  it('extracts the CLAUDE.md example', () => {
    const result = parseCategoryInput('pay rent tmrw 5p #home', categories);
    expect(result?.category).toBe('Home'); // canonical casing, not the typed token
    expect(result?.cleanTitle).toBe('pay rent tmrw 5p');
  });

  it('matches case-insensitively', () => {
    expect(parseCategoryInput('mow the lawn #WORK', categories)?.category).toBe('Work');
  });

  it('extracts a tag from the middle of the title', () => {
    const result = parseCategoryInput('buy milk #errands on the way home', categories);
    expect(result?.category).toBe('Errands');
    expect(result?.cleanTitle).toBe('buy milk on the way home');
  });

  it('reports the matched span', () => {
    const input = 'pay rent #home';
    const result = parseCategoryInput(input, categories)!;
    expect(input.slice(result.matchStart, result.matchEnd)).toBe('#home');
  });

  it('returns null when the tag names no known category', () => {
    expect(parseCategoryInput('reply to #sarah about the trip', categories)).toBeNull();
  });

  it('returns null when there is no "#" at all', () => {
    expect(parseCategoryInput('just a normal title', categories)).toBeNull();
  });

  it('returns null when the entire input is the tag', () => {
    expect(parseCategoryInput('#home', categories)).toBeNull();
  });

  it('returns null when there are no categories registered', () => {
    expect(parseCategoryInput('pay rent #home', [])).toBeNull();
  });
});

describe('parseFromCompletionSuffix', () => {
  it('peels a bare "after completion" clause that parseTaskInput will not match', () => {
    // parseTaskInput needs a recurrence phrase in front of the clause, because
    // a task with no repeat has no completion to recur from. The Reminders
    // import is the caller that already has the repeat from somewhere else.
    expect(parseTaskInput('go running after completion')).toBeNull();
    expect(parseFromCompletionSuffix('go running after completion')).toEqual({
      cleanTitle: 'go running',
    });
  });

  it('accepts the same phrasings the recurrence parser does', () => {
    expect(parseFromCompletionSuffix('go running after completing')?.cleanTitle).toBe('go running');
    expect(parseFromCompletionSuffix('go running after finishing')?.cleanTitle).toBe('go running');
    expect(parseFromCompletionSuffix("go running after it's done")?.cleanTitle).toBe('go running');
    expect(parseFromCompletionSuffix('go running after I finish it')?.cleanTitle).toBe('go running');
    expect(parseFromCompletionSuffix('go running after done')?.cleanTitle).toBe('go running');
  });

  it('keeps the original casing and trims trailing punctuation', () => {
    expect(parseFromCompletionSuffix('Water The Plants after completion')?.cleanTitle).toBe(
      'Water The Plants'
    );
    expect(parseFromCompletionSuffix('Go Running, after completion')?.cleanTitle).toBe('Go Running');
  });

  it('is case insensitive in the clause itself', () => {
    expect(parseFromCompletionSuffix('go running After Completion')?.cleanTitle).toBe('go running');
  });

  it('returns null without the clause, or with nothing left in front of it', () => {
    expect(parseFromCompletionSuffix('go running')).toBeNull();
    expect(parseFromCompletionSuffix('after completion')).toBeNull();
    expect(parseFromCompletionSuffix('')).toBeNull();
  });
});
