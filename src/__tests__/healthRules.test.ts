import type { HealthRule } from '../types';
import {
  HEALTH_METRIC_EARLIEST_HOUR,
  HEALTH_THRESHOLDS,
  SHORT_SLEEP_HOURS,
  clampHealthThreshold,
  defaultHealthRules,
  describeHealthRule,
  healthRuleIdOf,
  healthSourceId,
  parseHealthRules,
  parseHealthSourceId,
  ruleCanBeJudgedYet,
  ruleShortfallToday,
  serializeHealthRules,
  shortSleepDeloadNote,
} from '../utils/healthRules';

function rule(over: Partial<HealthRule> = {}): HealthRule {
  return {
    id: 'r1',
    metric: 'sleepHours',
    threshold: 6,
    title: 'Keep today light',
    enabled: true,
    lastFiredDayKey: null,
    ...over,
  };
}

describe('defaultHealthRules', () => {
  it('ships two, both enabled and unfired', () => {
    const rules = defaultHealthRules();
    expect(rules).toHaveLength(2);
    expect(rules.every(r => r.enabled && r.lastFiredDayKey === null)).toBe(true);
    expect(new Set(rules.map(r => r.id)).size).toBe(2);
  });

  it('names things to do, never things to conclude', () => {
    // The mood-log rule, applied here: the app knows a number arrived, and that
    // is all it knows. "You slept badly" would be it telling somebody about
    // their own night.
    for (const r of defaultHealthRules()) {
      expect(r.title).not.toMatch(/you|bad|poor|tired|unwell/i);
    }
  });

  it('covers both metrics, so the first rule someone meets is not a monoculture', () => {
    expect(new Set(defaultHealthRules().map(r => r.metric))).toEqual(new Set(['sleepHours', 'steps']));
  });
});

describe('clampHealthThreshold', () => {
  it('holds each metric inside its own range', () => {
    expect(clampHealthThreshold('steps', 1_000_000)).toBe(HEALTH_THRESHOLDS.steps.max);
    expect(clampHealthThreshold('steps', 0)).toBe(HEALTH_THRESHOLDS.steps.min);
    expect(clampHealthThreshold('sleepHours', 40)).toBe(HEALTH_THRESHOLDS.sleepHours.max);
    expect(clampHealthThreshold('sleepHours', -3)).toBe(HEALTH_THRESHOLDS.sleepHours.min);
  });

  it('re-clamps across a metric switch, which is what the editor uses it for', () => {
    // Switching "under 3,000 steps" to hours must not leave a rule asking about
    // three thousand hours of sleep.
    expect(clampHealthThreshold('sleepHours', 3000)).toBe(HEALTH_THRESHOLDS.sleepHours.max);
  });

  it('falls back rather than storing a number that isn’t one', () => {
    expect(clampHealthThreshold('steps', NaN)).toBe(HEALTH_THRESHOLDS.steps.default);
  });
});

describe('parseHealthRules', () => {
  it('round-trips what was written', () => {
    const rules = defaultHealthRules();
    expect(parseHealthRules(serializeHealthRules(rules))).toEqual(rules);
  });

  it('reads nothing saved, and malformed, as no rules', () => {
    expect(parseHealthRules(null)).toEqual([]);
    expect(parseHealthRules('')).toEqual([]);
    expect(parseHealthRules('not json')).toEqual([]);
    expect(parseHealthRules('{"a":1}')).toEqual([]);
  });

  it('drops a bad entry without discarding the list', () => {
    const good = rule({ id: 'keep', title: 'Keep today light' });
    const raw = JSON.stringify([{ id: 'x', title: '   ', metric: 'steps', threshold: 1 }, good]);
    expect(parseHealthRules(raw).map(r => r.id)).toEqual(['keep']);
  });

  it('falls back on an unknown metric rather than losing the rule', () => {
    // The title is the part somebody wrote; a metric this build doesn't know is
    // not a reason to throw their sentence away.
    const raw = JSON.stringify([{ ...rule(), metric: 'heartRate' }]);
    expect(parseHealthRules(raw)[0].metric).toBe('sleepHours');
  });

  it('clamps a stored threshold into range on the way back', () => {
    const raw = JSON.stringify([{ ...rule({ metric: 'steps' }), threshold: 9_999_999 }]);
    expect(parseHealthRules(raw)[0].threshold).toBe(HEALTH_THRESHOLDS.steps.max);
  });

  it('defaults `enabled` to true, so an older row is not silently off', () => {
    const { enabled: _drop, ...withoutEnabled } = rule();
    expect(parseHealthRules(JSON.stringify([withoutEnabled]))[0].enabled).toBe(true);
  });
});

