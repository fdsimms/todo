/**
 * The unit half of a project's "Nudge me" cadence.
 *
 * `Project.nudgeCadenceDays` is a plain day count and stays one — findProjectStalls
 * compares it against calendar days of quiet, so days are the only unit the
 * feature actually thinks in. This is what lets the editor say "2 weeks" while
 * storing 14, so the picker doesn't have to offer a fixed handful of presets and
 * can't run out of granularity above them.
 */

export type CadenceUnit = 'days' | 'weeks' | 'months';

/** The order the unit pills are offered in. */
export const CADENCE_UNITS: readonly CadenceUnit[] = ['days', 'weeks', 'months'];

/**
 * A month is 30 days flat. Quiet is measured from the last member completed,
 * not from a date on a calendar, so there is nothing for a calendar month to be
 * anchored to — and "1 month" was already 30 days when this was a preset chip.
 */
export const CADENCE_UNIT_DAYS: Record<CadenceUnit, number> = { days: 1, weeks: 7, months: 30 };

/**
 * Ceilings, per unit. They exist only so a held − / + key can't walk the value
 * out to a cadence that would never fire; the point of the stepper is that
 * nothing in between is unsayable.
 */
export const CADENCE_UNIT_MAX: Record<CadenceUnit, number> = { days: 90, weeks: 52, months: 24 };

export interface CadenceParts {
  /** null = never. The same "no value" the stepper's minus key clears to. */
  count: number | null;
  unit: CadenceUnit;
}

/**
 * A stored day count as a count and a unit, in the largest unit that divides it
 * evenly — 30 reads back as 1 month, 14 as 2 weeks, 10 as 10 days.
 */
export function toCadenceParts(days: number): CadenceParts {
  const whole = Math.round(days);
  if (!Number.isFinite(whole) || whole <= 0) return { count: null, unit: 'days' };
  if (whole % CADENCE_UNIT_DAYS.months === 0) {
    return { count: whole / CADENCE_UNIT_DAYS.months, unit: 'months' };
  }
  if (whole % CADENCE_UNIT_DAYS.weeks === 0) {
    return { count: whole / CADENCE_UNIT_DAYS.weeks, unit: 'weeks' };
  }
  return { count: whole, unit: 'days' };
}

/** Back to the stored day count. A null count is the 0 that means "never ask". */
export function fromCadenceParts({ count, unit }: CadenceParts): number {
  if (count === null || count <= 0) return 0;
  return Math.round(count) * CADENCE_UNIT_DAYS[unit];
}

/**
 * Switching units keeps the number and changes what it counts — 2 weeks becomes
 * 2 months, the way every "every N ___" control behaves. From Never it means
 * "yes, nudge me", so it lands on 1 rather than staying off and making the unit
 * pills look inert.
 */
export function withCadenceUnit(parts: CadenceParts, unit: CadenceUnit): CadenceParts {
  if (parts.count === null) return { count: 1, unit };
  return { count: Math.min(parts.count, CADENCE_UNIT_MAX[unit]), unit };
}

const UNIT_NOUN: Record<CadenceUnit, string> = { days: 'day', weeks: 'week', months: 'month' };

/** "Never" / "3 days" / "2 weeks" — the field's collapsed summary. */
export function describeCadence(days: number): string {
  const { count, unit } = toCadenceParts(days);
  if (count === null) return 'Never';
  return `${count} ${UNIT_NOUN[unit]}${count === 1 ? '' : 's'}`;
}

/** The label on a unit pill. */
export function cadenceUnitLabel(unit: CadenceUnit): string {
  return unit.charAt(0).toUpperCase() + unit.slice(1);
}
