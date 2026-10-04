import type { Task } from '../types';
import type { ForecastDay } from '../services/weatherLookup';
import { weatherWaitChipText, canWaitForWeather, dayMatchesCondition, decideWeatherWait, weatherWaitLabel } from '../utils/weatherWait';

// dateUtils reads the day-reset setting; nothing here depends on it.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const CLEAR = 0;
const RAIN = 61;
const SNOW = 71;

function day(dayKey: string, weatherCode = CLEAR, highF = 70): ForecastDay {
  return { dayKey, weatherCode, highF, lowF: highF - 15 };
}

function makeTask(overrides: Partial<Task> = {}) {
  return {
    weatherWait: 'sunny',
    dueDate: null,
    deferUntil: null,
    completed: false,
    archived: false,
    recurrenceType: 'none',
    chainEnabled: false,
    seriesId: null,
    parentId: null,
    ...overrides,
  } as Parameters<typeof decideWeatherWait>[0];
}

// A local-midnight ISO, the way the date picker writes a day.
const iso = (key: string) => new Date(`${key}T00:00:00`).toISOString();

describe('dayMatchesCondition', () => {
  it('reads the sky from the code', () => {
    expect(dayMatchesCondition(day('2026-10-05', CLEAR), 'sunny')).toBe(true);
    expect(dayMatchesCondition(day('2026-10-05', RAIN), 'sunny')).toBe(false);
    expect(dayMatchesCondition(day('2026-10-05', RAIN), 'rainy')).toBe(true);
    expect(dayMatchesCondition(day('2026-10-05', SNOW), 'snowy')).toBe(true);
  });

  it('reads cold and hot off the high', () => {
    expect(dayMatchesCondition(day('2026-10-05', RAIN, 40), 'cold')).toBe(true);
    expect(dayMatchesCondition(day('2026-10-05', CLEAR, 60), 'cold')).toBe(false);
    expect(dayMatchesCondition(day('2026-10-05', CLEAR, 90), 'hot')).toBe(true);
  });
});

describe('canWaitForWeather', () => {
  it('accepts a plain one-off and refuses anything with a schedule of its own', () => {
    expect(canWaitForWeather(makeTask())).toBe(true);
    expect(canWaitForWeather(makeTask({ recurrenceType: 'daily' }))).toBe(false);
    expect(canWaitForWeather(makeTask({ chainEnabled: true }))).toBe(false);
    expect(canWaitForWeather(makeTask({ seriesId: 's1' }))).toBe(false);
    expect(canWaitForWeather(makeTask({ parentId: 'p1' }))).toBe(false);
  });
});

describe('decideWeatherWait', () => {
  const forecast = [day('2026-10-04', RAIN), day('2026-10-05', RAIN), day('2026-10-06', CLEAR), day('2026-10-07', CLEAR)];

  it('holds until the first matching day', () => {
    expect(decideWeatherWait(makeTask(), forecast, '2026-10-04')).toEqual({ kind: 'defer', dayKey: '2026-10-06', matched: true });
  });

  it('releases at once when today already matches', () => {
    expect(decideWeatherWait(makeTask(), [day('2026-10-04', CLEAR), ...forecast.slice(1)], '2026-10-04')).toEqual({ kind: 'release' });
  });

  it('moves the hold when the forecast changes', () => {
    const held = makeTask({ deferUntil: iso('2026-10-06') });
    const worse = [day('2026-10-04', RAIN), day('2026-10-05', RAIN), day('2026-10-06', RAIN), day('2026-10-07', CLEAR)];
    expect(decideWeatherWait(held, worse, '2026-10-04')).toEqual({ kind: 'defer', dayKey: '2026-10-07', matched: true });
  });

  it('releases once the held day arrives, whatever the forecast now says', () => {
    const held = makeTask({ deferUntil: iso('2026-10-06') });
    expect(decideWeatherWait(held, [day('2026-10-06', RAIN)], '2026-10-06')).toEqual({ kind: 'release' });
  });

  it('starts looking from the task\'s own date when that is later', () => {
    const dated = makeTask({ dueDate: iso('2026-10-07') });
    expect(decideWeatherWait(dated, forecast, '2026-10-04')).toEqual({ kind: 'defer', dayKey: '2026-10-07', matched: true });
  });

  it('keeps it hidden to the day after the forecast ends when nothing matches', () => {
    const wet = [day('2026-10-04', RAIN), day('2026-10-05', RAIN)];
    expect(decideWeatherWait(makeTask(), wet, '2026-10-04')).toEqual({ kind: 'defer', dayKey: '2026-10-06', matched: false });
  });

  it('decides nothing without a forecast', () => {
    expect(decideWeatherWait(makeTask(), [], '2026-10-04')).toEqual({ kind: 'none' });
  });

  it('ignores a task that is not waiting, finished, or not a one-off', () => {
    expect(decideWeatherWait(makeTask({ weatherWait: null }), forecast, '2026-10-04')).toEqual({ kind: 'none' });
    expect(decideWeatherWait(makeTask({ completed: true }), forecast, '2026-10-04')).toEqual({ kind: 'none' });
    expect(decideWeatherWait(makeTask({ archived: true }), forecast, '2026-10-04')).toEqual({ kind: 'none' });
    expect(decideWeatherWait(makeTask({ recurrenceType: 'weekly' }), forecast, '2026-10-04')).toEqual({ kind: 'none' });
  });
});

describe('weatherWaitLabel', () => {
  it('reads as plain English for every condition', () => {
    expect(weatherWaitLabel('sunny')).toBe('Waiting for a sunny day');
    expect(weatherWaitLabel('hot')).toBe('Waiting for a hot day');
  });
});

describe('weatherWaitChipText', () => {
  const base = { completed: false } as const;

  it('is null when nothing is waiting or the task is done', () => {
    expect(weatherWaitChipText({ ...base, weatherWait: null, deferUntil: null }, '2026-10-04')).toBeNull();
    expect(weatherWaitChipText({ completed: true, weatherWait: 'sunny', deferUntil: null }, '2026-10-04')).toBeNull();
  });

  it('names the wait while a day is picked or not yet decided', () => {
    expect(weatherWaitChipText({ ...base, weatherWait: 'sunny', deferUntil: iso('2026-10-08') }, '2026-10-04')).toBe('Waiting for a sunny day');
    expect(weatherWaitChipText({ ...base, weatherWait: 'rainy', deferUntil: null }, '2026-10-04')).toBe('Waiting for a rainy day');
  });

  it('says so when the hold is the look-again one past the forecast', () => {
    expect(weatherWaitChipText({ ...base, weatherWait: 'sunny', deferUntil: iso('2026-10-18') }, '2026-10-04'))
      .toBe('Waiting for a sunny day (none in the next 14 days)');
  });
});
