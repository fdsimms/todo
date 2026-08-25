import type { PersonNote, PersonNoteKind } from '../types';
import {
  PERSON_NOTE_HINTS,
  PERSON_NOTE_LABELS,
  describeNoteDay,
  giftIdeasText,
  guestFoodNotes,
  isLiveNote,
  isStaleNote,
  notesFor,
  notesOfKind,
} from '../utils/personNotes';

const today = new Date(2026, 7, 25, 12);
const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

let seq = 0;
function note(over: Partial<PersonNote> = {}): PersonNote {
  seq += 1;
  return {
    id: `n${seq}`,
    personId: 'p1',
    kind: 'note' as PersonNoteKind,
    text: `note ${seq}`,
    createdAt: iso(2026, 1, 1),
    relevantOn: null,
    archivedAt: null,
    sortOrder: seq,
    ...over,
  };
}

describe('isLiveNote', () => {
  it('is true for an ordinary note', () => {
    expect(isLiveNote(note())).toBe(true);
  });

  it('is false once filed away', () => {
    expect(isLiveNote(note({ archivedAt: iso(2026, 8, 1) }))).toBe(false);
  });

  it('is false for a note with nothing in it', () => {
    expect(isLiveNote(note({ text: '   ' }))).toBe(false);
  });
});

describe('isStaleNote', () => {
  it('is false for a note with no day, however old', () => {
    expect(isStaleNote({ relevantOn: null }, today)).toBe(false);
  });

  it('is false on the day itself', () => {
    expect(isStaleNote({ relevantOn: iso(2026, 8, 25) }, today)).toBe(false);
  });

  it('is false for a day still ahead', () => {
    expect(isStaleNote({ relevantOn: iso(2026, 9, 12) }, today)).toBe(false);
  });

  it('is true once the day has passed', () => {
    expect(isStaleNote({ relevantOn: iso(2026, 8, 24) }, today)).toBe(true);
  });
});

describe('notesOfKind', () => {
  it('keeps only this person and this kind', () => {
    const rows = [
      note({ id: 'mine', personId: 'p1', kind: 'note' }),
      note({ personId: 'p2', kind: 'note' }),
      note({ personId: 'p1', kind: 'gift' }),
    ];
    expect(notesOfKind(rows, 'p1', 'note', today).map(n => n.id)).toEqual(['mine']);
  });

  it('drops filed-away and empty notes', () => {
    const rows = [
      note({ id: 'live' }),
      note({ archivedAt: iso(2026, 8, 1) }),
      note({ text: '' }),
    ];
    expect(notesOfKind(rows, 'p1', 'note', today).map(n => n.id)).toEqual(['live']);
  });

  it('puts dated notes first, soonest first', () => {
    const rows = [
      note({ id: 'undated' }),
      note({ id: 'later', relevantOn: iso(2026, 10, 1) }),
      note({ id: 'sooner', relevantOn: iso(2026, 9, 1) }),
    ];
    expect(notesOfKind(rows, 'p1', 'note', today).map(n => n.id))
      .toEqual(['sooner', 'later', 'undated']);
  });

  it('sinks stale notes to the bottom without deleting them', () => {
    const rows = [
      note({ id: 'stale', relevantOn: iso(2026, 8, 1) }),
      note({ id: 'undated' }),
      note({ id: 'ahead', relevantOn: iso(2026, 9, 1) }),
    ];
    expect(notesOfKind(rows, 'p1', 'note', today).map(n => n.id))
      .toEqual(['ahead', 'undated', 'stale']);
  });

  it('keeps undated notes in the user own order', () => {
    const rows = [
      note({ id: 'third', sortOrder: 3 }),
      note({ id: 'first', sortOrder: 1 }),
      note({ id: 'second', sortOrder: 2 }),
    ];
    expect(notesOfKind(rows, 'p1', 'note', today).map(n => n.id))
      .toEqual(['first', 'second', 'third']);
  });

  it('is empty for somebody with nothing written about them', () => {
    expect(notesOfKind([note({ personId: 'p2' })], 'p1', 'note', today)).toEqual([]);
  });
});

describe('notesFor', () => {
  it('spans every kind', () => {
    const rows = [
      note({ kind: 'note' }), note({ kind: 'gift' }), note({ kind: 'food' }),
      note({ personId: 'p2', kind: 'food' }),
    ];
    expect(notesFor(rows, 'p1')).toHaveLength(3);
  });
});

