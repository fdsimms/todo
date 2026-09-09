import type { HealthRule } from '../types';
import {
  HEALTH_METRIC_EARLIEST_HOUR,
  HEALTH_THRESHOLDS,
  SHORT_SLEEP_HOURS,
  clampCheckpointHour,
  clampHealthThreshold,
  defaultHealthRules,
  describeHealthRule,
  formatCheckpointHour,
  healthMetricLabel,
  healthRuleCheckpointHour,
  healthRuleDirection,
  healthRuleIdOf,
  healthSourceId,
  healthTaskNote,
  parseHealthRules,
  parseHealthSourceId,
  proteinShortfallNote,
  ruleCanBeJudgedYet,
  ruleShortfallToday,
  satFatOverageNote,
  serializeHealthRules,
  shortSleepDeloadNote,
  sodiumShortfallNote,
  healthTaskLinkUrl,
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
    expect(clampHealthThreshold('sodiumMg', 999_999)).toBe(HEALTH_THRESHOLDS.sodiumMg.max);
    expect(clampHealthThreshold('sodiumMg', -1)).toBe(HEALTH_THRESHOLDS.sodiumMg.min);
    expect(clampHealthThreshold('proteinG', 999_999)).toBe(HEALTH_THRESHOLDS.proteinG.max);
    expect(clampHealthThreshold('proteinG', -1)).toBe(HEALTH_THRESHOLDS.proteinG.min);
    expect(clampHealthThreshold('satFatG', 999_999)).toBe(HEALTH_THRESHOLDS.satFatG.max);
    expect(clampHealthThreshold('satFatG', -1)).toBe(HEALTH_THRESHOLDS.satFatG.min);
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

  it('reads a sodium rule back, checkpointHour included', () => {
    const raw = JSON.stringify([{ ...rule({ metric: 'sodiumMg', threshold: 2000, checkpointHour: 12 }) }]);
    const parsed = parseHealthRules(raw)[0];
    expect(parsed.metric).toBe('sodiumMg');
    expect(parsed.checkpointHour).toBe(12);
  });

  it('reads a protein or saturated-fat rule back too', () => {
    const raw = JSON.stringify([
      rule({ id: 'p', metric: 'proteinG', threshold: 50, checkpointHour: 18 }),
      rule({ id: 'f', metric: 'satFatG', threshold: 20, checkpointHour: 0 }),
    ]);
    const [protein, satFat] = parseHealthRules(raw);
    expect(protein.metric).toBe('proteinG');
    expect(satFat.metric).toBe('satFatG');
  });

  it('clamps a stored threshold into range on the way back', () => {
    const raw = JSON.stringify([{ ...rule({ metric: 'steps' }), threshold: 9_999_999 }]);
    expect(parseHealthRules(raw)[0].threshold).toBe(HEALTH_THRESHOLDS.steps.max);
  });

  it('clamps a stored checkpointHour into 0-23 on the way back', () => {
    const raw = JSON.stringify([{ ...rule({ metric: 'sodiumMg' }), checkpointHour: 40 }]);
    expect(parseHealthRules(raw)[0].checkpointHour).toBe(23);
  });

  it('reads a stored direction override back', () => {
    const raw = JSON.stringify([{ ...rule({ metric: 'sodiumMg' }), direction: 'over' }]);
    expect(parseHealthRules(raw)[0].direction).toBe('over');
  });

  it('drops a nonsense stored direction rather than keeping it', () => {
    const raw = JSON.stringify([{ ...rule({ metric: 'sodiumMg' }), direction: 'sideways' }]);
    expect(parseHealthRules(raw)[0].direction).toBeUndefined();
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
  const recorded = { steps: 4000, sleepHours: 7, sodiumMg: 1800, proteinG: 40, satFatG: 10 };

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
    expect(ruleCanBeJudgedYet(rule({ metric: 'sleepHours' }), 9, { steps: 9000, sleepHours: null, sodiumMg: null, proteinG: null, satFatG: null }))
      .toBe(false);
    expect(ruleCanBeJudgedYet(rule({ metric: 'steps' }), 23, { steps: null, sleepHours: 8, sodiumMg: null, proteinG: null, satFatG: null }))
      .toBe(false);
  });

  it('counts a zero as arrived, because it is a reading', () => {
    expect(ruleCanBeJudgedYet(rule({ metric: 'steps' }), 20, { steps: 0, sleepHours: null, sodiumMg: null, proteinG: null, satFatG: null }))
      .toBe(true);
  });

  it('holds a sodium rule until its own checkpoint hour, not the fallback', () => {
    const sodium = rule({ metric: 'sodiumMg', checkpointHour: 17 });
    expect(ruleCanBeJudgedYet(sodium, 16, recorded)).toBe(false);
    expect(ruleCanBeJudgedYet(sodium, 17, recorded)).toBe(true);
  });

  it('falls back to the metric default when a sodium rule has no checkpointHour of its own', () => {
    const sodium = rule({ metric: 'sodiumMg' });
    expect(ruleCanBeJudgedYet(sodium, HEALTH_METRIC_EARLIEST_HOUR.sodiumMg - 1, recorded)).toBe(false);
    expect(ruleCanBeJudgedYet(sodium, HEALTH_METRIC_EARLIEST_HOUR.sodiumMg, recorded)).toBe(true);
  });
});

