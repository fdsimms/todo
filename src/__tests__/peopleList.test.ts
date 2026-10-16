jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { peopleSections, personContactActions, sortPeopleAlphabetically } from '../utils/peopleList';
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
    pinned: false,
    phoneNumber: null,
    faxNumber: null, address: null,
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

const nameOf = (p: Person) => p.nickname.trim() || p.name.trim();

describe('sortPeopleAlphabetically', () => {
  it('sorts A to Z ignoring case and accents, without mutating the input', () => {
    const input = [
      person({ id: 'b', name: 'bea' }),
      person({ id: 'e', name: 'Émile' }),
      person({ id: 'a', name: 'Ada' }),
    ];
    expect(sortPeopleAlphabetically(input, nameOf).map(p => p.id)).toEqual(['a', 'b', 'e']);
    expect(input.map(p => p.id)).toEqual(['b', 'e', 'a']);
  });

  it('sorts by the nickname when there is one, as the row shows it', () => {
    const input = [
      person({ id: 'z', name: 'Zachary', nickname: 'Al' }),
      person({ id: 'b', name: 'Bea' }),
    ];
    expect(sortPeopleAlphabetically(input, nameOf).map(p => p.id)).toEqual(['z', 'b']);
  });
});

describe('peopleSections', () => {
  it('puts people before businesses, each A to Z, whatever the hand order was', () => {
    const sections = peopleSections([
      person({ id: 'eyeq', name: 'Eye Q', kind: 'business', sortOrder: 0 }),
      person({ id: 'tessa', name: 'Tessa', sortOrder: 1 }),
      person({ id: 'acme', name: 'Acme Dental', kind: 'business', sortOrder: 2 }),
      person({ id: 'gideon', name: 'Gideon', sortOrder: 3 }),
    ], nameOf);
    expect(sections.map(s => [s.title, s.people.map(p => p.id)])).toEqual([
      ['People', ['gideon', 'tessa']],
      ['Businesses', ['acme', 'eyeq']],
    ]);
  });

  it('puts pinned people first, A to Z across both kinds, and not again under their kind', () => {
    const sections = peopleSections([
      person({ id: 'tessa', name: 'Tessa' }),
      person({ id: 'vet', name: 'Vet', kind: 'business', pinned: true }),
      person({ id: 'gideon', name: 'Gideon', pinned: true }),
      person({ id: 'acme', name: 'Acme', kind: 'business' }),
    ], nameOf);
    expect(sections.map(s => [s.title, s.people.map(p => p.id)])).toEqual([
      ['Pinned', ['gideon', 'vet']],
      ['People', ['tessa']],
      ['Businesses', ['acme']],
    ]);
  });

  it('leaves out a kind nobody is filed under', () => {
    const sections = peopleSections([person({ id: 'a', kind: 'business' })], nameOf);
    expect(sections.map(s => s.kind)).toEqual(['business']);
    expect(peopleSections([], nameOf)).toEqual([]);
  });
});

describe('personContactActions', () => {
  it('offers nothing for a person with no details', () => {
    expect(personContactActions(person())).toEqual([]);
  });

  it('offers call and text for a number, then email, then the link', () => {
    const actions = personContactActions(person({
      phoneNumber: '(555) 123-4567',
      email: 'a@b.co',
      linkUrl: 'https://example.com',
    }));
    expect(actions.map(a => [a.kind, a.url])).toEqual([
      ['call', 'tel:5551234567'],
      ['text', 'sms:5551234567'],
      ['email', 'mailto:a@b.co'],
      ['link', 'https://example.com'],
    ]);
  });

  it('offers directions last, on one line, for an address', () => {
    const actions = personContactActions(person({ email: 'a@b.co', address: '214 Elm St\nAustin, TX 78701' }));
    expect(actions.map(a => a.kind)).toEqual(['email', 'directions']);
    expect(actions[1].url).toBe('https://maps.apple.com/?daddr=214%20Elm%20St%2C%20Austin%2C%20TX%2078701');
    expect(personContactActions(person({ address: '  \n ' }))).toEqual([]);
  });

  it('skips a number that cannot be dialed and blank fields', () => {
    expect(personContactActions(person({ phoneNumber: 'ask front desk', email: '  ', linkUrl: ' ' }))).toEqual([]);
  });
});
