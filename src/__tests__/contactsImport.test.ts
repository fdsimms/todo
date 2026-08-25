import type { Person } from '../types';
import {
  MAX_CONTACT_RESULTS,
  MIN_CONTACT_QUERY_LENGTH,
  alreadyAdded,
  canSearchContacts,
  contactBirthday,
  contactPersonDraft,
  describeCandidateBirthday,
  normalizePhone,
  rankContacts,
  type ContactCandidate,
} from '../utils/contactsImport';

function candidate(over: Partial<ContactCandidate> = {}): ContactCandidate {
  return {
    id: 'c1',
    name: 'Dustin Reyes',
    phoneNumber: null,
    email: null,
    birthdayMonth: null,
    birthdayDay: null,
    ...over,
  };
}

function person(over: Partial<Person> & Pick<Person, 'name'>): Pick<Person, 'name' | 'nickname' | 'phoneNumber'> {
  return { nickname: '', phoneNumber: null, ...over };
}

describe('contactBirthday', () => {
  // The one conversion in the feature, and it would fail silently: every value
  // is still in range a month early.
  it('converts the native 0-indexed month to the 1-12 the column stores', () => {
    expect(contactBirthday({ month: 0, day: 14 })).toEqual({ birthdayMonth: 1, birthdayDay: 14 });
    expect(contactBirthday({ month: 2, day: 14 })).toEqual({ birthdayMonth: 3, birthdayDay: 14 });
    expect(contactBirthday({ month: 11, day: 25 })).toEqual({ birthdayMonth: 12, birthdayDay: 25 });
  });

  it('keeps February 29, which is the whole reason the year is separate', () => {
    expect(contactBirthday({ month: 1, day: 29 })).toEqual({ birthdayMonth: 2, birthdayDay: 29 });
  });

  it('is nulls for a contact with no birthday', () => {
    expect(contactBirthday(null)).toEqual({ birthdayMonth: null, birthdayDay: null });
    expect(contactBirthday(undefined)).toEqual({ birthdayMonth: null, birthdayDay: null });
    expect(contactBirthday({})).toEqual({ birthdayMonth: null, birthdayDay: null });
  });

  it('refuses half a date, since a month with no day computes nothing', () => {
    expect(contactBirthday({ month: 5 })).toEqual({ birthdayMonth: null, birthdayDay: null });
    expect(contactBirthday({ day: 14 })).toEqual({ birthdayMonth: null, birthdayDay: null });
  });

  it('refuses a value out of range rather than storing it', () => {
    expect(contactBirthday({ month: 12, day: 1 })).toEqual({ birthdayMonth: null, birthdayDay: null });
    expect(contactBirthday({ month: -1, day: 1 })).toEqual({ birthdayMonth: null, birthdayDay: null });
    expect(contactBirthday({ month: 0, day: 0 })).toEqual({ birthdayMonth: null, birthdayDay: null });
    expect(contactBirthday({ month: 0, day: 32 })).toEqual({ birthdayMonth: null, birthdayDay: null });
  });

  it('refuses a non-number rather than coercing it', () => {
    expect(contactBirthday({ month: NaN, day: 3 })).toEqual({ birthdayMonth: null, birthdayDay: null });
  });
});

describe('describeCandidateBirthday', () => {
  it('says the month and the day', () => {
    expect(describeCandidateBirthday({ birthdayMonth: 3, birthdayDay: 14 })).toBe('March 14');
  });

  it('renders February 29 as itself rather than clamping it', () => {
    expect(describeCandidateBirthday({ birthdayMonth: 2, birthdayDay: 29 })).toBe('February 29');
  });

  it('says nothing when there is no birthday', () => {
    expect(describeCandidateBirthday({ birthdayMonth: null, birthdayDay: null })).toBe('');
  });
});