describe('ruleShortfallToday', () => {
  const full = { steps: 9000, sleepHours: 8, sodiumMg: 3000, proteinG: 60, satFatG: 10 };

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
    expect(ruleShortfallToday(rule({ metric: 'steps' }), { ...full, steps: null })).toBe(false);
    expect(ruleShortfallToday(rule({ metric: 'sleepHours' }), { ...full, sleepHours: null })).toBe(false);
    expect(ruleShortfallToday(rule({ metric: 'sodiumMg' }), { ...full, sodiumMg: null })).toBe(false);
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

  it('reads a sodium rule against sodiumMg', () => {
    const sodium = rule({ metric: 'sodiumMg', threshold: 2000 });
    expect(ruleShortfallToday(sodium, { ...full, sodiumMg: 1500 })).toBe(true);
    expect(ruleShortfallToday(sodium, { ...full, sodiumMg: 2500 })).toBe(false);
  });

  it('reads a protein rule against proteinG, same direction as sodium', () => {
    const protein = rule({ metric: 'proteinG', threshold: 50 });
    expect(ruleShortfallToday(protein, { ...full, proteinG: 30 })).toBe(true);
    expect(ruleShortfallToday(protein, { ...full, proteinG: 70 })).toBe(false);
  });

  it('reads a saturated-fat rule the other way round: over, not under', () => {
    const satFat = rule({ metric: 'satFatG', threshold: 20 });
    expect(ruleShortfallToday(satFat, { ...full, satFatG: 25 })).toBe(true);
    expect(ruleShortfallToday(satFat, { ...full, satFatG: 15 })).toBe(false);
  });

  it('flips direction when a rule overrides its metric’s default', () => {
    // A sodium ceiling (blood pressure) instead of the usual floor (POTS).
    const sodiumCeiling = rule({ metric: 'sodiumMg', threshold: 2000, direction: 'over' });
    expect(ruleShortfallToday(sodiumCeiling, { ...full, sodiumMg: 2500 })).toBe(true);
    expect(ruleShortfallToday(sodiumCeiling, { ...full, sodiumMg: 1500 })).toBe(false);

    // And saturated fat flipped back to a floor.
    const satFatFloor = rule({ metric: 'satFatG', threshold: 20, direction: 'under' });
    expect(ruleShortfallToday(satFatFloor, { ...full, satFatG: 15 })).toBe(true);
    expect(ruleShortfallToday(satFatFloor, { ...full, satFatG: 25 })).toBe(false);
  });

  it('does not match a saturated-fat reading that meets its ceiling exactly', () => {
    expect(ruleShortfallToday(rule({ metric: 'satFatG', threshold: 20 }), { ...full, satFatG: 20 })).toBe(false);
  });

  it('never matches a missing protein or saturated-fat reading', () => {
    expect(ruleShortfallToday(rule({ metric: 'proteinG' }), { ...full, proteinG: null })).toBe(false);
    expect(ruleShortfallToday(rule({ metric: 'satFatG' }), { ...full, satFatG: null })).toBe(false);
  });
});

