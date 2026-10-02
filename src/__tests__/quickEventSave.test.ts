import { describeAlert, quickEventSaveFields, splitNotesAndLink } from '../utils/quickEventSave';

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
