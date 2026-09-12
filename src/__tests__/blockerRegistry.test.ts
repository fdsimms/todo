import { registerTaskSource, resolveBlocker, waitingCountFor } from '../utils/blockerRegistry';
import type { Task } from '../types';

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    completed: false,
    archived: false,
    parentId: null,
    blockedById: null,
    ...over,
  } as Task);

afterEach(() => registerTaskSource(null));

describe('resolveBlocker', () => {
  // Undefined is the safe answer: canBlock reads it as "can't block", so a
  // context that never registered a source has no blocked tasks rather than
  // hiding work it cannot account for.
  it('answers undefined with no source registered', () => {
    expect(resolveBlocker('a')).toBeUndefined();
  });

  it('finds a task the registered source knows about', () => {
    registerTaskSource(() => [task('a'), task('b')]);
    expect(resolveBlocker('b')?.id).toBe('b');
  });

  it('answers undefined for an id nothing holds', () => {
    registerTaskSource(() => [task('a')]);
    expect(resolveBlocker('gone')).toBeUndefined();
  });

  // The store replaces `tasks` on every mutation, which is what the index
  // watches: a new array identity rebuilds it, the same one reuses it.
  it('sees a task added by a later store write', () => {
    let tasks = [task('a')];
    registerTaskSource(() => tasks);
    expect(resolveBlocker('b')).toBeUndefined();
    tasks = [task('a'), task('b')];
    expect(resolveBlocker('b')?.id).toBe('b');
  });

  it('reads the array once per store change rather than once per lookup', () => {
    const tasks = [task('a'), task('b')];
    const source = jest.fn(() => tasks);
    registerTaskSource(source);
    resolveBlocker('a');
    resolveBlocker('b');
    resolveBlocker('a');
    // Called per lookup, but the Map behind it is built once.
    expect(source).toHaveBeenCalledTimes(3);
    expect(resolveBlocker('b')?.id).toBe('b');
  });

  it('forgets what it cached when the source is replaced', () => {
    registerTaskSource(() => [task('a')]);
    expect(resolveBlocker('a')?.id).toBe('a');
    registerTaskSource(() => [task('z')]);
    expect(resolveBlocker('a')).toBeUndefined();
    expect(resolveBlocker('z')?.id).toBe('z');
  });
});

describe('waitingCountFor', () => {
  it('counts nothing with no source registered', () => {
    expect(waitingCountFor('a')).toBe(0);
  });

  it('counts the live tasks waiting on one task', () => {
    registerTaskSource(() => [
      task('a'),
      task('b', { blockedById: 'a' }),
      task('c', { blockedById: 'a' }),
    ]);
    expect(waitingCountFor('a')).toBe(2);
  });

  it('counts nothing for a task nothing waits on', () => {
    registerTaskSource(() => [task('a'), task('b', { blockedById: 'a' })]);
    expect(waitingCountFor('b')).toBe(0);
  });

  // A finished, filed-away or nested waiter is not work being held up.
  it('leaves out completed, archived and subtask waiters', () => {
    registerTaskSource(() => [
      task('a'),
      task('done', { blockedById: 'a', completed: true }),
      task('filed', { blockedById: 'a', archived: true }),
      task('sub', { blockedById: 'a', parentId: 'a' }),
      task('live', { blockedById: 'a' }),
    ]);
    expect(waitingCountFor('a')).toBe(1);
  });

  it('re-counts once the store writes a new array', () => {
    let tasks = [task('a'), task('b', { blockedById: 'a' })];
    registerTaskSource(() => tasks);
    expect(waitingCountFor('a')).toBe(1);
    tasks = [task('a'), task('b', { blockedById: 'a' }), task('c', { blockedById: 'a' })];
    expect(waitingCountFor('a')).toBe(2);
  });
});
