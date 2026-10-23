import {
  averageReading,
  formatReading,
  latestReading,
  parseBloodPressureInput,
  parseBloodPressureReadings,
  readingsSince,
} from '../utils/bloodPressureLog';

describe('parseBloodPressureInput', () => {
  it('reads two whole numbers', () => {
    expect(parseBloodPressureInput(' 118 ', '76')).toEqual({ systolic: 118, diastolic: 76 });
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
  const mk = (day: number, sys: number, dia: number) => ({ at: new Date(2026, 8, day, 8), systolic: sys, diastolic: dia });
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