describe('the source id', () => {
  it('round-trips a day and a rule', () => {
    expect(parseHealthSourceId(healthSourceId('2026-09-02', 'r1')))
      .toEqual({ dayKey: '2026-09-02', ruleId: 'r1' });
  });

  it('refuses a half of one', () => {
    expect(parseHealthSourceId(null)).toBeNull();
    expect(parseHealthSourceId('')).toBeNull();
    expect(parseHealthSourceId('2026-09-02')).toBeNull();
    expect(parseHealthSourceId('#r1')).toBeNull();
    expect(parseHealthSourceId('2026-09-02#')).toBeNull();
  });

  it('reads the rule id off a health task and off nothing else', () => {
    expect(healthRuleIdOf({ generatedKind: 'health', generatedSourceId: '2026-09-02#r1' })).toBe('r1');
    // A weather task's source id has the same shape, which is exactly why the
    // read goes through generatedSourceOf's kind check.
    expect(healthRuleIdOf({ generatedKind: 'weather', generatedSourceId: '2026-09-02#r1' })).toBeNull();
    expect(healthRuleIdOf({ generatedKind: null, generatedSourceId: null })).toBeNull();
  });
});

describe('ruleCanBeJudgedYet', () => {
  const recorded = { steps: 4000, sleepHours: 7 };

  it('lets a sleep rule be judged from the start of the day', () => {
    // Sleep is recorded overnight and is settled by the time anybody looks.
    expect(ruleCanBeJudgedYet(rule({ metric: 'sleepHours' }), 0, recorded)).toBe(true);
  });

  it('holds a steps rule until the day has had its chance', () => {
    // "Under 3,000 steps" is true at 7am for everybody not out running, so
    // firing then would be telling people off for not having had their day.
    const steps = rule({ metric: 'steps' });
    expect(ruleCanBeJudgedYet(steps, 7, recorded)).toBe(false);
    expect(ruleCanBeJudgedYet(steps, HEALTH_METRIC_EARLIEST_HOUR.steps - 0.1, recorded)).toBe(false);
    expect(ruleCanBeJudgedYet(steps, HEALTH_METRIC_EARLIEST_HOUR.steps, recorded)).toBe(true);
    expect(ruleCanBeJudgedYet(steps, 23, recorded)).toBe(true);
  });

  it('holds a rule whose number has not arrived, however late it is', () => {
    // The half that is easy to miss, and it is what stops a sleep rule being
    // judged at 00:05 against a night that has not happened, marked considered,
    // and silently retired for the rest of the day. It would have worked for
    // anybody who opens the app at eight and never for anybody whose phone is
    // awake at midnight.
    expect(ruleCanBeJudgedYet(rule({ metric: 'sleepHours' }), 9, { steps: 9000, sleepHours: null }))
      .toBe(false);
    expect(ruleCanBeJudgedYet(rule({ metric: 'steps' }), 23, { steps: null, sleepHours: 8 }))
      .toBe(false);
  });

  it('counts a zero as arrived, because it is a reading', () => {
    expect(ruleCanBeJudgedYet(rule({ metric: 'steps' }), 20, { steps: 0, sleepHours: null }))
      .toBe(true);
  });
});

