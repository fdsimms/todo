import {
  averageReading,
  bloodPressureDomain,
  bloodPressureTicks,
  readingSegments,
  formatReading,
  latestReading,
  parseBloodPressureInput,
  parseBloodPressureReadings,
  readingsSince,
} from '../utils/bloodPressureLog';

describe('parseBloodPressureInput', () => {
  it('reads two whole numbers', () => {
    expect(parseBloodPressureInput(' 118 ', '76')).toEqual({ systolic: 118, diastolic: 76, pulse: null });
  });
  it('refuses blanks, decimals and stray text', () => {
    expect(parseBloodPressureInput('', '76')).toBeNull();
    expect(parseBloodPressureInput('118.5', '76')).toBeNull();
    expect(parseBloodPressureInput('118', '76mm')).toBeNull();
    expect(parseBloodPressureInput('-118', '76')).toBeNull();
  });
  it('refuses a diastolic at or above the systolic, and absurd values', () => {
    expect(parseBloodPressureInput('76', '118')).toBeNull();
    expect(parseBloodPressureInput('100', '100')).toBeNull();
    expect(parseBloodPressureInput('1180', '76')).toBeNull();
    expect(parseBloodPressureInput('30', '20')).toBeNull();
  });
});

describe('pulse', () => {
  it('is optional, but a typed pulse that is not one refuses the reading', () => {
    expect(parseBloodPressureInput('118', '76', '64')).toEqual({ systolic: 118, diastolic: 76, pulse: 64 });
    expect(parseBloodPressureInput('118', '76', '  ')?.pulse).toBeNull();
    expect(parseBloodPressureInput('118', '76', '6')).toBeNull();
    expect(parseBloodPressureInput('118', '76', 'abc')).toBeNull();
  });
  it('is read back when present and null otherwise', () => {
    const out = parseBloodPressureReadings(JSON.stringify([
      { at: '2026-09-10T08:00:00.000Z', sys: 118, dia: 76, pulse: 64 },
      { at: '2026-09-10T09:00:00.000Z', sys: 120, dia: 80 },
    ]));
    expect(out.map(r => r.pulse)).toEqual([64, null]);
  });
});

describe('parseBloodPressureReadings', () => {
  it('parses and sorts oldest first', () => {
    const json = JSON.stringify([
      { at: '2026-09-10T20:00:00.000Z', sys: 124, dia: 80 },
      { at: '2026-09-10T08:00:00.000Z', sys: 118, dia: 76 },
    ]);
    const out = parseBloodPressureReadings(json);
    expect(out.map(formatReading)).toEqual(['118/76', '124/80']);
    expect(latestReading(out)?.systolic).toBe(124);
  });
  it('drops malformed and implausible entries', () => {
    const json = JSON.stringify([
      { at: 'nope', sys: 118, dia: 76 },
      { at: '2026-09-10T08:00:00.000Z', sys: 'x', dia: 76 },
      { at: '2026-09-10T08:00:00.000Z', sys: 70, dia: 90 },
      null,
      { at: '2026-09-10T09:00:00.000Z', sys: 120, dia: 80 },
    ]);
    expect(parseBloodPressureReadings(json)).toHaveLength(1);
  });
  it('answers empty for garbage', () => {
    expect(parseBloodPressureReadings('not json')).toEqual([]);
    expect(parseBloodPressureReadings('{}')).toEqual([]);
    expect(latestReading([])).toBeNull();
  });
});

describe('range and average', () => {
  const mk = (day: number, sys: number, dia: number) => ({ at: new Date(2026, 8, day, 8), systolic: sys, diastolic: dia, pulse: null });
  const readings = [mk(1, 130, 85), mk(8, 120, 80), mk(10, 118, 76)];
  it('keeps readings at or after the start', () => {
    expect(readingsSince(readings, new Date(2026, 8, 8, 8))).toHaveLength(2);
    expect(readingsSince(readings, new Date(2026, 8, 1))).toHaveLength(3);
  });
  it('averages each half to whole mmHg, and is null for none', () => {
    expect(averageReading(readings)).toEqual({ systolic: 123, diastolic: 80 });
    expect(averageReading([])).toBeNull();
  });
});

describe('chart helpers', () => {
  const r = (day: number, sys: number, dia: number) => ({ at: new Date(2026, 8, day, 8), systolic: sys, diastolic: dia, pulse: null });
  it('pads the domain to tens and never goes narrower than 40', () => {
    expect(bloodPressureDomain([])).toBeNull();
    const d = bloodPressureDomain([r(1, 118, 76), r(2, 124, 80)])!;
    expect(d.min % 10).toBe(0);
    expect(d.max % 10).toBe(0);
    expect(d.min).toBeLessThanOrEqual(70);
    expect(d.max).toBeGreaterThanOrEqual(130);
    expect(d.max - d.min).toBeGreaterThanOrEqual(40);
    expect(d.min).toBeGreaterThanOrEqual(0);
  });
  it('labels the axis at round numbers inside the domain', () => {
    const ticks = bloodPressureTicks({ min: 60, max: 140 });
    expect(ticks).toEqual([60, 80, 100, 120, 140]);
  });
  it('breaks a line across a gap longer than two weeks, and not across a week', () => {
    expect(readingSegments([r(1, 120, 80), r(8, 120, 80)])).toHaveLength(1);
    expect(readingSegments([r(1, 120, 80), r(25, 120, 80)])).toHaveLength(2);
    expect(readingSegments([])).toEqual([]);
  });
});
