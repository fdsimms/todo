import type { Person, Task } from '../types';
import {
  peopleOn,
  registerPersonSource,
  registerPersonTaskSource,
  resolvePerson,
  tasksNaming,
} from '../utils/peopleRegistry';

const person = (id: string, name: string): Person => ({
  id, name, nickname: '', notes: '', sortOrder: 1,
  archived: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: null, birthdayDay: null, birthYear: null, birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false,
  phoneNumber: null, email: null, linkUrl: null,
  cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null, reachOutDeclinedAt: null, askAbout: '',
  backfillDismissedFields: [],
});

const task = (id: string, personIds: string[]) => ({ id, personIds }) as unknown as Task;

afterEach(() => {
  registerPersonSource(null);
  registerPersonTaskSource(null);
});

describe('resolving a person', () => {
  it('finds one the store knows about', () => {
    registerPersonSource(() => [person('a', 'Ansley')]);
    expect(resolvePerson('a')?.name).toBe('Ansley');
  });

  // Ids in Task.personIds are deliberately never cleaned up when a person is
  // deleted — see docs/arch/people.md. Every reader has to shrug rather than
  // throw, the same way canBlock(undefined) is false.
  it('shrugs at an id whose person has gone', () => {
    registerPersonSource(() => [person('a', 'Ansley')]);
    expect(resolvePerson('gone')).toBeUndefined();
  });

  it('shrugs when no source is registered at all', () => {
    expect(resolvePerson('a')).toBeUndefined();
  });

  it('re-reads once the store replaces its array', () => {
    let people = [person('a', 'Ansley')];
    registerPersonSource(() => people);
    expect(resolvePerson('b')).toBeUndefined();
    people = [...people, person('b', 'Dustin')];
    expect(resolvePerson('b')?.name).toBe('Dustin');
  });
});

describe('the people a task names', () => {
  beforeEach(() => {
    registerPersonSource(() => [person('a', 'Ansley'), person('b', 'Dustin')]);
  });

  it('comes back in the order the task names them', () => {
    expect(peopleOn({ personIds: ['b', 'a'] }).map(p => p.name)).toEqual(['Dustin', 'Ansley']);
  });

  it('skips one who has been deleted rather than rendering a gap', () => {
    expect(peopleOn({ personIds: ['a', 'gone'] }).map(p => p.name)).toEqual(['Ansley']);
  });

  it('is empty for a task naming nobody', () => {
    expect(peopleOn({ personIds: [] })).toEqual([]);
  });
});

describe('the tasks naming a person', () => {
  it('finds every one, including completed rows', () => {
    // The completed ones are the point: a completed task carrying somebody's id
    // *is* the record that something happened with them, which is why there is
    // no interactions table.
    registerPersonTaskSource(() => [task('t1', ['a']), task('t2', ['a', 'b']), task('t3', [])]);
    expect(tasksNaming('a').map(t => t.id)).toEqual(['t1', 't2']);
    expect(tasksNaming('b').map(t => t.id)).toEqual(['t2']);
  });

  it('is empty for somebody no task names', () => {
    registerPersonTaskSource(() => [task('t1', ['a'])]);
    expect(tasksNaming('nobody')).toEqual([]);
  });

  it('is empty when no source is registered', () => {
    expect(tasksNaming('a')).toEqual([]);
  });

  it('rebuilds when the store replaces its array', () => {
    let tasks = [task('t1', ['a'])];
    registerPersonTaskSource(() => tasks);
    expect(tasksNaming('a')).toHaveLength(1);
    tasks = [...tasks, task('t2', ['a'])];
    expect(tasksNaming('a')).toHaveLength(2);
  });

  // The index is built once per store change rather than scanned per call: a
  // person chip renders on every row that has one, and a scan there is the
  // O(n²) waitingCountFor exists to avoid.
  it('does not re-read the source for every lookup', () => {
    const source = jest.fn(() => [task('t1', ['a'])]);
    registerPersonTaskSource(source);
    tasksNaming('a');
    tasksNaming('a');
    tasksNaming('b');
    // Called once per lookup to check identity, but the index is built once.
    expect(source).toHaveBeenCalledTimes(3);
    expect(tasksNaming('a')).toHaveLength(1);
  });
});
