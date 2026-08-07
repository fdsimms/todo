import type { Calendar as ReminderList, Reminder } from 'expo-calendar';
import {
  draftFromReminder,
  findReminderList,
  importableReminders,
  isImportableList,
  reminderListOptions,
} from '../utils/remindersImport';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', title: 'Buy milk', completed: false, ...overrides };
}

function list(overrides: Partial<ReminderList> = {}): ReminderList {
  return {
    id: 'l1',
    title: 'Reminders',
    allowsModifications: true,
    source: { id: 's1', name: 'iCloud', type: 'CalDAV' },
    ...overrides,
  } as ReminderList;
}

describe('draftFromReminder', () => {
  it('takes the title and nothing else, however much the reminder carries', () => {
    // The test that guards the title-only decision: it fails the day a field is
    // added here without meaning to.
    const draft = draftFromReminder(
      reminder({
        title: 'Pay rent',
        notes: 'the landlord emailed',
        dueDate: '2026-08-08T17:00:00.000+01:00',
        url: 'https://example.com',
        recurrenceRule: { frequency: 'monthly' },
        alarms: [{ relativeOffset: -30 }],
        location: 'home',
      } as Partial<Reminder>)
    );
    expect(Object.keys(draft!)).toEqual(['title']);
    expect(draft).toEqual({ title: 'Pay rent' });
  });

  it('trims what Siri transcribed', () => {
    expect(draftFromReminder(reminder({ title: '  Buy milk  ' }))).toEqual({ title: 'Buy milk' });
  });

  it('returns null when there is no title to use', () => {
    expect(draftFromReminder(reminder({ title: undefined }))).toBeNull();
    expect(draftFromReminder(reminder({ title: '' }))).toBeNull();
    expect(draftFromReminder(reminder({ title: '   ' }))).toBeNull();
  });
});

