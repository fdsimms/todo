import { ageFromBirthYear } from './energyBudget';

/**
 * Heart rate during a workout, as the workout page shows it: the average, the
 * maximum and the minutes in each of five zones, read back from Apple Health
 * for one workout the Apple Watch measured (`readWorkoutHeartRate`) and never
 * stored. See docs/arch/health-data.md, "Heart rate during a workout".
 *
 * **Shown, never interpreted.** Nothing here names a zone, ranks one, or says
 * a figure is high, low or good. The zones are shares of a maximum and the
 * minutes in each; what they mean is the person's business.
 *
 * **The maximum is the one estimate the app makes about a body**, and only
 * because the person chose it (a typed maximum, or a year of birth typed into
 * the calorie budget), it is labeled as an estimate wherever it shows, a
 * typed number replaces it, and it only partitions what Health recorded.
 * `resolveMaxHeartRate` is where the typed figure, the estimate and "none"
 * are decided, and `describeZoneBasis` is the label the card carries.
 */

/** The five zones' lower edges, as shares of the maximum. */
export const HEART_RATE_ZONE_SHARES = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

/** 220 minus age: the population formula the estimate is, said in its own words wherever it shows. */
export const AGE_ESTIMATE_BASE = 220;

/**
 * Bounds on a maximum heart rate, typed or estimated: an absurdity check, like
 * `MAX_WEIGHT_KG`, not a judgment. A typed figure outside them is refused, and
 * an estimate outside them (an age the year of birth can't really mean) gives
 * no zones.
 */
export const MAX_HEART_RATE_RANGE = { min: 100, max: 230 } as const;

/**
 * How long one reading stands for, at most. A reading counts until the next
 * one, which during a workout session is a few seconds later; a silence
 * longer than this (the sensor lost contact, the watch slid on the wrist) is
 * time nobody measured, and goes in no zone rather than being guessed at.
 * A minute is well above the session's own spacing, so ordinary readings join
 * up, and short enough that a dropout isn't filled with the last number seen.
 */
export const MAX_READING_GAP_SECONDS = 60;

/** The plausible span of one reading. Anything outside is a broken sample, dropped like a missing one. */
const READING_RANGE = { min: 20, max: 260 } as const;

// ==== the maximum ====

export interface MaxHeartRate {
  bpm: number;
  /** `typed` is the person's own figure; `age` is 220 minus the age from their year of birth. */
  source: 'typed' | 'age';
}

/** A stored maximum, or null for none (the estimate). Anything unreadable reads as none. */
export function parseMaxHeartRate(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const bpm = Math.round(value);
  return bpm >= MAX_HEART_RATE_RANGE.min && bpm <= MAX_HEART_RATE_RANGE.max ? bpm : null;
}

/**
 * The maximum the zones are shares of: the typed figure when there is one,
 * else 220 minus the age from the year of birth in the calorie budget, else
 * null, which means no zones at all (never a default age, never a guess).
 */
export function resolveMaxHeartRate(typed: number | null, birthYear: number | null, today: Date): MaxHeartRate | null {
  const own = typed === null ? null : parseMaxHeartRate(String(typed));
  if (own !== null) return { bpm: own, source: 'typed' };
  const age = ageFromBirthYear(birthYear, today);
  if (age === null) return null;
  const bpm = AGE_ESTIMATE_BASE - age;
  if (bpm < MAX_HEART_RATE_RANGE.min || bpm > MAX_HEART_RATE_RANGE.max) return null;
  return { bpm, source: 'age' };
}

/** The setting's value: "186, from age", "190", or "Not set". The estimate always says it is one. */
export function describeMaxHeartRate(max: MaxHeartRate | null): string {
  if (!max) return 'Not set';
  return max.source === 'age' ? `${max.bpm}, from age` : String(max.bpm);
}

/**
 * The line under the heart-rate card, saying what the zones are shares of and
 * where that number came from. Not help text: it is the label that keeps an
 * estimate from reading as a measurement, so Hide help text leaves it.
 */
export function describeZoneBasis(max: MaxHeartRate | null): string {
  if (!max) {
    return 'To see time in zones, set your maximum heart rate in Settings › Apple Health › Workouts, or your year of birth in the calorie budget.';
  }
  if (max.source === 'age') {
    return `Zones are shares of a maximum of ${max.bpm} bpm, estimated from your age (${AGE_ESTIMATE_BASE} minus age). Set your own maximum in Settings › Apple Health › Workouts.`;
  }
  return `Zones are shares of the maximum heart rate you set, ${max.bpm} bpm.`;
}

// ==== the zones ====

export interface HeartRateZone {
  /** 1 to 5. */
  zone: number;
  /** The lowest whole bpm in the zone. */
  low: number;
  /** The highest whole bpm in the zone, for the label. Zone 5 runs to the maximum, and takes anything above it too. */
  high: number;
}

/**
 * The five zones of a maximum, in whole beats: zone 2 of 186 is 112–130, since
 * 60 percent of 186 is 111.6 and 70 percent is 130.2. A reading is in the zone
 * whose range holds it once rounded, so the label and the minutes can't
 * disagree about where a beat goes.
 */
export function heartRateZones(maxBpm: number): HeartRateZone[] {
  const lows = HEART_RATE_ZONE_SHARES.map(share => Math.ceil(share * maxBpm - 1e-9));
  return lows.map((low, i) => ({
    zone: i + 1,
    low,
    high: i + 1 < lows.length ? lows[i + 1] - 1 : maxBpm,
  }));
}

