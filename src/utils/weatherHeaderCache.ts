import type { WeatherSnapshot } from '../services/weatherLookup';

/**
 * The reading kept on disk for Today's header chip: the snapshot and the
 * logical day it was read for. The day travels with it because a reading from
 * yesterday must not be shown as today's, and the chip checks it the same way
 * it checks a live snapshot.
 */
export interface CachedWeather {
  snapshot: WeatherSnapshot;
  dayKey: string;
}

/**
 * Reads the stored value back. Anything that doesn't have the fields the chip
 * draws from is treated as no cache, since a bad row should cost one frame of
 * waiting rather than a chip reading "NaN°".
 */
export function parseCachedWeather(raw: string | null): CachedWeather | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const s = parsed?.snapshot;
    if (
      typeof parsed?.dayKey !== 'string'
      || !s
      || typeof s.weatherCode !== 'number'
      || typeof s.tempF !== 'number'
      || !Number.isFinite(s.tempF)
    ) return null;
    return { snapshot: s as WeatherSnapshot, dayKey: parsed.dayKey };
  } catch {
    return null;
  }
}
