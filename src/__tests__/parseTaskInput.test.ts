import { parseTaskInput, describeSchedule, parseLinkInput, parsePhoneInput, parseEmailInput, detectContactIntent, parseDurationInput, parseSupplyInput, parseCategoryAndTagsInput, parsePriorityInput, matchPersonMentions, findAmbiguousMention, applyMentionOverrides, parseFromCompletionSuffix, type ParsedSchedule } from '../utils/parseTaskInput';

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

describe('parseTaskInput — the "m"-less 12-hour shorthand', () => {
  it('parses the example quick add\'s own tip advertises', () => {
    // "pay rent tmrw 5p #home" is the string tips.ts and CLAUDE.md both use to
    // describe quick add. The tag half is parseCategoryAndTagsInput's (tested
    // below); this is the schedule half, which used to come back null — the
    // tip taught a shorthand the grammar didn't accept.
    const r = parseTaskInput('pay rent tmrw 5p', NOW)!;
    expect(r.cleanTitle).toBe('pay rent');
    expect(r.matchedText).toBe('tmrw 5p');
    expectDay(r.schedule.dueDate, 2025, 5, 11);
    expect(r.schedule.timeSegments).toEqual(['afternoon']);
  });

  it('reads "9a" as the morning, with a connector', () => {
    const r = parseTaskInput('call mom at 9a', NOW)!;
    expect(r.cleanTitle).toBe('call mom');
    expect(r.schedule.timeSegments).toEqual(['morning']);
  });

  it('keeps the minutes', () => {
    const r = parseTaskInput('pay rent tmrw 5:30p', NOW)!;
    expect(r.schedule.timeSegments).toEqual(['afternoon']);
    expectDay(r.schedule.dueDate, 2025, 5, 11);
  });

  it('carries a deadline phrasing through', () => {
    const r = parseTaskInput('submit report by fri 9a', NOW)!;
    expect(r.cleanTitle).toBe('submit report');
    expectDay(r.schedule.deadline!, 2025, 5, 13);
  });

  it('works inside a recurrence phrase', () => {
    const r = parseTaskInput('standup every day at 9a', NOW)!;
    expect(r.cleanTitle).toBe('standup');
    expect(r.schedule.recurrenceType).toBe('daily');
    expect(r.schedule.timeSegments).toEqual(['morning']);
  });

  it('holds back a bare trailing "3a", which is as likely to be a room number', () => {
    // Deliberately absent from SINGLE_WORD_SAFE — a lone short token needs a
    // connector, the same rule "walk the dog mon" is held to below.
    expect(parseTaskInput('call mom 3a', NOW)).toBeNull();
    expect(parseTaskInput('meet in room 5a', NOW)).toBeNull();
  });
});

