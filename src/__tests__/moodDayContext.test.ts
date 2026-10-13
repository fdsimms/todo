import { moodDayOffers, type MoodDayInputs } from '../utils/moodDayContext';
import {
  EXERCISED_MINUTES,
  OUTSIDE_MINUTES,
  NO_MOOD_CONTEXT_SOURCES,
  parseMoodContextSources,
  type MoodContextSources,
} from '../utils/moodContextSources';
import { indexEventPeople } from '../utils/eventPeople';
import type { BusyEvent } from '../utils/calendarBusy';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const on = (over: Partial<MoodContextSources> = {}): MoodContextSources => ({
  dayOff: true, social: true, birthday: true, exercise: true, outside: true, ...over,
});

const event = (over: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'e1', title: 'Dinner', start: new Date(2026, 6, 4, 19).toISOString(), end: new Date(2026, 6, 4, 21).toISOString(),
  allDay: false, calendarId: 'c', location: null, status: 'confirmed', availability: 'busy', ...over,
});

const linkFor = (e: BusyEvent, personIds: string[]) => ({
  id: 'l1', eventKey: `${e.id}#${new Date(e.start).toISOString()}`, eventStart: e.start, personIds,
}) as never;

const base = (over: Partial<MoodDayInputs> = {}): MoodDayInputs => ({
  dayKey: '2026-07-04',
  dayStart: new Date(2026, 6, 4),
  dayEnd: new Date(2026, 6, 5),
  isToday: true,
  holidays: { set: 'us', custom: [] },
  events: [],
  eventPeople: indexEventPeople([], {}),
  people: [],
  exerciseMinutesToday: null,
  daylightMinutesToday: null,
  ...over,
});

describe('moodDayOffers', () => {
  it('offers nothing when every source is off', () => {
    const e = event();
    const out = moodDayOffers(NO_MOOD_CONTEXT_SOURCES, base({
      events: [e], eventPeople: indexEventPeople([linkFor(e, ['p'])], {}),
      people: [{ birthdayMonth: 7, birthdayDay: 4, archived: false }], exerciseMinutesToday: 90, daylightMinutesToday: 90,
    }));
    expect(out).toEqual([]);
  });

  it('offers Holiday on a public holiday and Day off on your own', () => {
    expect(moodDayOffers(on(), base())).toContain('Holiday');
    expect(moodDayOffers(on(), base({
      dayKey: '2026-07-10', holidays: { set: 'us', custom: ['2026-07-10'] },
    }))).toContain('Day off');
    expect(moodDayOffers(on(), base({ dayKey: '2026-07-09' }))).not.toContain('Holiday');
  });

  it('offers Social event only for an event with someone linked, on that day', () => {
    const e = event();
    const linked = indexEventPeople([linkFor(e, ['p'])], {});
    expect(moodDayOffers(on(), base({ events: [e], eventPeople: linked }))).toContain('Social event');
    expect(moodDayOffers(on(), base({ events: [e] }))).not.toContain('Social event');
    const elsewhere = event({ start: new Date(2026, 6, 6, 19).toISOString() });
    expect(moodDayOffers(on(), base({ events: [elsewhere], eventPeople: indexEventPeople([linkFor(elsewhere, ['p'])], {}) })))
      .not.toContain('Social event');
    const canceled = event({ status: 'canceled' });
    expect(moodDayOffers(on(), base({ events: [canceled], eventPeople: indexEventPeople([linkFor(canceled, ['p'])], {}) })))
      .not.toContain('Social event');
  });

  it('offers nothing about events when the calendar was not read', () => {
    const e = event();
    expect(moodDayOffers(on(), base({ events: null, eventPeople: indexEventPeople([linkFor(e, ['p'])], {}) })))
      .not.toContain('Social event');
  });

  it('offers Birthday for a live person whose birthday is the day, and not for an archived one', () => {
    const people = [{ birthdayMonth: 7, birthdayDay: 4, archived: false }];
    expect(moodDayOffers(on(), base({ people }))).toContain('Birthday');
    expect(moodDayOffers(on(), base({ people: [{ ...people[0], archived: true }] }))).not.toContain('Birthday');
    expect(moodDayOffers(on(), base({ people: [{ birthdayMonth: 7, birthdayDay: 5, archived: false }] }))).not.toContain('Birthday');
    expect(moodDayOffers(on(), base({ people: [{ birthdayMonth: null, birthdayDay: null, archived: false }] }))).not.toContain('Birthday');
  });

  it('offers Exercised from the threshold, today only, and never from missing data', () => {
    expect(moodDayOffers(on(), base({ exerciseMinutesToday: EXERCISED_MINUTES }))).toContain('Exercised');
    expect(moodDayOffers(on(), base({ exerciseMinutesToday: EXERCISED_MINUTES - 1 }))).not.toContain('Exercised');
    expect(moodDayOffers(on(), base({ exerciseMinutesToday: null }))).not.toContain('Exercised');
    expect(moodDayOffers(on(), base({ isToday: false, exerciseMinutesToday: 90 }))).not.toContain('Exercised');
  });

  it('offers Went outside from the daylight threshold, today only, and never from missing data', () => {
    expect(moodDayOffers(on(), base({ daylightMinutesToday: OUTSIDE_MINUTES }))).toContain('Went outside');
    expect(moodDayOffers(on(), base({ daylightMinutesToday: OUTSIDE_MINUTES - 1 }))).not.toContain('Went outside');
    expect(moodDayOffers(on(), base({ daylightMinutesToday: null }))).not.toContain('Went outside');
    expect(moodDayOffers(on(), base({ isToday: false, daylightMinutesToday: 90 }))).not.toContain('Went outside');
    expect(moodDayOffers(on({ outside: false }), base({ daylightMinutesToday: 90 }))).not.toContain('Went outside');
  });

  it('keeps each switch independent', () => {
    expect(moodDayOffers(on({ dayOff: false }), base())).not.toContain('Holiday');
  });
});

describe('parseMoodContextSources', () => {
  it('reads what was stored and treats anything unreadable as off', () => {
    expect(parseMoodContextSources(JSON.stringify({ dayOff: true, social: 'yes' }))).toEqual({
      dayOff: true, social: false, birthday: false, exercise: false, outside: false,
    });
    expect(parseMoodContextSources('not json')).toEqual(NO_MOOD_CONTEXT_SOURCES);
    expect(parseMoodContextSources(null)).toEqual(NO_MOOD_CONTEXT_SOURCES);
    expect(parseMoodContextSources('[]')).toEqual(NO_MOOD_CONTEXT_SOURCES);
  });
});
