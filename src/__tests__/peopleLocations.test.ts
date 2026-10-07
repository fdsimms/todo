import { anyoneHasLocation, peopleNearLocation } from '../utils/peopleLocations';
import type { Person } from '../types';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: overrides.id ?? 'p1',
    name: 'Someone',
    kind: 'individual',
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
    location: null, faxNumber: null,
    ...overrides,
  };
}

describe('peopleNearLocation', () => {
  it('matches a case-insensitive substring of the location field', () => {
    const gideon = person({ id: 'gideon', name: 'Gideon', location: 'Denver, CO' });
    const results = peopleNearLocation([gideon], 'denver');
    expect(results.map(p => p.id)).toEqual(['gideon']);
  });

  it('returns nothing for an empty query, never the whole roster', () => {
    const gideon = person({ id: 'gideon', location: 'Denver, CO' });
    expect(peopleNearLocation([gideon], '')).toEqual([]);
    expect(peopleNearLocation([gideon], '   ')).toEqual([]);
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
    const tessa = person({ id: 'tessa', name: 'Tessa', location: 'Denver, CO' });
    const results = peopleNearLocation([zeke, tessa], 'denver');
    expect(results.map(p => p.id)).toEqual(['tessa', 'zeke']);
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
