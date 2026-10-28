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

  it('only uses a plain key a text field would handle', () => {
    // Since iOS 15 text input sees a key before a key command, so a plain key
    // the field handles (a character, Space, an arrow, Return, Delete) is left
    // to it while someone types. A key it doesn't (Tab) would reach the command
    // mid-sentence. Escape is the deliberate exception: it closes the sheet the
    // field is in.
    const handled = /^([a-z0-9/ ]|up|down|return|delete)$/;
    const plain = KEY_SHORTCUTS.filter(s => s.modifiers.length === 0 && s.input !== 'escape');
    for (const s of plain) expect(s.input).toMatch(handled);
  });

  it('drops every key that acts on a row while a field has focus, whichever keys a field takes', () => {
    // The system hands a field the keys it handles, but a field that ignores one (an
    // arrow in a one-line field, say) would let the command through, and Return or
    // Delete acting on a row while someone types is the one failure that does harm.
    const rowKeys = ['cursorDown', 'cursorUp', 'openCursor', 'completeCursor', 'deleteCursor', 'selectAll'];
    const acting = KEY_SHORTCUTS.filter(s => rowKeys.includes(s.action));
    expect(acting.length).toBeGreaterThan(0);
    for (const s of acting) expect(s.unlessTyping).toBe(true);
  });

  it('only acts on a row from a bare screen', () => {
    const rowKeys = ['cursorDown', 'cursorUp', 'openCursor', 'completeCursor', 'deleteCursor', 'selectAll'];
    for (const s of KEY_SHORTCUTS.filter(k => rowKeys.includes(k.action))) expect(s.screenOnly).toBe(true);
  });

  it('keeps the chords a Mac window is expected to answer to on whatever mirroring mode says', () => {
    const onMac = KEY_SHORTCUTS.filter(s => s.onMac).map(s => s.action);
    expect(onMac).toEqual(expect.arrayContaining(['undo', 'redo', 'closeSheet', 'commit']));
    // No plain character key rides along: turning mirroring mode off is how someone says no to those.
    for (const s of KEY_SHORTCUTS.filter(k => k.onMac)) {
      expect(s.modifiers.length > 0 || s.input === 'escape').toBe(true);
    }
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

  it('writes the keys that have no character of their own', () => {
    expect(shortcutKeys(shortcutById('cursorDown')!)).toBe('↓');
    expect(shortcutKeys(shortcutById('openCursor')!)).toBe('↩');
    expect(shortcutKeys(shortcutById('completeCursor')!)).toBe('Space');
    expect(shortcutKeys(shortcutById('deleteCursorCommand')!)).toBe('⌘⌫');
    expect(shortcutKeys(shortcutById('commit')!)).toBe('⌘↩');
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
