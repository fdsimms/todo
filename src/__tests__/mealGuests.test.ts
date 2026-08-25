import type { MealPlanEntry, Person } from '../types';
import {
  describeGuests,
  guestsOn,
  hasGuests,
  upcomingMealsWithGuest,
} from '../utils/mealGuests';

function person(over: Partial<Person> & Pick<Person, 'id' | 'name'>): Person {
  return {
    nickname: '', notes: '', sortOrder: 1, archived: false, archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    birthdayMonth: null, birthdayDay: null, birthYear: null, birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false,
    phoneNumber: null, email: null, linkUrl: null,
    cadenceDays: 0, nudgeOptIn: false, reachOutDeclinedAt: null, askAbout: '',
    ...over,
  };
}

function meal(over: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'm1',
    date: '2026-08-27',
    slot: 'dinner',
    recipeId: null,
    title: 'Chili',
    sortOrder: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    personIds: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    calendarEventId: null,
    ...over,
  };
}

const dustin = person({ id: 'p1', name: 'Dustin Reyes', sortOrder: 1 });
const ansley = person({ id: 'p2', name: 'Ansley', sortOrder: 2 });
const mom = person({ id: 'p3', name: 'Marianne Fields', nickname: 'Mom', sortOrder: 3 });
const people = [dustin, ansley, mom];

describe('guestsOn', () => {
  it('resolves ids to people', () => {
    expect(guestsOn(meal({ personIds: ['p2'] }), people).map(p => p.id)).toEqual(['p2']);
  });

  it('shrugs off an id whose person is gone rather than rendering a blank', () => {
    expect(guestsOn(meal({ personIds: ['p2', 'deleted'] }), people).map(p => p.id)).toEqual(['p2']);
  });

  it('returns the People screen order, not the order they were tapped', () => {
    expect(guestsOn(meal({ personIds: ['p3', 'p1', 'p2'] }), people).map(p => p.id))
      .toEqual(['p1', 'p2', 'p3']);
  });

  it('is empty for a meal naming nobody', () => {
    expect(guestsOn(meal(), people)).toEqual([]);
  });

  it('includes an archived guest, since filing somebody away is about the list', () => {
    const filed = person({ id: 'p9', name: 'Priya', archived: true, sortOrder: 4 });
    expect(guestsOn(meal({ personIds: ['p9'] }), [...people, filed]).map(p => p.id)).toEqual(['p9']);
  });
});

describe('describeGuests', () => {
  it('says nothing for nobody', () => {
    expect(describeGuests([])).toBe('');
  });

  it('names one', () => {
    expect(describeGuests([ansley])).toBe('Ansley');
  });

  it('joins two with "and"', () => {
    expect(describeGuests([dustin, ansley])).toBe('Dustin Reyes and Ansley');
  });

  it('uses a nickname over a name', () => {
    expect(describeGuests([mom])).toBe('Mom');
  });

  it('serial-joins up to the limit', () => {
    expect(describeGuests([dustin, ansley, mom])).toBe('Dustin Reyes, Ansley and Mom');
  });

  it('counts past the limit, but still leads with a name', () => {
    const extra = person({ id: 'p4', name: 'Priya', sortOrder: 4 });
    expect(describeGuests([dustin, ansley, mom, extra])).toBe('Dustin Reyes and 3 others');
  });

  it('honours a caller-set limit', () => {
    expect(describeGuests([dustin, ansley, mom], 2)).toBe('Dustin Reyes and 2 others');
  });

  it('skips a person with no usable name at all', () => {
    const blank = person({ id: 'p5', name: '   ', sortOrder: 5 });
    expect(describeGuests([ansley, blank])).toBe('Ansley');
  });
});

describe('hasGuests', () => {
  it('answers off the ids, not off whether they resolve', () => {
    expect(hasGuests(meal())).toBe(false);
    expect(hasGuests(meal({ personIds: ['gone'] }))).toBe(true);
  });
});

describe('upcomingMealsWithGuest', () => {
  const today = '2026-08-25';

  it('finds a meal naming them', () => {
    const out = upcomingMealsWithGuest([meal({ personIds: ['p2'] })], 'p2', today);
    expect(out).toEqual([{ entryId: 'm1', title: 'Chili', date: '2026-08-27', slot: 'dinner' }]);
  });

  it('ignores a meal naming somebody else', () => {
    expect(upcomingMealsWithGuest([meal({ personIds: ['p1'] })], 'p2', today)).toEqual([]);
  });

  it('ignores a meal naming nobody', () => {
    expect(upcomingMealsWithGuest([meal()], 'p2', today)).toEqual([]);
  });

  it('counts today as upcoming, since a day key has no hour to be past', () => {
    const out = upcomingMealsWithGuest([meal({ date: today, personIds: ['p2'] })], 'p2', today);
    expect(out).toHaveLength(1);
  });

  it('drops a day that has been and gone', () => {
    const out = upcomingMealsWithGuest([meal({ date: '2026-08-20', personIds: ['p2'] })], 'p2', today);
    expect(out).toEqual([]);
  });

  it('drops a meal already cooked, which is history rather than a plan', () => {
    const cooked = meal({ personIds: ['p2'], cookedAt: '2026-08-27T20:00:00.000Z' });
    expect(upcomingMealsWithGuest([cooked], 'p2', today)).toEqual([]);
  });

  it('returns soonest first, breaking a tie on the slot', () => {
    const rows = [
      meal({ id: 'later', date: '2026-09-01', personIds: ['p2'] }),
      meal({ id: 'lunch', date: '2026-08-27', slot: 'lunch', personIds: ['p2'] }),
      meal({ id: 'dinner', date: '2026-08-27', slot: 'dinner', personIds: ['p2'] }),
    ];
    expect(upcomingMealsWithGuest(rows, 'p2', today).map(m => m.entryId))
      .toEqual(['dinner', 'lunch', 'later']);
  });

  it('finds a meal naming several people, once per person asking', () => {
    const shared = [meal({ personIds: ['p1', 'p2'] })];
    expect(upcomingMealsWithGuest(shared, 'p1', today)).toHaveLength(1);
    expect(upcomingMealsWithGuest(shared, 'p2', today)).toHaveLength(1);
  });
});
