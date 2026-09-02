/**
 * Every function the native widget module defines is reachable from JS.
 *
 * `drainPendingAddTasks` shipped declared on `WidgetBridge`, called by
 * `widgetSync.ts`, defined in Swift, and asserted by `widgetBridge.test.ts` —
 * and still did nothing, because `todo-widget-bridge/index.ts` neither declared
 * nor exported it. At runtime the property was `undefined`, the call threw a
 * TypeError, and `widgetSync`'s `catch` swallowed it under a comment about
 * builds predating the function. Tasks dictated to Siri or added from the
 * Action Button queued up in the App Group and were never drained.
 *
 * Nothing caught it because every existing test mocks the package wholesale, so
 * the hand-maintained list in `index.ts` was checked against nothing. This
 * reads the Swift source and the TypeScript entry point directly — the two
 * halves that actually have to agree.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MODULE_DIR = join(__dirname, '..', '..', 'modules', 'todo-widget-bridge');

function nativeFunctionNames(): string[] {
  const swift = readFileSync(join(MODULE_DIR, 'ios', 'TodoWidgetBridgeModule.swift'), 'utf8');
  // `Function("name")` and `AsyncFunction("name")` — how expo-modules-core
  // declares anything callable from JS.
  return [...swift.matchAll(/\bA?(?:sync)?Function\("([^"]+)"\)/g)].map(m => m[1]);
}

function entryPointSource(): string {
  return readFileSync(join(MODULE_DIR, 'index.ts'), 'utf8');
}

describe('todo-widget-bridge entry point', () => {
  it('finds the native functions to check against', () => {
    // Guards the regex itself: a rename in expo-modules-core that stopped this
    // matching would otherwise make every assertion below vacuously pass.
    const names = nativeFunctionNames();
    expect(names.length).toBeGreaterThan(4);
    expect(names).toContain('writeSnapshot');
  });

  it('declares every native function on its interface', () => {
    const source = entryPointSource();
    for (const name of nativeFunctionNames()) {
      expect(source).toContain(`${name}(`);
    }
  });

  it('exports a wrapper that calls each one', () => {
    const source = entryPointSource();
    for (const name of nativeFunctionNames()) {
      // The wrapper's own name is allowed to differ from the native one
      // (`writeSnapshot` is exported as `writeWidgetSnapshot`), so what's
      // checked is that something actually calls through to it.
      expect(source).toContain(`TodoWidgetBridge.${name}(`);
    }
  });
});

describe('todo-screentime-bridge entry point', () => {
  const SCREEN_TIME_DIR = join(__dirname, '..', '..', 'modules', 'todo-screentime-bridge');

  function screenTimeNativeNames(): string[] {
    const swift = readFileSync(
      join(SCREEN_TIME_DIR, 'ios', 'TodoScreenTimeBridgeModule.swift'), 'utf8',
    );
    return [...swift.matchAll(/\bA?(?:sync)?Function\("([^"]+)"\)/g)].map(m => m[1]);
  }

  it('calls through to every native function', () => {
    // The same check for the newer module, since it is built the same way and
    // so can fail the same way.
    const source = readFileSync(join(SCREEN_TIME_DIR, 'index.ts'), 'utf8');
    const names = screenTimeNativeNames();
    expect(names.length).toBeGreaterThan(4);
    for (const name of names) {
      expect(source).toContain(`nativeModule!.${name}(`);
    }
  });
});

describe('todo-health-bridge entry point', () => {
  const HEALTH_DIR = join(__dirname, '..', '..', 'modules', 'todo-health-bridge');

  function healthNativeNames(): string[] {
    const swift = readFileSync(
      join(HEALTH_DIR, 'ios', 'TodoHealthBridgeModule.swift'), 'utf8',
    );
    return [...swift.matchAll(/\bA?(?:sync)?Function\("([^"]+)"\)/g)].map(m => m[1]);
  }

  it('calls through to every native function', () => {
    // The third module built this way, and so the third that can fail this way.
    const source = readFileSync(join(HEALTH_DIR, 'index.ts'), 'utf8');
    const names = healthNativeNames();
    // Fewer functions than the other two bridges have, so the floor is lower —
    // but it still guards the regex, which would otherwise make this vacuous.
    expect(names).toContain('readDailyHealth');
    for (const name of names) {
      expect(source).toContain(`nativeModule!.${name}(`);
    }
  });
});
