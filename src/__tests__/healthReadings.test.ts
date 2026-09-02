/**
 * `readDailyHealth` answers numbers or nothing, and never a zero it made up.
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

const mockNative = { readDailyHealth: jest.fn() };
jest.mock('expo-modules-core', () => ({ requireNativeModule: () => mockNative }));

// `require`, deliberately, rather than an import. Babel hoists an `import`
// above the `const mockNative` line, so the module under test would resolve
// `expo-modules-core` while that binding is still in its temporal dead zone —
// the factory throws, the module's own try/catch reads it as "no native half",
// and every assertion below quietly measures the degraded path instead of the
// parse. Requiring here runs the factory after the mock exists.
const { readDailyHealth } = require('todo-health-bridge') as typeof import('todo-health-bridge');

beforeEach(() => {
  mockNative.readDailyHealth.mockReset();
});

describe('readDailyHealth', () => {
  const ANCHOR = '2026-08-04T00:00:00.000Z';

  function answering(json: string) {
    mockNative.readDailyHealth.mockResolvedValue(json);
  }

  it('reads a day through, both numbers', async () => {
    answering('[{"start":"2026-08-04T00:00:00.000Z","steps":4120,"sleepMinutes":437}]');
    await expect(readDailyHealth(ANCHOR, 1)).resolves.toEqual([
      { start: '2026-08-04T00:00:00.000Z', steps: 4120, sleepMinutes: 437 },
    ]);
  });

  it('passes the anchor and the count through, since only JS knows the logical day', async () => {
    answering('[]');
    await readDailyHealth(ANCHOR, 30);
    expect(mockNative.readDailyHealth).toHaveBeenCalledWith(ANCHOR, 30);
  });

  it('keeps the two numbers independently nullable', async () => {
    // The common case for anybody without a Watch: steps every day, sleep
    // never. A day is not dropped for missing one of them.
    answering('[{"start":"2026-08-04T00:00:00.000Z","steps":6000,"sleepMinutes":null}]');
    const [day] = await readDailyHealth(ANCHOR, 1);
    expect(day.steps).toBe(6000);
    expect(day.sleepMinutes).toBeNull();
  });

  it('keeps a real zero on either number', async () => {
    answering('[{"start":"2026-08-04T00:00:00.000Z","steps":0,"sleepMinutes":0}]');
    const [day] = await readDailyHealth(ANCHOR, 1);
    expect(day.steps).toBe(0);
    expect(day.sleepMinutes).toBe(0);
  });

  it('reads a broken number as no number rather than as a small one', async () => {
    answering('[{"start":"2026-08-04T00:00:00.000Z","steps":-1,"sleepMinutes":"437"}]');
    const [day] = await readDailyHealth(ANCHOR, 1);
    expect(day.steps).toBeNull();
    expect(day.sleepMinutes).toBeNull();
  });

  it('drops a row with no instant instead of guessing which day it is', async () => {
    answering('[{"steps":100,"sleepMinutes":10},{"start":"","steps":1,"sleepMinutes":1},'
      + '{"start":"2026-08-05T00:00:00.000Z","steps":7,"sleepMinutes":null}]');
    const days = await readDailyHealth(ANCHOR, 3);
    expect(days.map(d => d.start)).toEqual(['2026-08-05T00:00:00.000Z']);
  });

  it('answers an empty window for anything malformed', async () => {
    for (const json of ['not json', '{}', 'null', '"[]"']) {
      answering(json);
      await expect(readDailyHealth(ANCHOR, 7)).resolves.toEqual([]);
    }
  });

  it('answers an empty window when the native call rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockNative.readDailyHealth.mockRejectedValue(new Error('health daemon unavailable'));
    await expect(readDailyHealth(ANCHOR, 7)).resolves.toEqual([]);
    warn.mockRestore();
  });
});