describe('healthRuleCheckpointHour', () => {
  it('uses the rule’s own hour when set', () => {
    expect(healthRuleCheckpointHour(rule({ metric: 'sodiumMg', checkpointHour: 15 }))).toBe(15);
  });

  it('falls back to the metric default otherwise', () => {
    expect(healthRuleCheckpointHour(rule({ metric: 'sodiumMg' }))).toBe(HEALTH_METRIC_EARLIEST_HOUR.sodiumMg);
    expect(healthRuleCheckpointHour(rule({ metric: 'steps' }))).toBe(HEALTH_METRIC_EARLIEST_HOUR.steps);
  });
});

describe('clampCheckpointHour', () => {
  it('holds a value inside 0-23', () => {
    expect(clampCheckpointHour(-5)).toBe(0);
    expect(clampCheckpointHour(30)).toBe(23);
    expect(clampCheckpointHour(12)).toBe(12);
  });

  it('falls back rather than storing a number that isn’t one', () => {
    expect(clampCheckpointHour(NaN)).toBe(HEALTH_METRIC_EARLIEST_HOUR.sodiumMg);
  });
});

describe('formatCheckpointHour', () => {
  it('renders a round hour with AM/PM', () => {
    expect(formatCheckpointHour(12)).toBe('12 PM');
    expect(formatCheckpointHour(18)).toBe('6 PM');
    expect(formatCheckpointHour(0)).toBe('12 AM');
  });
});

describe('healthMetricLabel', () => {
  it('names all five metrics', () => {
    expect(healthMetricLabel('steps')).toBe('Steps');
    expect(healthMetricLabel('sleepHours')).toBe('Hours asleep');
    expect(healthMetricLabel('sodiumMg')).toBe('Sodium');
    expect(healthMetricLabel('proteinG')).toBe('Protein');
    expect(healthMetricLabel('satFatG')).toBe('Saturated fat');
  });
});

