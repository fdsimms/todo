import { INITIAL_QUICK_EVENT_DEFAULTS, parseQuickEventDefaults } from '../utils/quickEventDefaults';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

describe('parseQuickEventDefaults', () => {
  it('starts on the default calendar, no alert, busy', () => {
    expect(parseQuickEventDefaults(null)).toEqual(INITIAL_QUICK_EVENT_DEFAULTS);
    expect(INITIAL_QUICK_EVENT_DEFAULTS).toEqual({ calendarId: null, alertMinutes: null, availability: 'busy' });
  });

  it('reads what was stored', () => {
    const raw = JSON.stringify({ calendarId: 'c1', alertMinutes: 30, availability: 'free' });
    expect(parseQuickEventDefaults(raw)).toEqual({ calendarId: 'c1', alertMinutes: 30, availability: 'free' });
  });

  it('falls back field by field on a value that does not read', () => {
    const raw = JSON.stringify({ calendarId: 7, alertMinutes: -5, availability: 'away' });
    expect(parseQuickEventDefaults(raw)).toEqual(INITIAL_QUICK_EVENT_DEFAULTS);
  });

  it('survives garbage', () => {
    expect(parseQuickEventDefaults('{nope')).toEqual(INITIAL_QUICK_EVENT_DEFAULTS);
  });
});
