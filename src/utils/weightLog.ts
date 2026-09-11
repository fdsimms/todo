/**
 * Body weight: the unit it's shown in, the shape a chart needs, and what may
 * honestly be said about a run of readings.
 *
 * Everything here is arithmetic over numbers Apple Health already holds. This
 * module deliberately holds no state and no store of its own: HealthKit is the
 * record, for the reason `docs/arch/health-data.md` gives at length, and a
 * local copy would be a backup file with somebody's body weight in it.
 *
 * **Nothing here interprets a body, and that is the line that let weight be
 * built at all.** The arch doc ruled weight out for years alongside HRV and
 * blood glucose, on the grounds that a reading a device guessed at is one the
 * app would have to form an opinion about. Weight came back across that line by
 * the same argument that admitted the eight nutrients: a weight exists only
 * because somebody stepped on a scale, and the app is writing their number
 * down. What keeps it on the right side is everything this file does *not*
 * export — no goal weight, no BMI, no healthy-range verdict, no rule metric, no
 * generated task. `weightChange` reports two readings and the gap between them,
 * which is a fact the person can check against their own scale, and stops
 * there.
 */

/** Which unit a weight is shown and typed in. */
export type WeightUnit = 'kg' | 'lb';

/**
 * The international avoirdupois pound, exactly. Written out rather than
 * rounded to 0.4536 because a round-trip through kg and back is how a typed
 * "180.0 lb" comes back as "179.9" and looks like the app lost a tenth of a
 * pound.
 */
const KG_PER_LB = 0.45359237;

/**
 * The widest weight this app will accept or believe, in kilograms.
 *
 * An absurdity check rather than a judgement about anybody: it sits far above
 * any real body mass so it can only ever catch a typo. It matters because a
 * mistyped weight written to Health is permanent and would skew every chart
 * drawn from it afterwards, unlike a mistyped grocery quantity. The native
 * write applies the same ceiling, so a caller that skipped this can't get past
 * the bridge either.
 */
export const MAX_WEIGHT_KG = 1000;

/** One logical day's weight, keyed the way every other day-keyed reader is. */
export interface WeightPoint {
  dayKey: string;
  /** Null for a day with no weigh-in, which is the normal case, not a fault. */
  kilograms: number | null;
}

/** A `WeightPoint` that actually has a reading on it. */
export interface WeightReading {
  dayKey: string;
  kilograms: number;
}

export function kgToUnit(kilograms: number, unit: WeightUnit): number {
  return unit === 'kg' ? kilograms : kilograms / KG_PER_LB;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

/**
 * A weight for display, in `unit`, to one decimal place.
 *
 * One decimal because that is what a bathroom scale shows, in either unit —
 * more digits would claim a precision the reading never had, and none at all
 * would hide exactly the movement somebody weighing themselves regularly is
 * looking for.
 */
export function formatWeight(kilograms: number, unit: WeightUnit): string {
  return `${kgToUnit(kilograms, unit).toFixed(1)} ${unit}`;
}

/**
 * Read a typed weight, in `unit`, back to kilograms — or null if it isn't one.
 *
 * Refuses zero and negatives outright rather than clamping them, because a
 * clamp would silently write a number the person did not type into their
 * medical record.
 */
export function parseWeightInput(text: string, unit: WeightUnit): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // A plain decimal only. Anything with a stray unit, a comma or a range in it
  // is a typo worth refusing rather than guessing at.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  const kilograms = unitToKg(value, unit);
  if (kilograms <= 0 || kilograms >= MAX_WEIGHT_KG) return null;
  return kilograms;
}

/** Every day that carries a reading, in the order given. */
export function weightReadings(points: WeightPoint[]): WeightReading[] {
  const out: WeightReading[] = [];
  for (const point of points) {
    if (point.kilograms !== null) out.push({ dayKey: point.dayKey, kilograms: point.kilograms });
  }
  return out;
}

/**
 * The most recent reading in the window, or null if there isn't one.
 *
 * Takes the last reading in order rather than scanning for a maximum date,
 * because the series is built by walking days forward from an anchor and is
 * always in order — the same assumption every other day-keyed reader in the app
 * makes about its own series.
 */
export function latestWeight(points: WeightPoint[]): WeightReading | null {
  const readings = weightReadings(points);
  return readings.length > 0 ? readings[readings.length - 1] : null;
}

/**
 * How far apart the y-axis bounds must sit however flat the data is, in
 * kilograms.
 *
 * Without a floor, a week in which somebody's weight moved 200g would be drawn
 * as a mountain range: the chart would scale that 200g to the full height and
 * every scale-to-scale wobble would read as a trend. Two kilograms is wide
 * enough that ordinary day-to-day variation looks like ordinary variation, and
 * narrow enough that a real change is still plainly visible.
 */
