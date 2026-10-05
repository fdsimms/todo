import { alertRelativeOffset, describeEventRepeat, eventMarkerText, parseClockRange, parseLengthClause, parseAlertClause, parseQuickEvent } from '../utils/quickEvent';
import { findAmbiguousMention } from '../utils/parseTaskInput';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

// Friday Sep 25 2026, 2:25pm.
const now = new Date(2026, 8, 25, 14, 25);
const today = new Date(2026, 8, 25, 0);
const people = [
  { id: 'p1', name: 'Gideon Reyes', nickname: '' },
  { id: 'p2', name: 'Tessa', nickname: '' },
];
const names: Record<string, string> = { p1: 'Gideon', p2: 'Tessa' };
const opts = { people, nameOf: (id: string) => names[id] ?? null, now, today, wallClock: now };

describe('parseQuickEvent', () => {
  // An event opened for editing keeps its title as written: "Dinner at 7 for
  // Sam's birthday" is a name, not an instruction to move it to 7pm.
  it('reads a plain line as nothing but a title', () => {
    const draft = parseQuickEvent('Dinner at Luigi tomorrow 7pm for 2h', { ...opts, plain: true });
    expect(draft.title).toBe('Dinner at Luigi tomorrow 7pm for 2h');
    expect(draft.scheduled).toBe(false);
    expect(draft.location).toBeNull();
  });

  it('reads a day, a clock time and a person', () => {
    const draft = parseQuickEvent('lunch w/ @gideon sat 12pm', opts);
    expect(draft.title).toBe('lunch w/ Gideon');
    expect(draft.start).toEqual(new Date(2026, 8, 26, 12, 0));
    expect(draft.end).toEqual(new Date(2026, 8, 26, 13, 0));
    expect(draft.personIds).toEqual(['p1']);
    expect(draft.scheduled).toBe(true);
  });

  it('names everybody mentioned', () => {
    const draft = parseQuickEvent('beach with @gideon and @tessa tomorrow', opts);
    expect(draft.title).toBe('beach with Gideon and Tessa');
    expect(draft.personIds).toEqual(['p1', 'p2']);
  });

  it('uses a representative hour for a day-part word', () => {
    const draft = parseQuickEvent('dinner tomorrow evening', opts);
    expect(draft.start.getHours()).toBe(19);
    expect(draft.start.getDate()).toBe(26);
  });

  it('falls back to 9:00 on a day with no time', () => {
    const draft = parseQuickEvent('dentist monday', opts);
    expect(draft.start).toEqual(new Date(2026, 8, 28, 9, 0));
  });

  it('falls back to the next whole hour today when nothing is read', () => {
    const draft = parseQuickEvent('coffee', opts);
    expect(draft.title).toBe('coffee');
    expect(draft.start).toEqual(new Date(2026, 8, 25, 15, 0));
    expect(draft.scheduled).toBe(false);
  });

  it('leaves an unknown @token as typed and links nobody', () => {
    const draft = parseQuickEvent('call @zed', opts);
    expect(draft.title).toBe('call @zed');
    expect(draft.personIds).toEqual([]);
  });
});

describe('parseQuickEvent, for the quick-add sheet', () => {
  it('reports the schedule phrase and the line without it', () => {
    const draft = parseQuickEvent('lunch w/ @gideon sat 12pm', opts);
    expect(draft.phrase).toEqual({ start: 17, text: 'sat 12pm', lineWithout: 'lunch w/ @gideon' });
    expect(draft.mentionSpans).toEqual([[9, 16]]);
  });

  it('keeps an ignored phrase as part of the title', () => {
    const draft = parseQuickEvent('lunch sat 12pm', { ...opts, ignoreSchedule: true });
    expect(draft.title).toBe('lunch sat 12pm');
    expect(draft.phrase).toBeNull();
    expect(draft.scheduled).toBe(false);
    expect(draft.start).toEqual(new Date(2026, 8, 25, 15, 0));
  });

  it('links a pick made for an ambiguous @name', () => {
    const twoSams = [
      { id: 's1', name: 'Sam Ortiz', nickname: '' },
      { id: 's2', name: 'Sam Park', nickname: '' },
    ];
    const line = 'coffee with @sam';
    const ambiguous = findAmbiguousMention(line, twoSams);
    expect(ambiguous).not.toBeNull();
    const plain = parseQuickEvent(line, { ...opts, people: twoSams, nameOf: () => 'Sam' });
    expect(plain.personIds).toEqual([]);
    const picked = parseQuickEvent(line, {
      ...opts, people: twoSams, nameOf: () => 'Sam',
      mentionOverrides: { [ambiguous!.token]: 's2' },
    });
    expect(picked.personIds).toEqual(['s2']);
    expect(picked.title).toBe('coffee with Sam');
  });
});

