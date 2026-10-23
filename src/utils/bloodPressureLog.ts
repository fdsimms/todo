/**
 * Blood pressure: reading one back off the Health wire, typing one in, and the
 * few figures that may honestly be said about a run of them.
 *
 * Same stance as `weightLog.ts`, and for the same reason: Health is the record
 * and this holds no state. **Nothing here interprets a body.** There is no
 * "normal", "elevated" or "high", no category, no colour for a number, no
 * rule metric, no generated task. A reading is two numbers somebody's cuff
 * showed, and the app writes them down and reads them back. `averageReading`
 * is arithmetic over readings already on screen, and that is as far as it goes.
 */

/** One reading, in whole mmHg. */
export interface BloodPressureReading {
  at: Date;
  systolic: number;
  diastolic: number;
}

/** Bounds mirrored by the native write. An absurdity check for a mistyped digit, not a judgement. */
export const MIN_SYSTOLIC = 40;
export const MAX_SYSTOLIC = 300;
export const MIN_DIASTOLIC = 20;
export const MAX_DIASTOLIC = 200;

/** True when the pair could be a reading at all. */
export function isPlausibleReading(systolic: number, diastolic: number): boolean {
  return (
    Number.isInteger(systolic) && Number.isInteger(diastolic) &&
    systolic >= MIN_SYSTOLIC && systolic <= MAX_SYSTOLIC &&
    diastolic >= MIN_DIASTOLIC && diastolic <= MAX_DIASTOLIC &&
    diastolic < systolic
  );
}

/**
 * Read the two typed fields, or null if they aren't a reading. Whole numbers
 * only: a cuff shows whole numbers, and a decimal or a stray unit is a typo
 * worth refusing rather than rounding into somebody's record.
 */
export function parseBloodPressureInput(
  systolicText: string,
  diastolicText: string,
): { systolic: number; diastolic: number } | null {
  const whole = (text: string): number | null => {
    const trimmed = text.trim();
    return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null;
  };
  const systolic = whole(systolicText);
  const diastolic = whole(diastolicText);
  if (systolic === null || diastolic === null) return null;
  return isPlausibleReading(systolic, diastolic) ? { systolic, diastolic } : null;
}

/** `118/76`, the way a cuff and a doctor write it. */
export function formatReading(reading: { systolic: number; diastolic: number }): string {
  return `${reading.systolic}/${reading.diastolic}`;
}

/**
 * The JSON `readBloodPressureSeries` returns, as readings oldest first. A
 * malformed entry, or a pair no reading could be, is dropped rather than shown:
 * a wrong figure is worse than a missing one. An empty answer covers a refused
 * read, a device with no Health and nothing recorded alike, and that is
 * deliberate (`docs/arch/health-data.md`).
 */
export function parseBloodPressureReadings(json: string): BloodPressureReading[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: BloodPressureReading[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { at, sys, dia } = entry as Record<string, unknown>;
      if (typeof at !== 'string' || typeof sys !== 'number' || typeof dia !== 'number') continue;
      const when = new Date(at);
      if (Number.isNaN(when.getTime())) continue;
      if (!isPlausibleReading(sys, dia)) continue;
      out.push({ at: when, systolic: sys, diastolic: dia });
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  } catch {
    return [];
  }
}

/** The most recent reading, or null. Takes the input as given by `parseBloodPressureReadings`. */
export function latestReading(readings: BloodPressureReading[]): BloodPressureReading | null {
  return readings.length > 0 ? readings[readings.length - 1] : null;
}

/**
 * Readings at or after `since`. The caller works `since` out from the logical
 * day start (`addDays(getCurrentDayStart(), -(days - 1))`), so the range
 * follows `dayResetTime` like every other day-keyed reader.
 */
export function readingsSince(readings: BloodPressureReading[], since: Date): BloodPressureReading[] {
  return readings.filter(r => r.at.getTime() >= since.getTime());
}

/** The mean of each half, rounded to whole mmHg, or null for no readings. */
export function averageReading(
  readings: BloodPressureReading[],
): { systolic: number; diastolic: number } | null {
  if (readings.length === 0) return null;
  const sum = readings.reduce(
    (acc, r) => ({ systolic: acc.systolic + r.systolic, diastolic: acc.diastolic + r.diastolic }),
    { systolic: 0, diastolic: 0 },
  );
  return {
    systolic: Math.round(sum.systolic / readings.length),
    diastolic: Math.round(sum.diastolic / readings.length),
  };
}
