import { keepUnchanged, reuseUnchanged } from '../utils/structuralSharing';

describe('reuseUnchanged', () => {
  it('hands back a primitive as it came', () => {
    expect(reuseUnchanged(1, 2)).toBe(2);
    expect(reuseUnchanged('a', 'a')).toBe('a');
    expect(reuseUnchanged(null, 0)).toBe(0);
    expect(reuseUnchanged({ a: 1 }, null)).toBeNull();
    expect(reuseUnchanged(undefined, undefined)).toBeUndefined();
  });

  it('keeps the old object when a fresh one is equal all the way down', () => {
    const prev = { id: 'a', tags: ['x', 'y'], nested: { n: 1, list: [{ k: true }] } };
    const next = { id: 'a', tags: ['x', 'y'], nested: { n: 1, list: [{ k: true }] } };
    expect(reuseUnchanged(prev, next)).toBe(prev);
  });

  it('is always equal in value to what was read', () => {
    const prev = { a: [1, 2, 3], b: { c: 'x' }, gone: true };
    const next = { a: [1, 2, 4], b: { c: 'x' }, added: null };
    expect(reuseUnchanged(prev, next)).toEqual(next);
  });

  it('keeps the untouched branches of an object that changed elsewhere', () => {
    const prev = { a: { n: 1 }, b: { n: 2 } };
    const next = { a: { n: 1 }, b: { n: 3 } };
    const out = reuseUnchanged(prev, next);
    expect(out).not.toBe(prev);
    expect(out.a).toBe(prev.a);
    expect(out.b).toBe(next.b);
  });

  it('tells a missing key from one that is there and undefined', () => {
    const prev = { a: 1 } as Record<string, unknown>;
    const next = { a: 1, b: undefined } as Record<string, unknown>;
    const out = reuseUnchanged(prev, next);
    expect(out).not.toBe(prev);
    expect(Object.keys(out)).toEqual(['a', 'b']);
    // And the other way round: the same number of keys, but not the same keys.
    expect(reuseUnchanged({ a: 1, b: undefined }, { a: 1, c: undefined })).toEqual({ a: 1, c: undefined });
    expect(reuseUnchanged({ a: 1, b: undefined }, { a: 1, c: undefined })).not.toHaveProperty('b');
  });

  it('treats NaN as equal to itself and 0 as different from -0', () => {
    const prev = { n: NaN };
    expect(reuseUnchanged(prev, { n: NaN })).toBe(prev);
    const zero = { n: 0 };
    expect(reuseUnchanged(zero, { n: -0 })).not.toBe(zero);
  });

  describe('lists', () => {
    it('keeps the list when every member is unchanged and in place', () => {
      const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
      expect(reuseUnchanged(prev, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }])).toBe(prev);
    });

    it('keeps every other row when one changed', () => {
      const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }];
      const next = [{ id: 'a', n: 1 }, { id: 'b', n: 20 }, { id: 'c', n: 3 }];
      const out = reuseUnchanged(prev, next);
      expect(out).not.toBe(prev);
      expect(out[0]).toBe(prev[0]);
      expect(out[1]).toBe(next[1]);
      expect(out[2]).toBe(prev[2]);
    });

    it('finds a row by id when one was added above it', () => {
      const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
      const next = [{ id: 'new', n: 0 }, { id: 'a', n: 1 }, { id: 'b', n: 2 }];
      const out = reuseUnchanged(prev, next);
      expect(out).toEqual(next);
      expect(out[1]).toBe(prev[0]);
      expect(out[2]).toBe(prev[1]);
    });

    it('finds a row by id when the order changed, and gives a new list', () => {
      const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
      const out = reuseUnchanged(prev, [{ id: 'b', n: 2 }, { id: 'a', n: 1 }]);
      expect(out).not.toBe(prev);
      expect(out[0]).toBe(prev[1]);
      expect(out[1]).toBe(prev[0]);
    });

    it('gives a new list when a row was removed, keeping the rest', () => {
      const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
      const out = reuseUnchanged(prev, [{ id: 'b', n: 2 }]);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(prev[1]);
    });

    it('matches rows without an id by position', () => {
      const prev = [{ n: 1 }, { n: 2 }];
      const out = reuseUnchanged(prev, [{ n: 1 }, { n: 3 }]);
      expect(out[0]).toBe(prev[0]);
      expect(out[1]).toEqual({ n: 3 });
    });

    it('never takes an old row for one with the same id and other content', () => {
      const prev = [{ id: 'a', n: 1 }, { id: 'a', n: 2 }];
      const next = [{ id: 'a', n: 2 }, { id: 'a', n: 1 }];
      expect(reuseUnchanged(prev, next)).toEqual(next);
    });

    it('does not mistake a list for an object, or the reverse', () => {
      const list: unknown = ['a'];
      const obj: unknown = { 0: 'a' };
      expect(reuseUnchanged(list, obj)).toBe(obj);
      expect(reuseUnchanged(obj, list)).toBe(list);
    });

    it('keeps an empty list', () => {
      const prev: string[] = [];
      expect(reuseUnchanged(prev, [])).toBe(prev);
    });
  });

  describe('Map, Set and Date', () => {
    it('keeps a Map whose entries are unchanged, in the same order', () => {
      const prev = new Map([['a', { n: 1 }], ['b', { n: 2 }]]);
      expect(reuseUnchanged(prev, new Map([['a', { n: 1 }], ['b', { n: 2 }]]))).toBe(prev);
    });

    it('keeps the unchanged values of a Map that changed', () => {
      const prev = new Map([['a', { n: 1 }], ['b', { n: 2 }]]);
      const out = reuseUnchanged(prev, new Map([['a', { n: 1 }], ['b', { n: 3 }]]));
      expect(out).not.toBe(prev);
      expect(out.get('a')).toBe(prev.get('a'));
      expect(out.get('b')).toEqual({ n: 3 });
    });

    it('gives a new Map when the keys come in another order', () => {
      const prev = new Map([['a', 1], ['b', 2]]);
      const out = reuseUnchanged(prev, new Map([['b', 2], ['a', 1]]));
      expect(out).not.toBe(prev);
      expect([...out.keys()]).toEqual(['b', 'a']);
    });

    it('keeps a Set with the same members in the same order', () => {
      const prev = new Set(['a', 'b']);
      expect(reuseUnchanged(prev, new Set(['a', 'b']))).toBe(prev);
      expect(reuseUnchanged(prev, new Set(['a', 'c']))).not.toBe(prev);
      expect(reuseUnchanged(prev, new Set(['a']))).not.toBe(prev);
    });

    it('keeps a Date at the same instant', () => {
      const prev = new Date(2026, 0, 5, 9, 0);
      expect(reuseUnchanged(prev, new Date(2026, 0, 5, 9, 0))).toBe(prev);
      expect(reuseUnchanged(prev, new Date(2026, 0, 5, 9, 1))).not.toBe(prev);
    });
  });

  it('takes anything it does not understand fresh', () => {
    class Box {
      constructor(public n: number) {}
    }
    const prev = new Box(1);
    const next = new Box(1);
    expect(reuseUnchanged(prev, next)).toBe(next);
    const fn = () => 1;
    expect(reuseUnchanged(() => 1, fn)).toBe(fn);
  });
});

describe('keepUnchanged', () => {
  it('swaps in what the store holds, key by key, and leaves the rest alone', () => {
    const action = () => {};
    const state = { rows: [{ id: 'a' }], byId: { a: 1 }, count: 1, action };
    const patch = { rows: [{ id: 'a' }], byId: { a: 2 }, count: 1 };
    const out = keepUnchanged(state, patch);
    expect(out.rows).toBe(state.rows);
    expect(out.byId).toBe(patch.byId);
    expect(Object.keys(out)).toEqual(['rows', 'byId', 'count']);
  });
});