const MIN_DOMAIN_SPAN_KG = 2;

/**
 * Headroom above and below the data, as a fraction of the span, so the highest
 * and lowest points aren't drawn touching the edges of the plot.
 */
const DOMAIN_PADDING = 0.15;

/** The y-axis bounds for a chart of these weights, in kilograms. */
export interface WeightDomain {
  min: number;
  max: number;
}

/**
 * The y-axis bounds for a run of readings — **never zero-based**.
 *
 * This is the one thing a weight chart cannot borrow from the four bar charts
 * already in the app. Those plot counts, where zero is a real value and the
 * bar's length is the quantity, so a zero baseline is the honest drawing. A
 * body sits in a narrow band a long way from zero: scaled from zero, every
 * reading in a year lands within a couple of pixels of every other and the
 * chart says nothing at all. So the domain is windowed to the data, floored at
 * `MIN_DOMAIN_SPAN_KG` so flatness still reads as flat, and padded so the
 * extremes aren't clipped to the frame.
 *
 * Returns null when there is nothing to draw, which the caller renders as an
 * empty state rather than as an empty chart.
 */
export function weightDomain(
  points: WeightPoint[],
  includeKg?: number | null,
): WeightDomain | null {
  const readings = weightReadings(points);
  if (readings.length === 0) return null;

  let low = readings[0].kilograms;
  let high = readings[0].kilograms;
  for (const reading of readings) {
    if (reading.kilograms < low) low = reading.kilograms;
    if (reading.kilograms > high) high = reading.kilograms;
  }

  // A weight the chart must have room for even though nobody recorded it: a
  // goal's target, so its line lands inside the plot rather than off the top
  // or bottom of it.
  //
  // **This deliberately flattens the readings, and that is the trade.** A
  // target ten kilograms away widens the domain by ten kilograms, so the
  // week-to-week wobble the windowed domain exists to show gets squashed
  // against it. Drawing the line at the edge of a domain it isn't in would be
  // worse — it would put the target wherever the data happened to end and
  // invite reading a gap that isn't there — and the fainter trend line still
  // carries the shape. It only applies when a target is actually passed, so a
  // chart with no goal behind it is unchanged.
  if (includeKg !== undefined && includeKg !== null && Number.isFinite(includeKg)) {
    if (includeKg < low) low = includeKg;
    if (includeKg > high) high = includeKg;
  }

  const middle = (low + high) / 2;
  const span = Math.max(high - low, MIN_DOMAIN_SPAN_KG) * (1 + DOMAIN_PADDING * 2);
  return {
    // Clamped at zero for the same reason the ceiling exists: not because a
    // real body could approach it, but so a nonsense reading that slipped
    // through can't drag the axis somewhere impossible.
    min: Math.max(0, middle - span / 2),
    max: middle + span / 2,
  };
}

/**
 * Where a reading sits in the plot, as a fraction from 0 (the domain's floor)
 * to 1 (its ceiling).
 *
 * Split out from the chart so the arithmetic is testable without a renderer —
 * there are no component tests in this app, so anything a chart gets wrong
 * silently is worth pulling into a function that can be pinned down here.
 */
export function weightFraction(kilograms: number, domain: WeightDomain): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 0.5;
  const fraction = (kilograms - domain.min) / span;
  return Math.min(1, Math.max(0, fraction));
}

/** A reading together with where it sits in the window, for plotting. */
export interface WeightPlotPoint {
  /** The reading's offset in days from the start of the window. */
  index: number;
  dayKey: string;
  kilograms: number;
}

/**
 * How long a gap between weigh-ins breaks the line, in days.
 *
 * Somebody who weighs in weekly should get a continuous line — joining Monday
 * to the following Monday is a fair drawing of two readings a week apart. Two
 * readings either side of a three-month gap are not a trend, and a straight
 * line across that gap invents every day in between. A fortnight is the point
 * where a line stops being a reasonable reading of the data and starts being a
 * claim about days nobody measured.
 */
export const MAX_JOINED_GAP_DAYS = 14;

/** Every reading in the window, carrying its day offset. */
export function weightPlotPoints(points: WeightPoint[]): WeightPlotPoint[] {
  const out: WeightPlotPoint[] = [];
  points.forEach((point, index) => {
    if (point.kilograms !== null) {
      out.push({ index, dayKey: point.dayKey, kilograms: point.kilograms });
    }
  });
  return out;
}

/**
 * Splits an already-sorted run of indexed points into segments, breaking
 * wherever consecutive points are more than `maxGapDays` apart.
 *
 * Shared by `weightSegments` and `weightTrendSegments` below, which draw two
 * different lines (raw readings, a trailing average) but must break at
 * exactly the same gaps — a smoothed line that stayed continuous across a
 * span the raw line had already broken would draw a trend through days
 * neither line has any data for.
 */
