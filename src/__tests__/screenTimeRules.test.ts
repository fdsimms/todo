import {
  armableRules,
  clampThresholdMinutes,
  crossingWantsTask,
  defaultScreenTimeRules,
  parseScreenTimeRules,
  parseScreenTimeSourceId,
  screenTimeRuleIdOf,
  screenTimeSourceId,
  serializeScreenTimeRules,
  SCREEN_TIME_RULE_TITLE_MAX_LENGTH,
  SCREEN_TIME_THRESHOLD_MAX,
  SCREEN_TIME_THRESHOLD_MIN,
} from '../utils/screenTimeRules';
import type { ScreenTimeRule, Task } from '../types';

const makeRule = (overrides: Partial<ScreenTimeRule> = {}): ScreenTimeRule => ({
  id: 'rule-1',
  thresholdMinutes: 30,
  title: 'Take a walk',
  enabled: true,
  lastFiredDayKey: null,
  ...overrides,
});

describe('defaultScreenTimeRules', () => {
  it('ships rules that are ready to fire, at two different thresholds', () => {
    const rules = defaultScreenTimeRules();
    expect(rules.length).toBeGreaterThan(1);
    expect(rules.every(r => r.enabled && r.title !== '')).toBe(true);
    // Two rules at the same threshold would demo nothing the first doesn't.
    expect(new Set(rules.map(r => r.thresholdMinutes)).size).toBe(rules.length);
  });

  it('gives each rule its own id, and no rule a spent mark', () => {
    const rules = defaultScreenTimeRules();
    expect(new Set(rules.map(r => r.id)).size).toBe(rules.length);
    expect(rules.every(r => r.lastFiredDayKey === null)).toBe(true);
  });
});

describe('clampThresholdMinutes', () => {
  it('holds the value inside the range the monitor can actually watch', () => {
    expect(clampThresholdMinutes(1)).toBe(SCREEN_TIME_THRESHOLD_MIN);
    expect(clampThresholdMinutes(10_000)).toBe(SCREEN_TIME_THRESHOLD_MAX);
    expect(clampThresholdMinutes(45)).toBe(45);
  });

  it('rounds a fractional threshold rather than passing it to DateComponents', () => {
    expect(clampThresholdMinutes(30.6)).toBe(31);
  });

  it('reads a value that is not a number as the default', () => {
    expect(clampThresholdMinutes(NaN)).toBe(30);
    expect(clampThresholdMinutes(Infinity)).toBe(30);
  });
});

describe('parseScreenTimeRules', () => {
  it('reads a missing or malformed value as no rules saved', () => {
    expect(parseScreenTimeRules(null)).toEqual([]);
    expect(parseScreenTimeRules(undefined)).toEqual([]);
    expect(parseScreenTimeRules('')).toEqual([]);
    expect(parseScreenTimeRules('not json')).toEqual([]);
    expect(parseScreenTimeRules('{"not":"an array"}')).toEqual([]);
  });

  it('round-trips what serialize wrote', () => {
    const rules = [makeRule(), makeRule({ id: 'rule-2', thresholdMinutes: 90, title: 'Stretch' })];
    expect(parseScreenTimeRules(serializeScreenTimeRules(rules))).toEqual(rules);
  });

  it('drops a bad entry rather than discarding the whole list', () => {
    const raw = JSON.stringify([
      makeRule(),
      { id: 'rule-2', title: '', thresholdMinutes: 30 },
      { id: '', title: 'No id', thresholdMinutes: 30 },
      { id: 'rule-4', title: 'No threshold' },
      null,
      makeRule({ id: 'rule-5', title: 'Fine' }),
    ]);
    expect(parseScreenTimeRules(raw).map(r => r.id)).toEqual(['rule-1', 'rule-5']);
  });

  it('clamps a stored threshold that is out of range', () => {
    const raw = JSON.stringify([makeRule({ thresholdMinutes: 9999 })]);
    expect(parseScreenTimeRules(raw)[0].thresholdMinutes).toBe(SCREEN_TIME_THRESHOLD_MAX);
  });

  it('truncates an over-long title rather than rejecting the rule', () => {
    const raw = JSON.stringify([makeRule({ title: 'x'.repeat(500) })]);
    expect(parseScreenTimeRules(raw)[0].title).toHaveLength(SCREEN_TIME_RULE_TITLE_MAX_LENGTH);
  });

  it('reads a missing enabled flag as on, so an older stored rule keeps working', () => {
    const raw = JSON.stringify([{ id: 'rule-1', title: 'Walk', thresholdMinutes: 30 }]);
    expect(parseScreenTimeRules(raw)[0].enabled).toBe(true);
  });
});

