import type { ForecastDay } from '../services/weatherLookup';
import {
  describeForecastGap,
  describeTripForecast,
  summarizeTripForecast,
} from '../utils/tripForecast';

const day = (over: Partial<ForecastDay> = {}): ForecastDay => ({
  dayKey: '2026-11-03',
  weatherCode: 0,
  lowF: 50,
  highF: 65,
  ...over,
});

describe('summarizeTripForecast', () => {
  it('is null with no days', () => {
    expect(summarizeTripForecast([])).toBeNull();
  });

  it('takes the range across the whole span, not a per-day figure', () => {
    const f = summarizeTripForecast([
      day({ lowF: 50, highF: 65 }),
      day({ lowF: 41, highF: 72 }),
    ])!;
    expect(f.lowF).toBe(41);
    expect(f.highF).toBe(72);
    expect(f.dayCount).toBe(2);
  });

  it('counts rain and snow days separately', () => {
    const f = summarizeTripForecast([
      day({ weatherCode: 61 }),
      day({ weatherCode: 71 }),
      day({ weatherCode: 0 }),
    ])!;
    expect(f.rainDays).toBe(1);
    expect(f.snowDays).toBe(1);
  });
});

describe('describeTripForecast', () => {
  const clear = summarizeTripForecast([day(), day(), day()]);

  it('says nothing without a forecast', () => {
    expect(describeTripForecast(null, 'Lisbon')).toBeNull();
  });

  it('names the place and states the range', () => {
    expect(describeTripForecast(clear, 'Lisbon')).toBe('Lisbon, 50 to 65°F');
  });

  it('drops the place when there is none to name', () => {
    expect(describeTripForecast(clear, null)).toBe('50 to 65°F');
  });

  it('never says a trip is clear', () => {
    // No rain in the rows means the clause is dropped, not replaced with a
    // reassurance the forecast cannot support.
    expect(describeTripForecast(clear, 'Lisbon')).not.toContain('no rain');
    expect(describeTripForecast(clear, 'Lisbon')).not.toContain('clear');
  });

  it('counts the days it saw, not the trip', () => {
    const f = summarizeTripForecast([
      day({ weatherCode: 61 }), day({ weatherCode: 61 }), day(), day(),
    ]);
    expect(describeTripForecast(f, 'Lisbon')).toBe('Lisbon, 50 to 65°F, rain on 2 of 4 days');
  });

  it('says every day rather than counting all of them', () => {
    const f = summarizeTripForecast([day({ weatherCode: 61 }), day({ weatherCode: 63 })]);
    expect(describeTripForecast(f, 'Lisbon')).toBe('Lisbon, 50 to 65°F, rain every day');
  });

  it('names snow ahead of rain when both fall', () => {
    // The more consequential of the two to pack for, and a line naming both
    // reads as a list rather than as a warning.
    const f = summarizeTripForecast([day({ weatherCode: 71 }), day({ weatherCode: 61 })]);
    expect(describeTripForecast(f, 'Reykjavik')).toContain('snow');
    expect(describeTripForecast(f, 'Reykjavik')).not.toContain('rain');
  });

  it('calls out a cold or hot trip when nothing is falling', () => {
    const cold = summarizeTripForecast([day({ lowF: 20, highF: 38 })]);
    expect(describeTripForecast(cold, 'Oslo')).toBe('Oslo, 20 to 38°F, cold throughout');
    const hot = summarizeTripForecast([day({ lowF: 88, highF: 101 })]);
    expect(describeTripForecast(hot, 'Phoenix')).toBe('Phoenix, 88 to 101°F, hot throughout');
  });

  it('converts for a reader who asked for metric', () => {
    expect(describeTripForecast(clear, 'Lisbon', true)).toBe('Lisbon, 10 to 18°C');
  });
});

describe('describeForecastGap', () => {
  const f = summarizeTripForecast([day(), day(), day(), day(), day()]);

  it('says nothing when the forecast reached the whole trip', () => {
    expect(describeForecastGap(f, 5)).toBeNull();
    expect(describeForecastGap(f, 3)).toBeNull();
  });

  it('says nothing without a forecast or a span to compare against', () => {
    expect(describeForecastGap(null, 7)).toBeNull();
    expect(describeForecastGap(f, null)).toBeNull();
  });

  it('names which part of the trip it could see', () => {
    // Open-Meteo forecasts about a fortnight out, so a trip further away is
    // answered in part and the reader has to be told which part.
    expect(describeForecastGap(f, 9)).toBe('Forecast reaches the first 5 of 9 days.');
  });
});