describe('parseQuickEvent, location and alert clauses', () => {
  it('keeps the place out of the title when it follows a mention', () => {
    const draft = parseQuickEvent('Movie with @gideon at home', opts);
    expect(draft.title).toBe('Movie with Gideon');
    expect(draft.location).toBe('home');
  });

  it('reads a place and an alert after the schedule phrase', () => {
    const line = "lunch w/ @gideon fri 12p at Joe's alert 30m";
    const draft = parseQuickEvent(line, opts);
    expect(draft.title).toBe('lunch w/ Gideon');
    expect(draft.location).toBe("Joe's");
    expect(draft.alertMinutes).toBe(30);
    expect(draft.start).toEqual(new Date(2026, 9, 2, 12, 0));
    expect(draft.personIds).toEqual(['p1']);
    expect(draft.clauseSpans.map(([a, b]) => line.slice(a, b))).toEqual(["at Joe's", 'alert 30m']);
  });

  it('keeps the clauses when the schedule phrase is taken out of the line', () => {
    const draft = parseQuickEvent("lunch fri 12p at Joe's alert 30m", opts);
    expect(draft.phrase?.lineWithout).toBe("lunch at Joe's alert 30m");
  });

  it('reads a place with no schedule phrase', () => {
    const draft = parseQuickEvent('coffee at Blue Bottle', opts);
    expect(draft.title).toBe('coffee');
    expect(draft.location).toBe('Blue Bottle');
    expect(draft.scheduled).toBe(false);
  });

  it('does not take a time for a place', () => {
    const draft = parseQuickEvent('dentist at 3pm', opts);
    expect(draft.location).toBeNull();
    expect(draft.start).toEqual(new Date(2026, 8, 25, 15, 0));
    expect(draft.title).toBe('dentist');
  });

  it('leaves a place followed by a time in the title', () => {
    const draft = parseQuickEvent("lunch at Joe's fri 12p", opts);
    expect(draft.location).toBeNull();
    expect(draft.title).toBe("lunch at Joe's");
    expect(draft.start).toEqual(new Date(2026, 9, 2, 12, 0));
  });

  it('reports no alert when none is typed, and null for "alert none"', () => {
    expect(parseQuickEvent('coffee', opts).alertMinutes).toBeUndefined();
    expect(parseQuickEvent('coffee alert none', opts).alertMinutes).toBeNull();
  });

  it('keeps the word alert in a title when it is not a clause', () => {
    const draft = parseQuickEvent('alert the neighbors', opts);
    expect(draft.title).toBe('alert the neighbors');
    expect(draft.alertMinutes).toBeUndefined();
  });
});

describe('parseAlertClause', () => {
  it.each([
    ['x alert 30m', 30],
    ['x alert 30 min', 30],
    ['x alert 1h', 60],
    ['x alert 2 hours', 120],
    ['x alert 1d', 1440],
    ['x alert 2 days', 2880],
    ['x alert 15', 15],
    ['x alert 0', 0],
    ['x alert none', null],
    ['x alert off', null],
  ])('reads %s', (line, minutes) => {
    expect(parseAlertClause(line)?.minutes).toBe(minutes);
  });

  it('only reads a suffix', () => {
    expect(parseAlertClause('alert 30m dinner')).toBeNull();
  });
});

