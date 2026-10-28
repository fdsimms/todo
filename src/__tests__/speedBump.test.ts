import type { SpeedBumpRule } from '../types';
import {
  SPEED_BUMP_BLOCK_MIN,
  armableSpeedBumps,
  clampBumpBlockMinutes,
  clampBumpWarn,
  parseBumpWarn,
  speedBumpWarnRungs,
  speedBumpWarnText,
  describeSpeedBump,
  liveSpeedBump,
  newSpeedBumpRule,
  parseSpeedBumpRules,
  serializeSpeedBumpRules,
  speedBumpRungs,
} from '../utils/speedBump';

const rule = (over: Partial<SpeedBumpRule> = {}): SpeedBumpRule => ({
  id: 'r1',
  title: 'Social wind-down',
  thresholdMinutes: 45,
  blockMinutes: 15,
  repeatEveryMinutes: null,
  maxTimes: 1,
  enabled: true,
  ...over,
});

describe('speedBumpRungs', () => {
  it('is one rung for a rule that does not repeat, whatever its count says', () => {
    expect(speedBumpRungs(rule({ maxTimes: 5 }))).toEqual([45]);
  });

  it('arms a ladder of cumulative minutes for a repeating rule', () => {
    expect(speedBumpRungs(rule({ repeatEveryMinutes: 30, maxTimes: 4 }))).toEqual([45, 75, 105, 135]);
  });

  it('drops a rung past the longest threshold a rule can have (480 itself stays)', () => {
    expect(speedBumpRungs(rule({ thresholdMinutes: 420, repeatEveryMinutes: 30, maxTimes: 6 }))).toEqual([420, 450, 480]);
    expect(speedBumpRungs(rule({ thresholdMinutes: 450, repeatEveryMinutes: 45, maxTimes: 3 }))).toEqual([450]);
  });

  it('caps the count, so a hand-edited rule cannot arm dozens of events', () => {
    expect(speedBumpRungs(rule({ thresholdMinutes: 5, repeatEveryMinutes: 15, maxTimes: 99 }))).toHaveLength(6);
  });
});

describe('parseSpeedBumpRules', () => {
  it('round-trips a rule', () => {
    const rules = [rule({ groupId: 'social', blockGroupId: 'games', repeatEveryMinutes: 30, maxTimes: 3, blockMinutes: 30 })];
    expect(parseSpeedBumpRules(serializeSpeedBumpRules(rules))).toEqual(rules);
  });

  it('reads nothing saved, and malformed JSON, as an empty list', () => {
    expect(parseSpeedBumpRules(null)).toEqual([]);
    expect(parseSpeedBumpRules('{oops')).toEqual([]);
    expect(parseSpeedBumpRules('{"a":1}')).toEqual([]);
  });

  it('drops a bad entry without discarding the list', () => {
    const raw = JSON.stringify([
      { id: '', title: 'x', thresholdMinutes: 30, blockMinutes: 15 },
      { id: 'a', title: '  ', thresholdMinutes: 30, blockMinutes: 15 },
      { id: 'b', title: 'ok', thresholdMinutes: 'soon', blockMinutes: 15 },
      { id: 'c', title: 'kept', thresholdMinutes: 30, blockMinutes: 15 },
    ]);
    expect(parseSpeedBumpRules(raw).map(r => r.id)).toEqual(['c']);
  });

  it('clamps what iOS or the app cannot honour', () => {
    const [parsed] = parseSpeedBumpRules(JSON.stringify([
      { id: 'a', title: 't', thresholdMinutes: 1, blockMinutes: 2, repeatEveryMinutes: 1, maxTimes: 50 },
    ]));
    expect(parsed.thresholdMinutes).toBe(5);
    expect(parsed.blockMinutes).toBe(SPEED_BUMP_BLOCK_MIN);
    expect(parsed.repeatEveryMinutes).toBe(15);
    expect(parsed.maxTimes).toBe(6);
  });

  it('forces a rule that does not repeat to fire once', () => {
    const [parsed] = parseSpeedBumpRules(JSON.stringify([
      { id: 'a', title: 't', thresholdMinutes: 30, blockMinutes: 15, repeatEveryMinutes: 0, maxTimes: 4 },
    ]));
    expect(parsed.repeatEveryMinutes).toBeNull();
    expect(parsed.maxTimes).toBe(1);
  });

  it('is off only when it says so', () => {
    const [parsed] = parseSpeedBumpRules(JSON.stringify([{ id: 'a', title: 't', thresholdMinutes: 30, blockMinutes: 15, enabled: false }]));
    expect(parsed.enabled).toBe(false);
  });
});

describe('clampBumpBlockMinutes', () => {
  it('never goes under the quarter hour a monitored interval needs', () => {
    expect(clampBumpBlockMinutes(5)).toBe(15);
    expect(clampBumpBlockMinutes(Number.NaN)).toBe(15);
    expect(clampBumpBlockMinutes(500)).toBe(120);
  });
});

