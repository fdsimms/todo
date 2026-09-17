import type { Task, WeatherRule } from '../types';
import {
  defaultWeatherRules,
  parseWeatherRules,
  ruleMatchesToday,
  weatherRuleIdOf,
  weatherSourceId,
  parseWeatherSourceId,
  weatherWindowFor,
  describeWeatherWindow,
  weatherTaskTitle,
} from '../utils/weatherTasks';

/** A day of clear 70° hours, with `codes` overriding the ones named. */
function makeHours(codes: Record<number, number> = {}, temps: Record<number, number> = {}) {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    weatherCode: codes[hour] ?? 0,
    tempF: temps[hour] ?? 70,
  }));
}

/** `{ 14: 61, 15: 61 }` — the hours `from`..`to` inclusive, all at `code`. */
function run(from: number, to: number, code: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let h = from; h <= to; h++) out[h] = code;
  return out;
}

function makeRule(overrides: Partial<WeatherRule> = {}): WeatherRule {
  return {
    id: 'rule-1',
    condition: 'sunny',
    title: 'Put on sunscreen',
    enabled: true,
    lastFiredDayKey: null,
    lastAheadDayKey: null,
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

  it('ships both idempotency marks unspent', () => {
    expect(defaultWeatherRules().every(r => r.lastAheadDayKey === null)).toBe(true);
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

  // Every rule stored before the day-ahead pass existed is missing this, and
  // reads as "never fired ahead" rather than dropping the rule.
  it('reads a rule with no day-ahead mark as never having fired one', () => {
    const raw = JSON.stringify([{ id: 'rule-1', title: 'Bring an umbrella', condition: 'rainy', lastFiredDayKey: '2026-08-25' }]);
    const parsed = parseWeatherRules(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0].lastAheadDayKey).toBeNull();
    expect(parsed[0].lastFiredDayKey).toBe('2026-08-25');
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

describe('weatherWindowFor', () => {
  it('finds the run of hours the condition holds for', () => {
    expect(weatherWindowFor(makeHours(run(14, 17, 61)), 'rainy', 9)).toEqual({ startHour: 14, endHour: 18 });
  });

  it('skips a run that is already over and takes the next one', () => {
    const hours = makeHours({ ...run(3, 4, 61), ...run(15, 16, 61) });
    expect(weatherWindowFor(hours, 'rainy', 9)).toEqual({ startHour: 15, endHour: 17 });
  });

  it('keeps a run that is under way rather than skipping to the next', () => {
    const hours = makeHours({ ...run(8, 11, 61), ...run(15, 16, 61) });
    expect(weatherWindowFor(hours, 'rainy', 9)).toEqual({ startHour: 8, endHour: 12 });
  });

  it('is null when every run is behind us', () => {
    expect(weatherWindowFor(makeHours(run(3, 4, 61)), 'rainy', 9)).toBeNull();
  });

  it('is null for a condition no hour matches', () => {
    expect(weatherWindowFor(makeHours(run(14, 17, 61)), 'snowy', 9)).toBeNull();
  });

  // The hourly block degrades on its own — see WeatherSnapshot.todayHours.
  it('is null when there is no hourly forecast at all', () => {
    expect(weatherWindowFor(null, 'rainy', 9)).toBeNull();
    expect(weatherWindowFor([], 'rainy', 9)).toBeNull();
  });

  // Temperature conditions come off the same per-hour classification the sky
  // ones do, so a morning that warms up past the threshold has a window too.
  it('reads a temperature condition hour by hour', () => {
    const hours = makeHours({}, { 13: 88, 14: 90, 15: 87 });
    expect(weatherWindowFor(hours, 'hot', 9)).toEqual({ startHour: 13, endHour: 16 });
  });
});

describe('describeWeatherWindow', () => {
  it('says when it starts for weather running to the end of the day', () => {
    expect(describeWeatherWindow('rainy', { startHour: 14, endHour: 24 })).toBe('rain from 2pm');
  });

  it('says when it ends for weather already under way at midnight', () => {
    expect(describeWeatherWindow('snowy', { startHour: 0, endHour: 10 })).toBe('snow until 10am');
  });

  it('gives both ends for a window inside the day', () => {
    expect(describeWeatherWindow('rainy', { startHour: 14, endHour: 18 })).toBe('rain 2pm to 6pm');
  });

  it('says all day when it never lets up', () => {
    expect(describeWeatherWindow('hot', { startHour: 0, endHour: 24 })).toBe('heat all day');
  });

  it('names the rule\'s own condition, not the sky', () => {
    expect(describeWeatherWindow('cold', { startHour: 0, endHour: 9 })).toBe('cold until 9am');
  });

  // What the day-ahead pass writes the evening before. It is the one part of
  // the phrase that goes stale, and drift is what takes it back out.
  it('says tomorrow when asked to, in every shape', () => {
    expect(describeWeatherWindow('snowy', { startHour: 7, endHour: 11 }, true)).toBe('snow 7am to 11am tomorrow');
    expect(describeWeatherWindow('rainy', { startHour: 14, endHour: 24 }, true)).toBe('rain from 2pm tomorrow');
    expect(describeWeatherWindow('cold', { startHour: 0, endHour: 9 }, true)).toBe('cold until 9am tomorrow');
    expect(describeWeatherWindow('hot', { startHour: 0, endHour: 24 }, true)).toBe('heat all day tomorrow');
  });

  it('reads noon and midnight as 12, not 0', () => {
    expect(describeWeatherWindow('sunny', { startHour: 12, endHour: 24 })).toBe('sun from 12pm');
    expect(describeWeatherWindow('sunny', { startHour: 0, endHour: 1 })).toBe('sun until 1am');
  });
});

describe('weatherTaskTitle', () => {
  it('puts the window after the rule\'s own words', () => {
    expect(weatherTaskTitle('Put on sunscreen', 'sun from 11am')).toBe('Put on sunscreen (sun from 11am)');
  });

  // A forecast that can't say when leaves the title exactly as it always was,
  // rather than trailing an empty pair of brackets.
  it('is the rule title alone when there is no window', () => {
    expect(weatherTaskTitle('Put on sunscreen', null)).toBe('Put on sunscreen');
  });
});
