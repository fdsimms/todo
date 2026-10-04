import type { MealPlanEntry, Person, Project, Task } from '../types';
import { dayKeyOf } from '../utils/dateUtils';
import {
  buildDayExtras,
  calendarTrips,
  completedRows,
  hasDayNotes,
  tripBandLanes,
  type DayExtras,
} from '../utils/calendarExtras';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
  },
}));

// Only the fields each reader touches; the rest of the shape is irrelevant here.
const project = (over: Partial<Project>): Project => ({
  id: 'p1', title: 'Trip', archived: false, completed: false, deadline: null,
  awayStart: null, awayEnd: null, ...over,
} as unknown as Project);

const person = (over: Partial<Person>): Person => ({
  id: 'a', name: 'Tessa', nickname: '', archived: false, birthdayMonth: null, birthdayDay: null, ...over,
} as unknown as Person);

const task = (over: Partial<Task>): Task => ({
  id: 't', title: 'Task', completed: false, completedAt: null, missedAt: null,
  parentId: null, archived: false, ...over,
} as unknown as Task);

const meal = (over: Partial<MealPlanEntry>): MealPlanEntry => ({
  id: 'm', date: '2026-10-05', slot: 'dinner', recipeId: null, title: 'Tacos', sortOrder: 0, ...over,
} as unknown as MealPlanEntry);

/** Oct 4–10 2026, a Sunday-start week. */
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 4 + i));
const keys = week.map(dayKeyOf);

const empty = { trips: [], meals: [], people: [], projects: [], tasks: [] };

describe('calendarTrips', () => {
  it('names each live project with an away span, and drops filed ones', () => {
    const trips = calendarTrips([
      project({ id: 'p1', title: 'Lisbon', awayStart: new Date(2026, 9, 5, 12).toISOString(), awayEnd: new Date(2026, 9, 8, 12).toISOString() }),
      project({ id: 'p2', title: 'Old', archived: true, awayStart: new Date(2026, 9, 5, 12).toISOString() }),
      project({ id: 'p3', title: 'Done', completed: true, awayStart: new Date(2026, 9, 5, 12).toISOString() }),
      project({ id: 'p4', title: 'No trip' }),
    ]);
    expect(trips.map(t => t.name)).toEqual(['Lisbon']);
  });
});