describe('armableSpeedBumps', () => {
  it('leaves out a rule that is switched off', () => {
    expect(armableSpeedBumps([rule({ enabled: false })])).toEqual([]);
  });

  it('counts the group it names and blocks it too when no other is named', () => {
    const [bump] = armableSpeedBumps([rule({ groupId: 'social' })]);
    expect(bump).toEqual({ id: 'r1', groupId: 'social', blockGroupIds: ['social'], blockMinutes: 15, rungs: [45], warnRungs: [0], warnText: '' });
  });

  it('blocks a different group when one is named, with a supergroup already expanded', () => {
    const [bump] = armableSpeedBumps(
      [rule({ groupId: 'social', blockGroupId: 'distractions' })],
      id => id ?? 'default',
      id => (id === 'distractions' ? ['games', 'video'] : [id ?? 'default']),
    );
    expect(bump.blockGroupIds).toEqual(['games', 'video']);
    expect(bump.groupId).toBe('social');
  });

  it('reads a missing group as Default for both', () => {
    const [bump] = armableSpeedBumps([rule()]);
    expect(bump.groupId).toBe('default');
    expect(bump.blockGroupIds).toEqual(['default']);
  });

  it('leaves out a rule that resolves to nothing to block', () => {
    expect(armableSpeedBumps([rule()], id => id ?? 'default', () => [])).toEqual([]);
  });
});

describe('liveSpeedBump', () => {
  const NOW = new Date('2026-08-22T09:00:00.000Z');
  const later = '2026-08-22T09:15:00.000Z';

  it('reads the record the extension wrote', () => {
    expect(liveSpeedBump(JSON.stringify({ endIso: later, groupIds: ['games'], ruleId: 'r1' }), NOW))
      .toEqual({ untilIso: later, groupIds: ['games'] });
  });

  it('is nothing once the end has passed, or at the end', () => {
    expect(liveSpeedBump(JSON.stringify({ endIso: '2026-08-22T08:59:00.000Z', groupIds: ['games'] }), NOW)).toBeNull();
    expect(liveSpeedBump(JSON.stringify({ endIso: NOW.toISOString(), groupIds: ['games'] }), NOW)).toBeNull();
  });

  it('is nothing for an empty, malformed or incomplete record, never a block for ever', () => {
    expect(liveSpeedBump('', NOW)).toBeNull();
    expect(liveSpeedBump(null, NOW)).toBeNull();
    expect(liveSpeedBump('{nope', NOW)).toBeNull();
    expect(liveSpeedBump(JSON.stringify({ endIso: 'later', groupIds: ['games'] }), NOW)).toBeNull();
    expect(liveSpeedBump(JSON.stringify({ endIso: later, groupIds: [] }), NOW)).toBeNull();
    expect(liveSpeedBump(JSON.stringify({ groupIds: ['games'] }), NOW)).toBeNull();
  });
});

describe('describeSpeedBump', () => {
  it('says a rule that fires once in one clause', () => {
    expect(describeSpeedBump(rule(), 'Social', 'Games')).toBe('After 45 min on Social, Games blocked for 15 minutes.');
  });

  it('says how a repeating rule repeats, with the count it can actually arm', () => {
    expect(describeSpeedBump(rule({ repeatEveryMinutes: 30, maxTimes: 3, blockMinutes: 30 }), 'Social', 'Social'))
      .toBe('After 45 min on Social, then every 30 min, up to 3 times a day: Social blocked for 30 minutes.');
  });
});

describe('newSpeedBumpRule', () => {
  it('starts on, once a day, for a quarter hour', () => {
    const made = newSpeedBumpRule('Wind down', 'social');
    expect(made).toMatchObject({ title: 'Wind down', groupId: 'social', blockMinutes: 15, repeatEveryMinutes: null, maxTimes: 1, enabled: true });
  });
});

describe('speed bump heads-ups', () => {
  it('puts each heads-up the lead before its rung, in step with the rungs', () => {
    expect(speedBumpWarnRungs([45, 75, 105], 5)).toEqual([40, 70, 100]);
  });

  it('is all zeros when off', () => {
    expect(speedBumpWarnRungs([45, 75], 0)).toEqual([0, 0]);
  });

  it('gives a rung with no minute left before it no heads-up', () => {
    expect(speedBumpWarnRungs([5, 15], 10)).toEqual([0, 5]);
  });

  it('reads anything but an offered lead as off', () => {
    expect(clampBumpWarn(7)).toBe(0);
    expect(parseBumpWarn('10')).toBe(10);
    expect(parseBumpWarn('')).toBe(0);
    expect(parseBumpWarn(null)).toBe(0);
    expect(speedBumpWarnRungs([45], 7)).toEqual([0]);
  });

  it('hands the native side the rungs, the heads-ups and the sentence', () => {
    const [bump] = armableSpeedBumps(
      [rule({ repeatEveryMinutes: 30, maxTimes: 2 })],
      undefined,
      undefined,
      { leadMinutes: 5, blockedName: () => 'Games' },
    );
    expect(bump.rungs).toEqual([45, 75]);
    expect(bump.warnRungs).toEqual([40, 70]);
    expect(bump.warnText).toBe('Games will be blocked in about 5 minutes.');
  });

  it('arms no heads-ups unless asked', () => {
    const [bump] = armableSpeedBumps([rule()]);
    expect(bump.warnRungs).toEqual([0]);
  });
});
