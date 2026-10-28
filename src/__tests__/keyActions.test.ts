import { registerCommit, registerEscapeHandler, registerScreenKeys, runCommit, runEscape, runScreenKey } from '../utils/keyActions';
import { trackOpenSheet } from '../utils/sheetModal';

describe('Escape', () => {
  it('closes the sheet on top before anything the screen is holding open', () => {
    const closed: string[] = [];
    const offSheet = trackOpenSheet('sheet', () => closed.push('sheet'));
    const offHeld = registerEscapeHandler(() => { closed.push('selection'); });
    expect(runEscape()).toBe(true);
    expect(closed).toEqual(['sheet']);
    offSheet();
    offHeld();
  });

  it('falls to the most recently added handler, then the one under it', () => {
    const ran: string[] = [];
    const offPane = registerEscapeHandler(() => { ran.push('pane'); });
    const offSelection = registerEscapeHandler(() => { ran.push('selection'); });
    expect(runEscape()).toBe(true);
    expect(ran).toEqual(['selection']);
    offSelection();
    expect(runEscape()).toBe(true);
    expect(ran).toEqual(['selection', 'pane']);
    offPane();
  });

  it('passes the key down when a handler has nothing to do right now', () => {
    const ran: string[] = [];
    const offLower = registerEscapeHandler(() => { ran.push('lower'); });
    const offUpper = registerEscapeHandler(() => { ran.push('upper'); return false; });
    expect(runEscape()).toBe(true);
    expect(ran).toEqual(['upper', 'lower']);
    offUpper();
    offLower();
  });

  it('is false, and so leaves the key alone, with nothing open', () => {
    expect(runEscape()).toBe(false);
  });

  it('forgets a handler once it is taken off', () => {
    const off = registerEscapeHandler(() => {});
    off();
    off();
    expect(runEscape()).toBe(false);
  });
});

describe('commit', () => {
  it('runs the frontmost confirm action', () => {
    const ran: string[] = [];
    const offBack = registerCommit(() => ran.push('back'), () => true);
    const offFront = registerCommit(() => ran.push('front'), () => true);
    expect(runCommit()).toBe('ran');
    expect(ran).toEqual(['front']);
    offFront();
    expect(runCommit()).toBe('ran');
    expect(ran).toEqual(['front', 'back']);
    offBack();
  });

  it('refuses when the frontmost is disabled, and never saves the form underneath instead', () => {
    const ran: string[] = [];
    const offBack = registerCommit(() => ran.push('back'), () => true);
    const offFront = registerCommit(() => ran.push('front'), () => false);
    expect(runCommit()).toBe('refused');
    expect(ran).toEqual([]);
    offFront();
    offBack();
  });

  it('reads whether it is enabled when the key is pressed', () => {
    let valid = false;
    let ran = 0;
    const off = registerCommit(() => { ran += 1; }, () => valid);
    expect(runCommit()).toBe('refused');
    valid = true;
    expect(runCommit()).toBe('ran');
    expect(ran).toBe(1);
    off();
  });

  it('has nothing to say with nothing registered', () => {
    expect(runCommit()).toBe('none');
  });
});

describe('screen keys', () => {
  it('runs what the screen registered', () => {
    const ran: string[] = [];
    const off = registerScreenKeys({ cursorDown: () => ran.push('down'), openCursor: () => ran.push('open') });
    expect(runScreenKey('cursorDown')).toBe(true);
    expect(runScreenKey('openCursor')).toBe(true);
    expect(ran).toEqual(['down', 'open']);
    off();
  });

  it('is false for a key the screen did not register, and for every key when none is up', () => {
    const off = registerScreenKeys({ cursorDown: () => {} });
    expect(runScreenKey('deleteCursor')).toBe(false);
    off();
    expect(runScreenKey('cursorDown')).toBe(false);
  });

  it('gives the keys to whichever screen registered last, and a stale removal takes nothing back', () => {
    const ran: string[] = [];
    const offFirst = registerScreenKeys({ cursorDown: () => ran.push('first') });
    const offSecond = registerScreenKeys({ cursorDown: () => ran.push('second') });
    runScreenKey('cursorDown');
    // The first screen going away must not unregister the one in front of it.
    offFirst();
    runScreenKey('cursorDown');
    expect(ran).toEqual(['second', 'second']);
    offSecond();
    expect(runScreenKey('cursorDown')).toBe(false);
  });
});
