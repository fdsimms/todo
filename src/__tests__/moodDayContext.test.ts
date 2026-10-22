import { moodDayOffers, rainForDay, type MoodDayInputs } from '../utils/moodDayContext';
import {
  EXERCISED_MINUTES,
  OUTSIDE_MINUTES,
  RAIN_TAG_MM,
  NO_MOOD_CONTEXT_SOURCES,
  parseMoodContextSources,
  parseMoodEventTags,
  type MoodEventTag,
  type MoodContextSources,
} from '../utils/moodContextSources';
import { indexEventPeople } from '../utils/eventPeople';
import type { BusyEvent } from '../utils/calendarBusy';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const on = (over: Partial<MoodContextSources> = {}): MoodContextSources => ({
  dayOff: true, social: true, exercise: true, workout: true, shortNight: true, outside: true, rain: true, ...over,
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
  exerciseMinutesToday: null,
  daylightMinutesToday: null,
  eventTags: [],
  trainingDays: new Set(),
  sleepMinutes: null,
  shortNightMinutes: 360,
  rain: null,
  ...over,
});

describe('moodDayOffers', () => {
  it('offers nothing when every source is off', () => {
    const e = event();
    const out = moodDayOffers(NO_MOOD_CONTEXT_SOURCES, base({
      events: [e], eventPeople: indexEventPeople([linkFor(e, ['p'])], {}),
      exerciseMinutesToday: 90, daylightMinutesToday: 90,
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

  it('offers Worked out from the threshold, today only, and never from missing data', () => {
    expect(moodDayOffers(on(), base({ exerciseMinutesToday: EXERCISED_MINUTES }))).toContain('Worked out');
    expect(moodDayOffers(on(), base({ exerciseMinutesToday: EXERCISED_MINUTES - 1 }))).not.toContain('Worked out');
    expect(moodDayOffers(on(), base({ exerciseMinutesToday: null }))).not.toContain('Worked out');
    expect(moodDayOffers(on(), base({ isToday: false, exerciseMinutesToday: 90 }))).not.toContain('Worked out');
  });

  it('offers Went outside from the daylight threshold, today only, and never from missing data', () => {
    expect(moodDayOffers(on(), base({ daylightMinutesToday: OUTSIDE_MINUTES }))).toContain('Went outside');
    expect(moodDayOffers(on(), base({ daylightMinutesToday: OUTSIDE_MINUTES - 1 }))).not.toContain('Went outside');
    expect(moodDayOffers(on(), base({ daylightMinutesToday: null }))).not.toContain('Went outside');
    expect(moodDayOffers(on(), base({ isToday: false, daylightMinutesToday: 90 }))).not.toContain('Went outside');
    expect(moodDayOffers(on({ outside: false }), base({ daylightMinutesToday: 90 }))).not.toContain('Went outside');
  });

  it('offers Worked out for a day a workout was finished, any day, and only once with Health too', () => {
    const trainingDays = new Set(['2026-07-03']);
    expect(moodDayOffers(on(), base({ isToday: false, dayKey: '2026-07-03', trainingDays }))).toContain('Worked out');
    expect(moodDayOffers(on(), base({ trainingDays }))).not.toContain('Worked out');
    expect(moodDayOffers(on({ workout: false }), base({ dayKey: '2026-07-03', trainingDays }))).not.toContain('Worked out');
    const both = moodDayOffers(on(), base({
      trainingDays: new Set(['2026-07-04']), exerciseMinutesToday: EXERCISED_MINUTES,
    }));
    expect(both.filter(t => t === 'Worked out')).toHaveLength(1);
  });

  it('offers Short night under the threshold the person set, and never from no reading', () => {
    expect(moodDayOffers(on(), base({ sleepMinutes: 300, shortNightMinutes: 360 }))).toContain('Short night');
    expect(moodDayOffers(on(), base({ sleepMinutes: 360, shortNightMinutes: 360 }))).not.toContain('Short night');
    expect(moodDayOffers(on(), base({ sleepMinutes: 400, shortNightMinutes: 420 }))).toContain('Short night');
    expect(moodDayOffers(on(), base({ sleepMinutes: null }))).not.toContain('Short night');
    expect(moodDayOffers(on(), base({ sleepMinutes: 0 }))).not.toContain('Short night');
    expect(moodDayOffers(on({ shortNight: false }), base({ sleepMinutes: 200 }))).not.toContain('Short night');
  });

  it('offers Rain only for rain that was seen to fall, over the floor', () => {
    expect(moodDayOffers(on(), base({ rain: { mm: RAIN_TAG_MM, observed: true } }))).toContain('Rain');
    expect(moodDayOffers(on(), base({ rain: { mm: RAIN_TAG_MM - 0.5, observed: true } }))).not.toContain('Rain');
    expect(moodDayOffers(on(), base({ rain: { mm: 12, observed: false } }))).not.toContain('Rain');
    expect(moodDayOffers(on(), base({ rain: { mm: null, observed: true } }))).not.toContain('Rain');
    expect(moodDayOffers(on(), base({ rain: null }))).not.toContain('Rain');
    expect(moodDayOffers(on({ rain: false }), base({ rain: { mm: 12, observed: true } }))).not.toContain('Rain');
  });

  it('offers a keyword rule\'s tag for a matching event that day, whole words only', () => {
    const rule: MoodEventTag = { id: 'r', title: 'Therapy', enabled: true, matches: ['therapy'] };
    const sources = { ...NO_MOOD_CONTEXT_SOURCES };
    expect(moodDayOffers(sources, base({ eventTags: [rule], events: [event({ title: 'Therapy w/ Dr K' })] })))
      .toEqual(['Therapy']);
    expect(moodDayOffers(sources, base({ eventTags: [rule], events: [event({ title: 'Physiotherapy' })] })))
      .toEqual([]);
    expect(moodDayOffers(sources, base({ eventTags: [{ ...rule, enabled: false }], events: [event({ title: 'Therapy' })] })))
      .toEqual([]);
    expect(moodDayOffers(sources, base({ eventTags: [rule], events: [event({ title: 'Therapy', status: 'canceled' })] })))
      .toEqual([]);
    expect(moodDayOffers(sources, base({
      eventTags: [rule],
      events: [event({ title: 'Therapy', start: new Date(2026, 6, 5, 10).toISOString() })],
    }))).toEqual([]);
    expect(moodDayOffers(sources, base({ eventTags: [rule], events: null }))).toEqual([]);
  });

  it('does not offer the same tag twice when two rules name it', () => {
    const rules: MoodEventTag[] = [
      { id: 'a', title: 'In office', enabled: true, matches: ['office'] },
      { id: 'b', title: 'in office', enabled: true, matches: ['standup'] },
    ];
    const events = [event({ title: 'Office day' }), event({ id: 'e2', title: 'Standup' })];
    expect(moodDayOffers(NO_MOOD_CONTEXT_SOURCES, base({ eventTags: rules, events }))).toEqual(['In office']);
  });

  it('keeps each switch independent', () => {
    expect(moodDayOffers(on({ dayOff: false }), base())).not.toContain('Holiday');
  });
});

describe('rainForDay', () => {
  const hour = (h: number, weatherCode: number) => ({ hour: h, weatherCode, tempF: 60 });
  const snapshot = {
    yesterdayPrecipitationMm: 8,
    todayPrecipitationMm: 6,
    todayHours: [hour(8, 3), hour(14, 61)],
  };

  it('counts today only once rain has fallen in an hour already gone', () => {
    expect(rainForDay('2026-07-04', snapshot, '2026-07-04', 10)).toEqual({ mm: 6, observed: false });
    expect(rainForDay('2026-07-04', snapshot, '2026-07-04', 15)).toEqual({ mm: 6, observed: true });
  });

  it('reads yesterday as a record, and knows nothing of any other day', () => {
    expect(rainForDay('2026-07-03', snapshot, '2026-07-04', 0)).toEqual({ mm: 8, observed: true });
    expect(rainForDay('2026-07-02', snapshot, '2026-07-04', 0)).toBeNull();
    expect(rainForDay('2026-07-04', null, null, 12)).toBeNull();
  });
});

describe('parseMoodEventTags', () => {
  it('keeps a rule with a tag and a keyword, and drops one missing either', () => {
    const raw = JSON.stringify([
      { id: 'a', title: ' Therapy ', enabled: true, matches: ['therapy', 'Therapy', ' '] },
      { id: 'b', title: '', enabled: true, matches: ['office'] },
      { id: 'c', title: 'Gym', enabled: false, matches: [] },
      { id: 'd', title: 'In office', enabled: false, matches: ['office'] },
    ]);
    expect(parseMoodEventTags(raw)).toEqual([
      { id: 'a', title: 'Therapy', enabled: true, matches: ['therapy'] },
      { id: 'd', title: 'In office', enabled: false, matches: ['office'] },
    ]);
    expect(parseMoodEventTags('nope')).toEqual([]);
    expect(parseMoodEventTags(null)).toEqual([]);
  });
});

describe('parseMoodContextSources', () => {
  it('reads what was stored and treats anything unreadable as off', () => {
    expect(parseMoodContextSources(JSON.stringify({ dayOff: true, social: 'yes' }))).toEqual({
      dayOff: true, social: false, exercise: false, workout: false, shortNight: false, outside: false, rain: false,
    });
    expect(parseMoodContextSources('not json')).toEqual(NO_MOOD_CONTEXT_SOURCES);
    expect(parseMoodContextSources(null)).toEqual(NO_MOOD_CONTEXT_SOURCES);
    expect(parseMoodContextSources('[]')).toEqual(NO_MOOD_CONTEXT_SOURCES);
  });

  it('drops a source that has since been removed', () => {
    expect(parseMoodContextSources(JSON.stringify({ birthday: true, outside: true }))).toEqual({
      ...NO_MOOD_CONTEXT_SOURCES, outside: true,
    });
  });
});