describe('normalizePhone', () => {
  it('keeps only digits', () => {
    expect(normalizePhone('(555) 018-2277')).toBe('5550182277');
    expect(normalizePhone('+1 555 018 2277')).toBe('15550182277');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('alreadyAdded', () => {
  it('matches a name, trimmed and case-insensitively', () => {
    expect(alreadyAdded(candidate({ name: 'dustin reyes' }), [person({ name: 'Dustin Reyes' })])).toBe(true);
    expect(alreadyAdded(candidate({ name: ' Dustin Reyes ' }), [person({ name: 'Dustin Reyes' })])).toBe(true);
  });

  it('matches a nickname, since "Mom" in Contacts is the same person', () => {
    expect(alreadyAdded(candidate({ name: 'Mom' }), [person({ name: 'Marianne Fields', nickname: 'Mom' })])).toBe(true);
  });

  it('matches on the phone alone, which catches a different filing name', () => {
    const held = [person({ name: 'Mom', phoneNumber: '555 018 2277' })];
    expect(alreadyAdded(candidate({ name: 'Marianne Fields', phoneNumber: '(555) 018-2277' }), held)).toBe(true);
  });

  it('matches across a country code, comparing the last seven digits', () => {
    const held = [person({ name: 'Somebody', phoneNumber: '5550182277' })];
    expect(alreadyAdded(candidate({ name: 'Other', phoneNumber: '+1 555 018 2277' }), held)).toBe(true);
  });

  it('does not match on a short number, which would collide constantly', () => {
    const held = [person({ name: 'Somebody', phoneNumber: '2277' })];
    expect(alreadyAdded(candidate({ name: 'Other', phoneNumber: '2277' }), held)).toBe(false);
  });

  it('is false for somebody genuinely new', () => {
    expect(alreadyAdded(candidate({ name: 'Priya' }), [person({ name: 'Dustin Reyes' })])).toBe(false);
    expect(alreadyAdded(candidate(), [])).toBe(false);
  });
});

describe('canSearchContacts', () => {
  it('needs more than one character, so a screen of near-everybody is impossible', () => {
    expect(MIN_CONTACT_QUERY_LENGTH).toBe(2);
    expect(canSearchContacts('')).toBe(false);
    expect(canSearchContacts('   ')).toBe(false);
    expect(canSearchContacts('d')).toBe(false);
    expect(canSearchContacts('du')).toBe(true);
    expect(canSearchContacts(' du ')).toBe(true);
  });
});

describe('rankContacts', () => {
  const nobody: Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[] = [];

  it('returns nothing at all for a query too short to search', () => {
    expect(rankContacts([candidate()], 'd', nobody)).toEqual([]);
    expect(rankContacts([candidate()], '', nobody)).toEqual([]);
  });

  it('finds a match anywhere in the name', () => {
    expect(rankContacts([candidate({ name: 'Dustin Reyes' })], 'rey', nobody).map(c => c.name))
      .toEqual(['Dustin Reyes']);
  });

  it('puts the start of a name ahead of the start of a later word, ahead of the middle', () => {
    const rows = [
      candidate({ id: 'mid', name: 'Bandana Supply' }),
      candidate({ id: 'word', name: 'Jo Danvers' }),
      candidate({ id: 'start', name: 'Dan Whitfield' }),
    ];
    expect(rankContacts(rows, 'dan', nobody).map(c => c.id)).toEqual(['start', 'word', 'mid']);
  });

  it('keeps the order the system gave for a tie', () => {
    const rows = [
      candidate({ id: 'b', name: 'Dana Ortiz' }),
      candidate({ id: 'a', name: 'Dan Whitfield' }),
    ];
    expect(rankContacts(rows, 'dan', nobody).map(c => c.id)).toEqual(['b', 'a']);
  });

  it('leaves out somebody already added, so a second pass cannot mint a duplicate', () => {
    const rows = [candidate({ name: 'Dustin Reyes' }), candidate({ id: 'c2', name: 'Dustin Clarke' })];
    const held = [person({ name: 'Dustin Reyes' })];
    expect(rankContacts(rows, 'dustin', held).map(c => c.id)).toEqual(['c2']);
  });

  it('drops a contact with no name, which could only be picked by accident', () => {
    const rows = [candidate({ id: 'blank', name: '  ' }), candidate({ id: 'named', name: 'Dustin' })];
    expect(rankContacts(rows, 'dus', nobody).map(c => c.id)).toEqual(['named']);
  });

  it('caps what it returns, because a search that returns a book is a book', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      candidate({ id: `c${i}`, name: `Dustin ${i}` }));
    expect(rankContacts(rows, 'dustin', nobody)).toHaveLength(MAX_CONTACT_RESULTS);
    expect(rankContacts(rows, 'dustin', nobody, 3)).toHaveLength(3);
  });

  it('is empty when nothing matches', () => {
    expect(rankContacts([candidate({ name: 'Priya' })], 'dustin', nobody)).toEqual([]);
  });
});

describe('contactPersonDraft', () => {
  it('carries the name, number, email and birthday', () => {
    expect(contactPersonDraft(candidate({
      name: '  Dustin Reyes ',
      phoneNumber: '555 0148',
      email: 'd@example.com',
      birthdayMonth: 3,
      birthdayDay: 14,
    }))).toEqual({
      name: 'Dustin Reyes',
      phoneNumber: '555 0148',
      email: 'd@example.com',
      birthdayMonth: 3,
      birthdayDay: 14,
    });
  });

  // An empty-string number would light up the row's call button with nothing
  // behind it.
  it('stores a blank as null rather than as an empty string', () => {
    const draft = contactPersonDraft(candidate({ phoneNumber: '   ', email: '' }));
    expect(draft.phoneNumber).toBeNull();
    expect(draft.email).toBeNull();
  });
});
