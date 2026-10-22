/**
 * What a body actually burns, worked out from what was eaten and how the weight
 * moved: the "Your log" basis on the weight goal's maintenance figure.
 *
 * **This is a carve-out from "nothing derives anything from a weight"**
 * (docs/arch/health-data.md), asked for, and fenced the way the weight goal's
 * own is:
 *
 * - **It is opt-in, and choosing it is the opt-in.** Nothing computes it until
 *   somebody picks "Your log" on the weight goal, and it is never offered
 *   anywhere else.
 * - **It proposes a maintenance figure and nothing else.** The target is still
 *   `budgetFromMaintenance`'s arithmetic with the goal's own rate and floor, so
 *   the measured basis can't produce a number the profile basis couldn't.
 * - **It shows its working.** The days counted, the weigh-ins, the average
 *   eaten and where the weight trend started and ended are all returned so the
 *   sheet can say them; a figure with no visible working is the app's opinion.
 * - **It refuses rather than guesses.** Too few fully logged days, too few
 *   weigh-ins, or weigh-ins too close together, and there is no figure, only
 *   what is missing.
 *
 * The arithmetic: energy in minus energy stored. A weight trend falling by a
 * kilogram is about `KCAL_PER_KG` that came from the body rather than the
 * plate, so expenditure is the average intake minus the trend's daily slope in
 * calories. The slope is a least-squares line through the weigh-ins, which a
 * single heavy morning moves less than it moves a line drawn between two
 * endpoints.
 */
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { KCAL_PER_LB } from './energyBudget';
import { unitToKg, type WeightPoint } from './weightLog';

/**
 * A `YYYY-MM-DD` key as local midnight. Written out rather than taken from
 * `dateUtils`, which reaches the settings store, so this file stays pure.
 */
function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The window read, in days, ending the day before today. */
export const EXPENDITURE_WINDOW_DAYS = 28;
/** Fully logged days needed inside the window. */
export const MIN_EXPENDITURE_DAYS = 14;
/** Weigh-ins needed inside the window. */
export const MIN_EXPENDITURE_WEIGH_INS = 3;
/** Days between the first and last weigh-in, so the trend spans enough time to mean anything. */
export const MIN_EXPENDITURE_SPAN_DAYS = 14;

/** The same energy per kilogram the goal's rate arithmetic uses, so the two can't disagree. */
export const KCAL_PER_KG = KCAL_PER_LB / unitToKg(1, 'lb');

/** A figure outside this is a logging gap or a scale error, not a body: refused. */
const PLAUSIBLE_KCAL = { min: 800, max: 6000 };

export interface MeasuredExpenditure {
  kind: 'measured';
  /** Rounded to the nearest 10. */
  kcal: number;
  /** Fully logged days counted. */
  days: number;
  weighIns: number;
  /** Average calories eaten across those days, rounded. */
  averageIntakeKcal: number;
  /** The trend line's weight at the first and last weigh-in, kilograms. */
  trendStartKg: number;
  trendEndKg: number;
  firstDayKey: string;
  lastDayKey: string;
}

export interface ExpenditureShortfall {
  kind: 'short';
  days: number;
  weighIns: number;
  spanDays: number;
}

/** Why there is no figure even though the data is all there: it came out implausible. */
export interface ExpenditureImplausible {
  kind: 'implausible';
}

export type ExpenditureResult = MeasuredExpenditure | ExpenditureShortfall | ExpenditureImplausible;

/**
 * The measured expenditure over the window ending the day before `todayKey`,
 * or what it is short of.
 *
 * `intake` is one row per day with the day's calories, from `foodDayInputs`,
 * which has already dropped a day logged past only one meal and a day whose
 * calories some entry didn't state. Today is left out here, since a day still
 * being eaten reads low.
 */