describe('ruleShortfallToday', () => {
  const full = { steps: 9000, sleepHours: 8 };

  it('matches a reading under the threshold', () => {
    expect(ruleShortfallToday(rule({ threshold: 6 }), { ...full, sleepHours: 5 })).toBe(true);
    expect(ruleShortfallToday(rule({ metric: 'steps', threshold: 3000 }), { ...full, steps: 900 })).toBe(true);
  });

  it('does not match a reading that meets it exactly', () => {
    // "Under six hours" means under six hours.
    expect(ruleShortfallToday(rule({ threshold: 6 }), { ...full, sleepHours: 6 })).toBe(false);
  });

  it('never matches a missing reading', () => {
    // The rule the whole feature rests on. HealthKit serves a refused read as
    // an empty store, so null covers "you said no" — reading it as zero would
    // fire "Go for a walk" at everybody who declined, every single evening.
    expect(ruleShortfallToday(rule({ metric: 'steps' }), { steps: null, sleepHours: 8 })).toBe(false);
    expect(ruleShortfallToday(rule({ metric: 'sleepHours' }), { steps: 9000, sleepHours: null })).toBe(false);
  });

  it('matches a genuine zero, which is a reading rather than an absence', () => {
    expect(ruleShortfallToday(rule({ metric: 'steps', threshold: 3000 }), { ...full, steps: 0 })).toBe(true);
  });

  it('says nothing for a disabled rule', () => {
    expect(ruleShortfallToday(rule({ enabled: false }), { ...full, sleepHours: 2 })).toBe(false);
  });

  it('ignores the mark, which the caller spends itself', () => {
    expect(ruleShortfallToday(rule({ lastFiredDayKey: '2026-09-02' }), { ...full, sleepHours: 2 })).toBe(true);
  });
});

describe('describeHealthRule', () => {
  it('says the number and, for steps, when it is judged', () => {
    expect(describeHealthRule(rule({ metric: 'steps', threshold: 3000 })))
      .toBe('Under 3,000 steps, from 6 PM');
    expect(describeHealthRule(rule({ metric: 'sleepHours', threshold: 6 })))
      .toBe('Under 6 hours asleep');
  });

  it('does not say "1 hours"', () => {
    expect(describeHealthRule(rule({ threshold: 1 }))).toBe('Under 1 hour asleep');
  });
});

describe('shortSleepDeloadNote', () => {
  it('attributes the source rather than asserting the fact', () => {
    // A reading is a claim, not a statement: nobody logged this, and it may be
    // a watch's guess or a phone on the nightstand.
    const note = shortSleepDeloadNote(5.34) as string;
    expect(note).toBe('Apple Health recorded 5h 20m of sleep for today.');
  });

  it('says "for today" rather than "last night", since a nap counts too', () => {
    expect(shortSleepDeloadNote(4)).toContain('for today');
    expect(shortSleepDeloadNote(4)).not.toContain('last night');
  });

  it('drops the minutes when there are none', () => {
    expect(shortSleepDeloadNote(5)).toBe('Apple Health recorded 5h of sleep for today.');
  });

  it('never renders 60 minutes', () => {
    expect(shortSleepDeloadNote(5.999)).toBe('Apple Health recorded 6h of sleep for today.');
  });

  it('says nothing about a night that was long enough', () => {
    expect(shortSleepDeloadNote(SHORT_SLEEP_HOURS)).toBeNull();
    expect(shortSleepDeloadNote(9)).toBeNull();
  });

  it('says nothing at all when there is no reading', () => {
    // Null is a refused read as much as an unrecorded night.
    expect(shortSleepDeloadNote(null)).toBeNull();
  });

  it('gives no advice and names no state', () => {
    // The rule moodNudge lives by, applied to the one line this feature puts
    // in front of somebody about their own body.
    const note = shortSleepDeloadNote(3) as string;
    expect(note).not.toMatch(/\btry\b|\bshould\b|tired|exhaust|rest up|take it easy/i);
  });
});
