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
  /**
   * The highest whole bpm in the zone, or null for zone 5, which is open at
   * the top: it takes every reading from 90 percent up, the maximum and
   * anything above it included, so it is labeled "168+", never "168–186".
   */
  high: number | null;
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
    high: i + 1 < lows.length ? lows[i + 1] - 1 : null,
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

/**
 * One heart-rate sample: when (epoch milliseconds) and beats per minute.
 *
 * **A sample can be a series** (`HKQuantitySample.count` above 1): several
 * readings stored as one, from `at` to `until`, whose `bpm` is their average
 * (Apple's `quantity` page: "average for discrete") and whose `max` is the
 * highest of them. The readings inside aren't sent (that is
 * `HKQuantitySeriesSampleQuery`, deliberately not used, see
 * docs/arch/workouts.md), so the average stands across the series' own span.
 */
export interface HeartRateSample {
  at: number;
  bpm: number;
  /** When the sample's last reading was taken; `at` for a single reading. */
  until: number;
  /** How many readings the sample holds; 1 for a single one. */
  count: number;
  /** The highest reading in it; `bpm` for a single one. */
  max: number;
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
 * reading is dropped, never read as a zero. Each sample is
 * `[startMs, bpm, endMs?, count?, maxBpm?]`; a sample from a build that sent
 * only the first two is one reading.
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
      const until = finite(entry[2]);
      const count = finite(entry[3]);
      const max = inReadingRange(finite(entry[4]));
      samples.push({
        at,
        bpm,
        until: until !== null && until >= at ? until : at,
        count: count !== null && count >= 1 ? Math.round(count) : 1,
        max: max !== null && max >= bpm ? max : bpm,
      });
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
 * from the samples: the mean of every reading (a series counts as its count
 * of readings at its average), which is how Health averages a discrete type,
 * and the highest reading (a series' own maximum).
 */
export function heartRateSummary(read: WorkoutHeartRate): { average: number | null; max: number | null } {
  const readings = read.samples.reduce((n, s) => n + s.count, 0);
  const mean = readings > 0 ? read.samples.reduce((sum, s) => sum + s.bpm * s.count, 0) / readings : null;
  const largest = read.samples.length > 0 ? Math.max(...read.samples.map(s => s.max)) : null;
  const average = read.average ?? mean;
  const max = read.max ?? largest;
  return {
    average: average === null ? null : Math.round(average),
    max: max === null ? null : Math.round(max),
  };
}

/**
 * Seconds spent in each zone, zone 1 first.
 *
 * A single reading stands for the time until the next sample, at most
 * `MAX_READING_GAP_SECONDS`, and the last one until the workout ended, under
 * the same cap. A series stands, at its average, across its own span (from its
 * first reading to its last), then like a single reading after its last; but
 * the gap rule holds inside it too, so a series whose readings are on average
 * further apart than the cap counts no more than the cap per gap between them.
 * Nothing is counted past the next sample's start, and every stretch is
 * clipped to the workout's span. A longer silence is in no zone, and so is a
 * reading below zone 1, so the five need not add up to the workout's length.
 */
export function secondsInZones(read: WorkoutHeartRate, zones: readonly HeartRateZone[]): number[] {
  const out = zones.map(() => 0);
  const cap = MAX_READING_GAP_SECONDS * 1000;
  const { samples, startMs, endMs } = read;
  const clip = (from: number, to: number) => Math.max(0, Math.min(to, endMs) - Math.max(from, startMs));
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const zone = zoneOf(s.bpm, zones);
    if (zone === null) continue;
    const next = i + 1 < samples.length ? samples[i + 1].at : endMs;
    // Across the series' own span, scaled down when its readings are sparser than the gap rule allows.
    const spanEnd = Math.min(s.until, next);
    const span = clip(s.at, spanEnd);
    const allowed = s.count > 1 ? (s.count - 1) * cap : 0;
    const inside = s.until > s.at && span > 0 ? span * Math.min(1, allowed / (s.until - s.at)) : 0;
    // After its last reading, as any single reading stands.
    const after = clip(spanEnd, Math.min(next, s.until + cap));
    out[zone - 1] += (inside + after) / 1000;
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
  /** "Zone 2 · 112–130", or "Zone 5 · 168+" for the top zone, which is open at the top. */
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
      const range = z.high === null ? `${z.low}+` : `${z.low}–${z.high}`;
      const spokenRange = z.high === null ? `${z.low} beats per minute and above` : `${z.low} to ${z.high} beats per minute`;
      return {
        zone: z.zone,
        label: `Zone ${z.zone} · ${range}`,
        minutes,
        spoken: `Zone ${z.zone}, ${spokenRange}, ${spokenMinutes(seconds[i])}`,
        fraction: total > 0 ? seconds[i] / total : 0,
      };
    })
    .reverse();
}

/**
 * The line under the card, or null for none: what the zones are shares of
 * when zones are drawn, and how to get zones when there are readings to divide
 * but no maximum. A card with only an average and a maximum (no readings) has
 * no zones to explain and no way to draw them, so it gets no line.
 */
export function zoneBasisLine(read: WorkoutHeartRate, max: MaxHeartRate | null): string | null {
  if (read.samples.length === 0) return null;
  return describeZoneBasis(max);
}
