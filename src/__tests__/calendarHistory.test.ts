import {
  MIN_CALENDAR_NAME_LENGTH,
  PAST_CALENDAR_WINDOW_DAYS,
  historyEventKey,
  parseHandledHistoryEvents,
  pastWindowStart,
  peopleNamedInTitle,
  pruneHandledHistoryEvents,
  serializeHandledHistoryEvents,
  shouldReadPastCalendar,
  suggestedHistoryEvents,
  type PersonName,
} from '../utils/calendarHistory';
import type { BusyEvent } from '../utils/calendarBusy';

// `dayKeyOf` reaches dateUtils, which reaches the settings store, which reaches
// expo-sqlite. The same stub dateUtils' own tests use — nothing here reads a
// setting, and the day key is deliberately not reset-time aware (see
// `historyEventKey`).
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

const dustin: PersonName = { id: 'p1', name: 'Dustin Reyes', nickname: '' };
const ansley: PersonName = { id: 'p2', name: 'Ansley', nickname: '' };
const mom: PersonName = { id: 'p3', name: 'Marianne Fields', nickname: 'Mom' };

function event(over: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'e1',
    title: 'Dinner w/ Dustin',
    start: '2026-08-20T18:00:00.000Z',
    end: '2026-08-20T20:00:00.000Z',
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...over,
  };
}

const now = new Date('2026-08-25T12:00:00.000Z');

describe('peopleNamedInTitle', () => {
  it('finds a first name inside an ordinary title', () => {
    expect(peopleNamedInTitle('Dinner w/ Dustin', [dustin])).toEqual(['p1']);
  });

  it('finds a full name', () => {
    expect(peopleNamedInTitle('Coffee with Dustin Reyes', [dustin])).toEqual(['p1']);
  });

  it('finds a nickname', () => {
    expect(peopleNamedInTitle('Call Mom', [mom])).toEqual(['p3']);
  });

  it('is case insensitive', () => {
    expect(peopleNamedInTitle('DINNER W/ DUSTIN', [dustin])).toEqual(['p1']);
  });

  it('names everybody a title mentions', () => {
    expect(peopleNamedInTitle('Beach with Dustin and Ansley', [dustin, ansley]).sort())
      .toEqual(['p1', 'p2']);
  });

  it('matches whole words only', () => {
    expect(peopleNamedInTitle('Dust the shelves', [dustin])).toEqual([]);
    expect(peopleNamedInTitle('Dustinism reading group', [dustin])).toEqual([]);
  });

  it('treats an apostrophe as a boundary', () => {
    expect(peopleNamedInTitle("Dustin's place", [dustin])).toEqual(['p1']);
  });

  it('never matches a name shorter than the floor', () => {
    const al: PersonName = { id: 'p9', name: 'Al', nickname: '' };
    expect(MIN_CALENDAR_NAME_LENGTH).toBe(3);
    expect(peopleNamedInTitle('Walk to Palo Alto', [al])).toEqual([]);
    expect(peopleNamedInTitle('Lunch with Al', [al])).toEqual([]);
  });

  it('drops a short nickname but keeps the full name it belongs to', () => {
    const bo: PersonName = { id: 'p8', name: 'Robert Chen', nickname: 'Bo' };
    expect(peopleNamedInTitle('Bo and the bots', [bo])).toEqual([]);
    expect(peopleNamedInTitle('Lunch with Robert', [bo])).toEqual(['p8']);
  });

  it('refuses an ambiguous token rather than guessing', () => {
    const samA: PersonName = { id: 'a', name: 'Sam Ortiz', nickname: '' };
    const samB: PersonName = { id: 'b', name: 'Sam Whitfield', nickname: '' };
    expect(peopleNamedInTitle('Drinks with Sam', [samA, samB])).toEqual([]);
  });

  it('still resolves the more specific token when the shared one is ambiguous', () => {
    const samA: PersonName = { id: 'a', name: 'Sam Ortiz', nickname: '' };
    const samB: PersonName = { id: 'b', name: 'Sam Whitfield', nickname: '' };
    expect(peopleNamedInTitle('Drinks with Sam Ortiz', [samA, samB])).toEqual(['a']);
  });

  it('never invents a person it was not given', () => {
    expect(peopleNamedInTitle('Dinner w/ Priya', [dustin, ansley])).toEqual([]);
  });

  it('handles an empty title and an empty list', () => {
    expect(peopleNamedInTitle('', [dustin])).toEqual([]);
    expect(peopleNamedInTitle('Dinner w/ Dustin', [])).toEqual([]);
  });

  it('normalises runs of whitespace on both sides', () => {
    const spaced: PersonName = { id: 'p7', name: 'Mary  Jane', nickname: '' };
    expect(peopleNamedInTitle('Lunch with Mary   Jane', [spaced])).toEqual(['p7']);
  });

  it('does not let a name containing regex characters blow up', () => {
    const odd: PersonName = { id: 'p6', name: 'A.J. (Alex)', nickname: '' };
    expect(() => peopleNamedInTitle('Dinner with A.J. (Alex)', [odd])).not.toThrow();
    expect(peopleNamedInTitle('Dinner with A.J. (Alex)', [odd])).toEqual(['p6']);
  });
});

