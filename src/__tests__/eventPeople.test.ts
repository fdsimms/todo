import {
  defaultNewEventSpan,
  eventPeopleKey,
  isEventPeopleLinkStale,
  parseEventPeople,
  peopleForEvent,
  pruneStaleEventPeople,
  suggestedEventPeople,
  upcomingEventsWith,
  withEventPeople,
  type EventPeopleLink,
} from '../utils/eventPeople';
import { PAST_CALENDAR_WINDOW_DAYS } from '../utils/calendarHistory';
import type { BusyEvent } from '../utils/calendarBusy';

// calendarHistory reaches dateUtils, which reaches the settings store, which
// reaches expo-sqlite. Same stub calendarHistory's own tests use.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

function event(over: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'e1',
    title: 'Dinner w/ Dustin',
    start: new Date(2026, 7, 20, 18).toISOString(),
    end: new Date(2026, 7, 20, 20).toISOString(),
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...over,
  };
}

const dustin = { id: 'p1', name: 'Dustin Reyes', nickname: '' };
const ansley = { id: 'p2', name: 'Ansley', nickname: '' };

describe('eventPeopleKey', () => {
  it('keys by id and start, so two occurrences of a series are separate', () => {
    const a = event({ start: new Date(2026, 7, 20, 18).toISOString() });
    const b = event({ start: new Date(2026, 7, 27, 18).toISOString() });
    expect(eventPeopleKey(a)).not.toBe(eventPeopleKey(b));
  });

  it('normalises the start, so a read-back Date and a fetched string agree', () => {
    const iso = new Date(2026, 7, 20, 18).toISOString();
    const offsetForm = iso.replace('.000Z', 'Z');
    expect(eventPeopleKey({ id: 'e1', start: offsetForm })).toBe(eventPeopleKey({ id: 'e1', start: iso }));
  });
});

describe('withEventPeople / peopleForEvent', () => {
  it('links people to one occurrence', () => {
    const links = withEventPeople({}, event(), ['p1', 'p2']);
    expect(peopleForEvent(links, event())).toEqual(['p1', 'p2']);
    expect(peopleForEvent(links, event({ start: new Date(2026, 7, 27, 18).toISOString() }))).toEqual([]);
  });

  it('drops duplicates', () => {
    expect(peopleForEvent(withEventPeople({}, event(), ['p1', 'p1']), event())).toEqual(['p1']);
  });

  it('removes the entry when the set goes empty', () => {
    const links = withEventPeople(withEventPeople({}, event(), ['p1']), event(), []);
    expect(links).toEqual({});
  });

  it('does not mutate the input', () => {
    const before = {};
    withEventPeople(before, event(), ['p1']);
    expect(before).toEqual({});
  });
});

describe('pruning', () => {
  const now = new Date(2026, 7, 22, 12);
  const link = (start: Date): EventPeopleLink => ({
    key: 'k',
    eventId: 'e1',
    eventStart: start.toISOString(),
    eventEnd: start.toISOString(),
    title: 'Dinner',
    personIds: ['p1'],
  });

  it('keeps a link for an event that is over but still inside the history window', () => {
    expect(isEventPeopleLinkStale(link(new Date(2026, 7, 20, 18)), now)).toBe(false);
  });

  it('drops a link whose event started before the history window', () => {
    const old = new Date(2026, 7, 22 - PAST_CALENDAR_WINDOW_DAYS - 1, 18);
    expect(isEventPeopleLinkStale(link(old), now)).toBe(true);
    expect(pruneStaleEventPeople({ k: link(old) }, now)).toEqual({});
  });

  it('drops a link with an unreadable start', () => {
    expect(isEventPeopleLinkStale({ ...link(now), eventStart: 'nope' }, now)).toBe(true);
  });
});

describe('parseEventPeople', () => {
  it('reads back what withEventPeople wrote', () => {
    const links = withEventPeople({}, event(), ['p1']);
    expect(parseEventPeople(JSON.stringify(links))).toEqual(links);
  });

  it('treats missing or malformed data as nothing', () => {
    expect(parseEventPeople(null)).toEqual({});
    expect(parseEventPeople('not json')).toEqual({});
    expect(parseEventPeople('[]')).toEqual({});
    expect(parseEventPeople(JSON.stringify({ k: { eventId: 'e1' } }))).toEqual({});
  });

  it('skips an entry with nobody in it', () => {
    const raw = { k: { eventId: 'e1', eventStart: 'a', eventEnd: 'b', title: '', personIds: [] } };
    expect(parseEventPeople(JSON.stringify(raw))).toEqual({});
  });
});

describe('suggestedEventPeople', () => {
  it('suggests people the title names who are not linked yet', () => {
    expect(suggestedEventPeople('Dinner w/ Dustin and Ansley', [dustin, ansley], ['p2'])).toEqual(['p1']);
  });

  it('suggests nobody for a title naming nobody on the list', () => {
    expect(suggestedEventPeople('Dentist', [dustin, ansley], [])).toEqual([]);
  });
});

describe('upcomingEventsWith', () => {
  const now = new Date(2026, 7, 20, 12);

  it('lists linked events that have not finished, soonest first', () => {
    const later = event({ id: 'e2', start: new Date(2026, 7, 25, 18).toISOString(), end: new Date(2026, 7, 25, 20).toISOString() });
    const sooner = event();
    let links = withEventPeople({}, later, ['p1']);
    links = withEventPeople(links, sooner, ['p1']);
    expect(upcomingEventsWith([later, sooner], links, 'p1', now).map(e => e.id)).toEqual(['e1', 'e2']);
  });

  it('leaves out finished, cancelled and unlinked events', () => {
    const past = event({ id: 'past', start: new Date(2026, 7, 19, 18).toISOString(), end: new Date(2026, 7, 19, 20).toISOString() });
    const cancelled = event({ id: 'cancelled', status: 'canceled' });
    const other = event({ id: 'other' });
    let links = withEventPeople({}, past, ['p1']);
    links = withEventPeople(links, cancelled, ['p1']);
    links = withEventPeople(links, other, ['p2']);
    expect(upcomingEventsWith([past, cancelled, other], links, 'p1', now)).toEqual([]);
  });
});

describe('defaultNewEventSpan', () => {
  it('starts at the next whole hour on the current day, an hour long', () => {
    const today = new Date(2026, 7, 20, 0);
    const { start, end } = defaultNewEventSpan(today, today, new Date(2026, 7, 20, 14, 25));
    expect(start).toEqual(new Date(2026, 7, 20, 15));
    expect(end).toEqual(new Date(2026, 7, 20, 16));
  });

  it('starts at 9:00 on any other day', () => {
    const today = new Date(2026, 7, 20, 0);
    const { start, end } = defaultNewEventSpan(new Date(2026, 7, 24, 12), today, new Date(2026, 7, 20, 14, 25));
    expect(start).toEqual(new Date(2026, 7, 24, 9));
    expect(end).toEqual(new Date(2026, 7, 24, 10));
  });

  it('treats the current logical day as today in the grace window', () => {
    // 1:30am with a 2am reset: the logical day is still the 19th.
    const logicalToday = new Date(2026, 7, 19, 2);
    const { start } = defaultNewEventSpan(new Date(2026, 7, 19, 12), logicalToday, new Date(2026, 7, 20, 1, 30));
    expect(start).toEqual(new Date(2026, 7, 20, 2));
  });
});
