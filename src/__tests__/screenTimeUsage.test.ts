import {
  USAGE_GROUP_ID,
  USAGE_MAX_MINUTES,
  USAGE_STEP_MINUTES,
  isUsageRuleId,
  raisedUsageDays,
  usageArmSignature,
  usageCrossingDay,
  usageHoursLabel,
  usageRuleMinutes,
  usageRungs,
} from '../utils/screenTimeUsage';

describe('usageRungs', () => {
  it('climbs in steps from the first to the top rung', () => {
    const rungs = usageRungs();
    expect(rungs[0].thresholdMinutes).toBe(USAGE_STEP_MINUTES);
    expect(rungs[rungs.length - 1].thresholdMinutes).toBe(USAGE_MAX_MINUTES);
    expect(rungs).toHaveLength(USAGE_MAX_MINUTES / USAGE_STEP_MINUTES);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i].thresholdMinutes - rungs[i - 1].thresholdMinutes).toBe(USAGE_STEP_MINUTES);
    }
  });

  it('counts the reserved group and past activity, with a unique id each', () => {
    const rungs = usageRungs();
    expect(new Set(rungs.map(r => r.id)).size).toBe(rungs.length);
    expect(rungs.every(r => r.groupId === USAGE_GROUP_ID && r.includesPastActivity)).toBe(true);
  });
});

describe('usage rule ids', () => {
  it('recognizes a rung and reads its minutes', () => {
    expect(isUsageRuleId('usage:90')).toBe(true);
    expect(usageRuleMinutes('usage:90')).toBe(90);
  });

  it('refuses anything that is not a rung', () => {
    expect(isUsageRuleId('default-screentime-30')).toBe(false);
    expect(isUsageRuleId('usage:')).toBe(false);
    expect(isUsageRuleId('usage:abc')).toBe(false);
    expect(isUsageRuleId('usage:0')).toBe(false);
    expect(isUsageRuleId('usage:-30')).toBe(false);
  });
});

describe('usageCrossingDay', () => {
  it('files a crossing under the logical day of the instant it fired', () => {
    // 01:00 local on the 12th belongs to the 11th under a 4 AM reset.
    const at = new Date('2026-08-12T01:00').getTime() / 1000;
    expect(usageCrossingDay({ ruleId: 'usage:30', dayKey: '2026-08-10', atSeconds: at }, '04:00')).toBe('2026-08-11');
    expect(usageCrossingDay({ ruleId: 'usage:30', dayKey: '2026-08-10', atSeconds: at }, '00:00')).toBe('2026-08-12');
  });

  it('falls back to the stamped day when the crossing has no instant', () => {
    expect(usageCrossingDay({ ruleId: 'usage:30', dayKey: '2026-08-10' }, '04:00')).toBe('2026-08-10');
  });
});

describe('raisedUsageDays', () => {
  const at = (iso: string) => new Date(iso).getTime() / 1000;

  it('takes the highest rung reached on a day', () => {
    const changed = raisedUsageDays(
      new Map(),
      [
        { ruleId: 'usage:30', dayKey: '2026-08-12', atSeconds: at('2026-08-12T09:00') },
        { ruleId: 'usage:90', dayKey: '2026-08-12', atSeconds: at('2026-08-12T15:00') },
        { ruleId: 'usage:60', dayKey: '2026-08-12', atSeconds: at('2026-08-12T12:00') },
      ],
      '04:00',
    );
    expect(changed).toEqual([{ dayKey: '2026-08-12', minutes: 90 }]);
  });

  it('never lowers a reading and reports only days that moved', () => {
    const current = new Map([['2026-08-12', 120], ['2026-08-13', 30]]);
    const changed = raisedUsageDays(
      current,
      [
        { ruleId: 'usage:60', dayKey: '2026-08-12', atSeconds: at('2026-08-12T10:00') },
        { ruleId: 'usage:90', dayKey: '2026-08-13', atSeconds: at('2026-08-13T10:00') },
      ],
      '04:00',
    );
    expect(changed).toEqual([{ dayKey: '2026-08-13', minutes: 90 }]);
  });

  it('is idempotent when the same crossings arrive twice', () => {
    const crossings = [{ ruleId: 'usage:60', dayKey: '2026-08-12', atSeconds: at('2026-08-12T10:00') }];
    const first = raisedUsageDays(new Map(), crossings, '04:00');
    const again = raisedUsageDays(new Map(first.map(d => [d.dayKey, d.minutes])), crossings, '04:00');
    expect(again).toEqual([]);
  });

  it('ignores rules that are not rungs', () => {
    expect(raisedUsageDays(new Map(), [{ ruleId: 'default-screentime-30', dayKey: '2026-08-12' }], '04:00')).toEqual([]);
  });

  it('files a crossing after midnight under the day before when the reset is later', () => {
    const changed = raisedUsageDays(
      new Map(),
      [{ ruleId: 'usage:30', dayKey: '2026-08-12', atSeconds: at('2026-08-13T02:00') }],
      '04:00',
    );
    expect(changed).toEqual([{ dayKey: '2026-08-12', minutes: 30 }]);
  });
});

describe('usageArmSignature', () => {
  it('changes with the day and with the rungs, and not otherwise', () => {
    const rungs = usageRungs();
    expect(usageArmSignature('2026-08-12', rungs)).toBe(usageArmSignature('2026-08-12', rungs));
    expect(usageArmSignature('2026-08-12', rungs)).not.toBe(usageArmSignature('2026-08-13', rungs));
    expect(usageArmSignature('2026-08-12', rungs)).not.toBe(usageArmSignature('2026-08-12', rungs.slice(1)));
  });
});

describe('usageHoursLabel', () => {
  it('says whole hours without a decimal and halves with one', () => {
    expect(usageHoursLabel(240)).toBe('4');
    expect(usageHoursLabel(150)).toBe('2.5');
    expect(usageHoursLabel(600)).toBe('10');
  });
});
