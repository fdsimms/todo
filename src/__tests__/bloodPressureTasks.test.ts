import type { Task } from '../types';
import {
  BLOOD_PRESSURE_EVERY_DAYS_MAX,
  BLOOD_PRESSURE_EVERY_DAYS_MIN,
  DEFAULT_BLOOD_PRESSURE_EVERY_DAYS,
  bloodPressureDayKey,
  bloodPressureDeclineHolds,
  bloodPressureNotes,
  clampBloodPressureEveryDays,
  wantsBloodPressure,
} from '../utils/bloodPressureTasks';

function generated(kind: string | null, sourceId: string | null) {
  return { generatedKind: kind, generatedSourceId: sourceId } as Pick<Task, 'generatedKind' | 'generatedSourceId'>;
}

describe('clampBloodPressureEveryDays', () => {
  it('leaves a sensible value alone and clamps the ends', () => {
    expect(clampBloodPressureEveryDays(7)).toBe(7);
    expect(clampBloodPressureEveryDays(0)).toBe(BLOOD_PRESSURE_EVERY_DAYS_MIN);
    expect(clampBloodPressureEveryDays(365)).toBe(BLOOD_PRESSURE_EVERY_DAYS_MAX);
  });

  it('rounds, and falls back to the default for a non-number', () => {
    expect(clampBloodPressureEveryDays(6.6)).toBe(7);
    expect(clampBloodPressureEveryDays(Number.NaN)).toBe(DEFAULT_BLOOD_PRESSURE_EVERY_DAYS);
  });
});

describe('wantsBloodPressure', () => {
  it('asks only when the window holds no reading', () => {
    expect(wantsBloodPressure([])).toBe(true);
    expect(wantsBloodPressure([{ at: new Date(2026, 9, 20, 8) }])).toBe(false);
  });
});

describe('bloodPressureDayKey', () => {
  it('reads the day key off its own kind only', () => {
    expect(bloodPressureDayKey(generated('bloodPressureLog', '2026-10-24'))).toBe('2026-10-24');
    expect(bloodPressureDayKey(generated('weighIn', '2026-10-24'))).toBeNull();
    expect(bloodPressureDayKey(generated(null, null))).toBeNull();
  });
});

describe('bloodPressureDeclineHolds', () => {
  it('holds for the whole window from the day it was deleted', () => {
    expect(bloodPressureDeclineHolds('2026-10-08', '2026-10-08', 7)).toBe(true);
    expect(bloodPressureDeclineHolds('2026-10-08', '2026-10-14', 7)).toBe(true);
    expect(bloodPressureDeclineHolds('2026-10-08', '2026-10-15', 7)).toBe(false);
  });

  it('never holds without a decline, and never past the window for a clock set back', () => {
    expect(bloodPressureDeclineHolds(null, '2026-10-08', 7)).toBe(false);
    expect(bloodPressureDeclineHolds('2026-10-20', '2026-10-08', 7)).toBe(false);
  });
});

describe('bloodPressureNotes', () => {
  it('states the gap and nothing else', () => {
    expect(bloodPressureNotes(1)).toBe('Nothing recorded in Apple Health today.');
    expect(bloodPressureNotes(7)).toBe('Nothing recorded in Apple Health in the last 7 days.');
  });
});
