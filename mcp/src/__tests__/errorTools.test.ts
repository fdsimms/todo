import { listErrors } from '../errorTools';
import type { Replica } from '../replica';

const row = (id: string, source: string, at: string, stack = '') =>
  ({ id, at, source, name: 'TypeError', message: `m-${id}`, stack });

const replica = (rows: ReturnType<typeof row>[]) => ({ errorLog: () => rows }) as unknown as Replica;

const ROWS = [
  row('c', 'ai', '2026-10-12T10:00:00.000Z'),
  row('b', 'recipe-component-import', '2026-10-12T09:00:00.000Z', 'at foo'),
  row('a', 'ai', '2026-10-11T09:00:00.000Z'),
];

describe('listErrors', () => {
  it('returns the rows in the order the phone kept them, with the total', () => {
    const result = listErrors(replica(ROWS));
    expect(result.total).toBe(3);
    expect(result.errors.map(e => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('narrows by source and still reports the whole total', () => {
    const result = listErrors(replica(ROWS), { source: 'Recipe-Component-Import' });
    expect(result.errors.map(e => e.id)).toEqual(['b']);
    expect(result.total).toBe(3);
  });

  it('limits the count and omits an empty stack', () => {
    const result = listErrors(replica(ROWS), { limit: 2 });
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).not.toHaveProperty('stack');
    expect(result.errors[1].stack).toBe('at foo');
  });

  it('says an empty log is not proof of no problems', () => {
    const result = listErrors(replica([]));
    expect(result.errors).toEqual([]);
    expect(result.note).toMatch(/not that nothing went wrong/);
  });
});
