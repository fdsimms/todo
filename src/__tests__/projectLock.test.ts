import {
  isProjectLockedAway,
  isTaskLockedAway,
  lockedAwayCount,
  parseLockedProjectIds,
  withProjectLocked,
} from '../utils/projectLock';

describe('parseLockedProjectIds', () => {
  it('reads a JSON array of ids and drops duplicates', () => {
    expect(parseLockedProjectIds('["a","b","a"]')).toEqual(['a', 'b']);
  });

  it('reads anything else as none', () => {
    expect(parseLockedProjectIds(null)).toEqual([]);
    expect(parseLockedProjectIds('')).toEqual([]);
    expect(parseLockedProjectIds('not json')).toEqual([]);
    expect(parseLockedProjectIds('{"a":1}')).toEqual([]);
    expect(parseLockedProjectIds('[1,"",null,"ok"]')).toEqual(['ok']);
  });
});

describe('isProjectLockedAway', () => {
  it('hides a locked project until the session is unlocked', () => {
    expect(isProjectLockedAway('a', ['a'], false)).toBe(true);
    expect(isProjectLockedAway('a', ['a'], true)).toBe(false);
  });

  it('never hides an unlocked project or a task with no project', () => {
    expect(isProjectLockedAway('b', ['a'], false)).toBe(false);
    expect(isProjectLockedAway(null, ['a'], false)).toBe(false);
    expect(isProjectLockedAway(undefined, ['a'], false)).toBe(false);
  });

  it('reads a task through its project', () => {
    expect(isTaskLockedAway({ projectId: 'a' }, ['a'], false)).toBe(true);
    expect(isTaskLockedAway({ projectId: null }, ['a'], false)).toBe(false);
  });
});

describe('lockedAwayCount', () => {
  const tasks = [{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }, { projectId: null }];

  it('counts the tasks the lock is hiding', () => {
    expect(lockedAwayCount(tasks, ['a'], false)).toBe(2);
  });

  it('is zero once unlocked or with nothing locked', () => {
    expect(lockedAwayCount(tasks, ['a'], true)).toBe(0);
    expect(lockedAwayCount(tasks, [], false)).toBe(0);
  });
});

describe('withProjectLocked', () => {
  it('adds without duplicating and removes', () => {
    expect(withProjectLocked(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(withProjectLocked(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(withProjectLocked(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(withProjectLocked(['a'], 'c', false)).toEqual(['a']);
  });
});
