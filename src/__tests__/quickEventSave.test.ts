import { alertMinutesFromOffset, describeAlert, quickEventFromLine, quickEventSaveFields, splitNotesAndLink } from '../utils/quickEventSave';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

const start = new Date(2026, 8, 25, 12, 0);

describe('splitNotesAndLink', () => {
  it('sends a lone link to the URL field', () => {
    expect(splitNotesAndLink(' https://example.com/menu ')).toEqual({ url: 'https://example.com/menu' });
  });

  it('keeps a link inside a sentence as a note', () => {
    expect(splitNotesAndLink('menu: https://example.com/menu')).toEqual({ notes: 'menu: https://example.com/menu' });
  });

  it('returns nothing for an empty field', () => {
    expect(splitNotesAndLink('  ')).toEqual({});
  });
});

describe('quickEventSaveFields', () => {
  const base = { title: 'Lunch', start, alertMinutes: null, availability: 'busy' as const, calendarId: 'cal1' };

  it('defaults to a one-hour span with no alert, location or notes', () => {
    const f = quickEventSaveFields(base);
    expect(f.end).toEqual(new Date(2026, 8, 25, 13, 0));
    expect(f.allDay).toBe(false);
    expect(f.alarms).toBeUndefined();
    expect(f.location).toBeUndefined();
    expect(f.notes).toBeUndefined();
    expect(f.calendarId).toBe('cal1');
  });

  it('turns an alert into a relative offset before the start', () => {
    expect(quickEventSaveFields({ ...base, alertMinutes: 30 }).alarms).toEqual([{ relativeOffset: -30 }]);
  });

  it('counts an all-day alert back from 9:00', () => {
    const f = quickEventSaveFields({ ...base, allDay: true, alertMinutes: 0 });
    expect(f.alarms).toEqual([{ relativeOffset: 540 }]);
  });

  it('carries a repeat rule through to the write', () => {
    const rule = { frequency: 'weekly' as const, interval: 1, daysOfTheWeek: [{ dayOfTheWeek: 2 }] };
    expect(quickEventSaveFields({ ...base, repeat: rule }).recurrence).toEqual(rule);
    expect(quickEventSaveFields({ ...base, repeat: null }).recurrence).toBeUndefined();
  });

  it('carries a picked place coordinate only alongside a location', () => {
    const place = { latitude: 40.7, longitude: -74 };
    expect(quickEventSaveFields({ ...base, location: "Joe's", place }).place).toEqual(place);
    expect(quickEventSaveFields({ ...base, location: '  ', place }).place).toBeUndefined();
    expect(quickEventSaveFields({ ...base, location: "Joe's" }).place).toBeUndefined();
  });

  it('trims the location and carries free time through', () => {
    const f = quickEventSaveFields({ ...base, location: '  Joe\'s ', availability: 'free', notesOrLink: 'https://x.co/a' });
    expect(f.location).toBe("Joe's");
    expect(f.availability).toBe('free');
    expect(f.url).toBe('https://x.co/a');
  });
});

describe('describeAlert', () => {
  it.each([
    [null, false, 'None'],
    [0, false, 'At start'],
    [0, true, 'At 9:00 AM'],
    [5, false, '5 min before'],
    [60, false, '1 hour before'],
    [120, false, '2 hours before'],
    [1440, false, '1 day before'],
    [90, false, '90 min before'],
  ])('%s -> %s', (minutes, allDay, label) => {
    expect(describeAlert(minutes, allDay as boolean)).toBe(label);
  });
});

describe('quickEventFromLine', () => {
  const defaults = { calendarId: 'c-default', alertMinutes: null, availability: 'busy' as const };
  const draft = {
    title: 'gym', start: new Date(2026, 8, 25, 15, 0), timed: false, durationMinutes: null,
    location: null, alertMinutes: undefined, repeat: null,
  };
  const recalled = {
    location: 'Planet Fitness', place: { latitude: 1, longitude: 2 }, durationMinutes: 90,
    calendarId: 'c-gym', alertMinutes: 30, availability: 'free' as const, at: 1,
  };

  it('fills what the line left out from the last event with this title', () => {
    const input = quickEventFromLine(draft, { recalled, defaults, freeSlotFor: () => null });
    expect(input).toMatchObject({
      location: 'Planet Fitness', place: { latitude: 1, longitude: 2 }, durationMinutes: 90,
      calendarId: 'c-gym', alertMinutes: 30, availability: 'free',
    });
    expect(input.end).toEqual(new Date(2026, 8, 25, 16, 30));
  });

  it('lets the line win over what was remembered, and drops the old pin with a new place', () => {
    const input = quickEventFromLine(
      { ...draft, location: 'YMCA', durationMinutes: 45, alertMinutes: null },
      { recalled, defaults, freeSlotFor: () => null },
    );
    expect(input).toMatchObject({ location: 'YMCA', place: null, durationMinutes: 45, alertMinutes: null });
  });

  it('falls back to the defaults with nothing remembered', () => {
    const input = quickEventFromLine(draft, { recalled: null, defaults, freeSlotFor: () => null });
    expect(input).toMatchObject({ calendarId: 'c-default', alertMinutes: null, availability: 'busy', durationMinutes: 60 });
  });

  it('starts an untimed line at the free slot, asked with the length it will have', () => {
    const slot = new Date(2026, 8, 25, 16, 15);
    const freeSlotFor = jest.fn(() => slot);
    const input = quickEventFromLine(draft, { recalled, defaults, freeSlotFor });
    expect(freeSlotFor).toHaveBeenCalledWith(90);
    expect(input.start).toEqual(slot);
    // A timed line keeps its own time.
    const timed = quickEventFromLine({ ...draft, timed: true }, { recalled, defaults, freeSlotFor });
    expect(timed.start).toEqual(draft.start);
  });
});

describe('alertMinutesFromOffset', () => {
  it('reads a timed event\'s offset as minutes before it', () => {
    expect(alertMinutesFromOffset(-15, false)).toBe(15);
    expect(alertMinutesFromOffset(0, false)).toBe(0);
  });

  // An all-day event's alert is measured from midnight, and the card counts
  // its choices back from 9 AM on the day.
  it('reads an all-day offset against 9 AM', () => {
    expect(alertMinutesFromOffset(540, true)).toBe(0);
    expect(alertMinutesFromOffset(-900, true)).toBe(1440);
  });

  it('never answers a negative lead, for an alert after the start', () => {
    expect(alertMinutesFromOffset(30, false)).toBe(0);
    expect(alertMinutesFromOffset(null, false)).toBeNull();
  });
});
