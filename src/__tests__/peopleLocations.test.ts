import { anyoneHasLocation, peopleNearLocation } from '../utils/peopleLocations';
import type { Person } from '../types';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: overrides.id ?? 'p1',
    name: 'Someone',
    nickname: '',
    notes: '',
    sortOrder: 0,
    archived: false,
    archivedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    birthdayMonth: null,
    birthdayDay: null,
    birthYear: null,
    birthdayTaskOptOut: false,
    birthdayGiftTaskOptOut: false,
    phoneNumber: null,
    email: null,
    linkUrl: null,
    cadenceDays: 0,
    nudgeOptIn: false,
    cadenceSetAt: null,
    reachOutDeclinedAt: null,
    reachOutOfferDeclinedAt: null,
    askAbout: '',
    backfillDismissedFields: [],
    groupId: null,
    location: null,
    ...overrides,
  };
}

describe('peopleNearLocation', () => {
  it('matches a case-insensitive substring of the location field', () => {
    const dustin = person({ id: 'dustin', name: 'Dustin', location: 'Denver, CO' });
    const results = peopleNearLocation([dustin], 'denver');
    expect(results.map(p => p.id)).toEqual(['dustin']);
  });

  it('returns nothing for an empty query, never the whole roster', () => {
    const dustin = person({ id: 'dustin', location: 'Denver, CO' });
    expect(peopleNearLocation([dustin], '')).toEqual([]);
    expect(peopleNearLocation([dustin], '   ')).toEqual([]);
  });

  it('skips people with no location on file', () => {
    const noLocation = person({ id: 'a', location: null });
    expect(peopleNearLocation([noLocation], 'denver')).toEqual([]);
  });

  it('skips archived people', () => {
    const archived = person({ id: 'a', location: 'Denver, CO', archived: true });
    expect(peopleNearLocation([archived], 'denver')).toEqual([]);
  });

  it('sorts matches alphabetically by display name, never by anything else', () => {
    const zeke = person({ id: 'zeke', name: 'Zeke', location: 'Denver, CO' });
    const ansley = person({ id: 'ansley', name: 'Ansley', location: 'Denver, CO' });
    const results = peopleNearLocation([zeke, ansley], 'denver');
    expect(results.map(p => p.id)).toEqual(['ansley', 'zeke']);
  });
});

describe('anyoneHasLocation', () => {
  it('is false when nobody has a location on file', () => {
    expect(anyoneHasLocation([person({ location: null })])).toBe(false);
  });

  it('is true once somebody does', () => {
    expect(anyoneHasLocation([person({ location: 'Denver, CO' })])).toBe(true);
  });

  it('ignores an archived person', () => {
    expect(anyoneHasLocation([person({ location: 'Denver, CO', archived: true })])).toBe(false);
  });
});
