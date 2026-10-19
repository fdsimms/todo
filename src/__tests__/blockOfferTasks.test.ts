import {
  blockOfferCoinsFor, blockOfferRuleIdOf, blockOfferRunOutcome, blockOfferSourceId, blockOfferTitle,
  clampBlockOfferCoins, clampBlockOfferMinutes, describeOfferCoins, newBlockOfferRule, offersBlockStart,
  parseBlockOfferRules, parseBlockOfferRuns, parseBlockOfferSourceId, serializeBlockOfferRules, withRunAdded,
  type BlockOfferRun,
} from '../utils/blockOfferTasks';
import type { Task } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Block Games for 1 hour (10 coins)',
  generatedKind: 'blockOffer',
  generatedSourceId: blockOfferSourceId('2026-10-19', 'rule1'),
  generatedReadyAt: null,
  completed: false,
  ...over,
} as Task);

const run = (over: Partial<BlockOfferRun> = {}): BlockOfferRun => ({
  taskId: 't1',
  ruleId: 'rule1',
  startedAt: new Date(2026, 9, 19, 10, 0).toISOString(),
  untilIso: new Date(2026, 9, 19, 11, 0).toISOString(),
  coins: 10,
  ...over,
});

describe('block offer rules', () => {
  it('round-trips through storage', () => {
    const rules = [{ ...newBlockOfferRule('Block Games for 1 hour', 'games'), category: 'Screen Time' }];
    expect(parseBlockOfferRules(serializeBlockOfferRules(rules))).toEqual(rules);
  });

  it('reads a malformed value as nothing saved and drops a bad entry without losing the rest', () => {
    expect(parseBlockOfferRules('not json')).toEqual([]);
    expect(parseBlockOfferRules(null)).toEqual([]);
    const good = newBlockOfferRule('Block Games for 1 hour');
    const parsed = parseBlockOfferRules(JSON.stringify([{ id: 'x' }, null, good, { ...good, id: 'blank', title: '  ' }]));
    expect(parsed).toEqual([good]);
  });

  it('clamps a length to what a manual block can hold and coins to a sane range', () => {
    expect(clampBlockOfferMinutes(1)).toBe(15);
    expect(clampBlockOfferMinutes(100_000)).toBe(720);
    expect(clampBlockOfferMinutes(NaN)).toBe(60);
    expect(clampBlockOfferCoins(0)).toBe(1);
    expect(clampBlockOfferCoins(100_000)).toBe(500);
    const [rule] = parseBlockOfferRules(JSON.stringify([{ ...newBlockOfferRule('A'), minutes: 5, coins: 0 }]));
    expect(rule).toMatchObject({ minutes: 15, coins: 1 });
  });

  it('names a block by its group and length', () => {
    expect(blockOfferTitle('Games', 60)).toBe('Block Games for 1 hour');
    expect(blockOfferTitle('Social', 90)).toBe('Block Social for 1 hour 30 minutes');
    expect(describeOfferCoins(1)).toBe('1 coin');
    expect(describeOfferCoins(10)).toBe('10 coins');
  });
});

describe('source ids', () => {
  it('names the day and the rule', () => {
    const id = blockOfferSourceId('2026-10-19', 'rule1');
    expect(parseBlockOfferSourceId(id)).toEqual({ dayKey: '2026-10-19', ruleId: 'rule1' });
    expect(parseBlockOfferSourceId('nope')).toBeNull();
    expect(blockOfferRuleIdOf(task())).toBe('rule1');
    expect(blockOfferRuleIdOf(task({ generatedKind: 'screenTime' }))).toBeNull();
  });
});

describe('runs', () => {
  it('reads back what it wrote and drops malformed entries', () => {
    expect(parseBlockOfferRuns(JSON.stringify([run(), { taskId: 't2' }, null, { ...run(), untilIso: 'x' }]))).toEqual([run()]);
    expect(parseBlockOfferRuns('{')).toEqual([]);
  });

  it('keeps one run per task and drops ones long over', () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const old = run({ taskId: 'old', untilIso: new Date(2026, 9, 10).toISOString() });
    const next = run({ coins: 20 });
    expect(withRunAdded([run(), old], next, now)).toEqual([next]);
  });
});

describe('blockOfferRunOutcome', () => {
  const during = new Date(2026, 9, 19, 10, 30);
  const after = new Date(2026, 9, 19, 11, 0, 1);
  const release = (at: Date, ended: ('manual' | 'key')[] = ['manual']) => ({ at: at.toISOString(), ended });

  it('is running until the window ends', () => {
    expect(blockOfferRunOutcome(run(), [], during)).toBe('running');
  });

  it('is ready once the window ends untouched', () => {
    expect(blockOfferRunOutcome(run(), [], after)).toBe('ready');
  });

  it('is forfeited by a release that ended the manual block inside the window', () => {
    expect(blockOfferRunOutcome(run(), [release(during)], during)).toBe('forfeited');
    expect(blockOfferRunOutcome(run(), [release(during)], after)).toBe('forfeited');
  });

  it('ignores a release of something else, and releases outside the window', () => {
    expect(blockOfferRunOutcome(run(), [release(during, ['key'])], after)).toBe('ready');
    expect(blockOfferRunOutcome(run(), [release(new Date(2026, 9, 19, 9, 59))], after)).toBe('ready');
    expect(blockOfferRunOutcome(run(), [release(new Date(2026, 9, 19, 11, 0))], after)).toBe('ready');
  });
});

describe('what a tick pays', () => {
  const rules = [{ id: 'rule1', coins: 7 }];
  const ready = { generatedReadyAt: new Date().toISOString() };

  it('is not a block offer for any other task', () => {
    expect(blockOfferCoinsFor(task({ generatedKind: 'screenTime', ...ready }), [], rules)).toBeNull();
    expect(blockOfferCoinsFor(task({ generatedKind: null, ...ready }), [], rules)).toBeNull();
  });

  it('pays nothing until the block has run', () => {
    expect(blockOfferCoinsFor(task(), [run()], rules)).toBe(0);
  });

  it('pays the run’s figure once ready, then the rule’s on a phone with no run', () => {
    expect(blockOfferCoinsFor(task(ready), [run({ coins: 10 })], rules)).toBe(10);
    expect(blockOfferCoinsFor(task(ready), [], rules)).toBe(7);
    expect(blockOfferCoinsFor(task(ready), [], [])).toBe(0);
  });
});

describe('offersBlockStart', () => {
  it('is true until a block has run, then false', () => {
    expect(offersBlockStart(task())).toBe(true);
    expect(offersBlockStart(task({ generatedReadyAt: new Date().toISOString() }))).toBe(false);
    expect(offersBlockStart(task({ completed: true }))).toBe(false);
  });

  it('leaves every other task alone', () => {
    expect(offersBlockStart(task({ generatedKind: null }))).toBe(false);
  });
});
