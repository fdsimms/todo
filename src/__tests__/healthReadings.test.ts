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

// Every field `readDailyHealth` reads besides `start`, so a test can build a
// row without hand-listing all ten every time.
const FIELDS = [
  'steps', 'sleepMinutes', 'sodiumMg', 'proteinG', 'satFatG', 'fiberG', 'sugarG', 'caffeineMg', 'waterMl', 'calorieKcal',
] as const;

/** One JSON row with `start` plus every field set from `values` (default 0 for the rest). */
function row(start: string, values: Partial<Record<(typeof FIELDS)[number], unknown>> = {}): string {
  const obj: Record<string, unknown> = { start };
  for (const field of FIELDS) obj[field] = field in values ? values[field] : 0;
  return JSON.stringify(obj);
}

describe('readDailyHealth', () => {
  const ANCHOR = '2026-08-04T00:00:00.000Z';

  function answering(json: string) {
    mockNative.readDailyHealth.mockResolvedValue(json);
  }

  it('reads a day through, every field', async () => {
    answering(`[${row('2026-08-04T00:00:00.000Z', {
      steps: 4120, sleepMinutes: 437, sodiumMg: 1850, proteinG: 42, satFatG: 18,
      fiberG: 22, sugarG: 35, caffeineMg: 180, waterMl: 1900, calorieKcal: 2100,
    })}]`);
    await expect(readDailyHealth(ANCHOR, 1)).resolves.toEqual([{
      start: '2026-08-04T00:00:00.000Z',
      steps: 4120, sleepMinutes: 437, sodiumMg: 1850, proteinG: 42, satFatG: 18,
      fiberG: 22, sugarG: 35, caffeineMg: 180, waterMl: 1900, calorieKcal: 2100,
    }]);
  });

  it('passes the anchor and the count through, since only JS knows the logical day', async () => {
    answering('[]');
    await readDailyHealth(ANCHOR, 30);
    expect(mockNative.readDailyHealth).toHaveBeenCalledWith(ANCHOR, 30);
  });

  it('keeps every field independently nullable', async () => {
    // The common case for anybody without a Watch or a food-logging app:
    // steps every day, nothing else. A day is not dropped for missing any
    // of the rest.
    const nulls = Object.fromEntries(FIELDS.filter(f => f !== 'steps').map(f => [f, null]));
    answering(`[${row('2026-08-04T00:00:00.000Z', { steps: 6000, ...nulls })}]`);
    const [day] = await readDailyHealth(ANCHOR, 1);
    expect(day.steps).toBe(6000);
    for (const field of FIELDS) {
      if (field === 'steps') continue;
      expect(day[field]).toBeNull();
    }
  });

  it('keeps a real zero on every field', async () => {
    answering(`[${row('2026-08-04T00:00:00.000Z')}]`); // row() defaults every field to 0
    const [day] = await readDailyHealth(ANCHOR, 1);
    for (const field of FIELDS) expect(day[field]).toBe(0);
  });

  it('reads a broken number as no number rather than as a small one', async () => {
    const broken = Object.fromEntries(FIELDS.map((f, i) => [f, i % 2 === 0 ? -1 : '18']));
    answering(`[${row('2026-08-04T00:00:00.000Z', broken)}]`);
    const [day] = await readDailyHealth(ANCHOR, 1);
    for (const field of FIELDS) expect(day[field]).toBeNull();
  });

  it('drops a row with no instant instead of guessing which day it is', async () => {
    const withoutStart = JSON.stringify(
      Object.fromEntries(FIELDS.map(f => [f, 0])), // no `start` key at all
    );
    answering(`[${withoutStart},${row('')},${row('2026-08-05T00:00:00.000Z', { sleepMinutes: null })}]`);
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