describe('healthRuleDirection', () => {
  it('defaults to under for every metric but saturated fat', () => {
    expect(healthRuleDirection(rule({ metric: 'steps' }))).toBe('under');
    expect(healthRuleDirection(rule({ metric: 'sleepHours' }))).toBe('under');
    expect(healthRuleDirection(rule({ metric: 'sodiumMg' }))).toBe('under');
    expect(healthRuleDirection(rule({ metric: 'proteinG' }))).toBe('under');
  });

  it('defaults to over for saturated fat alone', () => {
    expect(healthRuleDirection(rule({ metric: 'satFatG' }))).toBe('over');
  });

  it('lets a rule override its metric’s default direction', () => {
    expect(healthRuleDirection(rule({ metric: 'sodiumMg', direction: 'over' }))).toBe('over');
    expect(healthRuleDirection(rule({ metric: 'satFatG', direction: 'under' }))).toBe('under');
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

  it('says the sodium number and its own checkpoint hour', () => {
    expect(describeHealthRule(rule({ metric: 'sodiumMg', threshold: 2000, checkpointHour: 12 })))
      .toBe('Under 2,000mg sodium, from 12 PM');
    expect(describeHealthRule(rule({ metric: 'sodiumMg', threshold: 4000, checkpointHour: 18 })))
      .toBe('Under 4,000mg sodium, from 6 PM');
  });

  it('falls back to the metric default hour when a sodium rule has none set', () => {
    expect(describeHealthRule(rule({ metric: 'sodiumMg', threshold: 2000 })))
      .toBe(`Under 2,000mg sodium, from ${formatCheckpointHour(HEALTH_METRIC_EARLIEST_HOUR.sodiumMg)}`);
  });

  it('says the protein number and its own checkpoint hour', () => {
    expect(describeHealthRule(rule({ metric: 'proteinG', threshold: 50, checkpointHour: 18 })))
      .toBe('Under 50g protein, from 6 PM');
  });

  it('says "Over" rather than "Under" for saturated fat', () => {
    expect(describeHealthRule(rule({ metric: 'satFatG', threshold: 20, checkpointHour: 0 })))
      .toBe('Over 20g saturated fat, from 12 AM');
  });

  it('follows a rule’s own direction override rather than the metric default', () => {
    expect(describeHealthRule(rule({ metric: 'sodiumMg', threshold: 2000, checkpointHour: 12, direction: 'over' })))
      .toBe('Over 2,000mg sodium, from 12 PM');
    expect(describeHealthRule(rule({ metric: 'satFatG', threshold: 20, checkpointHour: 0, direction: 'under' })))
      .toBe('Under 20g saturated fat, from 12 AM');
  });
});

describe('sodiumShortfallNote', () => {
  it('attributes the source rather than asserting the fact', () => {
    expect(sodiumShortfallNote(1500)).toBe('Apple Health has recorded 1,500mg of sodium today.');
  });

  it('gives no advice and names no state', () => {
    expect(sodiumShortfallNote(500)).not.toMatch(/\btry\b|\bshould\b|low|deficien|need/i);
  });
});

describe('proteinShortfallNote', () => {
  it('attributes the source rather than asserting the fact', () => {
    expect(proteinShortfallNote(42)).toBe('Apple Health has recorded 42g of protein today.');
  });
});

describe('satFatOverageNote', () => {
  it('reports the reading rather than calling it too much', () => {
    // A ceiling crossed is reported exactly the way a floor missed is: what
    // Health recorded, attributed to Health, never a verdict on it.
    const note = satFatOverageNote(28);
    expect(note).toBe('Apple Health has recorded 28g of saturated fat today.');
    expect(note).not.toMatch(/\btoo much\b|\bexcess\b|\bshould\b/i);
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

describe('healthTaskLinkUrl', () => {
  it('opens DeloadSheet for a sleep-shortfall rule', () => {
    expect(healthTaskLinkUrl('sleepHours')).toBe('dundundun://deload');
  });

  it('carries no link for a steps rule, which already names its own action', () => {
    expect(healthTaskLinkUrl('steps')).toBeNull();
  });

  it('carries no link for a sodium rule either', () => {
    expect(healthTaskLinkUrl('sodiumMg')).toBeNull();
  });

  it('carries no link for protein or saturated fat', () => {
    expect(healthTaskLinkUrl('proteinG')).toBeNull();
    expect(healthTaskLinkUrl('satFatG')).toBeNull();
  });
});

describe('healthTaskNote', () => {
  const full = { steps: 1000, sleepHours: 5, sodiumMg: 1500, proteinG: 30, satFatG: 25 };

  it('carries no note for steps, which already names its own action', () => {
    expect(healthTaskNote(rule({ metric: 'steps' }), full)).toBeUndefined();
  });

  it('picks the right note for each of the other four metrics', () => {
    expect(healthTaskNote(rule({ metric: 'sleepHours' }), full)).toBe(shortSleepDeloadNote(5));
    expect(healthTaskNote(rule({ metric: 'sodiumMg' }), full)).toBe(sodiumShortfallNote(1500));
    expect(healthTaskNote(rule({ metric: 'proteinG' }), full)).toBe(proteinShortfallNote(30));
    expect(healthTaskNote(rule({ metric: 'satFatG' }), full)).toBe(satFatOverageNote(25));
  });

  it('carries no note when the reading behind it is missing', () => {
    expect(healthTaskNote(rule({ metric: 'sodiumMg' }), { ...full, sodiumMg: null })).toBeUndefined();
    expect(healthTaskNote(rule({ metric: 'proteinG' }), { ...full, proteinG: null })).toBeUndefined();
    expect(healthTaskNote(rule({ metric: 'satFatG' }), { ...full, satFatG: null })).toBeUndefined();
  });
});
