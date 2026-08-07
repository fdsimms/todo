import type { Calendar as ReminderList, Reminder } from 'expo-calendar';
import {
  describePendingImport,
  draftFromReminder,
  findReminderList,
  importableReminders,
  isImportableList,
  pendingImportFor,
  recurrenceFromRule,
  reminderListOptions,
  reminderTimeFromAlarms,
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

// A fixed "now" so the relative phrasing in the parser ("tomorrow") and the
// past/future alarm split are both deterministic. A Friday.
const NOW = new Date(2026, 7, 7, 9, 0, 0);

const LOADED = {
  title: 'Pay rent',
  notes: 'the landlord emailed',
  dueDate: '2026-08-08T17:00:00.000+01:00',
  url: 'https://example.com',
  recurrenceRule: { frequency: 'monthly' },
  alarms: [{ relativeOffset: -30 }],
  location: 'home',
} as Partial<Reminder>;

describe('draftFromReminder', () => {
  it('copies verbatim content only, and nothing that would file the task', () => {
    // The successor to the old title-only guard, and it guards the same
    // boundary one field further out: what a reminder *states* (title, notes)
    // is copied onto the row, and everything it *implies* (a date, a repeat, an
    // alarm) stays out — every one of those disqualifies isInboxTask, so a
    // field slipping in here files a capture nobody has reviewed. Suggestions
    // belong in pendingImportFor, which is tested below.
    const draft = draftFromReminder(reminder(LOADED));
    expect(Object.keys(draft!).sort()).toEqual(['notes', 'title']);
    expect(draft).toEqual({ title: 'Pay rent', notes: 'the landlord emailed' });
  });

  it('trims what Siri transcribed', () => {
    expect(draftFromReminder(reminder({ title: '  Buy milk  ' }))).toEqual({ title: 'Buy milk' });
  });

  it('omits notes rather than writing an empty string', () => {
    expect(draftFromReminder(reminder({ notes: '   ' }))).toEqual({ title: 'Buy milk' });
    expect(draftFromReminder(reminder({ notes: undefined }))).toEqual({ title: 'Buy milk' });
  });

  it('returns null when there is no title to use', () => {
    expect(draftFromReminder(reminder({ title: undefined }))).toBeNull();
    expect(draftFromReminder(reminder({ title: '' }))).toBeNull();
    expect(draftFromReminder(reminder({ title: '   ' }))).toBeNull();
  });
});

describe('recurrenceFromRule', () => {
  it('ignores a missing or unrecognised frequency', () => {
    expect(recurrenceFromRule(null)).toBeNull();
    expect(recurrenceFromRule(undefined)).toBeNull();
    expect(recurrenceFromRule({ frequency: 'fortnightly' } as never)).toBeNull();
  });

  it('maps frequency and interval', () => {
    expect(recurrenceFromRule({ frequency: 'daily' } as never)).toMatchObject({
      recurrenceType: 'daily',
      recurrenceInterval: 1,
    });
    expect(recurrenceFromRule({ frequency: 'weekly', interval: 2 } as never)).toMatchObject({
      recurrenceType: 'weekly',
      recurrenceInterval: 2,
    });
  });

  it('shifts EventKit weekdays from Sunday=1 to Sunday=0', () => {
    // The off-by-one that would silently move every weekly repeat by a day.
    const out = recurrenceFromRule({
      frequency: 'weekly',
      daysOfTheWeek: [{ dayOfTheWeek: 1 }, { dayOfTheWeek: 7 }],
    } as never);
    expect(out!.recurrenceDays).toEqual([0, 6]);
  });

  it('dedupes and sorts weekdays', () => {
    const out = recurrenceFromRule({
      frequency: 'weekly',
      daysOfTheWeek: [{ dayOfTheWeek: 6 }, { dayOfTheWeek: 2 }, { dayOfTheWeek: 6 }],
    } as never);
    expect(out!.recurrenceDays).toEqual([1, 5]);
  });

  it('treats weekNumber 0 as absent, since EventKit documents it as "ignore"', () => {
    const out = recurrenceFromRule({
      frequency: 'monthly',
      daysOfTheWeek: [{ dayOfTheWeek: 3, weekNumber: 0 }],
    } as never);
    expect(out!.recurrenceWeekOrdinal).toBeUndefined();
  });

  it('keeps an Nth-weekday ordinal we can express, and drops one we cannot', () => {
    const second = recurrenceFromRule({
      frequency: 'monthly',
      daysOfTheWeek: [{ dayOfTheWeek: 3, weekNumber: 2 }],
    } as never);
    expect(second!.recurrenceWeekOrdinal).toBe(2);

    const last = recurrenceFromRule({
      frequency: 'monthly',
      daysOfTheWeek: [{ dayOfTheWeek: 6, weekNumber: -1 }],
    } as never);
    expect(last!.recurrenceWeekOrdinal).toBe(-1);

    // 40th week of the month isn't a thing this app can say; the monthly
    // repeat still survives.
    const absurd = recurrenceFromRule({
      frequency: 'monthly',
      daysOfTheWeek: [{ dayOfTheWeek: 3, weekNumber: 40 }],
    } as never);
    expect(absurd!.recurrenceWeekOrdinal).toBeUndefined();
    expect(absurd!.recurrenceType).toBe('monthly');
  });

  it('carries a day of the month across, including -1 for the last day', () => {
    expect(
      recurrenceFromRule({ frequency: 'monthly', daysOfTheMonth: [15] } as never)!.recurrenceMonthDay
    ).toBe(15);
    expect(
      recurrenceFromRule({ frequency: 'monthly', daysOfTheMonth: [-1] } as never)!.recurrenceMonthDay
    ).toBe(-1);
  });

  it('keeps the first of several month days rather than refusing the rule', () => {
    // We hold one anchor. Dropping the extra beats dropping the repeat.
    const out = recurrenceFromRule({
      frequency: 'monthly',
      daysOfTheMonth: [1, 15, 20],
    } as never);
    expect(out!.recurrenceMonthDay).toBe(1);
    expect(out!.recurrenceType).toBe('monthly');
  });

  it('prefers the Nth-weekday form when a rule states both, since they are exclusive', () => {
    const out = recurrenceFromRule({
      frequency: 'monthly',
      daysOfTheMonth: [15],
      daysOfTheWeek: [{ dayOfTheWeek: 3, weekNumber: 2 }],
    } as never);
    expect(out!.recurrenceWeekOrdinal).toBe(2);
    expect(out!.recurrenceMonthDay).toBeUndefined();
  });

  it('maps the end conditions, with endDate overriding occurrence as EventKit specifies', () => {
    const counted = recurrenceFromRule({ frequency: 'daily', occurrence: 5 } as never);
    expect(counted!.recurrenceCount).toBe(5);
    expect(counted!.recurrenceEndDate).toBeUndefined();

    const both = recurrenceFromRule({
      frequency: 'daily',
      occurrence: 5,
      endDate: '2026-12-25T00:00:00.000+01:00',
    } as never);
    expect(both!.recurrenceEndDate).not.toBeUndefined();
    expect(both!.recurrenceCount).toBeUndefined();
  });

  it('drops the clauses this app has no field for, keeping the rest', () => {
    const out = recurrenceFromRule({
      frequency: 'yearly',
      monthsOfTheYear: [3, 9],
      weeksOfTheYear: [12],
    } as never);
    expect(out).toEqual({ recurrenceType: 'yearly', recurrenceInterval: 1 });
  });
});

describe('reminderTimeFromAlarms', () => {
  it('is null without alarms', () => {
    expect(reminderTimeFromAlarms(reminder(), NOW)).toBeNull();
    expect(reminderTimeFromAlarms(reminder({ alarms: [] }), NOW)).toBeNull();
  });

  it('takes an absolute alarm date', () => {
    const at = new Date(2026, 7, 8, 17, 0, 0);
    const out = reminderTimeFromAlarms(
      reminder({ alarms: [{ absoluteDate: at.toISOString() }] } as Partial<Reminder>),
      NOW
    );
    expect(out).toBe(at.toISOString());
  });

  it('resolves a relative offset against the due date', () => {
    const due = new Date(2026, 7, 8, 17, 0, 0);
    const out = reminderTimeFromAlarms(
      reminder({ dueDate: due.toISOString(), alarms: [{ relativeOffset: -30 }] } as Partial<Reminder>),
      NOW
    );
    expect(out).toBe(new Date(2026, 7, 8, 16, 30, 0).toISOString());
  });

  it('cannot resolve a relative offset with nothing to anchor it to', () => {
    expect(
      reminderTimeFromAlarms(reminder({ alarms: [{ relativeOffset: -30 }] } as Partial<Reminder>), NOW)
    ).toBeNull();
  });

  it('lets an absolute date win over a relative offset on the same alarm', () => {
    const at = new Date(2026, 7, 9, 8, 0, 0);
    const out = reminderTimeFromAlarms(
      reminder({
        dueDate: new Date(2026, 7, 8, 17, 0, 0).toISOString(),
        alarms: [{ absoluteDate: at.toISOString(), relativeOffset: -30 }],
      } as Partial<Reminder>),
      NOW
    );
    expect(out).toBe(at.toISOString());
  });

  it('drops alarms already in the past, which could never fire', () => {
    // scheduleTaskReminder refuses a past trigger, but reminderTime is a field
    // that ejects a task from the Inbox — so keeping one would file the capture
    // out of sight and buy nothing.
    const out = reminderTimeFromAlarms(
      reminder({
        alarms: [{ absoluteDate: new Date(2026, 6, 1, 9, 0, 0).toISOString() }],
      } as Partial<Reminder>),
      NOW
    );
    expect(out).toBeNull();
  });

  it('takes the earliest still-upcoming alarm', () => {
    const soon = new Date(2026, 7, 8, 9, 0, 0);
    const later = new Date(2026, 7, 20, 9, 0, 0);
    const past = new Date(2026, 6, 1, 9, 0, 0);
    const out = reminderTimeFromAlarms(
      reminder({
        alarms: [
          { absoluteDate: later.toISOString() },
          { absoluteDate: past.toISOString() },
          { absoluteDate: soon.toISOString() },
        ],
      } as Partial<Reminder>),
      NOW
    );
    expect(out).toBe(soon.toISOString());
  });
});

describe('pendingImportFor', () => {
  it('is null for a bare reminder that implies no schedule at all', () => {
    expect(pendingImportFor(reminder({ title: 'Buy milk' }), NOW)).toBeNull();
  });

  it('reads a native repeat Siri already understood', () => {
    // "Hey Siri, remind me to go running every day" — the repeat is a rule and
    // the title no longer contains the words, so text parsing alone sees
    // nothing.
    const out = pendingImportFor(
      reminder({ title: 'go running', recurrenceRule: { frequency: 'daily' } } as Partial<Reminder>),
      NOW
    );
    expect(out).toMatchObject({ recurrenceType: 'daily', recurrenceInterval: 1 });
    expect(out!.title).toBeUndefined();
  });

  it('reads a repeat Siri left in the title, and strips it', () => {
    const out = pendingImportFor(reminder({ title: 'go running every day' }), NOW);
    expect(out).toMatchObject({ recurrenceType: 'daily', title: 'go running' });
  });

  it('carries "after completion" when the whole phrase stayed in the title', () => {
    const out = pendingImportFor(reminder({ title: 'go running every day after completion' }), NOW);
    expect(out).toMatchObject({
      recurrenceType: 'daily',
      recurrenceFromCompletion: true,
      title: 'go running',
    });
  });

  it('carries "after completion" when Siri took the repeat and left the modifier', () => {
    // The headline case, and the one that needs both halves: EventKit has no
    // way to express from-completion, so it survives only as trailing text —
    // which parseTaskInput will not match on its own, having no recurrence
    // phrase in front of it.
    const out = pendingImportFor(
      reminder({
        title: 'go running after completion',
        recurrenceRule: { frequency: 'daily' },
      } as Partial<Reminder>),
      NOW
    );
    expect(out).toMatchObject({
      recurrenceType: 'daily',
      recurrenceFromCompletion: true,
      title: 'go running',
    });
  });

  it('does not invent a from-completion repeat when there is no repeat', () => {
    const out = pendingImportFor(reminder({ title: 'go running after completion' }), NOW);
    expect(out).toBeNull();
  });

  it('stores a due date at noon on its own day, not the raw instant', () => {
    // Midnight would land in the previous logical day for anyone whose
    // dayResetTime is after midnight — see ParsedSchedule.dueDate.
    const out = pendingImportFor(
      reminder({ title: 'Pay rent', dueDate: new Date(2026, 7, 8, 17, 0, 0).toISOString() }),
      NOW
    );
    const due = new Date(out!.dueDate!);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(7);
    expect(due.getDate()).toBe(8);
    expect(due.getHours()).toBe(12);
  });

  it('reads a part of the day off a timed due date', () => {
    const evening = pendingImportFor(
      reminder({ title: 'Pay rent', dueDate: new Date(2026, 7, 8, 19, 0, 0).toISOString() }),
      NOW
    );
    expect(evening!.timeSegments).toEqual(['evening']);

    const morning = pendingImportFor(
      reminder({ title: 'Pay rent', dueDate: new Date(2026, 7, 8, 9, 0, 0).toISOString() }),
      NOW
    );
    expect(morning!.timeSegments).toEqual(['morning']);
  });

  it('reads no part of the day off an all-day or midnight due date', () => {
    const allDay = pendingImportFor(
      reminder({
        title: 'Pay rent',
        dueDate: new Date(2026, 7, 8, 9, 0, 0).toISOString(),
        allDay: true,
      } as Partial<Reminder>),
      NOW
    );
    expect(allDay!.timeSegments).toBeUndefined();

    const midnight = pendingImportFor(
      reminder({ title: 'Pay rent', dueDate: new Date(2026, 7, 8, 0, 0, 0).toISOString() }),
      NOW
    );
    expect(midnight!.timeSegments).toBeUndefined();
  });

  it('lets EventKit win field by field, with the title filling what it left empty', () => {
    // A native monthly repeat plus a date phrase still sitting in the title:
    // the repeat comes from the rule, the date from the text.
    const out = pendingImportFor(
      reminder({
        title: 'Pay rent tomorrow',
        recurrenceRule: { frequency: 'monthly' },
      } as Partial<Reminder>),
      NOW
    );
    expect(out!.recurrenceType).toBe('monthly');
    expect(new Date(out!.dueDate!).getDate()).toBe(8);
    expect(out!.title).toBe('Pay rent');
  });

  it('does not let the title override a due date EventKit already stated', () => {
    const out = pendingImportFor(
      reminder({
        title: 'Pay rent tomorrow',
        dueDate: new Date(2026, 7, 20, 9, 0, 0).toISOString(),
      }),
      NOW
    );
    expect(new Date(out!.dueDate!).getDate()).toBe(20);
  });

  it('picks up an alarm as a reminder time', () => {
    const at = new Date(2026, 7, 8, 17, 0, 0);
    const out = pendingImportFor(
      reminder({ title: 'Pay rent', alarms: [{ absoluteDate: at.toISOString() }] } as Partial<Reminder>),
      NOW
    );
    expect(out!.reminderTime).toBe(at.toISOString());
  });
});

describe('describePendingImport', () => {
  it('is null when there is nothing to describe', () => {
    expect(describePendingImport(null)).toBeNull();
    expect(describePendingImport(undefined)).toBeNull();
    expect(describePendingImport({}, NOW)).toBeNull();
    expect(describePendingImport({ title: 'go running' }, NOW)).toBeNull();
  });

  it('describes a repeat without needing a date to do it', () => {
    expect(
      describePendingImport({ recurrenceType: 'daily', recurrenceInterval: 1 }, NOW)
    ).toBe('Daily');
    expect(
      describePendingImport(
        { recurrenceType: 'weekly', recurrenceInterval: 1, recurrenceDays: [1, 3] },
        NOW
      )
    ).toBe('Every Mon & Wed');
  });

  it('describes a one-off date', () => {
    expect(describePendingImport({ dueDate: new Date(2026, 7, 8, 12, 0, 0).toISOString() }, NOW))
      .toBe('Tomorrow');
  });

  it('says the things describeSchedule deliberately leaves out', () => {
    // quick add's tooltip omits these; here they separate two schedules the
    // user would want to tell apart before approving one.
    expect(
      describePendingImport(
        { recurrenceType: 'daily', recurrenceInterval: 1, recurrenceFromCompletion: true },
        NOW
      )
    ).toBe('Daily · after completion');
    expect(
      describePendingImport(
        { recurrenceType: 'daily', recurrenceInterval: 1, recurrenceCount: 5 },
        NOW
      )
    ).toBe('Daily · 5×');
    expect(
      describePendingImport(
        {
          recurrenceType: 'daily',
          recurrenceInterval: 1,
          recurrenceEndDate: new Date(2026, 11, 25, 12, 0, 0).toISOString(),
        },
        NOW
      )
    ).toBe('Daily · until Dec 25');
  });

  it('mentions a reminder', () => {
    expect(
      describePendingImport(
        {
          dueDate: new Date(2026, 7, 8, 12, 0, 0).toISOString(),
          reminderTime: new Date(2026, 7, 8, 17, 0, 0).toISOString(),
        },
        NOW
      )
    ).toBe('Tomorrow · reminder');
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