describe('parseQuickEvent, repeats', () => {
  it('reads "every monday" as a weekly rule starting next Monday', () => {
    const draft = parseQuickEvent('standup every monday 9am', opts);
    expect(draft.repeat).toEqual({ frequency: 'weekly', interval: 1, daysOfTheWeek: [{ dayOfTheWeek: 2 }] });
    expect(draft.start).toEqual(new Date(2026, 8, 28, 9, 0));
  });

  it('reads an interval and several weekdays', () => {
    const draft = parseQuickEvent('gym every 2 weeks', opts);
    expect(draft.repeat).toEqual({ frequency: 'weekly', interval: 2 });
  });

  it('reads "daily"', () => {
    expect(parseQuickEvent('walk daily 7am', opts).repeat).toEqual({ frequency: 'daily', interval: 1 });
  });

  it('has no repeat for a one-off day', () => {
    expect(parseQuickEvent('dentist monday', opts).repeat).toBeNull();
  });

  it('has none for a task-only repeat: every few hours, or counted from completion', () => {
    expect(parseQuickEvent('stretch every 3 hours', opts).repeat).toBeNull();
    expect(parseQuickEvent('water plants 3 days after completion', opts).repeat).toBeNull();
  });

  it('keeps the repeat when the phrase is followed by a place and an alert', () => {
    const draft = parseQuickEvent("standup every monday 9am at Zoom alert 10m", opts);
    expect(draft.repeat?.frequency).toBe('weekly');
    expect(draft.location).toBe('Zoom');
    expect(draft.alertMinutes).toBe(10);
  });
});

describe('describeEventRepeat', () => {
  it.each([
    [{ frequency: 'daily', interval: 1 }, 'Repeats every day'],
    [{ frequency: 'weekly', interval: 2 }, 'Repeats every 2 weeks'],
    [{ frequency: 'weekly', interval: 1, daysOfTheWeek: [{ dayOfTheWeek: 2 }, { dayOfTheWeek: 4 }] }, 'Repeats every week on Mon, Wed'],
    [{ frequency: 'monthly', interval: 1 }, 'Repeats every month'],
    [{ frequency: 'yearly', interval: 1 }, 'Repeats every year'],
  ] as const)('%j', (rule, text) => {
    expect(describeEventRepeat(rule as never)).toBe(text);
  });
});

describe('alertRelativeOffset', () => {
  it('counts back from the start of a timed event', () => {
    expect(alertRelativeOffset(30, false)).toBe(-30);
    expect(alertRelativeOffset(0, false)).toBe(0);
  });

  it('counts back from 9:00 on an all-day event', () => {
    expect(alertRelativeOffset(0, true)).toBe(540);
    expect(alertRelativeOffset(60, true)).toBe(480);
  });
});

describe('eventMarkerText', () => {
  it('returns the rest of a line that starts with "event:"', () => {
    expect(eventMarkerText('event: lunch w/ @gideon sat 12pm')).toBe('lunch w/ @gideon sat 12pm');
    expect(eventMarkerText('  Event:dinner')).toBe('dinner');
  });

  it('leaves ordinary titles alone', () => {
    expect(eventMarkerText('event planning')).toBeNull();
    expect(eventMarkerText('book the event: venue')).toBeNull();
  });
});

