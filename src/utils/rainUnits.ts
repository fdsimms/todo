import type { UnitSystem } from './unitConvert';

/**
 * How an amount of rain is shown: millimetres for metric, inches for everyone
 * else, as the app's °F already assumes. Amounts are stored in millimetres.
 */

const MM_PER_INCH = 25.4;

export type RainUnit = 'mm' | 'in';

/** Metric shows millimetres; everyone else inches. */
export function rainUnitFor(unitSystem: UnitSystem | null | undefined): RainUnit {
  return unitSystem === 'metric' ? 'mm' : 'in';
}

/** "5 mm", "0.25 in": an amount of rain as the app says it. */
export function formatRain(mm: number, unit: RainUnit): string {
  if (unit === 'mm') return `${mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm)} mm`;
  const inches = mm / MM_PER_INCH;
  const shown = inches < 1 ? Math.round(inches * 100) / 100 : Math.round(inches * 10) / 10;
  return `${shown} in`;
}
