import {
  parseSunAnchor, formatSunAnchor, describeSunAnchor, shortSunAnchor, describeSunOffset,
  roundSunLocation, isSunLocation, solarEvents, sunAnchorHHMM, windowBounds, hasSunAnchor,
  clampSunOffset, SUN_OFFSET_LIMIT,
} from '../utils/sunTimes';

const minutesApart = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60000;

describe('parseSunAnchor / formatSunAnchor', () => {
  it('reads the bare events and signed offsets', () => {
    expect(parseSunAnchor('sunset')).toEqual({ event: 'sunset', offsetMinutes: 0 });
    expect(parseSunAnchor('sunrise+15')).toEqual({ event: 'sunrise', offsetMinutes: 15 });
    expect(parseSunAnchor('sunset-30')).toEqual({ event: 'sunset', offsetMinutes: -30 });
  });

  it('refuses anything else, and an offset past the limit', () => {
    expect(parseSunAnchor(null)).toBeNull();
    expect(parseSunAnchor('')).toBeNull();
    expect(parseSunAnchor('18:30')).toBeNull();
    expect(parseSunAnchor('dusk')).toBeNull();
    expect(parseSunAnchor('sunset+')).toBeNull();
    expect(parseSunAnchor(`sunset-${SUN_OFFSET_LIMIT + 1}`)).toBeNull();
    expect(parseSunAnchor(`sunset-${SUN_OFFSET_LIMIT}`)).toEqual({ event: 'sunset', offsetMinutes: -SUN_OFFSET_LIMIT });
  });

  it('round-trips, writing a zero offset as the bare event', () => {
    for (const text of ['sunrise', 'sunset', 'sunrise-45', 'sunset+90']) {
      expect(formatSunAnchor(parseSunAnchor(text)!)).toBe(text);
    }
    expect(formatSunAnchor({ event: 'sunset', offsetMinutes: 0 })).toBe('sunset');
    expect(parseSunAnchor('sunset-0')).toEqual({ event: 'sunset', offsetMinutes: 0 });
  });

  it('clamps an offset written past the limit rather than storing one it would refuse to read', () => {
    expect(formatSunAnchor({ event: 'sunset', offsetMinutes: 500 })).toBe(`sunset+${SUN_OFFSET_LIMIT}`);
    expect(clampSunOffset(-999)).toBe(-SUN_OFFSET_LIMIT);
    expect(clampSunOffset(14.6)).toBe(15);
  });
});

describe('describing an anchor', () => {
  it('says it in words', () => {
    expect(describeSunAnchor({ event: 'sunset', offsetMinutes: 0 })).toBe('Sunset');
    expect(describeSunAnchor({ event: 'sunset', offsetMinutes: -30 })).toBe('30 min before sunset');
    expect(describeSunAnchor({ event: 'sunrise', offsetMinutes: 75 })).toBe('1 hr 15 min after sunrise');
    expect(describeSunAnchor({ event: 'sunrise', offsetMinutes: 120 })).toBe('2 hr after sunrise');
  });

  it('has a compact form for a pill', () => {
    expect(shortSunAnchor({ event: 'sunrise', offsetMinutes: 0 })).toBe('Sunrise');
    expect(shortSunAnchor({ event: 'sunset', offsetMinutes: -30 })).toBe('Sunset −30m');
    expect(shortSunAnchor({ event: 'sunrise', offsetMinutes: 60 })).toBe('Sunrise +1h');
    expect(shortSunAnchor({ event: 'sunrise', offsetMinutes: 75 })).toBe('Sunrise +1h 15m');
  });

  it('labels the stepper value', () => {
    expect(describeSunOffset(0, 'sunset')).toBe('At sunset');
    expect(describeSunOffset(0, 'sunrise')).toBe('At sunrise');
    expect(describeSunOffset(-45, 'sunset')).toBe('45 min before');
    expect(describeSunOffset(90, 'sunrise')).toBe('1 hr 30 min after');
  });
});

