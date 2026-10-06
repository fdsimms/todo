import { fieldChanged, initialFieldSync, nextFieldSync, styleKeyOf } from '../utils/textFieldSync';

describe('nextFieldSync', () => {
  it('writes nothing when React re-renders with what the field just reported', () => {
    let sync = initialFieldSync('', 'a');
    for (const typed of ['r', 'ru', 'rut', 'ruta']) {
      sync = fieldChanged(sync, typed);
      const next = nextFieldSync(sync, typed, 'a');
      expect(next.write).toBeNull();
      sync = next.sync;
    }
    // The text React renders never moved, so there was nothing to echo.
    expect(sync.tree).toBe('');
  });

  it('writes a value the field did not produce, and only once', () => {
    let sync = fieldChanged(initialFieldSync('', 'a'), 'milk');
    const cleared = nextFieldSync(sync, '', 'a');
    expect(cleared.write).toBe('');
    sync = cleared.sync;
    expect(nextFieldSync(sync, '', 'a').write).toBeNull();
  });

  it('writes a rewrite of what was typed, like a parsed phrase stripped out', () => {
    const sync = fieldChanged(initialFieldSync('', 'a'), 'pay rent tmrw');
    expect(nextFieldSync(sync, 'pay rent', 'a').write).toBe('pay rent');
  });

  it('writes a value sent back to what the field opened with', () => {
    const sync = fieldChanged(initialFieldSync('Buy milk', 'a'), 'Buy milk and eggs');
    expect(nextFieldSync(sync, 'Buy milk', 'a').write).toBe('Buy milk');
  });

  it('keeps the tree on the field\'s current words when the style changes', () => {
    const sync = fieldChanged(initialFieldSync('Buy milk', 'a'), 'Buy oat milk');
    const next = nextFieldSync(sync, 'Buy oat milk', 'b');
    expect(next.write).toBeNull();
    expect(next.sync.tree).toBe('Buy oat milk');
  });

  it('leaves an empty tree empty through a style change, since it has nothing to push', () => {
    const sync = fieldChanged(initialFieldSync('', 'a'), 'rutabaga');
    expect(nextFieldSync(sync, 'rutabaga', 'b').sync.tree).toBe('');
  });

  it('rewrites the typed words on a style change when the field opened empty, so they take the new attributes', () => {
    const sync = fieldChanged(initialFieldSync('', 'a'), 'rutabaga');
    const next = nextFieldSync(sync, 'rutabaga', 'b');
    expect(next.write).toBe('rutabaga');
    expect(nextFieldSync(next.sync, 'rutabaga', 'b').write).toBeNull();
  });

  it('writes nothing on a style change while an empty field is still empty', () => {
    expect(nextFieldSync(initialFieldSync('', 'a'), '', 'b').write).toBeNull();
  });

  it('leaves the tree alone when only the value changes', () => {
    const sync = fieldChanged(initialFieldSync('Buy milk', 'a'), 'Buy milk!');
    expect(nextFieldSync(sync, 'Something else', 'a').sync.tree).toBe('Buy milk');
  });
});

describe('styleKeyOf', () => {
  it('tells styles apart and matches equal ones', () => {
    expect(styleKeyOf({ color: 'red' })).toBe(styleKeyOf({ color: 'red' }));
    expect(styleKeyOf({ color: 'red' })).not.toBe(styleKeyOf({ color: 'blue' }));
    expect(styleKeyOf({ color: 'red' }, false)).not.toBe(styleKeyOf({ color: 'red' }));
  });

  it('reads an unserialisable style as a fixed key rather than throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => styleKeyOf(cyclic)).not.toThrow();
    expect(styleKeyOf(cyclic)).toBe(styleKeyOf(cyclic));
  });
});
