import { snapshotFromResponse } from '../services/weatherLookup';

jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => false }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));

// The shape Open-Meteo returns for the app's request: one past day, then today.
const body = {
  current: { time: '2026-10-08T14:15', temperature_2m: 61, weather_code: 61, is_day: 1 },
  daily: {
    time: ['2026-10-07', '2026-10-08', '2026-10-09'],
    weather_code: [63, 61, 0],
    temperature_2m_max: [58, 62, 70],
    temperature_2m_min: [49, 50, 52],
    precipitation_sum: [8.2, 3.1, 0],
  },
  hourly: {
    time: ['2026-10-08T09:00', '2026-10-09T09:00'],
    weather_code: [61, 0],
    temperature_2m: [55, 60],
    is_day: [1, 1],
  },
};

describe('snapshotFromResponse', () => {
  it('finds today by date, behind the past day the request asks for', () => {
    const s = snapshotFromResponse(body, 'now')!;
    expect(s.todayHighF).toBe(62);
    expect(s.todayWeatherCode).toBe(61);
    expect(s.tomorrow).toEqual({ weatherCode: 0, highF: 70, lowF: 52 });
    expect(s.todayHours).toEqual([{ hour: 9, weatherCode: 61, tempF: 55, isDay: true }]);
    expect(s.tomorrowHours).toEqual([{ hour: 9, weatherCode: 0, tempF: 60, isDay: true }]);
  });

  it('starts the forecast at today and carries each day\'s rain', () => {
    const s = snapshotFromResponse(body, 'now')!;
    expect(s.forecast?.map(d => d.dayKey)).toEqual(['2026-10-08', '2026-10-09']);
    expect(s.forecast?.[0].precipitationMm).toBe(3.1);
  });

  it('reads yesterday\'s and today\'s rain', () => {
    const s = snapshotFromResponse(body, 'now')!;
    expect(s.yesterdayPrecipitationMm).toBe(8.2);
    expect(s.todayPrecipitationMm).toBe(3.1);
  });

  it('still lines up on a response with no past day, and then knows no yesterday', () => {
    const noPast = {
      ...body,
      daily: {
        time: body.daily.time.slice(1),
        weather_code: body.daily.weather_code.slice(1),
        temperature_2m_max: body.daily.temperature_2m_max.slice(1),
        temperature_2m_min: body.daily.temperature_2m_min.slice(1),
      },
    };
    const s = snapshotFromResponse(noPast, 'now')!;
    expect(s.todayHighF).toBe(62);
    expect(s.yesterdayPrecipitationMm).toBeNull();
    expect(s.todayPrecipitationMm).toBeNull();
    expect(s.forecast?.[0].precipitationMm).toBeUndefined();
  });

  it('has no snapshot without a current reading', () => {
    expect(snapshotFromResponse({ daily: body.daily }, 'now')).toBeNull();
  });
});
