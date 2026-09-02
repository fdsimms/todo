/**
 * `readSteps` answers a number or nothing, and never a zero it made up.
 *
 * This is the one rule the whole Health integration rests on, so it is pinned
 * here rather than left to the native side. HealthKit serves a refused read as
 * an empty store — deliberately, so that an app cannot learn what somebody
 * declined to share — which means "you said no", "nothing recorded today" and
 * "this phone has never recorded a step" arrive as the same answer. Every one
 * of them has to come back as `null`, because the one thing they are all *not*
 * is a day on which somebody took zero steps.
 *
 * The parse lives in `modules/todo-health-bridge/index.ts` rather than in
 * `src/`, so this is the module's test rather than a mirror of a source file —
 * the position `widgetBridgeExports.test.ts` is already in. What it needs from
 * the environment is only that `requireNativeModule` hands back something, so
 * both of the module's imports are mocked and the native answer is a string,
 * exactly as it arrives over the bridge.
 */
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockNative = { readSteps: jest.fn() };
jest.mock('expo-modules-core', () => ({ requireNativeModule: () => mockNative }));

// `require`, deliberately, rather than an import. Babel hoists an `import`
// above the `const mockNative` line, so the module under test would resolve
// `expo-modules-core` while that binding is still in its temporal dead zone —
// the factory throws, the module's own try/catch reads it as "no native half",
// and every assertion below quietly measures the degraded path instead of the
// parse. Requiring here runs the factory after the mock exists.
const { readSteps } = require('todo-health-bridge') as typeof import('todo-health-bridge');

const START = '2026-09-02T00:00:00.000Z';
const END = '2026-09-02T18:30:00.000Z';

beforeEach(() => {
  mockNative.readSteps.mockReset();
});

function answering(json: string) {
  mockNative.readSteps.mockResolvedValue(json);
}

describe('readSteps', () => {
  it('reads a count through', async () => {
    answering('{"steps":4120}');
    await expect(readSteps(START, END)).resolves.toBe(4120);
  });

  it('passes the window straight through, since only JS knows the logical day', async () => {
    answering('{"steps":1}');
    await readSteps(START, END);
    expect(mockNative.readSteps).toHaveBeenCalledWith(START, END);
  });

  it('answers null when there is no number, rather than zero', async () => {
    answering('{"steps":null}');
    await expect(readSteps(START, END)).resolves.toBeNull();
  });

  it('keeps a real zero, which is a different claim', async () => {
    // A day spent in bed is a genuine 0 and has to survive: collapsing it to
    // null would be the mirror of the bug above, throwing away the one reading
    // that says the day was still.
    answering('{"steps":0}');
    await expect(readSteps(START, END)).resolves.toBe(0);
  });

  it('answers null for a broken answer rather than a small one', async () => {
    for (const json of ['{"steps":-5}', '{"steps":"4120"}', '{"steps":{}}', '{}', 'null', '[]']) {
      answering(json);
      await expect(readSteps(START, END)).resolves.toBeNull();
    }
  });

  it('answers null for a malformed answer instead of throwing into a store action', async () => {
    answering('not json at all');
    await expect(readSteps(START, END)).resolves.toBeNull();
  });

  it('answers null when the native call rejects', async () => {
    // `degradeOnReject` is what keeps a native failure from unmounting the
    // React root out of a launch effect. It warns on the way past, which is
    // wanted in the app and only noise here.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockNative.readSteps.mockRejectedValue(new Error('health daemon unavailable'));
    await expect(readSteps(START, END)).resolves.toBeNull();
    warn.mockRestore();
  });
});
