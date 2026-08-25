import type { Task } from '../types';
import {
  daysSinceTogether,
  describeDaysSince,
  describeLastTogether,
  lastTogether,
  personHistory,
  personUpcoming,
} from '../utils/personHistory';

const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Beach day',
  completed: false,
  completedAt: null,
  missedAt: null,
  archived: false,
  parentId: null,
  dueDate: null,
  personIds: ['p1'],
} as unknown as Task);

const make = (o: Partial<Task>): Task => ({ ...task(), ...o } as Task);

const TODAY = new Date(2026, 2, 20, 12); // March 20 2026

describe('what counts as history', () => {
  it('is the completed tasks that named them, newest first', () => {
    const entries = personHistory([
      make({ id: 'a', title: 'Coffee', completed: true, completedAt: iso(2026, 3, 1) }),
      make({ id: 'b', title: 'Hike', completed: true, completedAt: iso(2026, 3, 14) }),
    ]);
    expect(entries.map(e => e.title)).toEqual(['Hike', 'Coffee']);
  });

  it('leaves out anything still to do', () => {
    expect(personHistory([make({ completed: false })])).toEqual([]);
  });

  // The one that matters most: a missed task is stored as a completed row
  // carrying missedAt, so counting `completed` would read a "Call Mom" you
  // missed as having called her. That is the app writing down something about
  // a relationship that did not happen.
  it('never counts a missed task, which is stored as a completed row', () => {
    const missed = make({ completed: true, completedAt: iso(2026, 3, 14), missedAt: iso(2026, 3, 14) });
    expect(personHistory([missed])).toEqual([]);
  });

  // A "Beach day" with three subtasks would otherwise read as four separate
  // times you saw somebody, which is four times the evidence for one afternoon
  // once a cadence is derived from this.
  it('counts a parent once rather than counting its subtasks too', () => {
    const entries = personHistory([
      make({ id: 'parent', title: 'Beach day', completed: true, completedAt: iso(2026, 3, 14) }),
      make({ id: 'sub1', title: 'Pack towels', completed: true, completedAt: iso(2026, 3, 14), parentId: 'parent' }),
      make({ id: 'sub2', title: 'Buy snacks', completed: true, completedAt: iso(2026, 3, 14), parentId: 'parent' }),
    ]);
    expect(entries.map(e => e.title)).toEqual(['Beach day']);
  });

  // Unlike groupRoster and projectProgress, which collapse because they count
  // members. This counts events, and a standing Sunday call really is one
  // entry per Sunday.
  it('keeps every occurrence of a repeat, rather than collapsing them', () => {
    const entries = personHistory([
      make({ id: 'a', title: 'Sunday call', completed: true, completedAt: iso(2026, 3, 1) }),
      make({ id: 'b', title: 'Sunday call', completed: true, completedAt: iso(2026, 3, 8) }),
      make({ id: 'c', title: 'Sunday call', completed: true, completedAt: iso(2026, 3, 15) }),
    ]);
    expect(entries).toHaveLength(3);
  });

  it('still counts something archived, since filing it away does not undo it', () => {
    const filed = make({ completed: true, completedAt: iso(2026, 3, 14), archived: true });
    expect(personHistory([filed])).toHaveLength(1);
  });

  it('carries who else was there', () => {
    const entries = personHistory([
      make({ completed: true, completedAt: iso(2026, 3, 14), personIds: ['p1', 'p2'] }),
    ]);
    expect(entries[0].alsoPersonIds).toEqual(['p1', 'p2']);
  });
});

describe('what is still to come', () => {
  it('is the live dated tasks, soonest first', () => {
    const upcoming = personUpcoming([
      make({ id: 'a', title: 'Dinner', dueDate: iso(2026, 4, 2) }),
      make({ id: 'b', title: 'Beach', dueDate: iso(2026, 3, 25) }),
    ]);
    expect(upcoming.map(u => u.title)).toEqual(['Beach', 'Dinner']);
  });

  // "Someday, coffee with Dustin" is a wish rather than a plan, and listing it
  // under Coming up would overstate what has actually been arranged.
  it('leaves out an undated task, which is a wish rather than a plan', () => {
    expect(personUpcoming([make({ dueDate: null })])).toEqual([]);
  });

  it('leaves out what is already done, and what is filed away', () => {
    expect(personUpcoming([
      make({ completed: true, completedAt: iso(2026, 3, 1), dueDate: iso(2026, 3, 1) }),
      make({ archived: true, dueDate: iso(2026, 4, 1) }),
    ])).toEqual([]);
  });
});

describe('when you were last together', () => {
  it('is the most recent entry', () => {
    const entries = personHistory([
      make({ id: 'a', completed: true, completedAt: iso(2026, 3, 1) }),
      make({ id: 'b', completed: true, completedAt: iso(2026, 3, 14) }),
    ]);
    expect(lastTogether(entries)).toEqual(new Date(iso(2026, 3, 14)));
  });

  it('is nothing at all when there is no history yet', () => {
    expect(lastTogether([])).toBeNull();
  });
});

// Rule 2 in docs/arch/people.md: a date is a fact, a duration is a judgment.
// This is the phrase allowed to appear anywhere, so it is never a day count.
describe('the phrase that may appear anywhere', () => {
  it('names today and yesterday rather than counting them', () => {
    expect(describeLastTogether(new Date(2026, 2, 20, 9), TODAY)).toBe('Today');
    expect(describeLastTogether(new Date(2026, 2, 19, 9), TODAY)).toBe('Yesterday');
  });

  it('uses the weekday inside a week, where a date reads oddly', () => {
    expect(describeLastTogether(new Date(2026, 2, 17, 12), TODAY)).toBe('Last Tuesday');
  });

  it('is a plain date past a week', () => {
    expect(describeLastTogether(new Date(2026, 2, 1, 12), TODAY)).toBe('March 1');
  });

  it('adds the year once it is not this one', () => {
    expect(describeLastTogether(new Date(2025, 2, 1, 12), TODAY)).toBe('March 1, 2025');
  });

  it('never says a number of days', () => {
    for (const d of [0, 1, 3, 8, 40, 400]) {
      const at = new Date(TODAY.getTime() - d * 86_400_000);
      expect(describeLastTogether(at, TODAY)).not.toMatch(/\d+\s*days?\s*ago/);
    }
  });
});

// The one exception, for the person's own screen: going to look is different
// from being told.
describe('the day count, allowed on one screen', () => {
  it('counts calendar days', () => {
    expect(daysSinceTogether(new Date(2026, 2, 1, 12), TODAY)).toBe(19);
  });

  it('is nothing at all with no history, which must not render as zero', () => {
    expect(daysSinceTogether(null, TODAY)).toBeNull();
  });

  it('never goes negative for something logged later today', () => {
    expect(daysSinceTogether(new Date(2026, 2, 21, 12), TODAY)).toBe(0);
  });

  it('names today and yesterday rather than counting them', () => {
    expect(describeDaysSince(0)).toBe('Today');
    expect(describeDaysSince(1)).toBe('Yesterday');
    expect(describeDaysSince(19)).toBe('19 days ago');
  });
});
