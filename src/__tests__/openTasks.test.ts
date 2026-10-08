import { openTasksOf } from '../utils/openTasks';
import type { Task } from '../types';

// Only `completed` is read, so a row needs nothing else.
const row = (id: string, completed: boolean): Task => ({ id, completed }) as Task;

describe('openTasksOf', () => {
  it('keeps the rows that are not completed, in their original order', () => {
    const tasks = [row('a', false), row('b', true), row('c', false), row('d', true), row('e', false)];
    expect(openTasksOf(tasks).map(t => t.id)).toEqual(['a', 'c', 'e']);
  });

  it('hands back the same rows, not copies', () => {
    const a = row('a', false);
    expect(openTasksOf([a, row('b', true)])[0]).toBe(a);
  });

  it('answers the same array for the same input, so a shallow compare of it is one identity check', () => {
    const tasks = [row('a', false), row('b', true)];
    expect(openTasksOf(tasks)).toBe(openTasksOf(tasks));
  });

  it('works the answer out again for a new array, which is how the store writes', () => {
    const before = [row('a', false), row('b', false)];
    const after = before.map(t => (t.id === 'a' ? { ...t, completed: true } : t));
    expect(openTasksOf(before).map(t => t.id)).toEqual(['a', 'b']);
    expect(openTasksOf(after).map(t => t.id)).toEqual(['b']);
  });

  it('is empty for an empty list and for a list of history alone', () => {
    expect(openTasksOf([])).toEqual([]);
    expect(openTasksOf([row('a', true), row('b', true)])).toEqual([]);
  });
});
