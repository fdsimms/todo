/**
 * Tests for src/utils/savedFocusQueue.ts. The suggester has its own tests
 * (focusSuggest.test.ts), so it is replaced here to see what pool and window
 * savedFocusQueue hands it.
 */
import type { FocusContext } from '../utils/focusSuggest';
import type { Task } from '../types';

const mockSuggest = jest.fn((pool: { id: string }[], _ctx: unknown) => pool.map(t => t.id));
jest.mock('../utils/focusSuggest', () => ({
  suggestFocusTasks: (pool: { id: string }[], ctx: unknown) => mockSuggest(pool, ctx),
}));

import { savedFocusQueue } from '../utils/savedFocusQueue';

const task = (id: string, over: Partial<Task> = {}) =>
  ({ id, category: null, projectId: null, tags: [], ...over }) as unknown as Task;

describe('savedFocusQueue', () => {
  const ctx = { windowMinutes: 30 } as unknown as FocusContext;

  it('hands the suggester only the tasks the rule matches, under the saved window', () => {
    const pool = [task('a', { category: 'Work' }), task('b', { category: 'Home' }), task('c', { category: 'Work' })];
    const ids = savedFocusQueue({ filter: { kind: 'category', value: 'Work' }, windowMinutes: 90 }, pool, ctx);
    expect(ids).toEqual(['a', 'c']);
    expect(mockSuggest).toHaveBeenLastCalledWith(pool.filter(t => t.category === 'Work'), expect.objectContaining({ windowMinutes: 90 }));
  });

  it('passes no limit when the session has none', () => {
    savedFocusQueue({ filter: { kind: 'all' }, windowMinutes: null }, [task('a')], ctx);
    expect(mockSuggest).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ windowMinutes: null }));
  });
});