/** Which zone (1 to 5) a reading is in, or null below zone 1. */
export function zoneOf(bpm: number, zones: readonly HeartRateZone[]): number | null {
  const beat = Math.round(bpm);
  for (let i = zones.length - 1; i >= 0; i--) {
    if (beat >= zones[i].low) return zones[i].zone;
  }
  return null;
}

// ==== the readings ====

/** One heart-rate reading: when (epoch milliseconds) and beats per minute. */
export interface HeartRateSample {
  at: number;
  bpm: number;
}

/** A workout's heart rate as Health answered for it. */
export interface WorkoutHeartRate {
  /** The workout's own span, which a reading's time is clipped to. */
  startMs: number;
  endMs: number;
  /** Health's own figures for the workout, when it has them (`statistics(for:)`); null otherwise. */
  average: number | null;
  max: number | null;
  /** Oldest first. */
  samples: HeartRateSample[];
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const inReadingRange = (v: number | null): number | null =>
  v !== null && v >= READING_RANGE.min && v <= READING_RANGE.max ? v : null;

/**
 * The bridge's answer (`readWorkoutHeartRate`), read: null for every reason
 * there is nothing to show (no workout, no heart rate, a refused read, a
 * build without the call), which is one answer by Apple's design. A broken
 * reading is dropped, never read as a zero.
 */
export function parseWorkoutHeartRate(json: string | null | undefined): WorkoutHeartRate | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const startMs = typeof r.start === 'string' ? Date.parse(r.start) : NaN;
  const endMs = typeof r.end === 'string' ? Date.parse(r.end) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const samples: HeartRateSample[] = [];
  if (Array.isArray(r.samples)) {
    for (const entry of r.samples) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const at = finite(entry[0]);
      const bpm = inReadingRange(finite(entry[1]));
      if (at === null || bpm === null) continue;
      samples.push({ at, bpm });
    }
  }
  samples.sort((a, b) => a.at - b.at);
  const average = inReadingRange(finite(r.average));
  const max = inReadingRange(finite(r.max));
  if (samples.length === 0 && average === null && max === null) return null;
  return { startMs, endMs, average, max, samples };
}

/**
 * The average and the maximum, in whole beats: Health's own figures for the
 * workout when it gave them (what the Fitness app shows), else worked out
 * from the readings (their plain mean, which is how Health averages a
 * discrete type, and the largest).
 */
export function heartRateSummary(read: WorkoutHeartRate): { average: number | null; max: number | null } {
  const values = read.samples.map(s => s.bpm);
  const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const largest = values.length > 0 ? Math.max(...values) : null;
  const average = read.average ?? mean;
  const max = read.max ?? largest;
  return {
    average: average === null ? null : Math.round(average),
    max: max === null ? null : Math.round(max),
  };
}

/**
 * Seconds spent in each zone, zone 1 first. Each reading stands for the time
 * until the next one, at most `MAX_READING_GAP_SECONDS`, and the last one
 * until the workout ended, under the same cap; every stretch is clipped to the
 * workout's span. A longer silence is in no zone, and so is a reading below
 * zone 1, so the five need not add up to the workout's length.
 */
export function secondsInZones(read: WorkoutHeartRate, zones: readonly HeartRateZone[]): number[] {
  const out = zones.map(() => 0);
  const cap = MAX_READING_GAP_SECONDS * 1000;
  const { samples, startMs, endMs } = read;
  for (let i = 0; i < samples.length; i++) {
    const from = Math.max(samples[i].at, startMs);
    const until = Math.min(i + 1 < samples.length ? samples[i + 1].at : endMs, samples[i].at + cap, endMs);
    if (until <= from) continue;
    const zone = zoneOf(samples[i].bpm, zones);
    if (zone === null) continue;
    out[zone - 1] += (until - from) / 1000;
  }
  return out;
}

/** "2 min", or "<1 min" for a zone held under half a minute but not never. */
export function formatZoneMinutes(seconds: number): string {
  if (seconds <= 0) return '0 min';
  const minutes = Math.round(seconds / 60);
  return minutes === 0 ? '<1 min' : `${minutes} min`;
}

function spokenMinutes(seconds: number): string {
  if (seconds <= 0) return 'no time';
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return 'under a minute';
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** One row of the card, zone 5 first, as the mock draws them. */
export interface ZoneRow {
  zone: number;
  /** "Zone 2 · 112–130" */
  label: string;
  minutes: string;
  /** What a screen reader says for the row: "Zone 2, 112 to 130 beats per minute, 15 minutes". */
  spoken: string;
  /** The bar's length: this zone's share of the time measured in any zone, 0 to 1. */
  fraction: number;
}

/**
 * The card's zone rows, zone 5 first, or null without a maximum (no zones)
 * or without readings to divide. Every bar is drawn on one scale, the time
 * measured in any zone, so a minute is the same length on every row.
 */
export function zoneRows(read: WorkoutHeartRate, max: MaxHeartRate | null): ZoneRow[] | null {
  if (!max || read.samples.length === 0) return null;
  const zones = heartRateZones(max.bpm);
  const seconds = secondsInZones(read, zones);
  const total = seconds.reduce((a, b) => a + b, 0);
  return zones
    .map((z, i) => {
      const minutes = formatZoneMinutes(seconds[i]);
      return {
        zone: z.zone,
        label: `Zone ${z.zone} · ${z.low}–${z.high}`,
        minutes,
        spoken: `Zone ${z.zone}, ${z.low} to ${z.high} beats per minute, ${spokenMinutes(seconds[i])}`,
        fraction: total > 0 ? seconds[i] / total : 0,
      };
    })
    .reverse();
}