function groupByGap<T extends { index: number }>(points: T[], maxGapDays: number): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];
  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && point.index - previous.index > maxGapDays) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * The readings split into runs that may be joined by a line, breaking wherever
 * more than `maxGapDays` passed without a weigh-in.
 *
 * The alternative — one line through everything — is what makes a gap look like
 * a measurement. A person who stopped weighing in over the summer and started
 * again in September did not glide smoothly between the two figures, and a
 * chart that draws them doing so is asserting something nobody recorded. Each
 * run is drawn as its own line, so the gap is visible as a gap.
 */
export function weightSegments(
  points: WeightPoint[],
  maxGapDays: number = MAX_JOINED_GAP_DAYS,
): WeightPlotPoint[][] {
  return groupByGap(weightPlotPoints(points), maxGapDays);
}

/**
 * How many trailing days of readings a trend point averages over.
 *
 * A week, because that is enough to smooth out the water-weight swing an
 * ordinary day-to-day reading carries without also smoothing out a real
 * change — the same window most weight trackers use for exactly this reason.
 */
export const TREND_WINDOW_DAYS = 7;

/** A trend point: the trailing average as of one particular reading. */
export interface WeightTrendPoint {
  /** The day offset of the *reading* this average is centred on. */
  index: number;
  dayKey: string;
  kilograms: number;
}

/**
 * A trailing moving average, one point per actual reading.
 *
 * **Deliberately not one point per calendar day.** A day with no weigh-in has
 * nothing to average from that day, and manufacturing a value for it — by
 * carrying the last average forward, say — would be drawing a reading nobody
 * took. So the average is recomputed at each real reading, over whichever
 * readings from the trailing `windowDays` actually exist; a person who weighs
 * in twice a week gets an average that moves twice a week, not one that
 * pretends to move daily.
 *
 * **This does not widen what the app may claim about a weight.** The rule in
 * this file's own header — nothing here interprets a body — still holds: a
 * trailing average is arithmetic over numbers already on the raw line, drawn
 * a second time with the day-to-day noise averaged out. It says nothing a
 * careful reader of the dots couldn't already work out; it just makes the
 * shape easier to see. No slope is fitted, no direction is named, and nothing
 * here decides whether the trend is "good".
 */
export function weightTrendPoints(
  points: WeightPoint[],
  windowDays: number = TREND_WINDOW_DAYS,
): WeightTrendPoint[] {
  const readings = weightPlotPoints(points);
  const out: WeightTrendPoint[] = [];
  for (let i = 0; i < readings.length; i++) {
    const current = readings[i];
    let sum = 0;
    let count = 0;
    for (let j = i; j >= 0; j--) {
      const reading = readings[j];
      if (current.index - reading.index >= windowDays) break;
      sum += reading.kilograms;
      count++;
    }
    out.push({ index: current.index, dayKey: current.dayKey, kilograms: sum / count });
  }
  return out;
}

/**
 * The trend line split into runs that may be joined, using the same gap rule
 * `weightSegments` does — see `groupByGap`'s own note for why the two must
 * agree.
 */
export function weightTrendSegments(
  points: WeightPoint[],
  windowDays: number = TREND_WINDOW_DAYS,
  maxGapDays: number = MAX_JOINED_GAP_DAYS,
): WeightTrendPoint[][] {
  return groupByGap(weightTrendPoints(points, windowDays), maxGapDays);
}

/** Two readings and the distance between them. Not a trend, and not a verdict. */
export interface WeightChange {
  first: WeightReading;
  last: WeightReading;
  /** Positive when the later reading is heavier. */
  deltaKg: number;
  /** How many readings there were, including both ends. */
  readings: number;
}

/**
 * The first and last readings in the window, and the difference between them.
 *
 * **Deliberately the plainest thing that could be reported.** No slope, no
 * moving average, no "trending" language, no arrow: this is two numbers the
 * person can check against their own scale and the gap between them, in the
 * voice `MoodScreen` already uses for every comparison it draws ("no arrows
 * implying causation, no advice, and the sample size printed beside every
 * comparison"). The reading count is part of the return value rather than
 * optional decoration for that reason — a 3kg difference across two weigh-ins
 * months apart and across sixty daily ones are not the same claim, and the
 * caller must be able to say which it has.
 *
 * Null for fewer than two readings, because one weight is not a change.
 */
export function weightChange(points: WeightPoint[]): WeightChange | null {
  const readings = weightReadings(points);
  if (readings.length < 2) return null;
  const first = readings[0];
  const last = readings[readings.length - 1];
  return {
    first,
    last,
    deltaKg: last.kilograms - first.kilograms,
    readings: readings.length,
  };
}
