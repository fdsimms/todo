import type { Task, WeatherRule } from '../types';
import {
  defaultWeatherRules,
  parseWeatherRules,
  ruleMatchesToday,
  weatherRuleIdOf,
  weatherSourceId,
  parseWeatherSourceId,
} from '../utils/weatherTasks';

function makeRule(overrides: Partial<WeatherRule> = {}): WeatherRule {
  return {
    id: 'rule-1',
    condition: 'sunny',
    title: 'Put on sunscreen',
    enabled: true,
    lastFiredDayKey: null,
    ...overrides,
  };
}

describe('defaultWeatherRules', () => {
  it('ships three enabled rules covering sunny, rainy and cold', () => {
    const rules = defaultWeatherRules();
    expect(rules.map(r => r.condition).sort()).toEqual(['cold', 'rainy', 'sunny']);
    expect(rules.every(r => r.enabled)).toBe(true);
    expect(rules.every(r => r.lastFiredDayKey === null)).toBe(true);
  });

  it('gives each rule its own id', () => {
    const [a, b, c] = defaultWeatherRules();
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });
});

describe('parseWeatherRules', () => {
  it('round-trips a serialized rule list', () => {
    const rules = [makeRule(), makeRule({ id: 'rule-2', condition: 'rainy', title: 'Bring an umbrella' })];
    expect(parseWeatherRules(JSON.stringify(rules))).toEqual(rules);
  });

  it('reads a missing or malformed value as no rules saved', () => {
    expect(parseWeatherRules(null)).toEqual([]);
    expect(parseWeatherRules(undefined)).toEqual([]);
    expect(parseWeatherRules('')).toEqual([]);
    expect(parseWeatherRules('not json')).toEqual([]);
    expect(parseWeatherRules('{"not":"an array"}')).toEqual([]);
  });

  it('drops a rule with no title rather than discarding the whole list', () => {
    const rules = [makeRule(), { ...makeRule({ id: 'rule-2' }), title: '' }];
    const parsed = parseWeatherRules(JSON.stringify(rules));
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('rule-1');
  });

  it('falls back to a valid condition and fills a missing id', () => {
    const raw = JSON.stringify([{ title: 'Bring an umbrella', condition: 'blizzard' }]);
    const parsed = parseWeatherRules(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0].condition).toBe('sunny');
    expect(parsed[0].id).toBeTruthy();
  });

  it('defaults enabled to true unless explicitly false', () => {
    const raw = JSON.stringify([{ title: 'X' }, { title: 'Y', enabled: false }]);
    const [a, b] = parseWeatherRules(raw);
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(false);
  });
});

describe('weatherSourceId / parseWeatherSourceId', () => {
  it('round-trips a day key and rule id', () => {
    const sourceId = weatherSourceId('2026-08-26', 'rule-1');
    expect(sourceId).toBe('2026-08-26#rule-1');
    expect(parseWeatherSourceId(sourceId)).toEqual({ dayKey: '2026-08-26', ruleId: 'rule-1' });
  });

  it('is null for anything without a separator, or with an empty half', () => {
    expect(parseWeatherSourceId(null)).toBeNull();
    expect(parseWeatherSourceId('2026-08-26')).toBeNull();
    expect(parseWeatherSourceId('#rule-1')).toBeNull();
    expect(parseWeatherSourceId('2026-08-26#')).toBeNull();
  });
});

describe('weatherRuleIdOf', () => {
  it('reads the rule id off a weather task', () => {
    const task = { generatedKind: 'weather', generatedSourceId: '2026-08-26#rule-1' } as
      Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    expect(weatherRuleIdOf(task)).toBe('rule-1');
  });

  it('is null for any other kind of task, even one carrying a source id', () => {
    const task = { generatedKind: 'calendarReview', generatedSourceId: '2026-08-26#rule-1' } as
      Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    expect(weatherRuleIdOf(task)).toBeNull();
  });
});

describe('ruleMatchesToday', () => {
  it('matches when the condition is present and the rule is on', () => {
    expect(ruleMatchesToday(makeRule({ condition: 'sunny' }), ['sunny', 'hot'])).toBe(true);
  });

  it('does not match a condition that is absent today', () => {
    expect(ruleMatchesToday(makeRule({ condition: 'rainy' }), ['sunny', 'hot'])).toBe(false);
  });

  it('never matches a disabled rule, even on a matching day', () => {
    expect(ruleMatchesToday(makeRule({ condition: 'sunny', enabled: false }), ['sunny'])).toBe(false);
  });
});
