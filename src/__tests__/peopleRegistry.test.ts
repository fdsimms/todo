import type { Person, PersonGroup, Task } from '../types';
import {
  peopleOn,
  registerPersonSource,
  registerPersonTaskSource,
  registerPersonGroupSource,
  resolvePerson,
  resolvePersonGroup,
  groupMembers,
  groupMentionTokens,
  tasksNaming,
  contactDetailsFor,
} from '../utils/peopleRegistry';

const person = (id: string, name: string, groupId: string | null = null): Person => ({
  id, name, kind: 'individual', nickname: '', notes: '', sortOrder: 1,
  archived: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: null, birthdayDay: null, birthYear: null, birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false,
  phoneNumber: null, email: null, linkUrl: null,
  cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null, reachOutDeclinedAt: null, reachOutOfferDeclinedAt: null, askAbout: '',
  backfillDismissedFields: [], groupId, location: null,
});

const group = (id: string, name: string): PersonGroup => ({
  id, name, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', catchUpSeparately: false,
});

const task = (id: string, personIds: string[]) => ({ id, personIds }) as unknown as Task;

afterEach(() => {
  registerPersonSource(null);
  registerPersonTaskSource(null);
  registerPersonGroupSource(null);
});

describe('resolving a person', () => {
  it('finds one the store knows about', () => {
    registerPersonSource(() => [person('a', 'Tessa')]);
    expect(resolvePerson('a')?.name).toBe('Tessa');
  });

  // Ids in Task.personIds are deliberately never cleaned up when a person is
  // deleted — see docs/arch/people.md. Every reader has to shrug rather than
  // throw, the same way canBlock(undefined) is false.
  it('shrugs at an id whose person has gone', () => {
    registerPersonSource(() => [person('a', 'Tessa')]);
    expect(resolvePerson('gone')).toBeUndefined();
  });

  it('shrugs when no source is registered at all', () => {
    expect(resolvePerson('a')).toBeUndefined();
  });

  it('re-reads once the store replaces its array', () => {
    let people = [person('a', 'Tessa')];
    registerPersonSource(() => people);
    expect(resolvePerson('b')).toBeUndefined();
    people = [...people, person('b', 'Gideon')];
    expect(resolvePerson('b')?.name).toBe('Gideon');
  });
});

describe('the people a task names', () => {
  beforeEach(() => {
    registerPersonSource(() => [person('a', 'Tessa'), person('b', 'Gideon')]);
  });

  it('comes back in the order the task names them', () => {
    expect(peopleOn({ personIds: ['b', 'a'] }).map(p => p.name)).toEqual(['Gideon', 'Tessa']);
  });

  it('skips one who has been deleted rather than rendering a gap', () => {
    expect(peopleOn({ personIds: ['a', 'gone'] }).map(p => p.name)).toEqual(['Tessa']);
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

describe('resolving a group', () => {
  it('finds one the store knows about', () => {
    registerPersonGroupSource(() => [group('g1', 'Household')]);
    expect(resolvePersonGroup('g1')?.name).toBe('Household');
  });

  it('shrugs at an id whose group has gone', () => {
    registerPersonGroupSource(() => [group('g1', 'Household')]);
    expect(resolvePersonGroup('gone')).toBeUndefined();
  });

  it('shrugs when no source is registered at all', () => {
    expect(resolvePersonGroup('g1')).toBeUndefined();
  });
});

describe('a group\'s members', () => {
  it('is everyone currently filed under it, in their own order', () => {
    registerPersonSource(() => [
      { ...person('a', 'Tessa', 'g1'), sortOrder: 2 },
      { ...person('b', 'Gideon', 'g1'), sortOrder: 1 },
      person('c', 'Mom', null),
    ]);
    expect(groupMembers('g1').map(p => p.name)).toEqual(['Gideon', 'Tessa']);
  });

  it('is empty for a group nobody is in', () => {
    registerPersonSource(() => [person('a', 'Tessa', null)]);
    expect(groupMembers('g1')).toEqual([]);
  });
});

describe('group mention tokens', () => {
  beforeEach(() => {
    registerPersonSource(() => [person('a', 'Tessa', 'g1'), person('b', 'Gideon', 'g1'), person('c', 'Mom', null)]);
    registerPersonGroupSource(() => [group('g1', 'Household'), group('g2', 'Empty')]);
  });

  it('carries every current member\'s id', () => {
    const tokens = groupMentionTokens();
    expect(tokens).toEqual([{ id: 'g1', name: 'Household', memberIds: ['a', 'b'] }]);
  });

  it('omits a group with nobody currently in it', () => {
    expect(groupMentionTokens().some(t => t.id === 'g2')).toBe(false);
  });

  it('restricted to a set of ids, keeps only a group whose entire membership is inside it', () => {
    expect(groupMentionTokens(['a', 'b', 'c']).map(t => t.id)).toEqual(['g1']);
    // Missing one current member — the group can't have named this exact
    // task, whatever it was tagged with when it was written.
    expect(groupMentionTokens(['a'])).toEqual([]);
  });
});

describe('contact details for a task row', () => {
  const withContact = (id: string, phoneNumber: string | null, email: string | null): Person => ({
    ...person(id, 'Dr. Kushman'), phoneNumber, email,
  });
  const row = (personIds: string[], phoneNumber: string | null = null, emailAddress: string | null = null) =>
    ({ personIds, phoneNumber, emailAddress });

  it('uses the one person a task names when it holds no number of its own', () => {
    registerPersonSource(() => [withContact('a', '555-0100', 'k@example.com')]);
    expect(contactDetailsFor(row(['a']))).toEqual({ phoneNumber: '555-0100', emailAddress: 'k@example.com' });
  });

  it("lets the task's own number win and still fills the other field", () => {
    registerPersonSource(() => [withContact('a', '555-0100', 'k@example.com')]);
    expect(contactDetailsFor(row(['a'], '555-0199'))).toEqual({ phoneNumber: '555-0199', emailAddress: 'k@example.com' });
  });

  it('offers nothing when two people are named, since one button cannot say whose', () => {
    registerPersonSource(() => [withContact('a', '555-0100', null), withContact('b', '555-0101', null)]);
    expect(contactDetailsFor(row(['a', 'b']))).toEqual({ phoneNumber: null, emailAddress: null });
  });

  it('shrugs at a person who has gone, and at a person with no number', () => {
    registerPersonSource(() => [withContact('a', null, null)]);
    expect(contactDetailsFor(row(['gone']))).toEqual({ phoneNumber: null, emailAddress: null });
    expect(contactDetailsFor(row(['a']))).toEqual({ phoneNumber: null, emailAddress: null });
    expect(contactDetailsFor(null)).toEqual({ phoneNumber: null, emailAddress: null });
  });
});