describe('buildDayExtras', () => {
  it('covers a trip from departure up to, not including, the return day', () => {
    const trips = calendarTrips([
      project({ title: 'Lisbon', awayStart: new Date(2026, 9, 5, 12).toISOString(), awayEnd: new Date(2026, 9, 8, 12).toISOString() }),
    ]);
    const extras = buildDayExtras(week, { ...empty, trips });
    expect(keys.filter(k => extras.get(k)?.trips.length)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('puts meals on their day, in slot order', () => {
    const extras = buildDayExtras(week, {
      ...empty,
      meals: [
        meal({ id: 'd', slot: 'dinner', title: 'Tacos' }),
        meal({ id: 'b', slot: 'breakfast', title: 'Oats' }),
        meal({ id: 'x', date: '2026-11-01', title: 'Off grid' }),
      ],
    });
    expect(extras.get('2026-10-05')?.meals.map(m => m.title)).toEqual(['Oats', 'Tacos']);
    expect([...extras.keys()]).toEqual(['2026-10-05']);
  });

  it('places a birthday in every year the grid touches, and skips archived people', () => {
    const newYear = Array.from({ length: 7 }, (_, i) => new Date(2026, 11, 29 + i));
    const extras = buildDayExtras(newYear, {
      ...empty,
      people: [
        person({ id: 'a', name: 'Tessa', birthdayMonth: 1, birthdayDay: 2 }),
        person({ id: 'b', name: 'Bo', nickname: 'Bobby', birthdayMonth: 12, birthdayDay: 30 }),
        person({ id: 'c', name: 'Gone', archived: true, birthdayMonth: 12, birthdayDay: 31 }),
      ],
    });
    expect(extras.get('2027-01-02')?.birthdays).toEqual([{ personId: 'a', title: "Tessa's birthday" }]);
    expect(extras.get('2026-12-30')?.birthdays).toEqual([{ personId: 'b', title: "Bobby's birthday" }]);
    expect(extras.get('2026-12-31')).toBeUndefined();
  });

  it('lists a live project deadline on its day', () => {
    const extras = buildDayExtras(week, {
      ...empty,
      projects: [
        project({ id: 'p1', title: 'Remodel', deadline: new Date(2026, 9, 9, 12).toISOString() }),
        project({ id: 'p2', title: 'Shipped', completed: true, deadline: new Date(2026, 9, 9, 12).toISOString() }),
      ],
    });
    expect(extras.get('2026-10-09')?.projectDeadlines).toEqual([{ projectId: 'p1', name: 'Remodel' }]);
  });

  it('files a completion on its logical day, newest first, without subtasks, archived or missed rows', () => {
    const extras = buildDayExtras(week, {
      ...empty,
      dayResetTime: '02:00',
      tasks: [
        task({ id: 'early', completed: true, completedAt: new Date(2026, 9, 6, 9).toISOString() }),
        task({ id: 'late', completed: true, completedAt: new Date(2026, 9, 6, 20).toISOString() }),
        // 1 AM on the 7th is still the 6th under a 2 AM reset.
        task({ id: 'night', completed: true, completedAt: new Date(2026, 9, 7, 1).toISOString() }),
        task({ id: 'sub', parentId: 'early', completed: true, completedAt: new Date(2026, 9, 6, 10).toISOString() }),
        task({ id: 'filed', archived: true, completed: true, completedAt: new Date(2026, 9, 6, 10).toISOString() }),
        task({ id: 'missed', missedAt: new Date(2026, 9, 6, 10).toISOString(), completed: true, completedAt: new Date(2026, 9, 6, 10).toISOString() }),
        task({ id: 'open' }),
      ],
    });
    expect(extras.get('2026-10-06')?.completedIds).toEqual(['night', 'late', 'early']);
    expect(extras.get('2026-10-07')).toBeUndefined();
  });
});

describe('hasDayNotes', () => {
  const base: DayExtras = { key: 'k', trips: [], meals: [], birthdays: [], projectDeadlines: [], completedIds: ['t'] };
  it('ignores completions, which are rows rather than notes', () => {
    expect(hasDayNotes(base, true)).toBe(false);
    expect(hasDayNotes(undefined, true)).toBe(false);
  });
  it('counts meals only when asked to (the day view draws them on its own band)', () => {
    const withMeal = { ...base, meals: [meal({})] };
    expect(hasDayNotes(withMeal, true)).toBe(true);
    expect(hasDayNotes(withMeal, false)).toBe(false);
  });
});

describe('completedRows', () => {
  it('leaves out a task the day already lists', () => {
    const a = task({ id: 'a', completed: true });
    const b = task({ id: 'b', completed: true });
    const extras: DayExtras = { key: 'k', trips: [], meals: [], birthdays: [], projectDeadlines: [], completedIds: ['a', 'b', 'gone'] };
    const byId = new Map([[a.id, a], [b.id, b]]);
    expect(completedRows(extras, [a], byId).map(t => t.id)).toEqual(['b']);
  });
});

describe('tripBandLanes', () => {
  const extrasFor = (byKey: Record<string, string[]>): Map<string, DayExtras> => new Map(
    Object.entries(byKey).map(([key, ids]) => [key, {
      key, meals: [], birthdays: [], projectDeadlines: [], completedIds: [],
      trips: ids.map(id => ({ projectId: id, name: id.toUpperCase() })),
    }]),
  );

  it('draws one segment per run, open-ended where the trip carries on', () => {
    const extras = extrasFor({
      '2026-10-03': ['a'],
      '2026-10-04': ['a'], '2026-10-05': ['a'],
      '2026-10-09': ['b'], '2026-10-10': ['b'], '2026-10-11': ['b'],
    });
    const lanes = tripBandLanes(keys, extras, '2026-10-03', '2026-10-11');
    expect(lanes).toEqual([[
      { projectId: 'a', name: 'A', startCol: 0, span: 2, continuesBefore: true, continuesAfter: false },
      { projectId: 'b', name: 'B', startCol: 5, span: 2, continuesBefore: false, continuesAfter: true },
    ]]);
  });

  it('gives overlapping trips a lane each, the longer one on top', () => {
    const extras = extrasFor({
      '2026-10-05': ['long'], '2026-10-06': ['long', 'short'], '2026-10-07': ['long'],
    });
    const lanes = tripBandLanes(keys, extras, null, null);
    expect(lanes.map(l => l.map(s => s.projectId))).toEqual([['long'], ['short']]);
  });

  it('is empty for a week with no trip', () => {
    expect(tripBandLanes(keys, new Map(), null, null)).toEqual([]);
  });
});
