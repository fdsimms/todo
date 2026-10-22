import type { Person, PersonDate, Task } from '../types';
import {
  cleanPersonDates,
  isWholePersonDate,
  nextPersonDate,
  parsePersonDateSource,
  personDateDrift,
  personDateInYear,
  personDateSourceId,
  personDateTitle,
  stalePersonDateTasks,
  wantedPersonDateTasks,
  withPersonDateRemind,
} from '../utils/personDateTasks';

const date = (overrides: Partial<PersonDate> = {}): PersonDate => ({
  id: 'd1', label: 'Anniversary', month: 6, day: 14, year: 2019, yearly: true, remind: true,
  ...overrides,
});

const person = (overrides: Partial<Person> = {}): Person => ({
  id: 'p1', name: 'Sam Rivera', kind: 'individual', nickname: '', notes: '', sortOrder: 1,
  archived: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: null, birthdayDay: null, birthYear: null,
  birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false, pinned: false,
  phoneNumber: '555-0100', email: null, linkUrl: null,
  cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null,
  reachOutDeclinedAt: null, reachOutOfferDeclinedAt: null, askAbout: '',
  backfillDismissedFields: [], groupId: null, location: null, faxNumber: null, address: null,
  dates: [date()],
  ...overrides,
});

const task = (overrides: Partial<Task> = {}) => ({
  generatedKind: 'personDate', generatedSourceId: 'p1#d1#2026', completed: false, archived: false,
  ...overrides,
}) as Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;

describe('personDateInYear', () => {
  it('lands at noon on the day', () => {
    expect(personDateInYear({ month: 6, day: 14 }, 2026)).toEqual(new Date(2026, 5, 14, 12));
  });

  it('clamps February 29 to the 28th in a common year, and not in a leap year', () => {
    expect(personDateInYear({ month: 2, day: 29 }, 2027)).toEqual(new Date(2027, 1, 28, 12));
    expect(personDateInYear({ month: 2, day: 29 }, 2028)).toEqual(new Date(2028, 1, 29, 12));
  });
});

describe('nextPersonDate', () => {
  const today = new Date(2026, 5, 10);

  it('takes this year for a yearly date still to come, next year once it has passed', () => {
    expect(nextPersonDate(date(), today)).toEqual(new Date(2026, 5, 14, 12));
    expect(nextPersonDate(date({ month: 3 }), today)).toEqual(new Date(2027, 2, 14, 12));
  });

  it('counts the day itself as still to come', () => {
    expect(nextPersonDate(date({ day: 10 }), today)).toEqual(new Date(2026, 5, 10, 12));
  });

  it('gives a one-off date in its own year only, and nothing once it has passed', () => {
    expect(nextPersonDate(date({ yearly: false, year: 2026 }), today)).toEqual(new Date(2026, 5, 14, 12));
    expect(nextPersonDate(date({ yearly: false, year: 2027 }), today)).toEqual(new Date(2027, 5, 14, 12));
    expect(nextPersonDate(date({ yearly: false, year: 2025 }), today)).toBeNull();
  });

  it('refuses a one-off with no year, and a day that does not exist', () => {
    expect(nextPersonDate(date({ yearly: false, year: null }), today)).toBeNull();
    expect(nextPersonDate(date({ month: 13 }), today)).toBeNull();
    expect(isWholePersonDate(date({ day: 0 }))).toBe(false);
  });
});

describe('personDateTitle', () => {
  it('names the person, then the day as written', () => {
    expect(personDateTitle(person(), date({ label: ' Started new job ' }))).toBe('Sam Rivera: Started new job');
  });

  it('prefers a nickname', () => {
    expect(personDateTitle(person({ nickname: 'Sammy' }), date())).toBe('Sammy: Anniversary');
  });
});

describe('the source id', () => {
  it('round-trips the person, the date and the year', () => {
    const id = personDateSourceId('p1', 'd1', 2026);
    expect(parsePersonDateSource({ generatedKind: 'personDate', generatedSourceId: id }))
      .toEqual({ personId: 'p1', dateId: 'd1', year: 2026 });
  });

  it('reads nothing off another kind or a malformed id', () => {
    expect(parsePersonDateSource({ generatedKind: 'birthday', generatedSourceId: 'p1#d1#2026' })).toBeNull();
    expect(parsePersonDateSource({ generatedKind: 'personDate', generatedSourceId: 'p1#2026' })).toBeNull();
  });
});

