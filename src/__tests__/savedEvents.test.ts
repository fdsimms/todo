import {
  describeSavedEvent, editSavedEvent, findSavedEvent, parseSavedEvents, recordSavedEventUse, removeSavedEvent, saveEventAs,
  savedEventRecall, SAVED_EVENTS_KEY, sortedSavedEvents, suggestSavedEvents, updateSavedEvent,
  type SavedEventFields,
} from '../utils/savedEvents';
import { isSyncedSettingKey } from '../db/syncTracking';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

const fields: SavedEventFields = {
  location: 'Eastside Eye Care', place: { latitude: 40.7, longitude: -74 }, durationMinutes: 60,
  alertMinutes: 1440, availability: 'busy', calendarTitle: 'Health',
};
const start = new Date(2026, 9, 13, 9);

describe('saveEventAs', () => {
  it('adds a new saved event with the start it was used for', () => {
    const list = saveEventAs([], ' Optometrist ', fields, start, 1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Optometrist', lastStart: start.toISOString(), bookEveryMonths: null, at: 1 });
  });

  it('replaces the entry under the same title, however it is typed, keeping the booking interval', () => {
    let list = saveEventAs([], 'Optometrist', fields, start, 1);
    list = updateSavedEvent(list, 'optometrist', { bookEveryMonths: 12 });
    list = saveEventAs(list, 'OPTOMETRIST', { ...fields, durationMinutes: 45 }, null, 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ durationMinutes: 45, bookEveryMonths: 12, lastStart: start.toISOString() });
  });

  it('saves nothing for an empty title', () => {
    expect(saveEventAs([], '  ', fields, start, 1)).toEqual([]);
  });
});

describe('recordSavedEventUse', () => {
  it('refreshes a saved event and records the new start', () => {
    const list = saveEventAs([], 'Haircut', fields, null, 1);
    const later = new Date(2026, 10, 20, 16);
    const next = recordSavedEventUse(list, 'haircut', { ...fields, location: 'Fade Factory' }, later, 5);
    expect(findSavedEvent(next, 'Haircut')).toMatchObject({ location: 'Fade Factory', lastStart: later.toISOString(), at: 5 });
  });

  it('leaves the list alone, by identity, for a title nobody saved', () => {
    const list = saveEventAs([], 'Haircut', fields, null, 1);
    expect(recordSavedEventUse(list, 'Gym', fields, start, 5)).toBe(list);
  });
});

describe('the list', () => {
  it('removes by title', () => {
    const list = saveEventAs(saveEventAs([], 'Haircut', fields, null, 1), 'Dentist', fields, null, 2);
    expect(removeSavedEvent(list, 'haircut').map(e => e.title)).toEqual(['Dentist']);
  });

  it('sorts the most recently used first', () => {
    let list = saveEventAs([], 'Dentist', fields, null, 1);
    list = saveEventAs(list, 'Haircut', fields, null, 3);
    list = saveEventAs(list, 'Optometrist', fields, null, 2);
    expect(sortedSavedEvents(list).map(e => e.title)).toEqual(['Haircut', 'Optometrist', 'Dentist']);
  });
});

describe('savedEventRecall', () => {
  const saved = saveEventAs([], 'Optometrist', fields, start, 1)[0];

  it('matches the calendar by name on this device', () => {
    expect(savedEventRecall(saved, [{ id: 'x', title: 'Work' }, { id: 'h', title: 'Health' }], 'm').calendarId).toBe('h');
  });

  it("falls back to the memory's calendar, then to none", () => {
    expect(savedEventRecall(saved, [{ id: 'x', title: 'Work' }], 'm').calendarId).toBe('m');
    expect(savedEventRecall(saved, [], null).calendarId).toBeNull();
  });

  it('carries the rest across', () => {
    expect(savedEventRecall(saved, [], null)).toMatchObject({
      location: 'Eastside Eye Care', durationMinutes: 60, alertMinutes: 1440, availability: 'busy',
    });
  });
});

