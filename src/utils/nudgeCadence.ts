/**
 * The unit half of a project's "Nudge me" cadence.
 *
 * `Project.nudgeCadenceDays` is a plain day count and stays one — findProjectStalls
 * compares it against calendar days of quiet, so days are the only unit the
 * feature actually thinks in. This is what lets the editor say "2 weeks" while
 * storing 14, so the picker doesn't have to offer a fixed handful of presets and
 * can't run out of granularity above them.
 */

import type { Project } from '../types';

/**
 * What a project has been asked to do about going quiet: one question, three
 * answers, stored across the two fields that used to be two controls.
 *
 * `nudgeOptIn` and `nudgeCadenceDays` were set independently in the editor, as
 * a switch and a nested stepper, and between them they answered one question in
 * a way nobody could hold in their head. Getting a project to chase you took
 * turning the switch on *and* stepping the cadence off Never; the pull sheet
 * grew two separate empty-state reasons for the two ways of being off
 * (`nudge-excluded`, `cadence-off`); and Settings' own "Default review cadence"
 * could not work at all, because a new project was seeded with the cadence and
 * hardcoded to `nudgeOptIn: false`, which the gate refuses before it ever reads
 * a cadence.
 *
 * The three answers are genuinely distinct, which is why this is a three-way
 * and not the boolean the merge might suggest:
 *
 * - `never` — out of every nudge surface, asked or unasked. A reference list
 *   ("Gift ideas") is never a candidate to pull into today, however you got to
 *   the sheet. This is `nudgeOptIn: false`.
 * - `on-ask` — appears in "Pull from projects" when you open it, and never
 *   volunteers. Tapping the button *is* the nudge, so there is nothing left to
 *   opt into; what the cadence answers is "when should I chase you unprompted",
 *   and this says never.
 * - `scheduled` — the above, plus a review task once it has been quiet for
 *   `nudgeCadenceDays`. `autoSchedule` is only meaningful here.
 *
 * The encoding is unchanged, so nothing stored has to migrate: `never` is
 * `nudgeOptIn: false`, and the other two are `nudgeOptIn: true` split by
 * whether the cadence is positive. What changed is that one control now writes
 * both fields, so the two can no longer be set into a combination that means
 * something the user didn't pick.
 */
export type NudgeMode = 'never' | 'on-ask' | 'scheduled';

/** The order the three answers are offered in: quietest first. */
export const NUDGE_MODES: readonly NudgeMode[] = ['never', 'on-ask', 'scheduled'];

/** Which of the three a stored project is in. */
export function nudgeModeOf(project: Pick<Project, 'nudgeOptIn' | 'nudgeCadenceDays'>): NudgeMode {
  if (!project.nudgeOptIn) return 'never';
  return project.nudgeCadenceDays > 0 ? 'scheduled' : 'on-ask';
}

/**
 * The two stored fields for one chosen answer.
 *
 * `cadenceDays` is only read for `scheduled`, and a `scheduled` with nothing
 * positive to count falls back to a fortnight rather than storing a cadence
 * that can never fire — picking "Every…" and landing on Never is the exact
 * contradiction this whole type exists to make unrepresentable.
 */
export function nudgeFieldsFor(
  mode: NudgeMode,
  cadenceDays: number,
): Pick<Project, 'nudgeOptIn' | 'nudgeCadenceDays'> {
  if (mode === 'never') return { nudgeOptIn: false, nudgeCadenceDays: 0 };
  if (mode === 'on-ask') return { nudgeOptIn: true, nudgeCadenceDays: 0 };
  return { nudgeOptIn: true, nudgeCadenceDays: cadenceDays > 0 ? cadenceDays : FALLBACK_CADENCE_DAYS };
}

/** What "Every…" lands on when it's picked from Never. Two weeks. */
export const FALLBACK_CADENCE_DAYS = 14;

/** The segment labels, and the collapsed summary the editor row shows. */
export const NUDGE_MODE_LABEL: Record<NudgeMode, string> = {
  never: 'Never',
  'on-ask': 'When I ask',
  scheduled: 'Every…',
};

/** "Never" / "When I ask" / "Every 2 weeks" — the field's collapsed summary. */
export function describeNudge(project: Pick<Project, 'nudgeOptIn' | 'nudgeCadenceDays'>): string {
  const mode = nudgeModeOf(project);
  if (mode === 'scheduled') return `Every ${describeCadence(project.nudgeCadenceDays)}`;
  return NUDGE_MODE_LABEL[mode];
}

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
