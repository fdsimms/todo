import {
  HEART_RATE_ZONE_SHARES,
  MAX_READING_GAP_SECONDS,
  describeMaxHeartRate,
  describeZoneBasis,
  formatZoneMinutes,
  heartRateSummary,
  heartRateZones,
  parseMaxHeartRate,
  parseWorkoutHeartRate,
  resolveMaxHeartRate,
  secondsInZones,
  zoneOf,
  zoneRows,
  type WorkoutHeartRate,
} from '../utils/heartRateZones';

const today = new Date(2026, 9, 18, 12);
const start = new Date(2026, 9, 14, 18, 0).getTime();
const workout = (samples: [number, number][], extra: Partial<WorkoutHeartRate> = {}): WorkoutHeartRate => ({
  startMs: start,
  endMs: start + 60 * 60_000,
  average: null,
  max: null,
  samples: samples.map(([seconds, bpm]) => ({ at: start + seconds * 1000, bpm })),
  ...extra,
});

describe('the maximum the zones are shares of', () => {
  it('is the typed figure when there is one, whatever the year of birth says', () => {
    expect(resolveMaxHeartRate(190, 1990, today)).toEqual({ bpm: 190, source: 'typed' });
    expect(resolveMaxHeartRate(190, null, today)).toEqual({ bpm: 190, source: 'typed' });
  });

  it('is 220 minus the age from the year of birth when nothing is typed, and says so', () => {
    const max = resolveMaxHeartRate(null, 1992, today);
    expect(max).toEqual({ bpm: 186, source: 'age' });
    expect(describeMaxHeartRate(max)).toBe('186, from age');
    expect(describeZoneBasis(max)).toContain('estimated from your age (220 minus age)');
    expect(describeZoneBasis(max)).toContain('186 bpm');
  });

  it('is nothing at all with neither, rather than a default age', () => {
    expect(resolveMaxHeartRate(null, null, today)).toBeNull();
    expect(describeMaxHeartRate(null)).toBe('Not set');
    expect(describeZoneBasis(null)).toMatch(/^To see time in zones/);
  });

  it('falls back to the estimate for a typed figure outside the bounds, and to none for an absurd age', () => {
    expect(resolveMaxHeartRate(40, 1992, today)).toEqual({ bpm: 186, source: 'age' });
    expect(resolveMaxHeartRate(null, 1890, today)).toBeNull();
    expect(resolveMaxHeartRate(null, 2030, today)).toBeNull();
  });

  it('reads a stored figure, and anything unreadable as none', () => {
    expect(parseMaxHeartRate('190')).toBe(190);
    expect(parseMaxHeartRate('187.6')).toBe(188);
    expect(parseMaxHeartRate('')).toBeNull();
    expect(parseMaxHeartRate(null)).toBeNull();
    expect(parseMaxHeartRate('fast')).toBeNull();
    expect(parseMaxHeartRate('400')).toBeNull();
  });

  it('labels a typed maximum as the person’s own, never as an estimate', () => {
    const typed = { bpm: 190, source: 'typed' as const };
    expect(describeMaxHeartRate(typed)).toBe('190');
    expect(describeZoneBasis(typed)).not.toMatch(/estimat/);
  });
});

