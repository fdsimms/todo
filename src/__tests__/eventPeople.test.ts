import {
  defaultNewEventSpan,
  eventPeopleKeys,
  indexEventPeople,
  isEventPeopleLinkStale,
  legacyEventPeopleRows,
  peopleForEvent,
  planEventPeopleWrite,
  staleEventPeopleIds,
  suggestedEventPeople,
  upcomingEventsWith,
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

const link = (over: Partial<EventPeopleLink> = {}): EventPeopleLink => ({
  id: 'r1',
  eventKey: `e1#${new Date(2026, 7, 20, 18).toISOString()}`,
  eventStart: new Date(2026, 7, 20, 18).toISOString(),
  eventEnd: new Date(2026, 7, 20, 20).toISOString(),
  title: 'Dinner',
  personIds: ['p1'],
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const fresh = { id: 'new', now: '2026-08-02T00:00:00.000Z' };

describe('eventPeopleKeys', () => {
  it('keys by id and start, so two occurrences of a series are separate', () => {
    const a = event({ start: new Date(2026, 7, 20, 18).toISOString() });
    const b = event({ start: new Date(2026, 7, 27, 18).toISOString() });
    expect(eventPeopleKeys(a, {})).not.toEqual(eventPeopleKeys(b, {}));
  });

  it('normalises the start, so a read-back Date and a fetched string agree', () => {
    const iso = new Date(2026, 7, 20, 18).toISOString();
    expect(eventPeopleKeys({ id: 'e1', start: iso.replace('.000Z', 'Z') }, {})).toEqual(eventPeopleKeys({ id: 'e1', start: iso }, {}));
  });

  it('prefers the server id when known, and keeps the local id as the fallback', () => {
    const keys = eventPeopleKeys(event(), { e1: 'google-abc' });
    expect(keys[0].startsWith('google-abc#')).toBe(true);
    expect(keys[1].startsWith('e1#')).toBe(true);
  });
});

describe('peopleForEvent', () => {
  it('finds a link written under the local id', () => {
    const index = indexEventPeople([link()], {});
    expect(peopleForEvent(index, event())).toEqual(['p1']);
  });

  it('finds a link written under the server id, on a device whose local id differs', () => {
    const start = new Date(2026, 7, 20, 18).toISOString();
    const index = indexEventPeople([link({ eventKey: `google-abc#${start}` })], { otherLocalId: 'google-abc' });
    expect(peopleForEvent(index, event({ id: 'otherLocalId' }))).toEqual(['p1']);
  });

  it('unions duplicates from two devices linking the same occurrence', () => {
    const index = indexEventPeople([link(), link({ id: 'r2', personIds: ['p2', 'p1'] })], {});
    expect(peopleForEvent(index, event())).toEqual(['p1', 'p2']);
  });

  it('keeps occurrences apart', () => {
    const index = indexEventPeople([link()], {});
    expect(peopleForEvent(index, event({ start: new Date(2026, 7, 27, 18).toISOString() }))).toEqual([]);
  });
});

describe('planEventPeopleWrite', () => {
  it('creates one row under the preferred key', () => {
    const write = planEventPeopleWrite(indexEventPeople([], { e1: 'google-abc' }), event(), ['p1', 'p1'], fresh);
    expect(write.deleteIds).toEqual([]);
    expect(write.upsert).toMatchObject({ id: 'new', personIds: ['p1'], createdAt: fresh.now });
    expect(write.upsert!.eventKey.startsWith('google-abc#')).toBe(true);
  });

  it('rewrites the existing row in place, so sync sees an edit', () => {
    const write = planEventPeopleWrite(indexEventPeople([link()], {}), event(), ['p1', 'p2'], fresh);
    expect(write.upsert).toMatchObject({ id: 'r1', personIds: ['p1', 'p2'], createdAt: link().createdAt });
    expect(write.deleteIds).toEqual([]);
  });

  it('moves a local-id link onto the server id once that is known', () => {
    const write = planEventPeopleWrite(indexEventPeople([link()], { e1: 'google-abc' }), event(), ['p1'], fresh);
    expect(write.upsert!.id).toBe('new');
    expect(write.upsert!.eventKey.startsWith('google-abc#')).toBe(true);
    expect(write.deleteIds).toEqual(['r1']);
  });

  it('folds duplicates back into one row', () => {
    const write = planEventPeopleWrite(indexEventPeople([link(), link({ id: 'r2' })], {}), event(), ['p1'], fresh);
    expect(write.upsert!.id).toBe('r1');
    expect(write.deleteIds).toEqual(['r2']);
  });

  it('deletes every row for the occurrence when the set goes empty', () => {
    const write = planEventPeopleWrite(indexEventPeople([link(), link({ id: 'r2' })], {}), event(), [], fresh);
    expect(write).toEqual({ upsert: null, deleteIds: ['r1', 'r2'] });
  });
});

describe('pruning', () => {
  const now = new Date(2026, 7, 22, 12);

  it('keeps a link for an event that is over but still inside the history window', () => {
    expect(isEventPeopleLinkStale({ eventStart: new Date(2026, 7, 20, 18).toISOString() }, now)).toBe(false);
  });

  it('drops a link whose event started before the history window', () => {
    const old = new Date(2026, 7, 22 - PAST_CALENDAR_WINDOW_DAYS - 1, 18).toISOString();
    expect(staleEventPeopleIds([link({ eventStart: old }), link({ id: 'r2' })], now)).toEqual(['r1']);
  });

  it('drops a link with an unreadable start', () => {
    expect(isEventPeopleLinkStale({ eventStart: 'nope' }, now)).toBe(true);
  });
});

describe('legacyEventPeopleRows', () => {
  let n = 0;
  const newId = () => `id${++n}`;

  it('turns the old setting into rows keyed by the local id', () => {
    const start = new Date(2026, 7, 20, 18).toISOString();
    const raw = JSON.stringify({ [`e1|${start}`]: { key: `e1|${start}`, eventId: 'e1', eventStart: start, eventEnd: start, title: 'Dinner', personIds: ['p1'] } });
    const rows = legacyEventPeopleRows(raw, newId, fresh.now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventKey: `e1#${start}`, personIds: ['p1'], title: 'Dinner', createdAt: fresh.now });
    expect(peopleForEvent(indexEventPeople(rows, {}), event())).toEqual(['p1']);
  });

  it('treats missing or malformed data as nothing', () => {
    expect(legacyEventPeopleRows(null, newId, fresh.now)).toEqual([]);
    expect(legacyEventPeopleRows('not json', newId, fresh.now)).toEqual([]);
    expect(legacyEventPeopleRows('[]', newId, fresh.now)).toEqual([]);
    expect(legacyEventPeopleRows(JSON.stringify({ k: { eventId: 'e1' } }), newId, fresh.now)).toEqual([]);
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

/** An index holding one row per [event, people] pair, keyed by local id. */
function linksFor(pairs: [BusyEvent, string[]][]) {
  const rows = pairs.map(([e, ids], i) => link({
    id: `r${i}`,
    eventKey: eventPeopleKeys(e, {})[0],
    eventStart: e.start,
    eventEnd: e.end,
    personIds: ids,
  }));
  return indexEventPeople(rows, {});
}

describe('upcomingEventsWith', () => {
  const now = new Date(2026, 7, 20, 12);

  it('lists linked events that have not finished, soonest first', () => {
    const later = event({ id: 'e2', start: new Date(2026, 7, 25, 18).toISOString(), end: new Date(2026, 7, 25, 20).toISOString() });
    const sooner = event();
    const links = linksFor([[later, ['p1']], [sooner, ['p1']]]);
    expect(upcomingEventsWith([later, sooner], links, 'p1', now).map(e => e.id)).toEqual(['e1', 'e2']);
  });

  it('leaves out finished, cancelled and unlinked events', () => {
    const past = event({ id: 'past', start: new Date(2026, 7, 19, 18).toISOString(), end: new Date(2026, 7, 19, 20).toISOString() });
    const cancelled = event({ id: 'cancelled', status: 'canceled' });
    const other = event({ id: 'other' });
    const links = linksFor([[past, ['p1']], [cancelled, ['p1']], [other, ['p2']]]);
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
