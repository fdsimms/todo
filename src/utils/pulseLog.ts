import { MAX_PULSE, MIN_PULSE, type BloodPressureReading } from './bloodPressureLog';

/**
 * Pulse on the Blood pressure screen: typing one in on its own, reading the
 * ones listed back, and the one rule about which of them are listed.
 *
 * Same stance as `bloodPressureLog.ts`: Health is the record and this holds no
 * state, and **nothing here interprets a body.** There is no "normal", "high"
 * or "low", no band, no colour for a number and no rule metric. A pulse is a
 * number somebody typed or the Watch measured, shown back with its date.
 * `docs/arch/health-data.md` ("Pulse on the blood pressure screen") is where
 * resting heart rate was let in and the line it was let in behind.
 */

/**
 * `logged` is a pulse this app wrote, so somebody typed it in. `resting` is
 * Apple's own once-a-day resting heart rate, which the Watch records unasked.
 * They are labelled apart on screen because only one of them was entered.
 */
export type PulseKind = 'logged' | 'resting';

export interface PulseEntry {
  at: Date;
  bpm: number;
  kind: PulseKind;
}

/** True when the number could be a pulse at all. Mirrors the native write's bounds. */
export function isPlausiblePulse(bpm: number): boolean {
  return Number.isInteger(bpm) && bpm >= MIN_PULSE && bpm <= MAX_PULSE;
}

/**
 * The typed pulse, or null if it isn't one. Whole beats per minute only, for
 * `parseBloodPressureInput`'s reason: a decimal or a stray unit is a typo worth
 * refusing rather than rounding into somebody's record.
 */
export function parsePulseInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const bpm = Number(trimmed);
  return isPlausiblePulse(bpm) ? bpm : null;
}

/**
 * The JSON `readPulseSeries` returns, as entries oldest first. A malformed
 * entry, an unknown kind or an implausible number is dropped rather than shown:
 * a wrong figure is worse than a missing one. An empty answer covers a refused
 * read, a device with no Health and nothing recorded alike, deliberately.
 */
export function parsePulseSeries(json: string): PulseEntry[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: PulseEntry[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { at, bpm, kind } = entry as Record<string, unknown>;
      if (typeof at !== 'string' || typeof bpm !== 'number') continue;
      if (kind !== 'logged' && kind !== 'resting') continue;
      const when = new Date(at);
      if (Number.isNaN(when.getTime())) continue;
      if (!isPlausiblePulse(bpm)) continue;
      out.push({ at: when, bpm, kind });
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  } catch {
    return [];
  }
}

/**
 * The entries worth a row of their own. A pulse saved with a blood pressure
 * reading is written at the reading's exact instant and already shows on that
 * reading's row, so a `logged` entry at a reading's instant is dropped here
 * rather than listed twice. A `resting` entry is never dropped: it is Apple's
 * figure for the day, not a copy of anything on a reading.
 */
export function standalonePulses(
  entries: readonly PulseEntry[],
  readings: readonly Pick<BloodPressureReading, 'at'>[],
): PulseEntry[] {
  const readingInstants = new Set(readings.map(r => r.at.getTime()));
  return entries.filter(e => e.kind === 'resting' || !readingInstants.has(e.at.getTime()));
}

/** Entries at or after `since`, `readingsSince`'s twin for pulses. */
export function pulsesSince(entries: readonly PulseEntry[], since: Date): PulseEntry[] {
  return entries.filter(e => e.at.getTime() >= since.getTime());
}