describe('the zones', () => {
  it('are five, at 50, 60, 70, 80 and 90 percent, in whole beats with no gaps or overlaps', () => {
    expect(HEART_RATE_ZONE_SHARES).toEqual([0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(heartRateZones(186).map(z => [z.zone, z.low, z.high])).toEqual([
      [1, 93, 111],
      [2, 112, 130],
      [3, 131, 148],
      [4, 149, 167],
      [5, 168, 186],
    ]);
    // A round maximum, where floating point would put 120 a hair above itself.
    expect(heartRateZones(200).map(z => z.low)).toEqual([100, 120, 140, 160, 180]);
  });

  it('put a reading where its rounded beat falls, zone 5 taking anything above the maximum', () => {
    const zones = heartRateZones(186);
    expect(zoneOf(111.4, zones)).toBe(1);
    expect(zoneOf(111.6, zones)).toBe(2);
    expect(zoneOf(130, zones)).toBe(2);
    expect(zoneOf(131, zones)).toBe(3);
    expect(zoneOf(195, zones)).toBe(5);
    expect(zoneOf(92, zones)).toBeNull();
  });
});

describe('time in zones', () => {
  const zones = heartRateZones(186);

  it('gives each reading the time until the next one', () => {
    const read = workout([[0, 120], [30, 150], [60, 150], [90, 170]], { endMs: start + 120_000 });
    expect(secondsInZones(read, zones)).toEqual([0, 30, 0, 60, 30]);
  });

  it('leaves a silence longer than a minute in no zone, rather than filling it with the last number', () => {
    const read = workout([[0, 120], [600, 150]], { endMs: start + 660_000 });
    expect(secondsInZones(read, zones)).toEqual([0, MAX_READING_GAP_SECONDS, 0, 60, 0]);
  });

  it('ends the last reading at the workout’s end, and clips to its span', () => {
    const read = workout([[-20, 140], [0, 140], [50, 140]], { endMs: start + 70_000 });
    // The reading before the start counts only from the start; the last runs to the end.
    expect(secondsInZones(read, zones)[2]).toBe(70);
  });

  it('puts a reading below zone 1 in no zone', () => {
    expect(secondsInZones(workout([[0, 80], [30, 80]], { endMs: start + 60_000 }), zones)).toEqual([0, 0, 0, 0, 0]);
  });

  it('draws the rows zone 5 first, every bar on the same scale', () => {
    const read = workout([[0, 120], [30, 150], [60, 150], [90, 170]], { endMs: start + 120_000 });
    const rows = zoneRows(read, { bpm: 186, source: 'age' })!;
    expect(rows.map(r => r.label)).toEqual([
      'Zone 5 · 168–186', 'Zone 4 · 149–167', 'Zone 3 · 131–148', 'Zone 2 · 112–130', 'Zone 1 · 93–111',
    ]);
    expect(rows.map(r => r.fraction)).toEqual([0.25, 0.5, 0, 0.25, 0]);
    expect(rows[1].minutes).toBe('1 min');
    expect(rows[1].spoken).toBe('Zone 4, 149 to 167 beats per minute, 1 minute');
    expect(rows[2].spoken).toBe('Zone 3, 131 to 148 beats per minute, no time');
  });

  it('has no rows without a maximum, or without readings to divide', () => {
    const read = workout([[0, 120]]);
    expect(zoneRows(read, null)).toBeNull();
    expect(zoneRows(workout([], { average: 128, max: 171 }), { bpm: 186, source: 'typed' })).toBeNull();
  });

  it('writes minutes plainly, and a moment as under one', () => {
    expect(formatZoneMinutes(0)).toBe('0 min');
    expect(formatZoneMinutes(20)).toBe('<1 min');
    expect(formatZoneMinutes(150)).toBe('3 min');
  });
});

describe('the average and the maximum', () => {
  it('are Health’s own figures when it gave them', () => {
    expect(heartRateSummary(workout([[0, 100], [5, 200]], { average: 128.4, max: 171 }))).toEqual({ average: 128, max: 171 });
  });

  it('are worked out from the readings otherwise', () => {
    expect(heartRateSummary(workout([[0, 120], [5, 141], [10, 150]]))).toEqual({ average: 137, max: 150 });
  });

  it('are absent with nothing to work from, never zero', () => {
    expect(heartRateSummary(workout([]))).toEqual({ average: null, max: null });
  });
});

describe('reading what the bridge sent', () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it('reads the span, Health’s figures and the readings, oldest first', () => {
    const read = parseWorkoutHeartRate(JSON.stringify({
      start: iso(start), end: iso(start + 3_600_000), average: 128.4, max: 171,
      samples: [[start + 5000, 131], [start, 120]],
    }));
    expect(read).toEqual({
      startMs: start, endMs: start + 3_600_000, average: 128.4, max: 171,
      samples: [{ at: start, bpm: 120 }, { at: start + 5000, bpm: 131 }],
    });
  });

  it('drops a broken reading rather than reading it as zero', () => {
    const read = parseWorkoutHeartRate(JSON.stringify({
      start: iso(start), end: iso(start + 60_000),
      samples: [[start, 0], [start + 1000, 'fast'], [start + 2000, 999], ['then', 120], [start + 3000, 125]],
    }));
    expect(read?.samples).toEqual([{ at: start + 3000, bpm: 125 }]);
  });

  it('is nothing for every reason there is nothing to show', () => {
    expect(parseWorkoutHeartRate('null')).toBeNull();
    expect(parseWorkoutHeartRate('')).toBeNull();
    expect(parseWorkoutHeartRate('not json')).toBeNull();
    expect(parseWorkoutHeartRate(JSON.stringify({ start: iso(start), end: iso(start + 60_000), samples: [] }))).toBeNull();
    expect(parseWorkoutHeartRate(JSON.stringify({ start: 'x', end: iso(start), samples: [[start, 120]] }))).toBeNull();
  });
});