describe('locations', () => {
  it('rounds to about a kilometer', () => {
    expect(roundSunLocation({ latitude: 40.712776, longitude: -74.005974 })).toEqual({ latitude: 40.71, longitude: -74.01 });
  });

  it('accepts only a finite coordinate on the globe', () => {
    expect(isSunLocation({ latitude: 40.71, longitude: -74.01 })).toBe(true);
    expect(isSunLocation({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isSunLocation({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isSunLocation({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isSunLocation({ latitude: '40', longitude: 0 })).toBe(false);
    expect(isSunLocation(null)).toBe(false);
  });
});

describe('solarEvents', () => {
  // Reference times from NOAA's solar calculator, in UTC. The equation is good
  // to about a minute, so the tolerance is two.
  it('matches New York at the June solstice', () => {
    const { sunrise, sunset } = solarEvents(2026, 5, 21, { latitude: 40.71, longitude: -74.01 });
    expect(minutesApart(sunrise!, new Date(Date.UTC(2026, 5, 21, 9, 25)))).toBeLessThanOrEqual(2);
    expect(minutesApart(sunset!, new Date(Date.UTC(2026, 5, 22, 0, 31)))).toBeLessThanOrEqual(2);
  });

  it('matches London at the December solstice', () => {
    const { sunrise, sunset } = solarEvents(2026, 11, 21, { latitude: 51.51, longitude: -0.13 });
    expect(minutesApart(sunrise!, new Date(Date.UTC(2026, 11, 21, 8, 4)))).toBeLessThanOrEqual(2);
    expect(minutesApart(sunset!, new Date(Date.UTC(2026, 11, 21, 15, 54)))).toBeLessThanOrEqual(2);
  });

  it('matches Sydney, south of the equator and east of Greenwich', () => {
    const { sunrise, sunset } = solarEvents(2026, 0, 15, { latitude: -33.87, longitude: 151.21 });
    // 05:59 and 20:09 AEDT (UTC+11).
    expect(minutesApart(sunrise!, new Date(Date.UTC(2026, 0, 14, 18, 59)))).toBeLessThanOrEqual(2);
    expect(minutesApart(sunset!, new Date(Date.UTC(2026, 0, 15, 9, 9)))).toBeLessThanOrEqual(2);
  });

  it('has neither event on a polar day or a polar night', () => {
    const tromsoSummer = solarEvents(2026, 5, 21, { latitude: 69.65, longitude: 18.96 });
    expect(tromsoSummer).toEqual({ sunrise: null, sunset: null });
    const tromsoWinter = solarEvents(2026, 11, 21, { latitude: 69.65, longitude: 18.96 });
    expect(tromsoWinter).toEqual({ sunrise: null, sunset: null });
  });
});

describe('resolving an anchor on a logical day', () => {
  // A place whose solar time roughly matches this process's clock, so the
  // resolved "HH:MM" means the same thing whichever zone the suite runs in
  // (CI runs it in UTC+14 as well as UTC).
  const dayStart = new Date(2026, 8, 22); // the September equinox, local midnight
  const offsetHours = -dayStart.getTimezoneOffset() / 60;
  const longitude = ((offsetHours * 15 + 540) % 360) - 180;
  const here = { latitude: 0, longitude };
  const minutesOf = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  it('lands sunrise and sunset near six on the equator at the equinox', () => {
    const rise = sunAnchorHHMM('sunrise', dayStart, here)!;
    const set = sunAnchorHHMM('sunset', dayStart, here)!;
    expect(Math.abs(minutesOf(rise) - 6 * 60)).toBeLessThanOrEqual(20);
    expect(Math.abs(minutesOf(set) - 18 * 60)).toBeLessThanOrEqual(20);
  });

  it('applies the offset in minutes', () => {
    const set = minutesOf(sunAnchorHHMM('sunset', dayStart, here)!);
    expect(minutesOf(sunAnchorHHMM('sunset-30', dayStart, here)!)).toBe(set - 30);
    expect(minutesOf(sunAnchorHHMM('sunset+45', dayStart, here)!)).toBe(set + 45);
  });

  it('answers null without a location or a readable anchor', () => {
    expect(sunAnchorHHMM('sunset', dayStart, null)).toBeNull();
    expect(sunAnchorHHMM(null, dayStart, here)).toBeNull();
    expect(sunAnchorHHMM('teatime', dayStart, here)).toBeNull();
  });

  it('answers null on a day the sun does not set', () => {
    expect(sunAnchorHHMM('sunset', new Date(2026, 5, 21), { latitude: 78.22, longitude: 15.65 })).toBeNull();
  });

  it('moves with the day it is asked about', () => {
    const north = { latitude: 52, longitude };
    const june = minutesOf(sunAnchorHHMM('sunset', new Date(2026, 5, 21), north)!);
    const december = minutesOf(sunAnchorHHMM('sunset', new Date(2026, 11, 21), north)!);
    expect(june - december).toBeGreaterThan(200);
  });
});

describe('windowBounds', () => {
  const dayStart = new Date(2026, 8, 22);
  const longitude = ((-dayStart.getTimezoneOffset() / 60) * 15 + 540) % 360 - 180;
  const here = { latitude: 0, longitude };

  it('passes a plain window straight through', () => {
    expect(windowBounds({ windowStart: '08:00', windowEnd: '17:00' }, dayStart, here))
      .toEqual({ start: '08:00', end: '17:00' });
  });

  it('resolves each anchored bound and leaves the other alone', () => {
    const bounds = windowBounds(
      { windowStart: '08:00', windowEnd: '18:00', windowStartSun: null, windowEndSun: 'sunset-30' },
      dayStart, here,
    );
    expect(bounds.start).toBe('08:00');
    expect(bounds.end).toBe(sunAnchorHHMM('sunset-30', dayStart, here));
  });

  it('falls back to the stored clock time when the anchor cannot be resolved', () => {
    expect(windowBounds(
      { windowStart: '19:02', windowEnd: null, windowStartSun: 'sunset', windowEndSun: null },
      dayStart, null,
    )).toEqual({ start: '19:02', end: null });
  });

  it('knows whether a window follows the sun at all', () => {
    expect(hasSunAnchor({ windowStartSun: null, windowEndSun: null })).toBe(false);
    expect(hasSunAnchor({ windowStartSun: 'sunrise', windowEndSun: null })).toBe(true);
    expect(hasSunAnchor({ windowStartSun: 'nonsense', windowEndSun: undefined })).toBe(false);
  });
});
