import {
  eventDetailEntries,
  eventDetailsDayKey,
  eventDetailsTitle,
  isEventDetailsSkipped,
  placeInTitle,
  withEventDetailsSkipped,
} from '../utils/eventDetailTasks';
import type { BusyEvent } from '../utils/calendarBusy';
import type { PersonName } from '../utils/calendarHistory';
import type { Task } from '../types';

// calendarHistory reaches dateUtils, which reaches the settings store; the
// same stub quickEvent.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

const NOW = new Date(2026, 10, 17, 12);

function makeEvent(overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'e-1',
    title: 'Dinner with Kristen at Zatar',
    start: new Date(2026, 10, 20, 19).toISOString(),
    end: new Date(2026, 10, 20, 21).toISOString(),
    allDay: false,
    calendarId: 'cal-1',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

const PEOPLE: PersonName[] = [
  { id: 'kristen', name: 'Kristen Alvarez', nickname: '' },
  { id: 'sam', name: 'Sam Ortiz', nickname: '' },
  { id: 'tessa', name: 'Tessa Lin', nickname: '' },
];

const noLinks = () => [] as string[];

describe('placeInTitle', () => {
  it.each([
    ['Dinner with Kristen at Zatar', 'Zatar'],
    ['Drinks @ The Ten Bells', 'The Ten Bells'],
    ['Drinks @Zatar', 'Zatar'],
    ['Drinks at Zatar with Kristen', 'Zatar'],
    ['Drinks at Zatar w/ Kristen', 'Zatar'],
    ['Lunch at Jo’s at 1pm', 'Jo’s'],
    ['Meet at 7 at Zatar', 'Zatar'],
    ['Book club at Joe’s.', 'Joe’s'],
  ])('reads %s as %s', (title, place) => {
    expect(placeInTitle(title, PEOPLE)).toBe(place);
  });

  it.each([
    'Standup at 9:30',
    'Call at 3pm',
    'Lunch at noon',
    'Dinner at home',
    'Late at work',
    'Dinner with Kristen',
    'Chat with Sam',
    'Email sam@example.com',
    'Dinner at Kristen’s',
  ])('finds no place in %s', title => {
    expect(placeInTitle(title, PEOPLE)).toBeNull();
  });
});

describe('eventDetailEntries', () => {
  it('offers the person and the place a title names', () => {
    const [entry] = eventDetailEntries([makeEvent()], PEOPLE, noLinks, {}, NOW);
    expect(entry.people).toEqual([{ personId: 'kristen', done: false }]);
    expect(entry.place).toEqual({ text: 'Zatar', done: false });
  });

  it('reads people only after "with", so a name earlier in the title links nobody', () => {
    const entries = eventDetailEntries([makeEvent({ title: 'Kristen’s birthday dinner' })], PEOPLE, noLinks, {}, NOW);
    expect(entries).toEqual([]);
  });

  it('names nobody it does not already know', () => {
    const entries = eventDetailEntries([makeEvent({ title: 'Dinner with Gideon' })], PEOPLE, noLinks, {}, NOW);
    expect(entries).toEqual([]);
  });

  it('shows an added person while the event still has something open', () => {
    const event = makeEvent({ title: 'Lunch w/ Sam and Tessa' });
    const [entry] = eventDetailEntries([event], PEOPLE, () => ['sam'], {}, NOW);
    expect(entry.people).toEqual([
      { personId: 'sam', done: true },
      { personId: 'tessa', done: false },
    ]);
  });

  it('drops an event once everything on it is answered', () => {
    const event = makeEvent({ location: 'Zatar, 2nd Ave' });
    expect(eventDetailEntries([event], PEOPLE, () => ['kristen'], {}, NOW)).toEqual([]);
  });

  it('reads a location that already starts with the place as added', () => {
    const [entry] = eventDetailEntries([makeEvent({ location: 'Zatar\n2nd Ave' })], PEOPLE, noLinks, {}, NOW);
    expect(entry.place).toEqual({ text: 'Zatar', done: true });
  });

  it('offers no place when the event already has a different location', () => {
    const [entry] = eventDetailEntries([makeEvent({ location: 'Somewhere else' })], PEOPLE, noLinks, {}, NOW);
    expect(entry.place).toBeNull();
    expect(entry.people).toHaveLength(1);
  });

  it('lists nothing that has already started, so a task deferred past its events lists none', () => {
    const started = makeEvent({ start: new Date(2026, 10, 17, 11).toISOString() });
    expect(eventDetailEntries([started], PEOPLE, noLinks, {}, NOW)).toEqual([]);
  });

  it('lists nothing cancelled', () => {
    expect(eventDetailEntries([makeEvent({ status: 'canceled' })], PEOPLE, noLinks, {}, NOW)).toEqual([]);
  });

  it('leaves out a skipped occurrence but not the next one of the same event', () => {
    const first = makeEvent();
    const second = makeEvent({
      start: new Date(2026, 10, 27, 19).toISOString(),
      end: new Date(2026, 10, 27, 21).toISOString(),
    });
    const skipped = withEventDetailsSkipped({}, first);
    const entries = eventDetailEntries([first, second], PEOPLE, noLinks, skipped, NOW);
    expect(entries.map(e => e.event.start)).toEqual([second.start]);
  });

  it('lists each occurrence once and soonest first', () => {
    const later = makeEvent({ id: 'e-2', title: 'Drinks @ Zatar', start: new Date(2026, 10, 25, 18).toISOString() });
    const sooner = makeEvent({ id: 'e-3', title: 'Lunch w/ Sam', start: new Date(2026, 10, 18, 12).toISOString() });
    const entries = eventDetailEntries([later, sooner, later], PEOPLE, noLinks, {}, NOW);
    expect(entries.map(e => e.event.id)).toEqual(['e-3', 'e-2']);
  });
});

describe('skipped record', () => {
  it('finds a skip filed under the local id once the server id is known', () => {
    const local = makeEvent();
    const skipped = withEventDetailsSkipped({}, local);
    expect(isEventDetailsSkipped({ ...local, externalId: 'server-1' }, skipped)).toBe(true);
  });

  it('values a skip by the occurrence end, so it prunes itself', () => {
    const event = makeEvent();
    expect(Object.values(withEventDetailsSkipped({}, event))).toEqual([event.end]);
  });
});

describe('eventDetailsTitle and eventDetailsDayKey', () => {
  it('counts the events', () => {
    expect(eventDetailsTitle(1)).toBe('Add details to 1 event');
    expect(eventDetailsTitle(3)).toBe('Add details to 3 events');
  });

  it('reads the day key off its own kind only', () => {
    const own = { generatedKind: 'eventDetails', generatedSourceId: '2026-11-17' } as Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    const other = { generatedKind: 'calendarReview', generatedSourceId: '2026-11-17' } as Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    expect(eventDetailsDayKey(own)).toBe('2026-11-17');
    expect(eventDetailsDayKey(other)).toBeNull();
  });
});
