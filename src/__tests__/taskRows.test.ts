import { idsPresent, taskById, taskIndexById, withRowsUpserted, withTaskReplaced } from '../utils/taskRows';

interface Row { id: string; title: string }

const row = (id: string, title = id): Row => ({ id, title });
const rows = (...ids: string[]): Row[] => ids.map(id => row(id));

describe('taskIndexById and taskById', () => {
  it('find a row wherever it sits, and say so when there is none', () => {
    const list = rows('a', 'b', 'c');
    expect(taskIndexById(list, 'a')).toBe(0);
    expect(taskIndexById(list, 'c')).toBe(2);
    expect(taskIndexById(list, 'z')).toBe(-1);
    expect(taskById(list, 'b')).toBe(list[1]);
    expect(taskById(list, 'z')).toBeUndefined();
    expect(taskById([], 'a')).toBeUndefined();
  });
});

describe('withTaskReplaced', () => {
  it('swaps the one row and leaves the others and the original list as they were', () => {
    const list = rows('a', 'b', 'c');
    const next = row('b', 'changed');
    const out = withTaskReplaced(list, 'b', next);
    expect(out).toEqual(list.map(t => (t.id === 'b' ? next : t)));
    expect(out[0]).toBe(list[0]);
    expect(out[2]).toBe(list[2]);
    expect(list[1].title).toBe('b');
  });

  it('builds the new row from the old one when given a function', () => {
    const list = rows('a', 'b');
    const out = withTaskReplaced(list, 'a', t => ({ ...t, title: `${t.title}!` }));
    expect(out.map(t => t.title)).toEqual(['a!', 'b']);
  });

  it('returns a new list even when no row has the id, as a mapped pass does', () => {
    const list = rows('a', 'b');
    const build = jest.fn((t: Row) => t);
    const out = withTaskReplaced(list, 'z', build);
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
    expect(build).not.toHaveBeenCalled();
  });
});

describe('idsPresent', () => {
  it('names the ids that have a row, for a few ids and for many', () => {
    const list = rows(...Array.from({ length: 40 }, (_, i) => `t${i}`));
    expect([...idsPresent(list, ['t3', 'nope', 't39'])].sort()).toEqual(['t3', 't39']);
    const many = [...Array.from({ length: 20 }, (_, i) => `t${i * 3}`), 'missing'];
    expect([...idsPresent(list, many)].sort()).toEqual(many.filter(id => list.some(t => t.id === id)).sort());
    expect(idsPresent(list, []).size).toBe(0);
  });
});

describe('withRowsUpserted', () => {
  /** The mapped version this replaced, kept as the reference answer. */
  function reference(tasks: Row[], spawned: readonly Row[]): Row[] {
    if (spawned.length === 0) return tasks;
    const byId = new Map(spawned.map(t => [t.id, t]));
    const replaced = tasks.map(t => {
      const next = byId.get(t.id);
      if (!next) return t;
      byId.delete(t.id);
      return next;
    });
    return [...replaced, ...byId.values()];
  }

  it('hands back the same list when there is nothing to add', () => {
    const list = rows('a');
    expect(withRowsUpserted(list, [])).toBe(list);
  });

  it('writes over a row that shares an id and appends the rest in order', () => {
    const list = rows('a', 'b', 'c');
    const spawned = [row('new1'), row('b', 'over'), row('new2')];
    const out = withRowsUpserted(list, spawned);
    expect(out).toEqual(reference(list, spawned));
    expect(out.map(t => t.id)).toEqual(['a', 'b', 'c', 'new1', 'new2']);
    expect(out[1].title).toBe('over');
    expect(list.map(t => t.title)).toEqual(['a', 'b', 'c']);
  });

  it('counts two rows with one id once, the later one winning', () => {
    const list = rows('a');
    const spawned = [row('n', 'first'), row('n', 'second')];
    expect(withRowsUpserted(list, spawned)).toEqual(reference(list, spawned));
  });

  it('gives the same answer for a long batch, which takes the one-pass route', () => {
    const list = rows(...Array.from({ length: 50 }, (_, i) => `t${i}`));
    const spawned = [
      ...Array.from({ length: 12 }, (_, i) => row(`t${i * 4}`, 'over')),
      ...Array.from({ length: 12 }, (_, i) => row(`new${i}`)),
    ];
    expect(withRowsUpserted(list, spawned)).toEqual(reference(list, spawned));
  });
});
