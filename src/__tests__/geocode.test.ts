/**
 * Tests for src/services/geocode.ts and the destination forecast beside it.
 *
 * What matters here is not the parsing so much as the two refusals every
 * integration in this app owes: demo mode, and this feature's own switch. Both
 * calls are keyless, so nothing else would stop them.
 */

import { geocodePlace } from '../services/geocode';
import { fetchDestinationForecast } from '../services/weatherLookup';
import { isDemoModeActive } from '../utils/demoState';

const settings = { destinationForecastEnabled: true };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));

jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));
const demoMock = isDemoModeActive as jest.MockedFunction<typeof isDemoModeActive>;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  settings.destinationForecastEnabled = true;
  demoMock.mockReturnValue(false);
  fetchSpy = jest.spyOn(global, 'fetch' as never);
});
afterEach(() => { fetchSpy.mockRestore(); });

const PLACE = { results: [{ latitude: 38.72, longitude: -9.14, name: 'Lisbon' }] };
const DAILY = {
  daily: {
    time: ['2026-11-03', '2026-11-04'],
    weather_code: [0, 61],
    temperature_2m_min: [50, 52],
    temperature_2m_max: [65, 63],
  },
};

describe('geocodePlace', () => {
  it('returns the first match', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(PLACE));
    await expect(geocodePlace('Lisbon')).resolves.toEqual({
      latitude: 38.72, longitude: -9.14, name: 'Lisbon',
    });
  });

  it('asks nothing in demo mode', async () => {
    // A demo trip's destination is invented, and looking it up would put real
    // traffic on the network about fiction.
    demoMock.mockReturnValue(true);
    await expect(geocodePlace('Lisbon')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks nothing while the switch is off', async () => {
    // Keyless, so "no key, no traffic" is not the privacy answer here.
    settings.destinationForecastEnabled = false;
    await expect(geocodePlace('Lisbon')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks nothing for a blank destination', async () => {
    await expect(geocodePlace('   ')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is null when nothing matches, or the response is bad', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ results: [] }));
    await expect(geocodePlace('Nowhere')).resolves.toBeNull();
    fetchSpy.mockResolvedValue(jsonResponse({}, 500));
    await expect(geocodePlace('Lisbon')).resolves.toBeNull();
    fetchSpy.mockRejectedValue(new Error('offline'));
    await expect(geocodePlace('Lisbon')).resolves.toBeNull();
  });
});

describe('fetchDestinationForecast', () => {
  const at = { latitude: 38.72, longitude: -9.14 };

  it('returns one row per readable day', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(DAILY));
    await expect(fetchDestinationForecast(at, '2026-11-03', '2026-11-04')).resolves.toEqual([
      { dayKey: '2026-11-03', weatherCode: 0, lowF: 50, highF: 65 },
      { dayKey: '2026-11-04', weatherCode: 61, lowF: 52, highF: 63 },
    ]);
  });

  it('carries the demo refusal and the switch of its own', async () => {
    // The coordinates only reach here via geocodePlace, which checks both, but
    // a second reader that skipped the check would be a second way to call out.
    demoMock.mockReturnValue(true);
    await expect(fetchDestinationForecast(at, '2026-11-03', '2026-11-04')).resolves.toBeNull();
    demoMock.mockReturnValue(false);
    settings.destinationForecastEnabled = false;
    await expect(fetchDestinationForecast(at, '2026-11-03', '2026-11-04')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops a day missing any of its three readings rather than guessing', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      daily: {
        time: ['2026-11-03', '2026-11-04'],
        weather_code: [0, null],
        temperature_2m_min: [50, 52],
        temperature_2m_max: [65, 63],
      },
    }));
    const days = await fetchDestinationForecast(at, '2026-11-03', '2026-11-04');
    expect(days).toHaveLength(1);
  });

  it('is null when the span reaches past what the forecast covers', async () => {
    // Not an error: the line simply says less. Nothing pads or extrapolates.
    fetchSpy.mockResolvedValue(jsonResponse({ daily: { time: [] } }));
    await expect(fetchDestinationForecast(at, '2027-11-03', '2027-11-10')).resolves.toBeNull();
  });
});
