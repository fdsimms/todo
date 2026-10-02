import { alertRelativeOffset, describeEventRepeat, eventMarkerText, parseAlertClause, parseQuickEvent } from '../utils/quickEvent';
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
  { id: 'p1', name: 'Dustin Reyes', nickname: '' },
  { id: 'p2', name: 'Ansley', nickname: '' },
];
const names: Record<string, string> = { p1: 'Dustin', p2: 'Ansley' };
const opts = { people, nameOf: (id: string) => names[id] ?? null, now, today, wallClock: now };

describe('parseQuickEvent', () => {
  it('reads a day, a clock time and a person', () => {
    const draft = parseQuickEvent('lunch w/ @dustin sat 12pm', opts);
    expect(draft.title).toBe('lunch w/ Dustin');
    expect(draft.start).toEqual(new Date(2026, 8, 26, 12, 0));
    expect(draft.end).toEqual(new Date(2026, 8, 26, 13, 0));
    expect(draft.personIds).toEqual(['p1']);
    expect(draft.scheduled).toBe(true);
  });

  it('names everybody mentioned', () => {
    const draft = parseQuickEvent('beach with @dustin and @ansley tomorrow', opts);
    expect(draft.title).toBe('beach with Dustin and Ansley');
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
    const draft = parseQuickEvent('lunch w/ @dustin sat 12pm', opts);
    expect(draft.phrase).toEqual({ start: 17, text: 'sat 12pm', lineWithout: 'lunch w/ @dustin' });
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
  it('reads a place and an alert after the schedule phrase', () => {
    const line = "lunch w/ @dustin fri 12p at Joe's alert 30m";
    const draft = parseQuickEvent(line, opts);
    expect(draft.title).toBe('lunch w/ Dustin');
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
    expect(eventMarkerText('event: lunch w/ @dustin sat 12pm')).toBe('lunch w/ @dustin sat 12pm');
    expect(eventMarkerText('  Event:dinner')).toBe('dinner');
  });

  it('leaves ordinary titles alone', () => {
    expect(eventMarkerText('event planning')).toBeNull();
    expect(eventMarkerText('book the event: venue')).toBeNull();
  });
});
