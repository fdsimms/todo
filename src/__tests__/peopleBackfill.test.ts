import {
  isPersonFieldMissing, isPersonBackfillDismissed, personBackfillCandidates, personBackfillFieldCounts,
  dismissPersonBackfillField, personCadencePatch, PERSON_BACKFILL_FIELDS,
} from '../utils/peopleBackfill';
import type { Person } from '../types';

const basePerson: Person = {
  id: 'p1',
  name: 'Dustin Reyes',
  nickname: '',
  notes: '',
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
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
  askAbout: '',
  backfillDismissedFields: [],
};

describe('isPersonFieldMissing', () => {
  it('treats a birthday as missing until both halves are on file', () => {
    expect(isPersonFieldMissing(basePerson, 'birthday')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, birthdayMonth: 3 }, 'birthday')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, birthdayDay: 14 }, 'birthday')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, birthdayMonth: 3, birthdayDay: 14 }, 'birthday')).toBe(false);
  });

  it('does not treat a missing birth year as a missing birthday', () => {
    const noYear = { ...basePerson, birthdayMonth: 3, birthdayDay: 14, birthYear: null };
    expect(isPersonFieldMissing(noYear, 'birthday')).toBe(false);
  });

  it('treats nudgeOptIn false as missing regardless of a stored cadence', () => {
    expect(isPersonFieldMissing(basePerson, 'cadence')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, cadenceDays: 14 }, 'cadence')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, nudgeOptIn: true }, 'cadence')).toBe(false);
  });

  it('treats a blank or whitespace-only askAbout as missing', () => {
    expect(isPersonFieldMissing(basePerson, 'askAbout')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, askAbout: '   ' }, 'askAbout')).toBe(true);
    expect(isPersonFieldMissing({ ...basePerson, askAbout: 'the new job' }, 'askAbout')).toBe(false);
  });
});

describe('personBackfillCandidates', () => {
  it('excludes archived people', () => {
    const people: Person[] = [
      { ...basePerson, id: 'a' },
      { ...basePerson, id: 'b', archived: true },
    ];
    expect(personBackfillCandidates(people, 'birthday').map(p => p.id)).toEqual(['a']);
  });

  // The rule the arch doc states outright, and the one line where copying the
  // task/category/project siblings would have broken it: the queue runs in the
  // People screen's own hand order, never in one the app derived. Names chosen
  // so alphabetical and sortOrder disagree.
  it('runs in the user’s own sortOrder, not alphabetically', () => {
    const people: Person[] = [
      { ...basePerson, id: 'a', name: 'Zoe', sortOrder: 1 },
      { ...basePerson, id: 'b', name: 'Ansley', sortOrder: 2 },
      { ...basePerson, id: 'c', name: 'Mom', sortOrder: 3 },
    ];
    expect(personBackfillCandidates(people, 'birthday').map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes a person dismissed for that field, but not for another', () => {
    const people: Person[] = [
      { ...basePerson, id: 'a', backfillDismissedFields: ['birthday'] },
      { ...basePerson, id: 'b', backfillDismissedFields: ['cadence'] },
    ];
    expect(personBackfillCandidates(people, 'birthday').map(p => p.id)).toEqual(['b']);
  });
});

describe('isPersonBackfillDismissed / dismissPersonBackfillField', () => {
  it('is false until the field has been dismissed', () => {
    expect(isPersonBackfillDismissed(basePerson, 'birthday')).toBe(false);
  });

  it('dismissing appends the field id', () => {
    const patch = dismissPersonBackfillField(basePerson, 'birthday');
    expect(patch.backfillDismissedFields).toEqual(['birthday']);
    expect(isPersonBackfillDismissed({ ...basePerson, ...patch }, 'birthday')).toBe(true);
  });

  it('preserves other dismissed fields already on the person', () => {
    const person = { ...basePerson, backfillDismissedFields: ['cadence'] };
    expect(dismissPersonBackfillField(person, 'birthday').backfillDismissedFields).toEqual(['cadence', 'birthday']);
  });

  it('dismissing twice does not duplicate the entry', () => {
    const person = { ...basePerson, backfillDismissedFields: ['birthday'] };
    expect(dismissPersonBackfillField(person, 'birthday').backfillDismissedFields).toEqual(['birthday']);
  });
});

describe('personBackfillFieldCounts', () => {
  it('counts each field independently, skipping archived people', () => {
    const people: Person[] = [
      { ...basePerson, id: 'a', birthdayMonth: 3, birthdayDay: 14 },
      { ...basePerson, id: 'b', nudgeOptIn: true },
      { ...basePerson, id: 'c', archived: true },
    ];
    expect(personBackfillFieldCounts(people)).toEqual({ birthday: 1, cadence: 1, askAbout: 2 });
  });

  it('covers every declared backfillable field', () => {
    const counts = personBackfillFieldCounts([basePerson]);
    for (const field of PERSON_BACKFILL_FIELDS) {
      expect(counts[field.id]).toBe(1);
    }
  });

  it('does not count a person dismissed for that field', () => {
    const person = { ...basePerson, backfillDismissedFields: ['birthday'] };
    expect(personBackfillFieldCounts([person])).toEqual({ birthday: 0, cadence: 1, askAbout: 1 });
  });
});

describe('personCadencePatch', () => {
  it('opts in and stamps the anchor on the off→on transition', () => {
    const patch = personCadencePatch(basePerson, 14);
    expect(patch.cadenceDays).toBe(14);
    expect(patch.nudgeOptIn).toBe(true);
    expect(patch.cadenceSetAt).not.toBeNull();
  });

  // The reason this is a helper rather than three fields written inline: the
  // anchor is the clock somebody with no history is measured against, so
  // re-stamping it for an already-opted-in person silently restarts their wait.
  // Reachable from the screen's Previous button.
  it('keeps an existing anchor when the person is already opted in', () => {
    const optedIn = { ...basePerson, nudgeOptIn: true, cadenceDays: 30, cadenceSetAt: '2025-06-01T00:00:00.000Z' };
    expect(personCadencePatch(optedIn, 14).cadenceSetAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('hands back the off state whole for a cadence of zero', () => {
    const optedIn = { ...basePerson, nudgeOptIn: true, cadenceDays: 30, cadenceSetAt: '2025-06-01T00:00:00.000Z' };
    expect(personCadencePatch(optedIn, 0)).toEqual({ cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null });
  });
});