export function measuredExpenditure(
  intake: readonly { dayKey: string; calorieKcal: number | undefined }[],
  weights: readonly WeightPoint[],
  todayKey: string,
): ExpenditureResult {
  const today = dayKeyToDate(todayKey);
  const inWindow = (dayKey: string) => {
    const back = differenceInCalendarDays(today, dayKeyToDate(dayKey));
    return back >= 1 && back <= EXPENDITURE_WINDOW_DAYS;
  };

  const days = intake.filter(d => inWindow(d.dayKey) && typeof d.calorieKcal === 'number' && d.calorieKcal > 0);
  const readings = weights
    .filter((w): w is { dayKey: string; kilograms: number } => w.kilograms !== null && inWindow(w.dayKey))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  const spanDays = readings.length >= 2
    ? differenceInCalendarDays(dayKeyToDate(readings[readings.length - 1].dayKey), dayKeyToDate(readings[0].dayKey))
    : 0;
  if (days.length < MIN_EXPENDITURE_DAYS || readings.length < MIN_EXPENDITURE_WEIGH_INS || spanDays < MIN_EXPENDITURE_SPAN_DAYS) {
    return { kind: 'short', days: days.length, weighIns: readings.length, spanDays };
  }

  // Least squares through (day offset, kilograms).
  const origin = dayKeyToDate(readings[0].dayKey);
  const xs = readings.map(r => differenceInCalendarDays(dayKeyToDate(r.dayKey), origin));
  const ys = readings.map(r => r.kilograms);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slopeKgPerDay = den === 0 ? 0 : num / den;
  const intercept = meanY - slopeKgPerDay * meanX;

  const averageIntake = days.reduce((sum, d) => sum + (d.calorieKcal as number), 0) / days.length;
  const kcal = averageIntake - slopeKgPerDay * KCAL_PER_KG;
  if (!Number.isFinite(kcal) || kcal < PLAUSIBLE_KCAL.min || kcal > PLAUSIBLE_KCAL.max) return { kind: 'implausible' };

  const sortedDays = [...days].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  return {
    kind: 'measured',
    kcal: Math.round(kcal / 10) * 10,
    days: days.length,
    weighIns: n,
    averageIntakeKcal: Math.round(averageIntake),
    trendStartKg: intercept,
    trendEndKg: intercept + slopeKgPerDay * xs[n - 1],
    firstDayKey: sortedDays[0].dayKey,
    lastDayKey: sortedDays[sortedDays.length - 1].dayKey,
  };
}

/** "Needs 14 fully logged days and weigh-ins at least two weeks apart. So far: 9 days, 3 weigh-ins." */
export function describeExpenditureShortfall(short: ExpenditureShortfall): string {
  const days = short.days === 1 ? '1 day' : `${short.days} days`;
  const weighIns = short.weighIns === 1 ? '1 weigh-in' : `${short.weighIns} weigh-ins`;
  return `Needs ${MIN_EXPENDITURE_DAYS} fully logged days and ${MIN_EXPENDITURE_WEIGH_INS} weigh-ins at least two weeks apart, in the last four weeks. So far: ${days}, ${weighIns}.`;
}

/**
 * The working under the "Your log" basis, said in full: what was counted and
 * what it came to, or what is still missing. The formatters keep units and
 * dates the caller's business.
 */
export function describeLogBasis(
  result: ExpenditureResult | null,
  formatKg: (kg: number) => string,
  formatDay: (dayKey: string) => string,
): string {
  if (!result) return '';
  if (result.kind === 'short') {
    return `${describeExpenditureShortfall(result)} Until then your target uses your activity level.`;
  }
  if (result.kind === 'implausible') {
    return 'Your log and your weigh-ins don’t come to a believable figure yet, so your target uses your activity level. A gap in the log or a weigh-in in different clothes can do this.';
  }
  return `From ${result.days} fully logged days and ${result.weighIns} weigh-ins, ${formatDay(result.firstDayKey)} to ${formatDay(result.lastDayKey)}. `
    + `You ate ${result.averageIntakeKcal.toLocaleString()} cal a day on average, and your weight trend went from ${formatKg(result.trendStartKg)} to ${formatKg(result.trendEndKg)}.`;
}