describe('describeNoteDay', () => {
  it('names today and tomorrow rather than counting them', () => {
    expect(describeNoteDay(iso(2026, 8, 25), today)).toBe('Today');
    expect(describeNoteDay(iso(2026, 8, 26), today)).toBe('Tomorrow');
  });

  it('counts forward inside a week', () => {
    expect(describeNoteDay(iso(2026, 8, 28), today)).toBe('In 3 days');
  });

  it('becomes a plain date past a week', () => {
    expect(describeNoteDay(iso(2026, 9, 12), today)).toBe('September 12');
  });

  it('carries the year when it is not this one', () => {
    expect(describeNoteDay(iso(2027, 3, 4), today)).toBe('March 4, 2027');
  });

  // Rule 2: a rising number about somebody is the scoreboard this feature
  // refuses to be, so a passed day says only that it passed.
  it('never says how long a note has been stale', () => {
    expect(describeNoteDay(iso(2026, 5, 1), today)).toBe('Passed');
    expect(describeNoteDay(iso(2026, 8, 24), today)).toBe('Passed');
  });
});

describe('giftIdeasText', () => {
  it('is empty when there is nothing to say', () => {
    expect(giftIdeasText([], 'p1', today)).toBe('');
    expect(giftIdeasText([note({ kind: 'note' })], 'p1', today)).toBe('');
  });

  it('bullets the ideas', () => {
    const rows = [
      note({ kind: 'gift', text: 'The pottery class', sortOrder: 1 }),
      note({ kind: 'gift', text: 'A proper chef knife', sortOrder: 2 }),
    ];
    expect(giftIdeasText(rows, 'p1', today)).toBe('• The pottery class\n• A proper chef knife');
  });

  it('leaves out an idea whose day has passed', () => {
    const rows = [
      note({ kind: 'gift', text: 'Concert tickets', relevantOn: iso(2026, 6, 1) }),
      note({ kind: 'gift', text: 'The pottery class' }),
    ];
    expect(giftIdeasText(rows, 'p1', today)).toBe('• The pottery class');
  });

  it('is about one person only', () => {
    const rows = [
      note({ kind: 'gift', text: 'Theirs', personId: 'p2' }),
      note({ kind: 'gift', text: 'Mine', personId: 'p1' }),
    ];
    expect(giftIdeasText(rows, 'p1', today)).toBe('• Mine');
  });
});

describe('guestFoodNotes', () => {
  const guests = [{ id: 'p1', name: 'Ansley' }, { id: 'p2', name: 'Dustin' }];

  it('names who each note is about', () => {
    const rows = [note({ kind: 'food', text: 'No shellfish', personId: 'p2' })];
    expect(guestFoodNotes(rows, guests, today))
      .toEqual([{ personId: 'p2', name: 'Dustin', text: 'No shellfish' }]);
  });

  it('is empty when no guest has one', () => {
    expect(guestFoodNotes([note({ kind: 'note' })], guests, today)).toEqual([]);
    expect(guestFoodNotes([], guests, today)).toEqual([]);
  });

  it('ignores a food note about somebody who is not coming', () => {
    const rows = [note({ kind: 'food', text: 'Vegetarian', personId: 'p9' })];
    expect(guestFoodNotes(rows, guests, today)).toEqual([]);
  });

  it('drops one whose day has passed, since it is no longer true', () => {
    const rows = [note({ kind: 'food', text: 'Dairy-free for now', relevantOn: iso(2026, 3, 1) })];
    expect(guestFoodNotes(rows, guests, today)).toEqual([]);
  });

  it('carries several notes for one guest, and several guests', () => {
    const rows = [
      note({ kind: 'food', text: 'No shellfish', personId: 'p1' }),
      note({ kind: 'food', text: 'Hates coriander', personId: 'p1' }),
      note({ kind: 'food', text: 'Vegetarian', personId: 'p2' }),
    ];
    expect(guestFoodNotes(rows, guests, today).map(n => n.text))
      .toEqual(['No shellfish', 'Hates coriander', 'Vegetarian']);
  });
});

describe('the kind copy', () => {
  it('names every kind and says where it turns up', () => {
    for (const kind of ['note', 'gift', 'food'] as PersonNoteKind[]) {
      expect(PERSON_NOTE_LABELS[kind]).toBeTruthy();
      expect(PERSON_NOTE_HINTS[kind]).toBeTruthy();
    }
  });

  // The three differ only in where they surface, which isn't guessable from the
  // name, so each hint has to say it — that's the whole job of the line.
  it('says where each one shows', () => {
    expect(PERSON_NOTE_HINTS.gift).toMatch(/birthday/i);
    expect(PERSON_NOTE_HINTS.food).toMatch(/meal/i);
    expect(PERSON_NOTE_HINTS.note).toMatch(/page/i);
  });
});