describe('parseTaskInput — false positives', () => {
  it.each([
    'discuss may budget',
    'email tuesday the dog',
    'ask tom',
    'feed the chickens',
    'buy groceries',
    'take 2 a day', // the shorthand never reaches across a space
    'buy 3 apples',
  ])('does not match %j', input => {
    expect(parseTaskInput(input, NOW)).toBeNull();
  });

  it('still reads "5 apr" as a date, not five in the morning', () => {
    const r = parseTaskInput('dentist 5 apr', NOW)!;
    expect(r.cleanTitle).toBe('dentist');
    expectDay(r.schedule.dueDate, 2026, 3, 5);
    expect(r.schedule.timeSegments).toEqual([]);
  });

  it('accepts an abbreviated weekday with a connector', () => {
    const r = parseTaskInput('pick up package on wed', NOW)!;
    expect(r.cleanTitle).toBe('pick up package');
    expectDay(r.schedule.dueDate, 2025, 5, 11);
  });

  it('accepts any weekday abbreviation as a bare trailing word, not just with a connector', () => {
    const a = parseTaskInput('call dentist thu', NOW)!;
    expect(a.cleanTitle).toBe('call dentist');
    expectDay(a.schedule.dueDate, 2025, 5, 12);

    const b = parseTaskInput('call dentist thur', NOW)!;
    expectDay(b.schedule.dueDate, 2025, 5, 12);

    const c = parseTaskInput('call dentist thurs', NOW)!;
    expectDay(c.schedule.dueDate, 2025, 5, 12);

    const d = parseTaskInput('pick up package wed', NOW)!;
    expect(d.cleanTitle).toBe('pick up package');
    expectDay(d.schedule.dueDate, 2025, 5, 11);

    const e = parseTaskInput('gym mon', NOW)!;
    expectDay(e.schedule.dueDate, 2025, 5, 16);

    const f = parseTaskInput('gym fri', NOW)!;
    expectDay(f.schedule.dueDate, 2025, 5, 13);

    // "sun"/"sat"/"wed" double as ordinary words, but a bare weekday
    // suggestion is a low-stakes false positive (easy to dismiss/edit), so
    // they're accepted the same as the rest rather than gated behind "on"/"by".
    const g = parseTaskInput('polish the sun', NOW)!;
    expect(g.cleanTitle).toBe('polish the');
    expectDay(g.schedule.dueDate, 2025, 5, 15);
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

  it('maps a numeric "every M/D" date to yearly recurrence', () => {
    const r = parseTaskInput('renew warranty every 3/10', NOW)!;
    expect(r.cleanTitle).toBe('renew warranty');
    expect(r.schedule.recurrenceType).toBe('yearly');
    expect(r.schedule.recurrenceInterval).toBe(1);
    expectDay(r.schedule.dueDate, 2026, 2, 10); // March 10 — already past this year, rolls to next
    expect(describeSchedule(r.schedule, NOW)).toBe('Every Mar 10');

    // Day-first when the first number can't be a month.
    const swapped = parseTaskInput('renew warranty every 25/12', NOW)!;
    expect(swapped.schedule.recurrenceType).toBe('yearly');
    expectDay(swapped.schedule.dueDate, 2025, 11, 25); // Dec 25 — still ahead this year
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

  it('fires even when the entire input is the URL, leaving an empty cleanTitle', () => {
    const result = parseLinkInput('https://example.com/foo');
    expect(result?.url).toBe('https://example.com/foo');
    expect(result?.cleanTitle).toBe('');
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

  it('fires even when the entire input is the number, leaving an empty cleanTitle', () => {
    const result = parsePhoneInput('555-123-4567');
    expect(result?.number).toBe('555-123-4567');
    expect(result?.cleanTitle).toBe('');
  });

  it('returns null when there is no number', () => {
    expect(parsePhoneInput('call the doctor')).toBeNull();
    expect(parsePhoneInput('')).toBeNull();
  });
});

// ─── parseEmailInput ───

describe('parseEmailInput', () => {
  it('extracts an address trailing the title', () => {
    const result = parseEmailInput('email the landlord jane@example.com');
    expect(result?.address).toBe('jane@example.com');
    expect(result?.cleanTitle).toBe('email the landlord');
  });

  it('extracts an address in the middle of the title', () => {
    const result = parseEmailInput('email jane@example.com about the invoice');
    expect(result?.address).toBe('jane@example.com');
    expect(result?.cleanTitle).toBe('email about the invoice');
  });

  it('handles dotted local parts and subdomains', () => {
    const result = parseEmailInput('email j.doe@mail.example.co.uk about it');
    expect(result?.address).toBe('j.doe@mail.example.co.uk');
  });

  it('drops trailing sentence punctuation', () => {
    const result = parseEmailInput('email jane@example.com.');
    expect(result?.address).toBe('jane@example.com');
  });

  it('fires even when the entire input is the address, leaving an empty cleanTitle', () => {
    const result = parseEmailInput('jane@example.com');
    expect(result?.address).toBe('jane@example.com');
    expect(result?.cleanTitle).toBe('');
  });

  it('returns null when there is no address', () => {
    expect(parseEmailInput('email the landlord')).toBeNull();
    expect(parseEmailInput('')).toBeNull();
  });
});

// ─── detectContactIntent ───

describe('detectContactIntent', () => {
  it('detects a leading "Call" as a phone intent', () => {
    expect(detectContactIntent('Call Kristen')).toBe('phone');
  });

  it('detects a leading "Text" as a phone intent', () => {
    expect(detectContactIntent('Text the plumber')).toBe('phone');
  });

  it('detects a leading "Email" as an email intent', () => {
    expect(detectContactIntent('Email the landlord')).toBe('email');
  });

  it('detects a leading "Phone" as a phone intent', () => {
    expect(detectContactIntent('Phone Kristen')).toBe('phone');
  });

  it('detects a leading "Message" as a phone intent', () => {
    expect(detectContactIntent('Message the plumber')).toBe('phone');
  });

  it('is case-insensitive', () => {
    expect(detectContactIntent('call mom')).toBe('phone');
    expect(detectContactIntent('EMAIL accounting')).toBe('email');
  });

  it('only matches at the start of the title', () => {
    expect(detectContactIntent('ask her to call me back')).toBeNull();
    expect(detectContactIntent('remember to email the invoice')).toBeNull();
  });

  it('does not match a word that merely starts with the verb', () => {
    expect(detectContactIntent('Calligraphy practice')).toBeNull();
  });

  it('returns null for an unrelated title', () => {
    expect(detectContactIntent('buy milk')).toBeNull();
    expect(detectContactIntent('')).toBeNull();
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

  it('fires even without a title left over', () => {
    const result = parseDurationInput('for 15 minutes');
    expect(result?.minutes).toBe(15);
    expect(result?.cleanTitle).toBe('');
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

// ─── parseCategoryAndTagsInput ───

describe('parseCategoryAndTagsInput', () => {
  const categories = ['Home', 'Work', 'Errands'];
  const tags = ['errand', 'work', 'urgent'];

  it('extracts the CLAUDE.md example as a category', () => {
    const result = parseCategoryAndTagsInput('pay rent tmrw 5p #home', categories, tags);
    expect(result?.category).toBe('Home'); // canonical casing, not the typed token
    expect(result?.tags).toEqual([]);
    expect(result?.cleanTitle).toBe('pay rent tmrw 5p');
  });

  it('matches category case-insensitively', () => {
    expect(parseCategoryAndTagsInput('mow the lawn #WORK', categories, [])?.category).toBe('Work');
  });

  it('extracts a category from the middle of the title', () => {
    const result = parseCategoryAndTagsInput('buy milk #errands on the way home', categories, tags);
    expect(result?.category).toBe('Errands');
    expect(result?.cleanTitle).toBe('buy milk on the way home');
  });

  it('extracts a single "#tag" naming a known tag when it is not a category', () => {
    const result = parseCategoryAndTagsInput('buy milk #errand', categories, tags);
    expect(result?.category).toBeNull();
    expect(result?.tags).toEqual(['errand']);
    expect(result?.cleanTitle).toBe('buy milk');
  });

  it('matches tags case-insensitively, returning the canonical name', () => {
    expect(parseCategoryAndTagsInput('mow the lawn #URGENT', [], tags)?.tags).toEqual(['urgent']);
  });

  it('the first token claims the category slot; every later token is only ever tried as a tag', () => {
    const result = parseCategoryAndTagsInput('pay rent #home #urgent', categories, tags);
    expect(result?.category).toBe('Home');
    expect(result?.tags).toEqual(['urgent']);
    expect(result?.cleanTitle).toBe('pay rent');
  });

  it('a token matching both a category and a tag name is read as the category, since that slot is checked first', () => {
    // "work" is both a category and a tag in this fixture set.
    const result = parseCategoryAndTagsInput('finish report #work', categories, tags);
    expect(result?.category).toBe('Work');
    expect(result?.tags).toEqual([]);
  });

  it('once the category slot is filled, a further token matching that same word is tried as a tag instead', () => {
    const result = parseCategoryAndTagsInput('pay rent #home #work', categories, tags);
    expect(result?.category).toBe('Home');
    expect(result?.tags).toEqual(['work']);
  });

  it('extracts multiple "#tag" tokens once no category is pending', () => {
    const result = parseCategoryAndTagsInput('finish report #work #urgent', [], tags);
    expect(result?.tags).toEqual(['work', 'urgent']);
    expect(result?.cleanTitle).toBe('finish report');
  });

  it('reports the matched span of the first consumed token', () => {
    const input = 'pay rent #home';
    const result = parseCategoryAndTagsInput(input, categories, tags)!;
    expect(input.slice(result.matchStart, result.matchEnd)).toBe('#home');
  });

  it('leaves an unmatched "#word" as plain text — "Reply to #sarah" is untouched', () => {
    expect(parseCategoryAndTagsInput('Reply to #sarah', categories, tags)).toBeNull();
  });

  it('returns null when there is no "#" at all', () => {
    expect(parseCategoryAndTagsInput('just a normal title', categories, tags)).toBeNull();
  });

  it('fires even when the entire input is the token, leaving an empty cleanTitle', () => {
    // Typing the category first ("#home", nothing else yet) is exactly this
    // state, and the tooltip should still offer it — the title can't be saved
    // blank, but that's handleAdd's guard, not this function's.
    const result = parseCategoryAndTagsInput('#home', categories, tags);
    expect(result?.category).toBe('Home');
    expect(result?.cleanTitle).toBe('');
  });

  it('returns null when there are no categories or tags registered', () => {
    expect(parseCategoryAndTagsInput('pay rent #home', [], [])).toBeNull();
  });

  it('only strips the tokens that match, leaving unmatched ones as text', () => {
    const result = parseCategoryAndTagsInput('buy milk #errand #sarah', categories, tags);
    expect(result?.tags).toEqual(['errand']);
    expect(result?.cleanTitle).toBe('buy milk #sarah');
  });

  it('does not match a "#" immediately preceded by a word character (e.g. "C#")', () => {
    expect(parseCategoryAndTagsInput('learn C#work basics', categories, tags)).toBeNull();
  });

  it('resolves an unambiguous category prefix before the word is finished', () => {
    const result = parseCategoryAndTagsInput('take out the trash #chor', ['Chores', 'Work'], []);
    expect(result?.category).toBe('Chores');
    expect(result?.cleanTitle).toBe('take out the trash');
  });

  it('does not resolve a prefix shared by more than one category', () => {
    expect(parseCategoryAndTagsInput('plan the week #wor', ['Work', 'Worship'], [])).toBeNull();
  });

  it('does not resolve a category prefix shorter than the minimum length', () => {
    expect(parseCategoryAndTagsInput('take out the trash #ch', ['Chores'], [])).toBeNull();
  });

  it('still requires an exact match for tags, even when a prefix is unambiguous', () => {
    const result = parseCategoryAndTagsInput('buy milk #err', [], ['errand']);
    expect(result).toBeNull();
  });
});

// ─── parsePriorityInput ───

describe('parsePriorityInput', () => {
  it('resolves an exact priority word', () => {
    const result = parsePriorityInput('clean the garage !urgent');
    expect(result?.priority).toBe(4);
    expect(result?.cleanTitle).toBe('clean the garage');
  });

  it('is case-insensitive', () => {
    expect(parsePriorityInput('mow the lawn !HIGH')?.priority).toBe(3);
  });

  it('resolves an unambiguous prefix before the word is finished', () => {
    const result = parsePriorityInput('pay rent !urg');
    expect(result?.priority).toBe(4);
    expect(result?.cleanTitle).toBe('pay rent');
  });

  it('resolves each of the four priority words', () => {
    expect(parsePriorityInput('a !low')?.priority).toBe(1);
    expect(parsePriorityInput('a !medium')?.priority).toBe(2);
    expect(parsePriorityInput('a !high')?.priority).toBe(3);
    expect(parsePriorityInput('a !urgent')?.priority).toBe(4);
  });

  it('does not resolve a prefix shorter than the minimum length', () => {
    expect(parsePriorityInput('mow the lawn !h')).toBeNull();
  });

  it('does not resolve a token matching no priority word', () => {
    expect(parsePriorityInput('mow the lawn !soon')).toBeNull();
  });

  it('ignores a bare exclamation with no following word', () => {
    expect(parsePriorityInput('wow!!!')).toBeNull();
  });

  it('does not fire mid-word', () => {
    expect(parsePriorityInput('reply to bri!high')).toBeNull();
  });

  it('returns null for a title with no token', () => {
    expect(parsePriorityInput('just a normal title')).toBeNull();
  });

  it('reports the matched span', () => {
    const input = 'walk the dog !urgent please';
    const result = parsePriorityInput(input)!;
    expect(input.slice(result.matchStart, result.matchEnd)).toBe('!urgent');
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

// ─── parseSupplyInput ────────────────────────────────────────────────────────

describe('parseSupplyInput', () => {
  it('reads a count and its unit out of the middle of a line', () => {
    const r = parseSupplyInput('replace cpap filter 6 filters left every month')!;
    expect(r.count).toBe(6);
    expect(r.unit).toBe('filters');
    expect(r.cleanTitle).toBe('replace cpap filter every month');
  });

  it('leaves the schedule behind for the schedule parser to find', () => {
    // The two have to be sayable in one line, because a supply is meaningless
    // without a repeat. Whichever tooltip is offered first shortens the title
    // so the other can fire on what is left.
    const supply = parseSupplyInput('replace cpap filter 6 filters left every month')!;
    const schedule = parseTaskInput(supply.cleanTitle, NOW)!;
    expect(schedule.cleanTitle).toBe('replace cpap filter');
    expect(schedule.schedule.recurrenceType).toBe('monthly');
  });

  it('composes in the other order too', () => {
    const schedule = parseTaskInput('replace cpap filter 6 filters left every month', NOW)!;
    const supply = parseSupplyInput(schedule.cleanTitle)!;
    expect(supply.count).toBe(6);
    expect(supply.cleanTitle).toBe('replace cpap filter');
  });

  it('takes a bare count with no unit', () => {
    const r = parseSupplyInput('swap the water filter 3 left')!;
    expect(r.count).toBe(3);
    expect(r.unit).toBeNull();
    expect(r.cleanTitle).toBe('swap the water filter');
  });

  it('refuses a unit that means time remaining, rather than dropping it', () => {
    // Read as a supply, "3 days left" would set a count of 3 and leave a title
    // reading "finish the report days".
    expect(parseSupplyInput('finish the report 3 days left')).toBeNull();
    expect(parseSupplyInput('ship it 2 weeks left')).toBeNull();
    expect(parseSupplyInput('call back 30 mins left')).toBeNull();
  });

  it('tidies up the punctuation a lifted phrase leaves behind', () => {
    expect(parseSupplyInput('replace filter, 6 filters left, every month')?.cleanTitle)
      .toBe('replace filter, every month');
  });

  it('reports the matched span so the tooltip can be positioned', () => {
    const input = 'replace cpap filter 6 filters left';
    const r = parseSupplyInput(input)!;
    expect(input.slice(r.matchStart, r.matchEnd)).toBe('6 filters left');
  });

  it('fires even without a title left over', () => {
    const result = parseSupplyInput('6 filters left');
    expect(result?.count).toBe(6);
    expect(result?.cleanTitle).toBe('');
  });

  it('rejects a zero, which is a sentence rather than a stock being set up', () => {
    expect(parseSupplyInput('nothing 0 left')).toBeNull();
  });

  it('returns null when there is no supply phrase', () => {
    expect(parseSupplyInput('replace cpap filter every month')).toBeNull();
    expect(parseSupplyInput('')).toBeNull();
  });

  it('does not match inside a word', () => {
    expect(parseSupplyInput('turn left at the lights')).toBeNull();
  });

  it('is case insensitive, and stores the unit the way the app renders it', () => {
    expect(parseSupplyInput('Replace Filter 6 Filters LEFT')?.count).toBe(6);
    expect(parseSupplyInput('Replace Filter 6 Filters LEFT')?.unit).toBe('filters');
  });
});

describe('matchPersonMentions', () => {
  const PEOPLE = [
    { id: 'p1', name: 'Dustin', nickname: '' },
    { id: 'p2', name: 'Ansley Brown', nickname: 'Ans' },
    { id: 'p3', name: 'Mom', nickname: '' },
  ];

  it('pulls one person out of a plan', () => {
    const r = matchPersonMentions('beach with @dustin', PEOPLE);
    expect(r).toEqual([{ start: 11, end: 18, personId: 'p1' }]);
  });

  it('pulls several, in the order they were typed', () => {
    const r = matchPersonMentions('beach with @ansley @dustin', PEOPLE);
    expect(r.map(m => m.personId)).toEqual(['p2', 'p1']);
  });

  it('matches a nickname', () => {
    expect(matchPersonMentions('coffee @ans', PEOPLE).map(m => m.personId)).toEqual(['p2']);
  });

  it('matches the first word of a full name, which is how a contact arrives', () => {
    expect(matchPersonMentions('coffee @ansley', PEOPLE).map(m => m.personId)).toEqual(['p2']);
  });

  it('is case insensitive', () => {
    expect(matchPersonMentions('call @Mom', PEOPLE).map(m => m.personId)).toEqual(['p3']);
  });

  it('reports somebody named twice as two mentions, not deduplicated — that is the caller\'s job', () => {
    expect(matchPersonMentions('call @mom then @mom again', PEOPLE).map(m => m.personId)).toEqual(['p3', 'p3']);
  });

  // Never creates a person: adding somebody is a deliberate act on the People
  // screen, not a side effect of a typo. See rule 3 in docs/arch/people.md.
  it('leaves an unknown token as literal text', () => {
    expect(matchPersonMentions('ping @nobody about it', PEOPLE)).toEqual([]);
  });

  it('leaves an email address alone, since its @ follows a word character', () => {
    expect(matchPersonMentions('email bob@example.com', PEOPLE)).toEqual([]);
    expect(matchPersonMentions('email dustin@example.com', PEOPLE)).toEqual([]);
  });

  it('leaves a token two people answer to unmatched, rather than guessing', () => {
    const twoSams = [
      { id: 'a', name: 'Sam Riley', nickname: '' },
      { id: 'b', name: 'Sam Okafor', nickname: '' },
    ];
    expect(matchPersonMentions('lunch @sam', twoSams)).toEqual([]);
  });

  it('matches a unique prefix once at least 3 characters are typed', () => {
    const people = [...PEOPLE, { id: 'p5', name: 'Brittany', nickname: '' }];
    expect(matchPersonMentions('hug @brittan', people).map(m => m.personId)).toEqual(['p5']);
  });

  it('leaves a prefix under 3 characters unmatched', () => {
    const people = [...PEOPLE, { id: 'p5', name: 'Brittany', nickname: '' }];
    expect(matchPersonMentions('hug @br', people)).toEqual([]);
  });

  it('leaves an ambiguous prefix unmatched, then resolves once it is typed far enough to be unique', () => {
    const twoBrits = [
      { id: 'a', name: 'Brittany', nickname: '' },
      { id: 'b', name: 'Brittney', nickname: '' },
    ];
    expect(matchPersonMentions('hug @bri', twoBrits)).toEqual([]);
    // "brittan" only Brittany answers to.
    expect(matchPersonMentions('hug @brittan', twoBrits).map(m => m.personId)).toEqual(['a']);
  });

  it('still resolves an unambiguous name when somebody else is ambiguous', () => {
    const people = [...PEOPLE, { id: 'p4', name: 'Dustin Two', nickname: '' }];
    // "dustin" now names two, so it is left alone; "mom" still resolves.
    const r = matchPersonMentions('call @mom about @dustin', people);
    expect(r.map(m => m.personId)).toEqual(['p3']);
  });

  it('resolves a bare token with nothing else in the title, since nothing is stripped', () => {
    expect(matchPersonMentions('@dustin', PEOPLE)).toEqual([{ start: 0, end: 7, personId: 'p1' }]);
  });

  it('finds nobody in a title with no tokens at all', () => {
    expect(matchPersonMentions('buy milk', PEOPLE)).toEqual([]);
  });

  describe('naming a group', () => {
    const GROUPS = [{ id: 'g1', name: 'Household', memberIds: ['p1', 'p2'] }];

    it('expands into one mention per current member, sharing the token\'s span', () => {
      const r = matchPersonMentions('beach with @household', PEOPLE, GROUPS);
      expect(r).toEqual([
        { start: 11, end: 21, personId: 'p1' },
        { start: 11, end: 21, personId: 'p2' },
      ]);
    });

    it('is tried only once no person answers to the token at all', () => {
      // "Mom" is a real person here, so the group check never runs for it.
      const groups = [{ id: 'g2', name: 'Mom', memberIds: ['p1'] }];
      expect(matchPersonMentions('call @mom', PEOPLE, groups).map(m => m.personId)).toEqual(['p3']);
    });

    it('never runs for a token two people already answer to', () => {
      const twoSams = [
        { id: 'a', name: 'Sam Riley', nickname: '' },
        { id: 'b', name: 'Sam Okafor', nickname: '' },
      ];
      const groups = [{ id: 'g3', name: 'Sam', memberIds: ['a'] }];
      expect(matchPersonMentions('lunch @sam', twoSams, groups)).toEqual([]);
    });

    it('resolves by a unique prefix of the group\'s name too', () => {
      const r = matchPersonMentions('dinner @house tonight', PEOPLE, GROUPS);
      expect(r.map(m => m.personId)).toEqual(['p1', 'p2']);
    });

    it('leaves a group with nobody in it unresolved', () => {
      const empty = [{ id: 'g4', name: 'Empty', memberIds: [] }];
      expect(matchPersonMentions('call @empty', PEOPLE, empty)).toEqual([]);
    });

    it('leaves a token two groups answer to unmatched', () => {
      const groups = [
        { id: 'g1', name: 'Household', memberIds: ['p1'] },
        { id: 'g2', name: 'Household', memberIds: ['p2'] },
      ];
      expect(matchPersonMentions('call @household', PEOPLE, groups)).toEqual([]);
    });

    it('does nothing when no groups are passed at all', () => {
      expect(matchPersonMentions('call @household', PEOPLE)).toEqual([]);
    });
  });
});

describe('findAmbiguousMention', () => {
  const twoSams = [
    { id: 'a', name: 'Sam Riley', nickname: '' },
    { id: 'b', name: 'Sam Okafor', nickname: '' },
  ];
  const twoBrits = [
    { id: 'a', name: 'Brittany', nickname: '' },
    { id: 'b', name: 'Brittney', nickname: '' },
  ];

  it('reports the candidates for a token two people answer to exactly', () => {
    const r = findAmbiguousMention('lunch @sam', twoSams);
    expect(r?.token).toBe('sam');
    expect(r?.candidates.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('reports the candidates for a prefix two people answer to', () => {
    const r = findAmbiguousMention('hug @bri', twoBrits);
    expect(r?.candidates.map(c => c.name)).toEqual(['Brittany', 'Brittney']);
  });

  it('is silent once a unique prefix resolves on its own', () => {
    expect(findAmbiguousMention('hug @brittan', twoBrits)).toBeNull();
  });

  it('is silent under the prefix floor — nothing to search yet', () => {
    expect(findAmbiguousMention('hug @br', twoBrits)).toBeNull();
  });

  it('is silent once the token has an override recorded for it', () => {
    expect(findAmbiguousMention('lunch @sam', twoSams, { sam: 'a' })).toBeNull();
  });

  it('is silent when nothing is ambiguous', () => {
    const PEOPLE = [{ id: 'p1', name: 'Dustin', nickname: '' }];
    expect(findAmbiguousMention('beach with @dustin', PEOPLE)).toBeNull();
  });

  it('finds the first ambiguous token, skipping ones already resolved', () => {
    const r = findAmbiguousMention('call @mom about @sam', [...twoSams, { id: 'c', name: 'Mom', nickname: '' }]);
    expect(r?.token).toBe('sam');
  });
});

describe('applyMentionOverrides', () => {
  const twoSams = [
    { id: 'a', name: 'Sam Riley', nickname: '' },
    { id: 'b', name: 'Sam Okafor', nickname: '' },
  ];

  it('adds an extra mention for a token an override resolves', () => {
    const matched = matchPersonMentions('lunch @sam', twoSams); // [] — ambiguous
    const r = applyMentionOverrides('lunch @sam', matched, { sam: 'b' });
    expect(r).toEqual([{ start: 6, end: 10, personId: 'b' }]);
  });

  it('leaves matched mentions untouched when there are no overrides', () => {
    const matched = matchPersonMentions('beach with @dustin', [{ id: 'p1', name: 'Dustin', nickname: '' }]);
    expect(applyMentionOverrides('beach with @dustin', matched, {})).toBe(matched);
  });

  it('does not double up a token matchPersonMentions already resolved on its own', () => {
    const people = [{ id: 'p1', name: 'Dustin', nickname: '' }];
    const matched = matchPersonMentions('beach with @dustin', people);
    const r = applyMentionOverrides('beach with @dustin', matched, { dustin: 'p1' });
    expect(r).toEqual(matched);
  });

  it('merges an override with a normally-resolved mention, in title order', () => {
    const people = [...twoSams, { id: 'c', name: 'Mom', nickname: '' }];
    const matched = matchPersonMentions('call @mom about @sam', people); // only "mom" resolves
    const r = applyMentionOverrides('call @mom about @sam', matched, { sam: 'a' });
    expect(r.map(m => m.personId)).toEqual(['c', 'a']);
  });
});
