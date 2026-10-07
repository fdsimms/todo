import { KEY_SHORTCUTS, describeShortcuts, shortcutById, shortcutKeys } from '../utils/keyShortcuts';

describe('KEY_SHORTCUTS', () => {
  it('gives every shortcut its own id', () => {
    const ids = KEY_SHORTCUTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never binds one chord twice', () => {
    const chords = KEY_SHORTCUTS.map(s => `${[...s.modifiers].sort().join('+')}|${s.input}`);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('leaves ⌘1, ⌘2 and ⌘3 to iPhone Mirroring', () => {
    const reserved = KEY_SHORTCUTS.filter(
      s => s.modifiers.length === 1 && s.modifiers[0] === 'command' && ['1', '2', '3'].includes(s.input),
    );
    expect(reserved).toEqual([]);
  });

  it('only uses a plain key a text field would type', () => {
    // A plain key a field doesn't take (an arrow, Return, Tab) would reach the
    // command while someone is typing. Escape is the deliberate exception: it
    // closes the sheet the field is in.
    const plain = KEY_SHORTCUTS.filter(s => s.modifiers.length === 0 && s.input !== 'escape');
    for (const s of plain) expect(s.input).toMatch(/^[a-z0-9/]$/);
  });
});

describe('shortcutById', () => {
  it('finds a known id and refuses an unknown one', () => {
    expect(shortcutById('undo')?.action).toBe('undo');
    expect(shortcutById('nope')).toBeNull();
  });
});

describe('shortcutKeys', () => {
  it('writes modifiers in Apple order before the key', () => {
    expect(shortcutKeys(shortcutById('redo')!)).toBe('⇧⌘Z');
    expect(shortcutKeys(shortcutById('closeSheet')!)).toBe('Esc');
    expect(shortcutKeys(shortcutById('newTask')!)).toBe('N');
  });
});

describe('describeShortcuts', () => {
  it('lists each action once, with all of its keys', () => {
    const text = describeShortcuts();
    expect(text).toContain('N or ⌘N: New task');
    expect(text.match(/New task/g)).toHaveLength(1);
  });

  it('leaves out hidden actions', () => {
    expect(describeShortcuts(['viewUnscheduled'])).not.toContain('Unscheduled');
  });
});