describe('suggestSavedEvents', () => {
  let list = saveEventAs([], 'Optometrist', fields, null, 1);
  list = saveEventAs(list, 'Annual eye exam', fields, null, 2);
  list = saveEventAs(list, 'Optician pickup', fields, null, 3);

  it('matches the start of the title, then the start of a word', () => {
    expect(suggestSavedEvents(list, 'opt').map(e => e.title)).toEqual(['Optician pickup', 'Optometrist']);
    expect(suggestSavedEvents(list, 'eye').map(e => e.title)).toEqual(['Annual eye exam']);
  });

  it('suggests nothing for one letter, or for the exact title', () => {
    expect(suggestSavedEvents(list, 'o')).toEqual([]);
    expect(suggestSavedEvents(list, 'optometrist')).toEqual([]);
  });
});

describe('parseSavedEvents', () => {
  it('round-trips, and drops what does not read and repeated titles', () => {
    const list = updateSavedEvent(saveEventAs([], 'Optometrist', fields, start, 1), 'Optometrist', { bookEveryMonths: 12 });
    const raw = JSON.stringify([...list, { title: 'optometrist', at: 9 }, { title: '' }, 'nope']);
    expect(parseSavedEvents(raw)).toEqual(list);
  });

  it('cleans out-of-range fields rather than dropping the entry', () => {
    const raw = JSON.stringify([{ title: 'X', at: 1, durationMinutes: 9999, bookEveryMonths: 400, lastStart: 'never' }]);
    expect(parseSavedEvents(raw)[0]).toMatchObject({ durationMinutes: null, bookEveryMonths: null, lastStart: null });
  });

  it('survives garbage', () => {
    expect(parseSavedEvents('{oops')).toEqual([]);
    expect(parseSavedEvents(null)).toEqual([]);
  });
});

it('describes the length and the place', () => {
  expect(describeSavedEvent({ durationMinutes: 60, location: 'Eastside Eye Care' })).toBe('1 hr · Eastside Eye Care');
  expect(describeSavedEvent({ durationMinutes: 90, location: null })).toBe('1 hr 30 min');
  expect(describeSavedEvent({ durationMinutes: null, location: null })).toBe('All day');
});

it('syncs', () => {
  expect(isSyncedSettingKey(SAVED_EVENTS_KEY)).toBe(true);
});

describe('editSavedEvent', () => {
  const input = { title: 'Dentist', location: ' 5 Oak St ', place: null, durationMinutes: 45, alertMinutes: null };

  it('creates an event with no interval and no last start', () => {
    const list = editSavedEvent([], null, input, 5)!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: 'Dentist', location: '5 Oak St', durationMinutes: 45, availability: 'busy',
      lastStart: null, bookEveryMonths: null, calendarTitle: null, at: 5,
    });
  });

  it('keeps what the form does not show when it rewrites one, even under a new title', () => {
    let list = saveEventAs([], 'Optometrist', fields, start, 1);
    list = updateSavedEvent(list, 'Optometrist', { bookEveryMonths: 12, bookDeclinedFor: 'x' });
    const next = editSavedEvent(list, 'Optometrist', { ...input, title: 'Eye exam' }, 9)!;
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      title: 'Eye exam', bookEveryMonths: 12, bookDeclinedFor: 'x', lastStart: start.toISOString(),
      calendarTitle: 'Health', durationMinutes: 45, at: 9,
    });
  });

  it('allows saving under the same title, however it is typed', () => {
    const list = saveEventAs([], 'Optometrist', fields, start, 1);
    expect(editSavedEvent(list, 'Optometrist', { ...input, title: 'optometrist' }, 2)).toHaveLength(1);
  });

  it('refuses an empty title, or one another event already has', () => {
    let list = saveEventAs([], 'Optometrist', fields, start, 1);
    list = saveEventAs(list, 'Haircut', fields, start, 2);
    expect(editSavedEvent(list, null, { ...input, title: '  ' }, 3)).toBeNull();
    expect(editSavedEvent(list, 'Haircut', { ...input, title: 'optometrist' }, 3)).toBeNull();
    expect(editSavedEvent(list, null, { ...input, title: 'Haircut' }, 3)).toBeNull();
  });
});