describe('screenTimeSourceId / parseScreenTimeSourceId', () => {
  it('round-trips a day and a rule', () => {
    expect(parseScreenTimeSourceId(screenTimeSourceId('2026-08-28', 'rule-1')))
      .toEqual({ dayKey: '2026-08-28', ruleId: 'rule-1' });
  });

  it('refuses anything that is not both halves', () => {
    expect(parseScreenTimeSourceId(null)).toBeNull();
    expect(parseScreenTimeSourceId('')).toBeNull();
    expect(parseScreenTimeSourceId('no-separator')).toBeNull();
    expect(parseScreenTimeSourceId('#rule-1')).toBeNull();
    expect(parseScreenTimeSourceId('2026-08-28#')).toBeNull();
  });
});

describe('screenTimeRuleIdOf', () => {
  const task = (kind: Task['generatedKind'], sourceId: string | null) =>
    ({ generatedKind: kind, generatedSourceId: sourceId }) as Pick<Task, 'generatedKind' | 'generatedSourceId'>;

  it('reads the rule id off a screen-time task', () => {
    expect(screenTimeRuleIdOf(task('screenTime', '2026-08-28#rule-7'))).toBe('rule-7');
  });

  it('is null for a task of another kind carrying the same shape of id', () => {
    // The kind guard in generatedSourceOf. Weather uses an identical source id
    // format, so without it a weather task would answer as a screen-time one.
    expect(screenTimeRuleIdOf(task('weather', '2026-08-28#rule-7'))).toBeNull();
  });

  it('is null for an ordinary task', () => {
    expect(screenTimeRuleIdOf(task(null, null))).toBeNull();
  });
});

describe('armableRules', () => {
  it('hands over only what the monitor should watch', () => {
    const rules = [
      makeRule({ id: 'a', thresholdMinutes: 30 }),
      makeRule({ id: 'b', enabled: false }),
      makeRule({ id: 'c', thresholdMinutes: 0 }),
    ];
    expect(armableRules(rules)).toEqual([{ id: 'a', thresholdMinutes: 30 }]);
  });

  it('leaves a disabled rule out entirely rather than arming and ignoring it', () => {
    // An event the app would only discard is still an event iOS wakes an
    // extension for.
    expect(armableRules([makeRule({ enabled: false })])).toEqual([]);
  });

  it('carries no title — the OS is told a number, never what it is for', () => {
    expect(Object.keys(armableRules([makeRule()])[0]).sort()).toEqual(['id', 'thresholdMinutes']);
  });
});

describe('crossingWantsTask', () => {
  it('accepts a crossing for an enabled rule that has not fired today', () => {
    expect(crossingWantsTask(makeRule(), '2026-08-28')).toBe(true);
  });

  it('refuses a second crossing on the same day', () => {
    expect(crossingWantsTask(makeRule({ lastFiredDayKey: '2026-08-28' }), '2026-08-28')).toBe(false);
  });

  it('accepts again once the day has rolled over', () => {
    expect(crossingWantsTask(makeRule({ lastFiredDayKey: '2026-08-27' }), '2026-08-28')).toBe(true);
  });

  it('never fires a disabled rule, even for a crossing already reported', () => {
    // The monitor can still be armed from before the rule was switched off.
    expect(crossingWantsTask(makeRule({ enabled: false }), '2026-08-28')).toBe(false);
  });
});
