/**
 * What a hardware key does beyond opening and closing sheets: the places the
 * keyboard's answer depends on what is on screen. Three small registries, each
 * a stack with the most recently added on top, because the thing drawn last is
 * the thing in front and is the one a key should reach.
 *
 * - **Escape** closes the sheet on top (`closeTopmostSheet`), and when there is
 *   none, steps back out of whatever the screen is holding open: bulk selection,
 *   an expanded row, the editor pane. Each registers while it is up.
 * - **Commit** is ⌘Return: the confirm button (Save, Done, Add) of the
 *   frontmost form. It is the key a Mac user reaches for to finish a form, and
 *   it works without a pointer over a button that has no key of its own.
 * - **Screen keys** are the row cursor's: the focused list registers what up,
 *   down, Return, Space and Delete mean in it. A screen with nothing registered
 *   leaves them doing nothing, so the keys can't reach a screen that isn't a
 *   list or one that is out of sight.
 *
 * Module state rather than a store: nothing renders from any of it, and each
 * entry is added and removed by an effect, so what is on the stack is exactly
 * what is mounted.
 */
import { closeTopmostSheet } from './sheetModal';

// ==== Escape ====

const escapeStack: { run: () => boolean | void }[] = [];

/**
 * Adds something Escape can close. `run` returns false when it has nothing to
 * do right now (so the key falls to whatever is under it); true or nothing
 * means it handled the press. Returns the call that takes it off again.
 */
export function registerEscapeHandler(run: () => boolean | void): () => void {
  const entry = { run };
  escapeStack.push(entry);
  return () => {
    const at = escapeStack.indexOf(entry);
    if (at >= 0) escapeStack.splice(at, 1);
  };
}

/** Escape: the sheet on top, else the frontmost thing registered. True when something closed. */
export function runEscape(): boolean {
  if (closeTopmostSheet()) return true;
  for (let i = escapeStack.length - 1; i >= 0; i--) {
    if (escapeStack[i].run() !== false) return true;
  }
  return false;
}

// ==== Commit ====

const commitStack: { run: () => void; enabled: () => boolean }[] = [];

/**
 * Adds a form's confirm action for ⌘Return. `enabled` is read when the key is
 * pressed, not when this is called, so a Save that becomes valid mid-edit works.
 */
export function registerCommit(run: () => void, enabled: () => boolean): () => void {
  const entry = { run, enabled };
  commitStack.push(entry);
  return () => {
    const at = commitStack.indexOf(entry);
    if (at >= 0) commitStack.splice(at, 1);
  };
}

/**
 * ⌘Return: 'ran' when the frontmost confirm action ran, 'refused' when it is
 * disabled (the same answer its button gives a tap: no, and not the form
 * underneath's Save instead), 'none' when nothing is registered.
 */
export function runCommit(): 'ran' | 'refused' | 'none' {
  const top = commitStack[commitStack.length - 1];
  if (!top) return 'none';
  if (!top.enabled()) return 'refused';
  top.run();
  return 'ran';
}

// ==== Screen keys ====

export type ScreenKey = 'cursorUp' | 'cursorDown' | 'openCursor' | 'completeCursor' | 'deleteCursor' | 'selectAll';

export type ScreenKeyHandlers = Partial<Record<ScreenKey, () => void>>;

let screenKeys: ScreenKeyHandlers | null = null;

/**
 * Makes `handlers` what the row cursor's keys do. One screen at a time: a
 * second registration (a screen that came to the front) replaces the first and
 * its removal puts nothing back, since the screen it covered re-registers when
 * it is revealed. Returns the call that takes these off again.
 */
export function registerScreenKeys(handlers: ScreenKeyHandlers): () => void {
  screenKeys = handlers;
  return () => {
    if (screenKeys === handlers) screenKeys = null;
  };
}

/** Runs a screen key. False when no screen has one registered for it. */
export function runScreenKey(key: ScreenKey): boolean {
  const run = screenKeys?.[key];
  if (!run) return false;
  run();
  return true;
}