describe('wantedPersonDateTasks', () => {
  const today = new Date(2026, 5, 10);

  it('wants a date inside the lead window, due today, with the date as its deadline', () => {
    const [want] = wantedPersonDateTasks([person()], 7, today);
    expect(want.sourceId).toBe('p1#d1#2026');
    expect(want.title).toBe('Sam Rivera: Anniversary');
    expect(want.dueDate).toEqual(new Date(2026, 5, 10, 12));
    expect(want.deadline).toEqual(new Date(2026, 5, 14, 12));
    expect(want.phoneNumber).toBe('555-0100');
  });

  it('wants nothing outside the window', () => {
    expect(wantedPersonDateTasks([person()], 3, today)).toEqual([]);
  });

  it('skips a date with its reminder off, an archived person and a business', () => {
    expect(wantedPersonDateTasks([person({ dates: [date({ remind: false })] })], 7, today)).toEqual([]);
    expect(wantedPersonDateTasks([person({ archived: true })], 7, today)).toEqual([]);
    expect(wantedPersonDateTasks([person({ kind: 'business' })], 7, today)).toEqual([]);
  });

  it('reads a person written before dates existed as having none', () => {
    expect(wantedPersonDateTasks([person({ dates: undefined })], 7, today)).toEqual([]);
  });

  it('gives each date of one person its own row, soonest first', () => {
    const two = person({ dates: [date({ id: 'd2', label: 'Day we met', day: 16 }), date()] });
    expect(wantedPersonDateTasks([two], 7, today).map(w => w.dateId)).toEqual(['d1', 'd2']);
  });
});

describe('stalePersonDateTasks', () => {
  it('flags a live row nothing wants any more, and leaves a wanted one', () => {
    const wants = wantedPersonDateTasks([person()], 7, new Date(2026, 5, 10));
    expect(stalePersonDateTasks([task()], wants)).toEqual([]);
    expect(stalePersonDateTasks([task({ generatedSourceId: 'p1#gone#2026' })], wants)).toHaveLength(1);
  });

  it('never touches a completed row', () => {
    expect(stalePersonDateTasks([task({ completed: true })], [])).toEqual([]);
  });
});

describe('personDateDrift', () => {
  const [want] = wantedPersonDateTasks([person()], 7, new Date(2026, 5, 10));

  it('leaves a row whose date has not moved, deferred or not', () => {
    expect(personDateDrift({ deadline: new Date(2026, 5, 14, 12).toISOString() }, want)).toBeNull();
  });

  it('rewrites both dates when the date itself moved', () => {
    expect(personDateDrift({ deadline: new Date(2026, 5, 13, 12).toISOString() }, want)).toEqual({
      dueDate: want.dueDate.toISOString(),
      deadline: want.deadline.toISOString(),
    });
  });
});

describe('withPersonDateRemind', () => {
  it('turns one date off and leaves the rest', () => {
    const list = [date(), date({ id: 'd2' })];
    expect(withPersonDateRemind(list, 'd1', false)).toEqual([date({ remind: false }), date({ id: 'd2' })]);
  });

  it('returns null when nothing would change', () => {
    expect(withPersonDateRemind([date()], 'd1', true)).toBeNull();
    expect(withPersonDateRemind([date()], 'missing', false)).toBeNull();
    expect(withPersonDateRemind(undefined, 'd1', false)).toBeNull();
  });
});

describe('cleanPersonDates', () => {
  it('trims labels and drops a date with no label or no real day', () => {
    expect(cleanPersonDates([
      date({ label: '  Anniversary ' }),
      date({ id: 'd2', label: '   ' }),
      date({ id: 'd3', month: 0 }),
    ])).toEqual([date()]);
  });

  it('keeps a one-off still missing its year, for the editor to point at', () => {
    const once = date({ yearly: false, year: null });
    expect(cleanPersonDates([once])).toEqual([once]);
  });
});
