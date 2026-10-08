import type { Task } from '../types';
import type { WeatherSnapshot } from '../services/weatherLookup';
import type { UnitSystem } from './unitConvert';

/**
 * A repeating task that skips a day it rained: "water the garden every two
 * days, unless it rained 5 mm or more". Store-free like `weatherWait.ts`: this
 * decides, and `applyRainSkips` in `useTaskStore` writes.
 *
 * **What counts as rain** is the snapshot's yesterday plus today, in
 * millimetres. Yesterday is the model's record of the day just gone; today is
 * the whole day's forecast, so on a morning look it is partly a prediction.
 * That is the honest reading of "it rained enough that I needn't water", which
 * is about the ground rather than about a calendar day, and the row says what
 * it read when it skips.
 *
 * **No figure decides nothing.** A snapshot without either day's rainfall (an
 * older response, the weather switch off, a cold launch before the first
 * fetch) never reads as dry and never as wet: the occurrence stays put, the
 * way an empty forecast leaves a weather wait alone.
 *
 * **It skips, never misses or completes.** A skip moves the occurrence to the
 * schedule's next date and records nothing about the person (see
 * `skipNextRecurrence`), and the streak is forgiven the way vacation forgives
 * one, because the rain did the job. A miss would be a claim about them in
 * their Logbook, and a completion a claim they did something.
 */

/** The thresholds offered, per unit: a light shower to a soaking. */
export const RAIN_SKIP_PRESETS_MM: readonly number[] = [2, 5, 10, 20];
export const RAIN_SKIP_PRESETS_IN: readonly number[] = [0.1, 0.25, 0.5, 1];

const MM_PER_INCH = 25.4;

export type RainUnit = 'mm' | 'in';

/** Metric shows millimetres; everyone else inches, as the app's °F already assumes. */
export function rainUnitFor(unitSystem: UnitSystem | null | undefined): RainUnit {
  return unitSystem === 'metric' ? 'mm' : 'in';
}

/** The stored threshold (always mm) for a preset picked in `unit`. */
export function rainPresetToMm(value: number, unit: RainUnit): number {
  return unit === 'mm' ? value : Math.round(value * MM_PER_INCH * 100) / 100;
}

/** "5 mm", "0.25 in": an amount of rain as the row and the picker say it. */
export function formatRain(mm: number, unit: RainUnit): string {
  if (unit === 'mm') return `${mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm)} mm`;
  const inches = mm / MM_PER_INCH;
  const shown = inches < 1 ? Math.round(inches * 100) / 100 : Math.round(inches * 10) / 10;
  return `${shown} in`;
}

/** The presets in `unit`, as stored millimetres, with their labels. */
export function rainSkipOptions(unit: RainUnit): { mm: number; label: string }[] {
  const presets = unit === 'mm' ? RAIN_SKIP_PRESETS_MM : RAIN_SKIP_PRESETS_IN;
  return presets.map(v => {
    const mm = rainPresetToMm(v, unit);
    return { mm, label: formatRain(mm, unit) };
  });
}

/**
 * The threshold a bare "unless it rains" sets: the second preset in the
 * person's unit (5 mm, or a quarter inch), enough to have soaked the ground
 * rather than wet it.
 */
export function defaultRainSkipMm(unit: RainUnit): number {
  return rainSkipOptions(unit)[1].mm;
}

/** Whether a task can skip for rain: a repeating one with days to skip. */
export function canSkipForRain(
  task: Pick<Task, 'recurrenceType'> & Partial<Pick<Task, 'polarity' | 'parentId'>>,
): boolean {
  return task.recurrenceType !== 'none' && task.recurrenceType !== 'hours'
    && task.polarity !== 'negative' && !task.parentId;
}

/** Yesterday's and today's rain together, or null when the snapshot carries neither. */
export function recentRainMm(
  snapshot: Pick<WeatherSnapshot, 'yesterdayPrecipitationMm' | 'todayPrecipitationMm'> | null | undefined,
): number | null {
  const y = snapshot?.yesterdayPrecipitationMm;
  const t = snapshot?.todayPrecipitationMm;
  if (typeof y !== 'number' && typeof t !== 'number') return null;
  return (typeof y === 'number' ? y : 0) + (typeof t === 'number' ? t : 0);
}

/**
 * Whether the pass should skip this task's occurrence today.
 *
 * - The occurrence has to be today's (`taskDayKey`, the logical day its date
 *   lands on): a future one isn't due yet, and an overdue one was owed on a
 *   day this reading isn't about.
 * - Once per day per row (`rainSkippedOn`), so an occurrence the person pulls
 *   back onto Today after a skip stays there.
 */
export function shouldSkipForRain(
  task: Pick<Task, 'recurrenceType' | 'completed' | 'archived'> & Partial<Pick<Task, 'rainSkipMm' | 'rainSkippedOn' | 'polarity' | 'parentId'>>,
  rainMm: number | null,
  taskDayKey: string | null,
  todayKey: string,
): boolean {
  const threshold = task.rainSkipMm;
  if (typeof threshold !== 'number' || threshold <= 0) return false;
  if (task.completed || task.archived || !canSkipForRain(task)) return false;
  if (task.rainSkippedOn === todayKey) return false;
  if (taskDayKey !== todayKey) return false;
  return rainMm !== null && rainMm >= threshold;
}

/** "skips after 5 mm of rain", for the repeat caption. Null with no threshold. */
export function describeRainSkip(rainSkipMm: number | null | undefined, unit: RainUnit): string | null {
  if (typeof rainSkipMm !== 'number' || rainSkipMm <= 0) return null;
  return `skips after ${formatRain(rainSkipMm, unit)} of rain`;
}
