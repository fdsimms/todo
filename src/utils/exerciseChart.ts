/**
 * The arithmetic behind an exercise's progress chart: where each session
 * sits, where the line breaks, and what the axis spans. Pure, so the drawing
 * (`ExerciseProgressChart`) is only layout. See docs/arch/workouts.md.
 *
 * The chart is `WeightChart`'s shape (a line, a dot per reading, breaks across
 * gaps) with one difference: its x axis is the calendar, not a count of
 * readings. Sessions come when the person trains, and drawing them evenly
 * spaced would hide that a four-week layoff happened between two of them.
 */

export interface ChartInput {
  dayKey: string;
  value: number;
}

export interface ChartPoint extends ChartInput {
  /** Whole days from the first point's day. */
  dayIndex: number;
}

/**
 * The longest stretch with no session the line is drawn across, in days. Past
 * it the line breaks, because a straight line over a month of nothing draws
 * every day nobody trained. Three weeks keeps an ordinary skipped week joined
 * and a real layoff open.
 */
export const CHART_GAP_DAYS = 21;

const DAY_MS = 86400000;

/** Whole days between two day keys, from local noon so a daylight-saving change can't make one 23 hours. */
export function daysBetween(fromKey: string, toKey: string): number {
  const at = (key: string) => new Date(`${key}T12:00:00`).getTime();
  return Math.round((at(toKey) - at(fromKey)) / DAY_MS);
}

/** Points in time order, with each one's day offset from the first. Two on one day stay in the order given. */
export function chartPoints(inputs: readonly ChartInput[]): ChartPoint[] {
  const sorted = [...inputs].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (sorted.length === 0) return [];
  return sorted.map(p => ({ ...p, dayIndex: daysBetween(sorted[0].dayKey, p.dayKey) }));
}

/** The runs of points the line is drawn through: a new run starts after a gap longer than `maxGapDays`. */
export function chartSegments(points: readonly ChartPoint[], maxGapDays = CHART_GAP_DAYS): ChartPoint[][] {
  const out: ChartPoint[][] = [];
  for (const p of points) {
    const run = out[out.length - 1];
    if (run && p.dayIndex - run[run.length - 1].dayIndex <= maxGapDays) run.push(p);
    else out.push([p]);
  }
  return out;
}

/**
 * Which points set a record on the way: strictly above everything before it.
 * The first point is never one (a first time is not a record), so a line that
 * only ever fell has none.
 */
export function recordIndexes(points: readonly ChartInput[]): number[] {
  const out: number[] = [];
  let best = -Infinity;
  points.forEach((p, i) => {
    if (i > 0 && p.value > best) out.push(i);
    if (p.value > best) best = p.value;
  });
  return out;
}

export interface ChartDomain {
  min: number;
  max: number;
}

/** A step of 1, 2, 2.5, 5 times a power of ten that puts roughly `target` steps across `span`. */
function niceStep(span: number, target = 2): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * The y span for a set of values: padded and rounded out to a tidy step, so
 * the three axis labels read as numbers a person would write ("85, 95, 105").
 *
 * **Never anchored at zero and never scaled to the data alone**, for
 * `WeightChart`'s reason: a lift that moved from 100 to 104 kg is a few
 * percent, and a zero baseline draws it as a flat line while a bare min/max
 * draws it as a mountain. A flat series gets a window around its one value
 * rather than a zero-height one. The floor is zero, since none of these
 * quantities is negative.
 */
export function chartDomain(values: readonly number[]): ChartDomain | null {
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.1, 1);
  const pad = span * 0.15;
  const step = niceStep(span + pad * 2);
  const min = Math.max(0, Math.floor((lo - pad) / step) * step);
  let max = Math.ceil((hi + pad) / step) * step;
  if (max - min < step * 2) max = min + step * 2;
  return { min, max };
}

/** Where a value sits in a domain, 0 at the bottom to 1 at the top. */
export function domainFraction(value: number, domain: ChartDomain): number {
  return (value - domain.min) / (domain.max - domain.min);
}

export interface MonthTick {
  /** The first of the month, as a day key. */
  dayKey: string;
  dayIndex: number;
  /** Short month name. */
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The fewest days between two month labels so they don't touch, for a plot
 * `plotWidth` points wide spanning `spanDays`: a label is about 30 points wide.
 */
export function minTickGapDays(spanDays: number, plotWidth: number): number {
  return plotWidth > 0 ? Math.max(7, Math.ceil((spanDays * 30) / plotWidth)) : 7;
}

/**
 * A tick for each month that begins inside the span, plus one at the very
 * start labelled with its own month, so the axis says where it starts. Ticks
 * closer together than `minGapDays` keep the earlier one: three months a
 * phone's width apart is a label each, and a year of them is a smear.
 */
export function monthTicks(firstKey: string, lastKey: string, minGapDays = 7): MonthTick[] {
  const span = daysBetween(firstKey, lastKey);
  const [y0, m0] = firstKey.split('-').map(Number);
  const ticks: MonthTick[] = [{ dayKey: firstKey, dayIndex: 0, label: MONTHS[m0 - 1] }];
  let y = y0;
  let m = m0;
  for (let i = 0; i < 240; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    const dayKey = `${y}-${String(m).padStart(2, '0')}-01`;
    const dayIndex = daysBetween(firstKey, dayKey);
    if (dayIndex > span) break;
    if (dayIndex - ticks[ticks.length - 1].dayIndex >= minGapDays) {
      ticks.push({ dayKey, dayIndex, label: MONTHS[m - 1] });
    }
  }
  return ticks;
}