describe('historyEventKey', () => {
  it('carries the occurrence day, so a recurring event is not one key', () => {
    const first = historyEventKey({ id: 'weekly', start: '2026-08-11T17:00:00.000Z' });
    const second = historyEventKey({ id: 'weekly', start: '2026-08-18T17:00:00.000Z' });
    expect(first).not.toBe(second);
    expect(first.startsWith('weekly#')).toBe(true);
  });

  it('is stable across calls', () => {
    expect(historyEventKey(event())).toBe(historyEventKey(event()));
  });
});

describe('pastWindowStart', () => {
  it('reaches back exactly the window', () => {
    const floor = pastWindowStart(new Date('2026-08-25T23:30:00'));
    expect(PAST_CALENDAR_WINDOW_DAYS).toBe(90);
    const days = Math.round(
      (new Date('2026-08-25T00:00:00').getTime() - floor.getTime()) / 86400000
    );
    expect(days).toBe(90);
  });
});

describe('suggestedHistoryEvents', () => {
  const people = [dustin, ansley, mom];

  it('offers a past event that named somebody', () => {
    const out = suggestedHistoryEvents([event()], people, {}, now);
    expect(out).toHaveLength(1);
    expect(out[0].personIds).toEqual(['p1']);
    expect(out[0].title).toBe('Dinner w/ Dustin');
    expect(out[0].at).toBe('2026-08-20T18:00:00.000Z');
  });

  it('offers nothing when no name matched', () => {
    expect(suggestedHistoryEvents([event({ title: 'Dentist' })], people, {}, now)).toEqual([]);
  });

  it('skips an event that has not finished', () => {
    const later = event({
      start: '2026-08-25T11:00:00.000Z',
      end: '2026-08-25T13:00:00.000Z',
    });
    expect(suggestedHistoryEvents([later], people, {}, now)).toEqual([]);
  });

  it('skips an event in the future', () => {
    const ahead = event({
      start: '2026-08-29T18:00:00.000Z',
      end: '2026-08-29T20:00:00.000Z',
    });
    expect(suggestedHistoryEvents([ahead], people, {}, now)).toEqual([]);
  });

  it('skips all-day events, which are markers rather than afternoons', () => {
    const birthday = event({ title: "Dustin's birthday", allDay: true });
    expect(suggestedHistoryEvents([birthday], people, {}, now)).toEqual([]);
  });

  it('skips a cancelled event', () => {
    expect(suggestedHistoryEvents([event({ status: 'canceled' })], people, {}, now)).toEqual([]);
  });

  it('keeps an event marked Free, which says nothing about whether it happened', () => {
    const out = suggestedHistoryEvents([event({ availability: 'free' })], people, {}, now);
    expect(out).toHaveLength(1);
  });

  it('skips an event that started before the window floor', () => {
    const old = event({
      start: '2026-01-02T18:00:00.000Z',
      end: '2026-01-02T20:00:00.000Z',
    });
    expect(suggestedHistoryEvents([old], people, {}, now)).toEqual([]);
  });

  it('skips anything already answered, whichever way it was answered', () => {
    const one = event();
    const handled = { [historyEventKey(one)]: '2026-08-20' };
    expect(suggestedHistoryEvents([one], people, handled, now)).toEqual([]);
  });

  it('skips an unparseable date rather than throwing', () => {
    const broken = event({ start: 'not a date', end: 'nor this' });
    expect(suggestedHistoryEvents([broken], people, {}, now)).toEqual([]);
  });

  it('skips an empty title', () => {
    expect(suggestedHistoryEvents([event({ title: '   ' })], people, {}, now)).toEqual([]);
  });

  it('returns newest first', () => {
    const older = event({ id: 'e0', start: '2026-08-10T18:00:00.000Z', end: '2026-08-10T20:00:00.000Z' });
    const newer = event({ id: 'e2', start: '2026-08-22T18:00:00.000Z', end: '2026-08-22T20:00:00.000Z' });
    const out = suggestedHistoryEvents([older, newer], people, {}, now);
    expect(out.map(s => s.eventId)).toEqual(['e2', 'e0']);
  });

  it('carries every person a title named, so one evening is one record', () => {
    const shared = event({ title: 'Beach with Dustin and Ansley' });
    const out = suggestedHistoryEvents([shared], people, {}, now);
    expect(out).toHaveLength(1);
    expect(out[0].personIds.sort()).toEqual(['p1', 'p2']);
  });

  it('offers each occurrence of a recurring event separately', () => {
    const first = event({ id: 'weekly', title: 'Call Mom', start: '2026-08-11T17:00:00.000Z', end: '2026-08-11T17:30:00.000Z' });
    const second = event({ id: 'weekly', title: 'Call Mom', start: '2026-08-18T17:00:00.000Z', end: '2026-08-18T17:30:00.000Z' });
    const out = suggestedHistoryEvents([first, second], people, {}, now);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(s => s.key)).size).toBe(2);
  });

  it('answering one occurrence leaves the others offered', () => {
    const first = event({ id: 'weekly', title: 'Call Mom', start: '2026-08-11T17:00:00.000Z', end: '2026-08-11T17:30:00.000Z' });
    const second = event({ id: 'weekly', title: 'Call Mom', start: '2026-08-18T17:00:00.000Z', end: '2026-08-18T17:30:00.000Z' });
    const handled = { [historyEventKey(first)]: '2026-08-11' };
    const out = suggestedHistoryEvents([first, second], people, handled, now);
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe('2026-08-18T17:00:00.000Z');
  });

  it('every offer it makes is prunable-safe: its day is at or after the floor', () => {
    const straddling = event({
      start: '2026-01-02T18:00:00.000Z',
      end: '2026-08-20T20:00:00.000Z',
    });
    const out = suggestedHistoryEvents([straddling, event()], [dustin], {}, now);
    const floorDay = pastWindowStart(now).toISOString().slice(0, 10);
    for (const suggestion of out) {
      expect(suggestion.key.split('#').pop()! >= floorDay).toBe(true);
    }
  });
});