describe('parseQuickEvent, length', () => {
  it('reads "for 90m" as the length, after the time', () => {
    const draft = parseQuickEvent('lunch sat 12pm for 90m', opts);
    expect(draft.title).toBe('lunch');
    expect(draft.start).toEqual(new Date(2026, 8, 26, 12, 0));
    expect(draft.durationMinutes).toBe(90);
    expect(draft.end).toEqual(new Date(2026, 8, 26, 13, 30));
  });

  it('reads a clock range as the start and the end', () => {
    const draft = parseQuickEvent('lunch sat 12-1:30pm', opts);
    expect(draft.title).toBe('lunch');
    expect(draft.start).toEqual(new Date(2026, 8, 26, 12, 0));
    expect(draft.end).toEqual(new Date(2026, 8, 26, 13, 30));
    expect(draft.phrase?.text).toBe('sat 12-1:30pm');
    expect(draft.phrase?.lineWithout).toBe('lunch');
  });

  it('reads a range with no day as today', () => {
    const draft = parseQuickEvent('call from 4 to 5pm', opts);
    expect(draft.title).toBe('call');
    expect(draft.start).toEqual(new Date(2026, 8, 25, 16, 0));
    expect(draft.durationMinutes).toBe(60);
    expect(draft.timed).toBe(true);
  });

  it('reads "between 12 and 1:30pm" as a span, not a deadline', () => {
    // At 2:25pm, so this one lands on the 25th; a day in front ("sat between")
    // is task grammar's to read, and a clock range ("sat 12-1:30pm") is the
    // form that takes one.
    const draft = parseQuickEvent('lunch between 4 and 5:30pm', opts);
    expect(draft.title).toBe('lunch');
    expect(draft.start).toEqual(new Date(2026, 8, 25, 16, 0));
    expect(draft.durationMinutes).toBe(90);
  });

  it('runs a late range past midnight', () => {
    const draft = parseQuickEvent('party sat 11pm-1am', opts);
    expect(draft.start).toEqual(new Date(2026, 8, 26, 23, 0));
    expect(draft.end).toEqual(new Date(2026, 8, 27, 1, 0));
  });

  it('keeps the one-hour default with no length typed', () => {
    const draft = parseQuickEvent('dentist monday 3pm', opts);
    expect(draft.durationMinutes).toBeNull();
    expect(draft.end).toEqual(new Date(2026, 8, 28, 16, 0));
  });

  it('leaves a bare number range in the title', () => {
    const draft = parseQuickEvent('read chapters 3-5', opts);
    expect(draft.title).toBe('read chapters 3-5');
    expect(draft.timed).toBe(false);
  });

  it('reads the trailing clauses in any order', () => {
    const line = "lunch sat 12pm alert 10m for 90m at Joe's";
    const draft = parseQuickEvent(line, opts);
    expect(draft.title).toBe('lunch');
    expect(draft.location).toBe("Joe's");
    expect(draft.alertMinutes).toBe(10);
    expect(draft.durationMinutes).toBe(90);
    expect(line.slice(...draft.locationSpan!)).toBe("at Joe's");
    expect(line.slice(...draft.alertSpan!)).toBe('alert 10m');
    expect(line.slice(...draft.durationSpan!)).toBe('for 90m');
    expect(draft.phrase?.lineWithout).toBe("lunch alert 10m for 90m at Joe's");
  });

  it('says whether a time of day was read', () => {
    expect(parseQuickEvent('lunch fri', opts).timed).toBe(false);
    expect(parseQuickEvent('lunch fri 1pm', opts).timed).toBe(true);
    expect(parseQuickEvent('dinner tomorrow evening', opts).timed).toBe(true);
  });
});

describe('parseClockRange', () => {
  it.each([
    ['x 12-1:30pm', { h: 12, m: 0 }, { h: 13, m: 30 }],
    ['x 6-8pm', { h: 18, m: 0 }, { h: 20, m: 0 }],
    ['x 11-1pm', { h: 11, m: 0 }, { h: 13, m: 0 }],
    ['x 9am-5pm', { h: 9, m: 0 }, { h: 17, m: 0 }],
    ['x 9:30-11', { h: 9, m: 30 }, { h: 11, m: 0 }],
    ['x 2:00-3:00', { h: 14, m: 0 }, { h: 15, m: 0 }],
    ['x 14:00–15:30', { h: 14, m: 0 }, { h: 15, m: 30 }],
  ])('reads %s', (line, from, to) => {
    expect(parseClockRange(line)).toMatchObject({ from, to });
  });

  it('refuses a range with no colon or am/pm, and an impossible time', () => {
    expect(parseClockRange('pages 3-5')).toBeNull();
    expect(parseClockRange('x 25:00-26:00')).toBeNull();
  });
});

describe('parseLengthClause', () => {
  it('reads minutes and hours as a suffix only', () => {
    expect(parseLengthClause('x for 45 min')?.minutes).toBe(45);
    expect(parseLengthClause('x for 1.5 hours')?.minutes).toBe(90);
    expect(parseLengthClause('for 2h of rest')).toBeNull();
    expect(parseLengthClause('x for 30 hours')).toBeNull();
    expect(parseLengthClause('lunch with Sam for an hour')?.minutes).toBe(60);
    expect(parseLengthClause('lunch with Sam for two hours')).toEqual({ start: 14, minutes: 120 });
    expect(parseLengthClause('call for half an hour')?.minutes).toBe(30);
  });
});