describe('importableReminders', () => {
  it('keeps an ordinary incomplete reminder', () => {
    expect(importableReminders([reminder()])).toHaveLength(1);
  });

  it('drops completed reminders, which are never ours to delete', () => {
    // The fetch can't filter these out — a status query matches on due date and
    // would drop the dictated reminders this feature exists for — so the rule
    // lives here and has to be real.
    const kept = importableReminders([
      reminder({ id: 'a', completed: true }),
      reminder({ id: 'b', completed: false }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['b']);
  });

  it('drops a reminder with no id, which could never be deleted', () => {
    expect(importableReminders([reminder({ id: undefined })])).toEqual([]);
  });

  it('drops a blank-titled reminder rather than deleting a half-written one', () => {
    const kept = importableReminders([
      reminder({ id: 'a', title: '   ' }),
      reminder({ id: 'b', title: undefined }),
      reminder({ id: 'c', title: 'Real' }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['c']);
  });

  it('drops ids whose delete failed earlier in the session', () => {
    const kept = importableReminders(
      [reminder({ id: 'a' }), reminder({ id: 'b' })],
      new Set(['a'])
    );
    expect(kept.map(r => r.id)).toEqual(['b']);
  });

  it('orders oldest first', () => {
    const kept = importableReminders([
      reminder({ id: 'later', creationDate: '2026-08-06T12:00:00.000Z' }),
      reminder({ id: 'earlier', creationDate: '2026-08-06T09:00:00.000Z' }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['earlier', 'later']);
  });

  it('compares creation dates as instants, not as strings', () => {
    // The native serializer emits a local offset rather than Z, so these two
    // sort the wrong way round under a lexicographic compare: "2026-08-06T01:00
    // +01:00" is midnight UTC, an hour before "2026-08-06T00:30…-01:00".
    const kept = importableReminders([
      reminder({ id: 'second', creationDate: '2026-08-06T00:30:00.000-01:00' }),
      reminder({ id: 'first', creationDate: '2026-08-06T01:00:00.000+01:00' }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['first', 'second']);
  });

  it('accepts a Date as well as a string', () => {
    const kept = importableReminders([
      reminder({ id: 'later', creationDate: new Date('2026-08-06T12:00:00.000Z') }),
      reminder({ id: 'earlier', creationDate: new Date('2026-08-06T09:00:00.000Z') }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['earlier', 'later']);
  });

  it('puts undated reminders last, keeping their own order', () => {
    const kept = importableReminders([
      reminder({ id: 'undated1' }),
      reminder({ id: 'dated', creationDate: '2026-08-06T09:00:00.000Z' }),
      reminder({ id: 'undated2' }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['dated', 'undated1', 'undated2']);
  });

  it('is stable for identical creation dates', () => {
    const at = '2026-08-06T09:00:00.000Z';
    const kept = importableReminders([
      reminder({ id: 'a', creationDate: at }),
      reminder({ id: 'b', creationDate: at }),
      reminder({ id: 'c', creationDate: at }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats an unparseable creation date as undated rather than dropping it', () => {
    const kept = importableReminders([
      reminder({ id: 'bad', creationDate: 'not a date' }),
      reminder({ id: 'good', creationDate: '2026-08-06T09:00:00.000Z' }),
    ]);
    expect(kept.map(r => r.id)).toEqual(['good', 'bad']);
  });

  it('does not mutate its input', () => {
    const input = [
      reminder({ id: 'later', creationDate: '2026-08-06T12:00:00.000Z' }),
      reminder({ id: 'earlier', creationDate: '2026-08-06T09:00:00.000Z' }),
    ];
    importableReminders(input);
    expect(input.map(r => r.id)).toEqual(['later', 'earlier']);
  });
});

describe('isImportableList', () => {
  it('accepts a list we can delete out of', () => {
    expect(isImportableList(list())).toBe(true);
  });

  it('rejects a read-only list, which would re-import itself for ever', () => {
    expect(isImportableList(list({ allowsModifications: false }))).toBe(false);
  });

  it('rejects a list that is not there', () => {
    expect(isImportableList(undefined)).toBe(false);
  });
});

describe('reminderListOptions', () => {
  // The two drain destinations must be disjoint: handledIds is global, so a
  // list wired to both would send each reminder to whichever drain reached it
  // first — a coin toss between the Inbox and the grocery list.
  it('hides the list the other destination already uses', () => {
    const options = reminderListOptions(
      [list({ id: 'a', title: 'Groceries' }), list({ id: 'b', title: 'Reminders' })],
      'a'
    );
    expect(options.map(l => l.id)).toEqual(['b']);
  });

  it('excludes nothing when the other destination is unset', () => {
    const options = reminderListOptions(
      [list({ id: 'a', title: 'Groceries' }), list({ id: 'b', title: 'Reminders' })],
      null
    );
    expect(options.map(l => l.id)).toEqual(['a', 'b']);
  });

  it('still drops a read-only list even when excluding another', () => {
    const options = reminderListOptions(
      [
        list({ id: 'a', title: 'Groceries' }),
        list({ id: 'b', title: 'Shared', allowsModifications: false }),
        list({ id: 'c', title: 'Work' }),
      ],
      'a'
    );
    expect(options.map(l => l.id)).toEqual(['c']);
  });

  it('offers only modifiable lists, sorted by title', () => {
    const options = reminderListOptions([
      list({ id: 'b', title: 'Work' }),
      list({ id: 'c', title: 'Family', allowsModifications: false }),
      list({ id: 'a', title: 'Groceries' }),
    ]);
    expect(options.map(l => l.title)).toEqual(['Groceries', 'Work']);
  });
});

describe('findReminderList', () => {
  it('finds a list by id', () => {
    expect(findReminderList([list({ id: 'a' }), list({ id: 'b' })], 'b')?.id).toBe('b');
  });

  it('returns undefined for an id that is gone, so the drain can bail', () => {
    expect(findReminderList([list({ id: 'a' })], 'gone')).toBeUndefined();
  });

  it('returns undefined when no list has been chosen', () => {
    expect(findReminderList([list({ id: 'a' })], null)).toBeUndefined();
  });
});
