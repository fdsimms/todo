/**
 * The people tools against a stub replica. What these pin is the part
 * docs/arch/people.md cares about: order is the user's own, and the last time
 * together is a date rather than a count.
 */
import { getPerson, listPeople, upcomingBirthdays, addPersonHistory } from '../peopleTools';
import type { Replica } from '../replica';
import type { Person, Task } from '../../../src/types';

const person = (over: Partial<Person> & { id: string; name: string }): Person =>
  ({ nickname: '', kind: 'individual', notes: '', askAbout: '', sortOrder: 0, archived: false, groupId: null,
     birthdayMonth: null, birthdayDay: null, phoneNumber: '', email: '', ...over }) as Person;

function stub(people: Person[], over: Partial<Replica> = {}): Replica {
  return {
    people: () => people,
    personGroups: () => [{ id: 'g1', name: 'Family' }],
    personNotes: () => [],
    personHistory: () => [],
    nextBirthday: () => null,
    todayKey: () => '2026-10-04',
    shiftDayKey: (key: string, days: number) => {
      const d = new Date(`${key}T12:00:00`);
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    ...over,
  } as unknown as Replica;
}

describe('listPeople', () => {
  it('keeps the user\'s own order and leaves archived people out', () => {
    const people = [
      person({ id: 'b', name: 'Bea', sortOrder: 2 }),
      person({ id: 'a', name: 'Al', sortOrder: 1, groupId: 'g1' }),
      person({ id: 'x', name: 'Gone', sortOrder: 0, archived: true }),
    ];
    const list = listPeople(stub(people));
    expect(list.map(p => p.id)).toEqual(['a', 'b']);
    expect(list[0].group).toBe('Family');
  });

  it('gives the last time together as a date, and a birthday with no age', () => {
    const r = stub([person({ id: 'a', name: 'Al', birthdayMonth: 3, birthdayDay: 14, birthYear: 1990 } as Person)], {
      personHistory: () => [{ taskId: 't', title: 'Coffee', at: new Date(2026, 8, 20, 18).toISOString() }],
    });
    const [al] = listPeople(r);
    expect(al.lastTogether).toBe('2026-09-20');
    expect(al.birthday).toBe('March 14');
    expect(JSON.stringify(al)).not.toMatch(/1990|days/);
  });
});

describe('getPerson', () => {
  it('shows where they live, and leaves it out when blank', () => {
    const r = stub([person({ id: 'a', name: 'Al', location: 'Austin, TX' }), person({ id: 'b', name: 'Bea', location: null })]);
    expect(getPerson(r, 'a')!.location).toBe('Austin, TX');
    expect(getPerson(r, 'b')!.location).toBeUndefined();
  });

  it('sorts notes into gift ideas, food and the rest, skipping archived ones', () => {
    const r = stub([person({ id: 'a', name: 'Al' })], {
      personNotes: () => [
        { id: '1', personId: 'a', kind: 'gift', text: 'Socks', sortOrder: 1, archivedAt: null },
        { id: '2', personId: 'a', kind: 'food', text: 'Vegetarian', sortOrder: 1, archivedAt: null },
        { id: '3', personId: 'a', kind: 'note', text: 'Old', sortOrder: 1, archivedAt: '2026-01-01' },
        { id: '4', personId: 'b', kind: 'gift', text: 'Not theirs', sortOrder: 1, archivedAt: null },
      ] as never,
    });
    expect(getPerson(r, 'a')).toMatchObject({ giftIdeas: ['Socks'], food: ['Vegetarian'], history: [] });
    expect(getPerson(r, 'a')!.otherNotes).toBeUndefined();
    expect(getPerson(r, 'nope')).toBeNull();
  });
});

describe('upcomingBirthdays', () => {
  it('lists the ones inside the window, soonest first', () => {
    const r = stub([person({ id: 'a', name: 'Al' }), person({ id: 'b', name: 'Bea', nickname: 'B' }), person({ id: 'c', name: 'Cy' })], {
      nextBirthday: (p: Person) => ({ a: new Date(2026, 9, 20, 12), b: new Date(2026, 9, 6, 12), c: new Date(2027, 0, 1, 12) } as Record<string, Date>)[p.id],
    });
    expect(upcomingBirthdays(r, 30)).toEqual([
      { id: 'b', name: 'B', date: '2026-10-06' },
      { id: 'a', name: 'Al', date: '2026-10-20' },
    ]);
  });
});

describe('addPersonHistory', () => {
  it('passes the people and the day through, and names them in the result', () => {
    const add = jest.fn((_ids: string[], title: string, at: Date) => ({ title, completedAt: at.toISOString() }) as Task);
    const r = stub([person({ id: 'a', name: 'Al' })], { addPersonHistory: add });
    const result = addPersonHistory(r, { personIds: ['a'], title: 'Lunch', date: '2026-09-30T12:00:00' });
    expect(add).toHaveBeenCalledWith(['a'], 'Lunch', new Date('2026-09-30T12:00:00'));
    expect(result.added).toEqual({ title: 'Lunch', date: '2026-09-30', people: ['Al'] });
    expect(() => addPersonHistory(r, { personIds: ['a'], title: 'x', date: 'whenever' })).toThrow(/ISO/);
  });
});