describe('shouldReadPastCalendar', () => {
  const on = {
    calendarReadEnabled: true,
    calendarPeopleHistory: true,
    calendarCount: 2,
    demoActive: false,
    ios: true,
  };

  it('reads when everything is on', () => {
    expect(shouldReadPastCalendar(on)).toBe(true);
  });

  it('never reads in demo mode', () => {
    // Real events attributed to an invented person, and an answer written into
    // a database about to be thrown away. See the note on the function.
    expect(shouldReadPastCalendar({ ...on, demoActive: true })).toBe(false);
  });

  it('never reads with the feature switched off', () => {
    expect(shouldReadPastCalendar({ ...on, calendarPeopleHistory: false })).toBe(false);
  });

  it('never reads with calendar reading switched off', () => {
    expect(shouldReadPastCalendar({ ...on, calendarReadEnabled: false })).toBe(false);
  });

  it('never reads with no calendar chosen', () => {
    // An empty id array reaches predicateForEvents with calendars: nil, which
    // means every calendar on the device — see fetchEvents.
    expect(shouldReadPastCalendar({ ...on, calendarCount: 0 })).toBe(false);
  });

  it('never reads off iOS', () => {
    expect(shouldReadPastCalendar({ ...on, ios: false })).toBe(false);
  });
});

describe('the handled record', () => {
  it('round-trips', () => {
    const record = { 'a#2026-08-20': '2026-08-20', 'b#2026-07-01': '2026-07-01' };
    expect(parseHandledHistoryEvents(serializeHandledHistoryEvents(record))).toEqual(record);
  });

  it('serialises stably whatever order it was built in', () => {
    const one = serializeHandledHistoryEvents({ b: '2026-08-01', a: '2026-07-01' });
    const two = serializeHandledHistoryEvents({ a: '2026-07-01', b: '2026-08-01' });
    expect(one).toBe(two);
  });

  it('reads nothing as an empty record rather than throwing', () => {
    expect(parseHandledHistoryEvents(null)).toEqual({});
    expect(parseHandledHistoryEvents('')).toEqual({});
    expect(parseHandledHistoryEvents('not json')).toEqual({});
    expect(parseHandledHistoryEvents('[1,2,3]')).toEqual({});
    expect(parseHandledHistoryEvents('"a string"')).toEqual({});
  });

  it('drops entries that are not day strings', () => {
    expect(parseHandledHistoryEvents('{"a":1,"b":"2026-08-20","c":null}'))
      .toEqual({ b: '2026-08-20' });
  });

  it('prunes what the window can no longer reach', () => {
    const record = {
      'old#2026-01-02': '2026-01-02',
      'edge#2026-05-27': '2026-05-27',
      'new#2026-08-20': '2026-08-20',
    };
    expect(pruneHandledHistoryEvents(record, '2026-05-27')).toEqual({
      'edge#2026-05-27': '2026-05-27',
      'new#2026-08-20': '2026-08-20',
    });
  });

  it('is bounded by the window: nothing older than the floor survives', () => {
    const record: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      const day = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
      record[`e${i}#${day}`] = day;
    }
    const pruned = pruneHandledHistoryEvents(record, '2026-05-27');
    expect(Object.keys(pruned).length).toBeLessThan(Object.keys(record).length);
    for (const day of Object.values(pruned)) expect(day >= '2026-05-27').toBe(true);
  });
});
