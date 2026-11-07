/**
 * No screen may act on a store from an `AppState` "came to the front" listener.
 *
 * A tab blurred by another tab is frozen and runs no effects, and a listener
 * set up in a focus effect only exists while its screen is in front, so work
 * hung off a screen's foreground listener silently skips every return to the
 * app made on another tab. That is how vacation expiry, the quota closes, every
 * clock-driven generator and the time-zone re-anchor of reminders (#1205) all
 * went unrun for anyone who reopened the app on Groceries: they lived in
 * Today's listener. Work the app needs whichever tab is open belongs in an
 * app-level hook (`useForegroundCatchUp`, run from `App.tsx`).
 *
 * The listeners that stay legitimate re-read something for the screen itself
 * (a permission, the keyboard, a drag in progress) and write nothing, so the
 * shape this bans is a `…Store.getState()` reached from inside the listener's
 * callback. It reads source text, like the other `no*` guards, because there is
 * no renderer to mount a screen with.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SRC, sourceFiles } from '../testSupport/sourceFiles';

const SCREENS = join(SRC, 'screens');
const LISTENER = /AppState\.addEventListener\(/g;
const STORE_ACCESS = /\b\w+Store\.getState\(\)/;

/** The text of each `AppState.addEventListener(...)` call, parentheses balanced. */
function listenerCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(LISTENER)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) {
        calls.push(source.slice(open, i + 1));
        break;
      }
    }
  }
  return calls;
}

const files = sourceFiles(SCREENS).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('store writes in a screen foreground listener', () => {
  it('scans the screens, and finds the listeners they do have', () => {
    // Guards the walk and the parse: with either broken the check below would
    // pass against nothing.
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap(f => listenerCalls(f.src)).length).toBeGreaterThan(5);
  });

  it('flags the shape it exists for', () => {
    const before = `
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') {
          useTaskStore.getState().checkVacationExpiry();
        }
      });`;
    const [call] = listenerCalls(before);
    expect(STORE_ACCESS.test(call)).toBe(true);
    expect(STORE_ACCESS.test("AppState.addEventListener('change', s => { if (s === 'active') refreshState(); })")).toBe(false);
  });

  it('reaches no store from any screen foreground listener', () => {
    const offenders = files
      .filter(f => listenerCalls(f.src).some(call => STORE_ACCESS.test(call)))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
